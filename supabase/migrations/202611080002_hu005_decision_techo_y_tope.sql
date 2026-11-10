BEGIN;

-- HU-005 · Correcciones de QA (EMT-153) y decisión de negocio de Harold sobre el techo (2026-11-08).
-- Complementa 202611050001, 202611060001, 202611070001 y 202611080001.
--   1) DEF-S3-001: el adelanto no puede superar el precio de lista del modelo de la moto (PT435). Si el modelo no
--      tiene precio de lista registrado no se puede comprobar el tope y no se separa hasta registrarlo (PT436).
--      La fecha del adelanto debe ser de hoy o de los últimos 30 días (PT437); la RPC ya rechaza fechas futuras.
--   2) Techo al separar: la separación guarda la decisión del comprador.
--      «Por definir»: decisión pendiente. «Sin techo»: lo eligió expresamente. «Con techo»: tipo elegido; si requiere
--      instalación, queda pendiente en Preparación. La decisión queda con fecha y autor para que la venta (HU-006)
--      la continúe. Una vez decidido se puede cambiar de techo, pero no volver a «Por definir».
--      Si gerencia cambia el techo de una moto separada desde su ficha (HU-004), la decisión de la separación lo sigue.
--   3) El formulario trae los precios de lista y la separación activa muestra la decisión del techo.
-- Compatible con la versión publicada: las separaciones nuevas nacen «Por definir» hasta que se guarda el techo.
-- Se puede volver a ejecutar sin efectos adicionales.

-- 2a) Decisión del techo en la separación -----------------------------------------------------------------------
-- «Sin techo» es el tipo que no lleva instalación ni proveedor; cualquier otro tipo es «Con techo».
CREATE OR REPLACE FUNCTION public.hu005_decision_de_techo(p_codtte bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_codtte IS NULL THEN 'Por definir'
    WHEN NOT COALESCE(t.reqinsttte, false) AND NOT COALESCE(t.reqprotte, false) THEN 'Sin techo'
    ELSE 'Con techo' END
  FROM (SELECT 1) AS x
  LEFT JOIN public.tipotecho AS t ON t.codtte = p_codtte;
$$;

DO $$
DECLARE
  v_primera boolean := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'separacion' AND column_name = 'dectechosep');
BEGIN
  ALTER TABLE public.separacion
    ADD COLUMN IF NOT EXISTS dectechosep varchar(20) NOT NULL DEFAULT 'Por definir',
    ADD COLUMN IF NOT EXISTS codttesep bigint,
    ADD COLUMN IF NOT EXISTS fecdectechosep timestamptz,
    ADD COLUMN IF NOT EXISTS codusudectechosep bigint;
  -- Solo la primera vez: las separaciones activas guardadas antes de esta versión toman como decisión el techo que
  -- ya tiene configurado su moto; si no tiene, quedan «Por definir». Volver a ejecutar no cambia ninguna decisión.
  IF v_primera THEN
    UPDATE public.separacion AS s
    SET dectechosep = public.hu005_decision_de_techo(u.codtte),
        codttesep = u.codtte,
        fecdectechosep = s.fecsep,
        codusudectechosep = s.codusu
    FROM public.unidad AS u
    WHERE u.coduni = s.coduni AND s.estsep = 'Activa' AND u.codtte IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_separacion_tipotecho') THEN
    ALTER TABLE public.separacion ADD CONSTRAINT fk_separacion_tipotecho
      FOREIGN KEY (codttesep) REFERENCES public.tipotecho(codtte);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_separacion_usuario_techo') THEN
    ALTER TABLE public.separacion ADD CONSTRAINT fk_separacion_usuario_techo
      FOREIGN KEY (codusudectechosep) REFERENCES public.usuario(codusu);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_separacion_decision_techo') THEN
    ALTER TABLE public.separacion ADD CONSTRAINT chk_separacion_decision_techo CHECK (
      (dectechosep = 'Por definir' AND codttesep IS NULL)
      OR (dectechosep IN ('Sin techo', 'Con techo') AND codttesep IS NOT NULL)
    );
  END IF;
END $$;

