BEGIN;

-- HU-005 · Integración incremental posterior a las migrations 202611080001–003.
-- Develop ya creó la decisión comercial canónica (dectechosep/codttesep), el
-- tope por precio, la preparación asociada y el comprador sin documento.
-- Este delta conserva el payload de techo para idempotencia, hace inmutable la
-- decisión final y separa la decisión comercial de la configuración física.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'separacion' AND column_name = 'dectechosep'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'separacion' AND column_name = 'codttesep'
  ) THEN
    RAISE EXCEPTION 'HU-005 integración requiere las migrations develop 202611080001 y 202611080002';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)'
  ) IS NULL AND pg_catalog.to_regprocedure(
    'public.hu005_crear_separacion_base(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'HU-005 integración requiere la RPC base de separación';
  END IF;
END;
$$;

ALTER TABLE public.separacion
  ADD COLUMN IF NOT EXISTS decisiontecho_solicitada varchar(20),
  ADD COLUMN IF NOT EXISTS codtte_solicitado bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.separacion'::pg_catalog.regclass AND conname = 'chk_hu005_techo_solicitado'
  ) THEN
    ALTER TABLE public.separacion ADD CONSTRAINT chk_hu005_techo_solicitado CHECK (
      (decisiontecho_solicitada IS NULL AND codtte_solicitado IS NULL)
      OR (decisiontecho_solicitada IN ('Por definir', 'Sin techo') AND codtte_solicitado IS NULL)
      OR (decisiontecho_solicitada = 'Con techo' AND codtte_solicitado IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.separacion'::pg_catalog.regclass AND conname = 'fk_hu005_techo_solicitado'
  ) THEN
    ALTER TABLE public.separacion ADD CONSTRAINT fk_hu005_techo_solicitado
      FOREIGN KEY (codtte_solicitado) REFERENCES public.tipotecho(codtte);
  END IF;
END;
$$;

-- «Sin techo» no necesita un código de tipo en la decisión comercial.
ALTER TABLE public.separacion DROP CONSTRAINT IF EXISTS chk_separacion_decision_techo;
UPDATE public.separacion SET codttesep = NULL WHERE dectechosep = 'Sin techo';
ALTER TABLE public.separacion ADD CONSTRAINT chk_separacion_decision_techo CHECK (
  (dectechosep IN ('Por definir', 'Sin techo') AND codttesep IS NULL)
  OR (dectechosep = 'Con techo' AND codttesep IS NOT NULL)
);

-- HU-004/HU-033 cambian la configuración física; no deben reescribir la
-- decisión comercial registrada en la separación.
DROP TRIGGER IF EXISTS hu005_unidad_decision_techo ON public.unidad;
DROP FUNCTION IF EXISTS public.hu005_sincronizar_decision_techo();

-- Mantiene como helper la operación transaccional ya implementada en HU-005.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)'
  ) IS NOT NULL AND pg_catalog.to_regprocedure(
    'public.hu005_crear_separacion_base(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)'
  ) IS NULL THEN
    EXECUTE 'ALTER FUNCTION public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid) RENAME TO hu005_crear_separacion_base';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_crear_separacion_base(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid
) FROM PUBLIC, anon, authenticated;

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

  IF v_separacion.decisiontecho_solicitada IS NOT NULL
    AND (v_separacion.decisiontecho_solicitada IS DISTINCT FROM v_decision
      OR v_separacion.codtte_solicitado IS DISTINCT FROM p_codttecomsep) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'Clave de idempotencia reutilizada con otra decisión de techo';
  END IF;

  IF NOT v_reutilizada THEN
    SELECT m.premod INTO v_precio_lista
    FROM public.unidad AS u
    JOIN public.modelo AS m ON m.codmod = u.codmod
    WHERE u.coduni = p_coduni
    FOR SHARE OF m;
    IF NOT FOUND OR v_precio_lista IS NULL OR v_precio_lista <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT436', MESSAGE = 'La moto no tiene precio de lista registrado';
    END IF;
    IF p_monadesep > v_precio_lista THEN
      RAISE EXCEPTION USING ERRCODE = 'PT435', MESSAGE = 'El adelanto no puede superar el precio de lista de la moto';
    END IF;
  END IF;

  IF NOT v_reutilizada AND v_decision = 'Con techo' THEN
    PERFORM 1 FROM public.tipotecho WHERE codtte = p_codttecomsep AND COALESCE(esttte, true) FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
    END IF;
  END IF;

  IF v_separacion.decisiontecho_solicitada IS NULL THEN
    UPDATE public.separacion
    SET decisiontecho_solicitada = v_decision,
        codtte_solicitado = p_codttecomsep,
        dectechosep = CASE WHEN v_decision = 'Por definir' THEN 'Por definir' ELSE dectechosep END,
        codttesep = CASE WHEN v_decision = 'Por definir' THEN NULL ELSE codttesep END,
        fecdectechosep = CASE WHEN v_decision = 'Por definir' THEN now() ELSE fecdectechosep END,
        codusudectechosep = CASE WHEN v_decision = 'Por definir' THEN v_autor ELSE codusudectechosep END
    WHERE codsep = v_separacion.codsep;
    v_separacion.decisiontecho_solicitada := v_decision;
    v_separacion.codtte_solicitado := p_codttecomsep;
    IF v_decision = 'Por definir' THEN
      v_separacion.dectechosep := 'Por definir';
      v_separacion.codttesep := NULL;
    END IF;
  ELSIF v_decision = 'Por definir' AND v_separacion.dectechosep IS NULL THEN
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

  SELECT * INTO v_separacion FROM public.separacion WHERE codsep = p_codsep FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Separación inexistente';
  END IF;
  IF v_separacion.estsep <> 'Activa' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT441', MESSAGE = 'La separación ya no está activa';
  END IF;

  IF v_separacion.dectechosep IS NOT NULL THEN
    IF v_separacion.dectechosep = 'Por definir' THEN
      IF v_separacion.decisiontecho_solicitada IS NOT NULL
        AND v_separacion.decisiontecho_solicitada <> 'Por definir'
        AND (v_separacion.decisiontecho_solicitada IS DISTINCT FROM v_decision
          OR v_separacion.codtte_solicitado IS DISTINCT FROM p_codttecomsep) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'La decisión no coincide con la elección pendiente';
      END IF;
      IF v_decision = 'Con techo' THEN
        PERFORM 1 FROM public.tipotecho WHERE codtte = p_codttecomsep AND COALESCE(esttte, true) FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
        END IF;
      END IF;
      IF v_decision = 'Por definir' THEN
        v_reutilizada := true;
      ELSE
        UPDATE public.separacion
        SET dectechosep = v_decision, codttesep = p_codttecomsep,
            fecdectechosep = now(), codusudectechosep = v_autor
        WHERE codsep = p_codsep;
      END IF;
    ELSIF v_separacion.dectechosep IS DISTINCT FROM v_decision
      OR v_separacion.codttesep IS DISTINCT FROM p_codttecomsep THEN
      RAISE EXCEPTION USING ERRCODE = 'PT440', MESSAGE = 'La elección de techo ya fue guardada con otros datos';
    ELSE
      v_reutilizada := true;
    END IF;
  ELSE
    IF v_separacion.decisiontecho_solicitada IS NOT NULL
      AND (v_separacion.decisiontecho_solicitada IS DISTINCT FROM v_decision
        OR v_separacion.codtte_solicitado IS DISTINCT FROM p_codttecomsep) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'La decisión no coincide con la elección pendiente';
    END IF;
    IF v_decision = 'Con techo' THEN
      PERFORM 1 FROM public.tipotecho WHERE codtte = p_codttecomsep AND COALESCE(esttte, true) FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
      END IF;
    END IF;
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
    'codsep', p_codsep::text, 'decision', v_decision,
    'codtte', p_codttecomsep::text, 'guardado', true, 'reutilizada', v_reutilizada
  );
