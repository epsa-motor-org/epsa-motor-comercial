BEGIN;

-- Publicar primero la firma nueva. La firma anterior se elimina al final de
-- esta transacción para que nunca quede una RPC sin confirmador de transferencia.
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
  p_idempotenciasep uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_autor bigint;
  v_rol text;
  v_medio text;
  v_referencia text;
  v_ruta_evidencia text;
  v_observacion text;
  v_confirmador bigint;
  v_existente public.separacion%ROWTYPE;
  v_unidad public.unidad%ROWTYPE;
  v_cliente public.cliente%ROWTYPE;
  v_responsable bigint;
  v_codsep bigint;
  v_resultado jsonb;
  v_reutilizada boolean := false;
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

  IF p_coduni IS NULL OR p_coduni <= 0 OR p_codcli IS NULL OR p_codcli <= 0
    OR p_codusuresp IS NULL OR p_codusuresp <= 0 OR p_idempotenciasep IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Unidad, comprador, responsable o clave de idempotencia inválidos';
  END IF;
  IF p_monadesep IS NULL OR p_monadesep <= 0
    OR p_monadesep <> pg_catalog.round(p_monadesep, 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El monto debe ser positivo y tener hasta dos decimales';
  END IF;
  IF p_fecpagsep IS NULL OR p_fecpagsep < DATE '0001-01-01'
    OR p_fecpagsep > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'La fecha del adelanto es inválida o futura';
  END IF;

  v_medio := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_metpagsep, ''), '[[:space:]]+', ' ', 'g'));
  IF v_medio NOT IN ('Efectivo', 'Transferencia') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Medio de pago inválido';
  END IF;
  v_referencia := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_refsep, ''), '[[:space:]]+', ' ', 'g')), '');
  v_ruta_evidencia := NULLIF(pg_catalog.btrim(COALESCE(p_rutavouchersep, '')), '');
  v_observacion := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_obssep, ''), '[[:space:]]+', ' ', 'g')), '');
  IF v_referencia IS NOT NULL AND pg_catalog.char_length(v_referencia) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'La referencia admite hasta 200 caracteres';
  END IF;
  IF v_medio = 'Transferencia' AND v_referencia IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El medio de pago requiere una referencia';
  END IF;
  IF v_ruta_evidencia IS NOT NULL AND (pg_catalog.char_length(v_ruta_evidencia) > 2048
    OR v_ruta_evidencia ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'La ruta de evidencia es inválida o supera 2048 caracteres';
  END IF;
  IF v_medio = 'Transferencia' AND v_ruta_evidencia IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'La transferencia requiere evidencia';
  END IF;
  IF v_observacion IS NOT NULL AND pg_catalog.char_length(v_observacion) > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'La observación admite hasta 300 caracteres';
  END IF;
  IF v_medio = 'Efectivo' AND v_observacion IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT428', MESSAGE = 'El efectivo requiere observación de recepción';
  END IF;
  IF p_ingreso_confirmado IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'PT427', MESSAGE = 'El ingreso debe confirmarse antes de separar';
  END IF;

  -- En efectivo confirma quien registra la recepción. En transferencia la
  -- persona confirmadora debe ser un gerente activo distinto o igual al autor.
  IF v_medio = 'Efectivo' THEN
    v_confirmador := v_autor;
  ELSE
    IF p_codusu_confirmador IS NULL OR p_codusu_confirmador <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT433', MESSAGE = 'Se requiere un gerente activo como confirmador del ingreso';
    END IF;
    SELECT u.codusu INTO v_confirmador
    FROM public.usuario AS u
    JOIN public.rol AS r ON r.codrol = u.codrol
    WHERE u.codusu = p_codusu_confirmador AND u.estusu AND r.estrol AND r.nomrol = 'Gerente'
    FOR SHARE OF u, r;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT433', MESSAGE = 'El confirmador debe ser un gerente activo';
    END IF;
  END IF;

  -- La misma clave se serializa hasta COMMIT. El confirmador efectivo forma
  -- parte del payload: efectivo normaliza siempre al autor autenticado.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hu005-separacion:' || p_idempotenciasep::text, 5)
  );
  SELECT * INTO v_existente
  FROM public.separacion
  WHERE idempotenciasep = p_idempotenciasep
  FOR SHARE;
  IF FOUND THEN
    IF v_existente.codusu IS DISTINCT FROM v_autor
      OR v_existente.coduni IS DISTINCT FROM p_coduni
      OR v_existente.codcli IS DISTINCT FROM p_codcli
      OR v_existente.codusuresp IS DISTINCT FROM p_codusuresp
      OR v_existente.monadesep IS DISTINCT FROM p_monadesep
      OR v_existente.fecpagsep IS DISTINCT FROM p_fecpagsep
      OR v_existente.metpagsep IS DISTINCT FROM v_medio
      OR v_existente.refsep IS DISTINCT FROM v_referencia
      OR v_existente.rutavouchersep IS DISTINCT FROM v_ruta_evidencia
      OR v_existente.obssep IS DISTINCT FROM v_observacion
      OR v_existente.codusuconfsep IS DISTINCT FROM v_confirmador THEN
      RAISE EXCEPTION USING ERRCODE = 'PT431', MESSAGE = 'Clave de idempotencia reutilizada con otros datos, confirmador o autor';
    END IF;
    v_codsep := v_existente.codsep;
    v_reutilizada := true;
  ELSE
    -- Se bloquea primero la unidad: dos claves diferentes que compitan por ella
    -- se serializan y la segunda vuelve a evaluar los compromisos al continuar.
    SELECT * INTO v_unidad
    FROM public.unidad
    WHERE coduni = p_coduni
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
    END IF;
    IF pg_catalog.btrim(COALESCE(v_unidad.nummotuni, '')) = ''
      OR pg_catalog.btrim(COALESCE(v_unidad.chauni, '')) = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT432', MESSAGE = 'La unidad todavía no está identificada';
    END IF;
    IF v_unidad.estcomuni = 'Vendida'
      OR EXISTS (SELECT 1 FROM public.venta AS v WHERE v.coduni = p_coduni) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT430', MESSAGE = 'La unidad ya está comprometida por una venta';
    END IF;
    IF v_unidad.estcomuni = 'Separada'
      OR EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = p_coduni AND s.estsep = 'Activa') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT429', MESSAGE = 'La unidad ya tiene una separación activa';
    END IF;

    SELECT * INTO v_cliente
    FROM public.cliente
    WHERE codcli = p_codcli
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Comprador inexistente';
    END IF;
    IF NOT v_cliente.estcli THEN
      RAISE EXCEPTION USING ERRCODE = 'PT426', MESSAGE = 'Comprador inactivo';
    END IF;

    SELECT u.codusu INTO v_responsable
    FROM public.usuario AS u
    JOIN public.rol AS r ON r.codrol = u.codrol
    WHERE u.codusu = p_codusuresp AND u.estusu AND r.estrol
      AND r.nomrol IN ('Gerente', 'Administradora', 'Vendedor')
    FOR SHARE OF u, r;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT407', MESSAGE = 'Responsable inexistente, inactivo o no autorizado';
    END IF;

    UPDATE public.unidad
    SET estcomuni = 'Separada'
    WHERE coduni = p_coduni;

    INSERT INTO public.separacion(
      coduni, codcli, codusu, codusuresp, monadesep, fecpagsep, metpagsep,
      refsep, rutavouchersep, obssep, ingconfsep, codusuconfsep, fecconfsep, idempotenciasep, estsep
    )
    VALUES (
      p_coduni, p_codcli, v_autor, v_responsable, p_monadesep, p_fecpagsep, v_medio,
      v_referencia, v_ruta_evidencia, v_observacion, TRUE, v_confirmador, CURRENT_TIMESTAMP, p_idempotenciasep, 'Activa'
    )
    RETURNING codsep INTO v_codsep;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'codsep', s.codsep::text,
    'coduni', s.coduni::text,
    'codcli', s.codcli::text,
    'codusuAutor', s.codusu::text,
    'codusuResponsable', s.codusuresp::text,
    'monto', s.monadesep,
    'fechaPago', s.fecpagsep,
    'medioPago', s.metpagsep,
    'referencia', s.refsep,
    'rutaEvidencia', s.rutavouchersep,
    'observacion', s.obssep,
    'ingresoConfirmado', s.ingconfsep,
    'confirmadoPor', s.codusuconfsep::text,
    'fechaConfirmacion', s.fecconfsep,
    'fechaRegistro', s.fecsep,
    'estado', s.estsep
  ) || pg_catalog.jsonb_build_object('reutilizada', v_reutilizada)
  INTO v_resultado
  FROM public.separacion AS s
  WHERE s.codsep = v_codsep;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)
  TO authenticated;

COMMENT ON FUNCTION public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)
IS 'Registra una separación confirmada; exige gerente activo como confirmador de transferencias y deriva confirmación de efectivo del autor.';

DROP FUNCTION IF EXISTS public.hu005_crear_separacion(bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid);

COMMIT;