-- 2b) Registrar el techo que eligió el comprador. Elegir lo mismo otra vez no cambia nada (sirve para reintentar).
--     Si el tipo cambia, la configuración de la moto se actualiza y el proveedor se borra (lo pone gerencia, HU-004).
CREATE OR REPLACE FUNCTION public.hu005_elegir_techo(p_coduni bigint, p_codtte bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_actual bigint;
  v_codsep bigint;
  v_previa bigint;
  v_tipo public.tipotecho%ROWTYPE;
  v_decision text;
BEGIN
  SELECT p.codusu INTO v_codusu FROM public.hu005_perfil_comercial() AS p;
  IF p_coduni IS NULL OR p_coduni <= 0 OR p_codtte IS NULL OR p_codtte <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Moto o techo inválido';
  END IF;
  SELECT u.codtte INTO v_actual FROM public.unidad AS u WHERE u.coduni = p_coduni FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
  END IF;
  SELECT s.codsep, s.codttesep INTO v_codsep, v_previa
  FROM public.separacion AS s
  WHERE s.coduni = p_coduni AND s.estsep = 'Activa'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La moto no tiene una separación activa';
  END IF;
  SELECT * INTO v_tipo FROM public.tipotecho AS t WHERE t.codtte = p_codtte AND COALESCE(t.esttte, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Tipo de techo inexistente o inactivo';
  END IF;
  v_decision := public.hu005_decision_de_techo(p_codtte);

  IF v_actual IS DISTINCT FROM p_codtte THEN
    UPDATE public.unidad SET codtte = p_codtte, codpro = NULL, dettecuni = NULL WHERE coduni = p_coduni;
  END IF;
  -- La moto ya tenía ese techo configurado (o el trigger de abajo ya lo anotó): se registra la decisión una vez
  UPDATE public.separacion
  SET dectechosep = v_decision, codttesep = p_codtte, fecdectechosep = now(), codusudectechosep = v_codusu
  WHERE codsep = v_codsep AND codttesep IS DISTINCT FROM p_codtte;

  RETURN pg_catalog.jsonb_build_object(
    'coduni', p_coduni::text,
    'codsep', v_codsep::text,
    'decision', v_decision,
    'techo', pg_catalog.jsonb_build_object(
      'codtte', v_tipo.codtte::text, 'nombre', v_tipo.nomtte, 'requiereInstalacion', COALESCE(v_tipo.reqinsttte, false)),
    'preparacion', public.hu033_proyectar_preparacion_unidad(p_coduni)
  );
END;
$$;

-- 2c) Si el techo de una moto separada cambia por otra vía (configuración de techo de HU-004, solo gerencia y
--     administración), la decisión de su separación activa lo sigue, con quién y cuándo.
CREATE OR REPLACE FUNCTION public.hu005_sincronizar_decision_techo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
BEGIN
  SELECT u.codusu INTO v_codusu FROM public.usuario AS u WHERE u.uuidusu = auth.uid();
  UPDATE public.separacion AS s
  SET dectechosep = public.hu005_decision_de_techo(NEW.codtte),
      codttesep = NEW.codtte,
      fecdectechosep = CASE WHEN NEW.codtte IS NULL THEN NULL ELSE now() END,
      codusudectechosep = CASE WHEN NEW.codtte IS NULL THEN NULL ELSE COALESCE(v_codusu, s.codusudectechosep) END
  WHERE s.coduni = NEW.coduni AND s.estsep = 'Activa' AND s.codttesep IS DISTINCT FROM NEW.codtte;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS hu005_unidad_decision_techo ON public.unidad;
CREATE TRIGGER hu005_unidad_decision_techo
AFTER UPDATE OF codtte ON public.unidad
FOR EACH ROW WHEN (OLD.codtte IS DISTINCT FROM NEW.codtte)
EXECUTE FUNCTION public.hu005_sincronizar_decision_techo();

-- 1) Tope del adelanto: no puede superar el precio de lista del modelo de la moto --------------------------------
CREATE OR REPLACE FUNCTION public.hu005_verificar_tope_adelanto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_precio numeric;
BEGIN
  SELECT m.premod INTO v_precio
  FROM public.unidad AS u
  JOIN public.modelo AS m ON m.codmod = u.codmod
  WHERE u.coduni = NEW.coduni;
  IF v_precio IS NULL OR v_precio <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT436', MESSAGE = 'La moto no tiene precio de lista registrado';
  END IF;
  IF NEW.monadesep > v_precio THEN
    RAISE EXCEPTION USING ERRCODE = 'PT435', MESSAGE = 'El adelanto no puede superar el precio de lista de la moto';
  END IF;
  -- Fecha del adelanto realista: de hoy o de los últimos 30 días (la RPC ya rechaza fechas futuras)
  IF NEW.fecpagsep < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT437', MESSAGE = 'La fecha del adelanto no puede ser de hace más de 30 días';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hu005_separacion_tope_adelanto ON public.separacion;
CREATE TRIGGER hu005_separacion_tope_adelanto
BEFORE INSERT ON public.separacion
FOR EACH ROW EXECUTE FUNCTION public.hu005_verificar_tope_adelanto();

