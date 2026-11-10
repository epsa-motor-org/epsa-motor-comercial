BEGIN;

-- HU-005 · Delta final de compatibilidad física. Presupone la cadena
-- develop 202611080001–003 y la integración 202611090001.
-- La configuración de unidad.codtte solo cuenta como techo instalado cuando
-- HU-033 confirma preparacionunidad.esttecho = 'Instalado'.
CREATE OR REPLACE FUNCTION public.hu005_validar_compatibilidad_techo_instalado(
  p_coduni bigint,
  p_decisiontecho text,
  p_codttecomsep bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codtte_unidad bigint;
  v_estado_techo text;
BEGIN
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'ID de unidad inválido';
  END IF;

  -- El orden de bloqueo coincide con las escrituras de preparación HU-033.
  SELECT u.codtte INTO v_codtte_unidad
  FROM public.unidad AS u
  WHERE u.coduni = p_coduni
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
  END IF;

  IF p_decisiontecho = 'Por definir' OR v_codtte_unidad IS NULL THEN
    RETURN;
  END IF;

  SELECT p.esttecho INTO v_estado_techo
  FROM public.preparacionunidad AS p
  WHERE p.coduni = p_coduni
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_estado_techo <> 'Instalado' THEN
    RETURN;
  END IF;

  IF p_decisiontecho = 'Sin techo'
    OR (p_decisiontecho = 'Con techo' AND p_codttecomsep IS DISTINCT FROM v_codtte_unidad) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT438',
      MESSAGE = 'La elección de techo no es compatible con el techo instalado en esta unidad';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hu005_crear_separacion(
  p_coduni bigint,
  p_codcli bigint,
  p_codusuresp bigint,
  p_codusu_confirmador bigint,
  p_monadesep numeric,
  p_fecpagsep date,
  p_metpagsep text,
  p_refsep text,
  p_rutavouchersep text,
  p_obssep text,
  p_ingreso_confirmado boolean,
  p_idempotenciasep uuid,
  p_decisiontecho text,
  p_codttecomsep bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_autor bigint;
  v_rol text;
  v_decision text;
  v_resultado jsonb;
  v_separacion public.separacion%ROWTYPE;
  v_precio_lista numeric(10,2);
  v_reutilizada boolean;
BEGIN
  SELECT u.codusu, r.nomrol INTO v_autor, v_rol
  FROM public.usuario AS u
  JOIN public.rol AS r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu AND r.estrol
  FOR SHARE OF u, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sesión o usuario activo requerido';
  END IF;
  IF v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para registrar separaciones';
  END IF;

  v_decision := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_decisiontecho, ''), '[[:space:]]+', ' ', 'g'));
  IF v_decision NOT IN ('Por definir', 'Sin techo', 'Con techo') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Decisión de techo inválida';
  END IF;
  IF (v_decision = 'Con techo' AND (p_codttecomsep IS NULL OR p_codttecomsep <= 0))
    OR (v_decision <> 'Con techo' AND p_codttecomsep IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El tipo de techo solo se admite para la decisión Con techo';
  END IF;

  -- El helper y este wrapper comparten una transacción. Cualquier error de
  -- techo/precio revierte también la separación y el cambio comercial.
  v_resultado := public.hu005_crear_separacion_base(
    p_coduni, p_codcli, p_codusuresp, p_codusu_confirmador, p_monadesep,
    p_fecpagsep, p_metpagsep, p_refsep, p_rutavouchersep, p_obssep,
    p_ingreso_confirmado, p_idempotenciasep
  );
  v_reutilizada := COALESCE((v_resultado ->> 'reutilizada')::boolean, false);

  SELECT * INTO v_separacion
  FROM public.separacion
  WHERE codsep = (v_resultado ->> 'codsep')::bigint
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Separación inexistente';
  END IF;

  IF (v_separacion.decisiontecho_solicitada IS NOT NULL
      AND (v_separacion.decisiontecho_solicitada IS DISTINCT FROM v_decision
        OR v_separacion.codtte_solicitado IS DISTINCT FROM p_codttecomsep)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'Clave de idempotencia reutilizada con otra decisión de techo';
  END IF;

  IF NOT v_reutilizada THEN
    SELECT m.premod INTO v_precio_lista
    FROM public.unidad AS u
    JOIN public.modelo AS m ON m.codmod = u.codmod
    WHERE u.coduni = p_coduni
    FOR SHARE OF m;
    IF NOT FOUND OR v_precio_lista IS NULL OR v_precio_lista <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT436', MESSAGE = 'La unidad no tiene un precio de lista configurado';
    END IF;
    IF p_monadesep > v_precio_lista THEN
      RAISE EXCEPTION USING ERRCODE = 'PT435', MESSAGE = 'El adelanto supera el precio de lista de la unidad';
    END IF;
  END IF;

  IF NOT v_reutilizada AND v_decision = 'Con techo' THEN
    PERFORM 1 FROM public.tipotecho
    WHERE codtte = p_codttecomsep AND esttte
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
    END IF;
  END IF;

  IF NOT v_reutilizada THEN
    PERFORM public.hu005_validar_compatibilidad_techo_instalado(
      p_coduni, v_decision, p_codttecomsep
    );
  END IF;

  IF v_separacion.decisiontecho_solicitada IS NULL THEN
    UPDATE public.separacion
    SET decisiontecho_solicitada = v_decision,
        codtte_solicitado = p_codttecomsep,
        dectechosep = CASE WHEN v_decision = 'Por definir' THEN v_decision ELSE dectechosep END,
        codttesep = CASE WHEN v_decision = 'Por definir' THEN NULL ELSE codttesep END,
        fecdectechosep = CASE WHEN v_decision = 'Por definir' THEN now() ELSE fecdectechosep END,
        codusudectechosep = CASE WHEN v_decision = 'Por definir' THEN v_autor ELSE codusudectechosep END
    WHERE codsep = v_separacion.codsep;
    v_separacion.decisiontecho_solicitada := v_decision;
    v_separacion.codtte_solicitado := p_codttecomsep;
    IF v_decision = 'Por definir' THEN
      v_separacion.dectechosep := v_decision;
      v_separacion.codttesep := NULL;
    END IF;
  ELSIF v_decision = 'Por definir' AND v_separacion.dectechosep IS NULL THEN
    -- Por definir no necesita un segundo paso de guardado: no representa una
    -- opción final elegida por el comprador y queda resoluble en una llamada futura.
    UPDATE public.separacion
    SET dectechosep = 'Por definir', codttesep = NULL,
        fecdectechosep = now(), codusudectechosep = v_autor
    WHERE codsep = v_separacion.codsep;
    v_separacion.dectechosep := 'Por definir';
    v_separacion.codttesep := NULL;
  END IF;

  RETURN v_resultado || pg_catalog.jsonb_build_object(
    'techo', pg_catalog.jsonb_build_object(
      'decision', CASE
        WHEN v_separacion.decisiontecho_solicitada = 'Por definir'
          OR v_separacion.dectechosep = v_separacion.decisiontecho_solicitada
          THEN v_separacion.dectechosep
        ELSE v_separacion.decisiontecho_solicitada END,
      'codtte', COALESCE(v_separacion.codttesep, v_separacion.codtte_solicitado)::text,
      'guardado', CASE
        WHEN v_separacion.decisiontecho_solicitada = 'Por definir'
          THEN v_separacion.dectechosep IS NOT NULL
        ELSE v_separacion.dectechosep = v_separacion.decisiontecho_solicitada
          AND (v_separacion.dectechosep <> 'Con techo'
            OR v_separacion.codttesep IS NOT DISTINCT FROM v_separacion.codtte_solicitado)
        END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hu005_guardar_techo_separacion(
  p_codsep bigint,
  p_decisiontecho text,
  p_codttecomsep bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_autor bigint;
  v_rol text;
  v_decision text;
  v_separacion public.separacion%ROWTYPE;
  v_reutilizada boolean := false;
BEGIN
  SELECT u.codusu, r.nomrol INTO v_autor, v_rol
  FROM public.usuario AS u
  JOIN public.rol AS r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu AND r.estrol
  FOR SHARE OF u, r;
  IF NOT FOUND OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Usuario activo con rol autorizado requerido';
  END IF;
  IF p_codsep IS NULL OR p_codsep <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'codsep inválido';
  END IF;

  v_decision := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_decisiontecho, ''), '[[:space:]]+', ' ', 'g'));
  IF v_decision NOT IN ('Por definir', 'Sin techo', 'Con techo')
    OR (v_decision = 'Con techo' AND (p_codttecomsep IS NULL OR p_codttecomsep <= 0))
    OR (v_decision <> 'Con techo' AND p_codttecomsep IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Decisión o tipo de techo inválidos';
  END IF;

  SELECT * INTO v_separacion
  FROM public.separacion
  WHERE codsep = p_codsep
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Separación inexistente';
  END IF;
  IF v_separacion.estsep <> 'Activa' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT441', MESSAGE = 'La separación ya no está activa';
  END IF;
  IF v_separacion.dectechosep IS NOT NULL THEN
    IF v_separacion.dectechosep = 'Por definir' THEN
      -- Por definir es una decisión guardada, pero sigue siendo resoluble.
      -- Puede permanecer igual o convertirse en una elección definitiva.
      IF v_separacion.decisiontecho_solicitada IS NOT NULL
        AND v_separacion.decisiontecho_solicitada <> 'Por definir'
        AND (v_separacion.decisiontecho_solicitada IS DISTINCT FROM v_decision
          OR v_separacion.codtte_solicitado IS DISTINCT FROM p_codttecomsep) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'La decisión no coincide con la elección pendiente';
      END IF;
      IF v_decision = 'Con techo' THEN
        PERFORM 1 FROM public.tipotecho
        WHERE codtte = p_codttecomsep AND esttte
        FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
        END IF;
      END IF;
      IF v_decision = 'Por definir' THEN
        v_reutilizada := true;
      ELSE
        PERFORM public.hu005_validar_compatibilidad_techo_instalado(
          v_separacion.coduni, v_decision, p_codttecomsep
        );
        UPDATE public.separacion
        SET dectechosep = v_decision,
            codttesep = p_codttecomsep,
            fecdectechosep = now(),
            codusudectechosep = v_autor
        WHERE codsep = p_codsep;
      END IF;
    ELSIF v_separacion.dectechosep IS DISTINCT FROM v_decision
      OR v_separacion.codttesep IS DISTINCT FROM p_codttecomsep THEN
      -- Una vez elegida una opción definitiva, solo se permite reintentarla
      -- exactamente igual; cualquier cambio requiere otro flujo de negocio.
      RAISE EXCEPTION USING ERRCODE = 'PT440', MESSAGE = 'La elección de techo ya fue guardada con otros datos';
    ELSE
      v_reutilizada := true;
    END IF;
  ELSE
    -- Una solicitud definitiva pendiente de persistencia solo admite el mismo
    -- payload en el reintento. Lo mismo se aplica si falló el guardado de Por
    -- definir; una vez recuperado, esa decisión podrá resolverse en otro PUT.
    IF v_separacion.decisiontecho_solicitada IS NOT NULL
      AND (v_separacion.decisiontecho_solicitada IS DISTINCT FROM v_decision
        OR v_separacion.codtte_solicitado IS DISTINCT FROM p_codttecomsep) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'La decisión no coincide con la elección pendiente';
    END IF;
    IF v_decision = 'Con techo' THEN
      PERFORM 1 FROM public.tipotecho
      WHERE codtte = p_codttecomsep AND esttte
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
      END IF;
    END IF;
    PERFORM public.hu005_validar_compatibilidad_techo_instalado(
      v_separacion.coduni, v_decision, p_codttecomsep
    );
    UPDATE public.separacion
    SET decisiontecho_solicitada = v_decision,
        codtte_solicitado = p_codttecomsep,
        dectechosep = v_decision,
        codttesep = p_codttecomsep,
        fecdectechosep = now(),
        codusudectechosep = v_autor
    WHERE codsep = p_codsep;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'codsep', p_codsep::text,
    'decision', v_decision,
    'codtte', p_codttecomsep::text,
    'guardado', true,
    'reutilizada', v_reutilizada
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_validar_compatibilidad_techo_instalado(bigint,text,bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) TO authenticated;
REVOKE ALL ON FUNCTION public.hu005_guardar_techo_separacion(bigint,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_guardar_techo_separacion(bigint,text,bigint)
  TO authenticated;
REVOKE ALL ON FUNCTION public.hu005_elegir_techo(bigint,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_elegir_techo(bigint,bigint) TO authenticated;
COMMIT;