END;
$$;

-- Conserva el endpoint existente, pero ahora resuelve la decisión comercial;
-- no cambia unidad.codtte, proveedor ni preparación.
CREATE OR REPLACE FUNCTION public.hu005_elegir_techo(p_coduni bigint, p_codtte bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codsep bigint;
  v_decision text;
  v_tipo public.tipotecho%ROWTYPE;
  v_actual public.separacion%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  IF p_coduni IS NULL OR p_coduni <= 0 OR p_codtte IS NULL OR p_codtte <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Moto o techo inválido';
  END IF;
  PERFORM 1 FROM public.unidad WHERE coduni = p_coduni FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
  END IF;
  SELECT * INTO v_actual FROM public.separacion
  WHERE coduni = p_coduni AND estsep = 'Activa' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La moto no tiene una separación activa';
  END IF;
  SELECT * INTO v_tipo FROM public.tipotecho WHERE codtte = p_codtte AND COALESCE(esttte, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT439', MESSAGE = 'El tipo de techo no existe o está inactivo';
  END IF;
  v_decision := public.hu005_decision_de_techo(p_codtte);
  IF v_actual.dectechosep <> 'Por definir'
    AND (v_actual.dectechosep IS DISTINCT FROM v_decision
      OR (v_decision = 'Con techo' AND v_actual.codttesep IS DISTINCT FROM p_codtte)
      OR (v_decision = 'Sin techo' AND v_actual.codttesep IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT440', MESSAGE = 'La elección de techo ya fue guardada con otros datos';
  END IF;
  IF v_decision = 'Con techo' THEN
    PERFORM public.hu005_guardar_techo_separacion(v_actual.codsep, v_decision, p_codtte);
  ELSE
    PERFORM public.hu005_guardar_techo_separacion(v_actual.codsep, v_decision, NULL);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'coduni', p_coduni::text,
    'codsep', v_actual.codsep::text,
    'decision', v_decision,
    'techo', pg_catalog.jsonb_build_object(
      'codtte', v_tipo.codtte::text,
      'nombre', v_tipo.nomtte,
      'requiereInstalacion', COALESCE(v_tipo.reqinsttte, false)
    ),
    'preparacion', public.hu033_proyectar_preparacion_unidad(p_coduni)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) TO authenticated;
REVOKE ALL ON FUNCTION public.hu005_guardar_techo_separacion(bigint,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_guardar_techo_separacion(bigint,text,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.hu005_elegir_techo(bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_elegir_techo(bigint,bigint) TO authenticated;

COMMENT ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) IS 'Crea o recupera una separación, conserva el payload de techo para idempotencia y deja la elección final para su guardado separado.';
COMMENT ON FUNCTION public.hu005_guardar_techo_separacion(bigint,text,bigint)
  IS 'Resuelve Por definir o reintenta una elección comercial pendiente; una elección final guardada es inmutable.';

COMMIT;