-- 3) Formulario con precios de lista y separación activa con la decisión del techo ------------------------------
CREATE OR REPLACE FUNCTION public.hu005_formulario_separacion()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
BEGIN
  SELECT p.codusu, p.rol INTO v_codusu, v_rol FROM public.hu005_perfil_comercial() AS p;
  -- La cuenta técnica de integración (dominio interno) no es una persona: no se ofrece.
  RETURN pg_catalog.jsonb_build_object(
    'usuarioActual', pg_catalog.jsonb_build_object('codusu', v_codusu::text, 'rol', v_rol),
    'tiposDocumento', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('codtdo', t.codtdo::text, 'nombre', t.nomtdo) ORDER BY t.codtdo), '[]'::jsonb)
      FROM public.tipodocumento AS t WHERE t.esttdo),
    'responsables', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'codusu', u.codusu::text,
        'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', u.nomusu, u.apepatusu, u.apematusu), '[[:space:]]+', ' ', 'g')),
        'rol', r.nomrol) ORDER BY u.nomusu, u.apepatusu, u.codusu), '[]'::jsonb)
      FROM public.usuario AS u JOIN public.rol AS r ON r.codrol = u.codrol
      WHERE u.estusu AND r.estrol AND r.nomrol IN ('Gerente', 'Administradora', 'Vendedor')
        AND u.corusu NOT ILIKE '%@epsa.internal'),
    'tiposTecho', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'codtte', t.codtte::text, 'nombre', t.nomtte, 'requiereInstalacion', COALESCE(t.reqinsttte, false),
        'sinTecho', public.hu005_decision_de_techo(t.codtte) = 'Sin techo'
      ) ORDER BY public.hu005_decision_de_techo(t.codtte) DESC, t.codtte), '[]'::jsonb)
      FROM public.tipotecho AS t
      WHERE COALESCE(t.esttte, true)
    ),
    'preciosLista', (
      SELECT COALESCE(pg_catalog.jsonb_object_agg(m.codmod::text, m.premod), '{}'::jsonb)
      FROM public.modelo AS m
      WHERE m.premod IS NOT NULL AND m.premod > 0
    ),
    'gerentes', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'codusu', u.codusu::text,
        'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', u.nomusu, u.apepatusu, u.apematusu), '[[:space:]]+', ' ', 'g'))) ORDER BY u.nomusu, u.apepatusu, u.codusu), '[]'::jsonb)
      FROM public.usuario AS u JOIN public.rol AS r ON r.codrol = u.codrol
      WHERE u.estusu AND r.estrol AND r.nomrol = 'Gerente'
        AND u.corusu NOT ILIKE '%@epsa.internal')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hu005_separacion_activa(p_coduni bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Unidad inválida';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'codsep', s.codsep::text,
    'coduni', s.coduni::text,
    'comprador', public.hu005_proyectar_cliente(s.codcli),
    'autor', CASE WHEN a.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'codusu', a.codusu::text, 'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', a.nomusu, a.apepatusu, a.apematusu), '[[:space:]]+', ' ', 'g'))) END,
    'responsable', CASE WHEN r.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'codusu', r.codusu::text, 'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', r.nomusu, r.apepatusu, r.apematusu), '[[:space:]]+', ' ', 'g'))) END,
    'confirmador', CASE WHEN c.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'codusu', c.codusu::text, 'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', c.nomusu, c.apepatusu, c.apematusu), '[[:space:]]+', ' ', 'g'))) END,
    'monto', s.monadesep,
    'fechaPago', s.fecpagsep,
    'medioPago', s.metpagsep,
    'referencia', s.refsep,
    'rutaEvidencia', s.rutavouchersep,
    'observacion', s.obssep,
    'ingresoConfirmado', s.ingconfsep,
    'fechaConfirmacion', s.fecconfsep,
    'fechaRegistro', s.fecsep,
    'estado', s.estsep,
    'decisionTecho', pg_catalog.jsonb_build_object(
      'decision', s.dectechosep,
      'codtte', s.codttesep::text,
      'nombre', te.nomtte,
      'requiereInstalacion', COALESCE(te.reqinsttte, false),
      'fecha', s.fecdectechosep,
      'por', CASE WHEN d.codusu IS NULL THEN NULL ELSE pg_catalog.btrim(pg_catalog.regexp_replace(
        pg_catalog.concat_ws(' ', d.nomusu, d.apepatusu, d.apematusu), '[[:space:]]+', ' ', 'g')) END
    ),
    'techo', pg_catalog.jsonb_build_object(
      'codtte', un.codtte::text,
      'nombre', tt.nomtte,
      'requiereInstalacion', COALESCE(tt.reqinsttte, false),
      'estado', pu.esttecho,
      'proveedor', pr.nompro
    )
  )
  INTO v_resultado
  FROM public.separacion AS s
  JOIN public.unidad AS un ON un.coduni = s.coduni
  LEFT JOIN public.tipotecho AS tt ON tt.codtte = un.codtte
  LEFT JOIN public.preparacionunidad AS pu ON pu.coduni = s.coduni
  LEFT JOIN public.proveedor AS pr ON pr.codpro = un.codpro
  LEFT JOIN public.tipotecho AS te ON te.codtte = s.codttesep
  LEFT JOIN public.usuario AS d ON d.codusu = s.codusudectechosep
  LEFT JOIN public.usuario AS a ON a.codusu = s.codusu
  LEFT JOIN public.usuario AS r ON r.codusu = s.codusuresp
  LEFT JOIN public.usuario AS c ON c.codusu = s.codusuconfsep
  WHERE s.coduni = p_coduni AND s.estsep = 'Activa'
  ORDER BY s.codsep DESC
  LIMIT 1;
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_verificar_tope_adelanto() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_sincronizar_decision_techo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_decision_de_techo(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_elegir_techo(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_elegir_techo(bigint, bigint) TO authenticated;

COMMIT;
