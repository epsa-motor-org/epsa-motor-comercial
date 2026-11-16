-- =====================================================================
-- EPSA Motor · Conexiones del Sprint 2 que todavía no tienen ruta en la API
--
-- Qué hace (sin cambiar tablas ni datos existentes):
--   1. web_registrar_interesado: la cotización o consulta de la web queda
--      guardada como interesado (lead) y aparece en Leads del panel, lista
--      para asignarla a un vendedor (HU-015).
--   2. seguimiento_listar y seguimiento_registrar: el vendedor trabaja sus
--      interesados asignados (contactado, en seguimiento, venta concretada o
--      cerrado) y deja cada contacto en seguimientolead. El gerente y la
--      administradora ven a todos.
--   3. hu003_ubicacion_inicial: dónde está una moto identificada a mano en
--      Compras (sin ubicación), para que luego se pueda trasladar (HU-003).
--   4. hu001_series_unidades: motor y chasis de cada moto, para que
--      Disponibilidad e Inventario los muestren y se pueda buscar por ellos
--      (el inventario de la API todavía no los envía).
--
-- Cómo se usa: Supabase > SQL Editor > New query > pegar TODO > Run.
-- Se puede ejecutar más de una vez sin dañar nada.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Interesado que llega desde la web (visitante sin sesión)
-- ---------------------------------------------------------------------
-- LEGADO: HU-011 se sustituye por supabase/migrations/20261116063202_hu011_consultas_web.sql.
-- No reaplicar este bloque ni su GRANT después de la migración nueva.
CREATE OR REPLACE FUNCTION public.web_registrar_interesado(
  p_nombre text,
  p_telefono text,
  p_codmod bigint DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_codsed bigint DEFAULT NULL,
  p_detalle text DEFAULT NULL,
  p_tipo text DEFAULT 'Cotización'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_nombre text; v_telefono text; v_color text; v_detalle text; v_tipo text;
  v_existente public.lead%ROWTYPE; v_nuevo public.lead%ROWTYPE;
BEGIN
  v_nombre := btrim(regexp_replace(coalesce(p_nombre, ''), '[[:space:]]+', ' ', 'g'));
  v_telefono := public.hu014_normalizar_movil(p_telefono);
  IF v_telefono ~ '^519[0-9]{8}$' THEN v_telefono := substr(v_telefono, 3); END IF;
  v_detalle := nullif(btrim(regexp_replace(coalesce(p_detalle, ''), '[[:space:]]+', ' ', 'g')), '');
  v_tipo := CASE WHEN lower(coalesce(p_tipo, '')) LIKE 'consulta%' THEN 'Consulta' ELSE 'Cotización' END;

  IF char_length(v_nombre) < 3 OR char_length(v_nombre) > 150 OR v_nombre !~ '[[:alpha:]]{2,}' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Escribe tu nombre y apellido.';
  END IF;
  IF v_telefono IS NULL OR v_telefono !~ '^9[0-9]{8}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Escribe un celular de 9 dígitos que empiece con 9.';
  END IF;
  IF char_length(coalesce(v_detalle, '')) > 1500 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El mensaje es demasiado largo.';
  END IF;
  IF p_codmod IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.modelo WHERE codmod = p_codmod AND estmod = 'Publicado') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Ese modelo ya no está publicado. Elige otro.';
  END IF;
  IF p_codmod IS NULL AND v_tipo = 'Cotización' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Elige un modelo.';
  END IF;
  IF p_codsed IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sede WHERE codsed = p_codsed AND estsed) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Esa sede no está disponible. Elige otra.';
  END IF;

  -- Color: solo los que acepta la tabla lead; otro color se anota en el detalle
  v_color := nullif(btrim(coalesce(p_color, '')), '');
  IF v_color IS NOT NULL THEN
    SELECT c INTO v_color FROM unnest(ARRAY['Rojo','Azul','Amarillo','Verde','Negro']) AS colores(c) WHERE lower(c) = lower(btrim(p_color));
    IF v_color IS NULL THEN v_detalle := concat_ws(' · ', v_detalle, 'Color: ' || btrim(p_color)); END IF;
  END IF;

  -- Freno contra envíos masivos desde la web
  IF (SELECT count(*) FROM public.lead WHERE tipreglea = 'Web' AND fecreglea > now() - interval '10 minutes') >= 40 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT429', MESSAGE = 'Recibimos muchas solicitudes. Inténtalo en unos minutos o escríbenos por WhatsApp.';
  END IF;

  -- El mismo celular dentro de 24 horas no crea otro interesado: se suma su mensaje al que ya está abierto
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('web:' || v_telefono, 14));
  SELECT * INTO v_existente FROM public.lead
  WHERE tipreglea = 'Web' AND public.hu014_normalizar_movil(tellea) = v_telefono
    AND estlea IN ('Nuevo', 'Contactado', 'En seguimiento')
    AND fecreglea > now() - interval '24 hours'
  ORDER BY fecreglea DESC LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.lead
       SET obslea = left(concat_ws(E'\n', obslea, to_char(now() AT TIME ZONE 'America/Lima', 'DD/MM HH24:MI') || ' · ' || v_tipo || coalesce(': ' || v_detalle, '')), 10000),
           codmod = coalesce(p_codmod, codmod), collea = coalesce(v_color, collea), codsed = coalesce(p_codsed, codsed)
     WHERE codlea = v_existente.codlea;
    RETURN jsonb_build_object('codlea', v_existente.codlea::text, 'repetido', true);
  END IF;

  INSERT INTO public.lead(codmod, codusu, codcwa, nomlea, tellea, orilea, canlea, obslea, estlea, codsed, collea, tipreglea, codcli, codcrelea, fecreglea)
  VALUES (p_codmod, NULL, NULL, v_nombre, v_telefono, 'Web', 'Web', left(v_tipo || coalesce(': ' || v_detalle, ''), 10000), 'Nuevo', p_codsed, v_color, 'Web', NULL, NULL, now())
  RETURNING * INTO v_nuevo;
  RETURN jsonb_build_object('codlea', v_nuevo.codlea::text, 'repetido', false);
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Seguimiento: interesados visibles para quien inició sesión
--    (vendedor: los suyos; gerente y administradora: todos)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seguimiento_listar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_codusu bigint; v_rol text; v_resultado jsonb;
BEGIN
  SELECT u.codusu, r.nomrol INTO v_codusu, v_rol
  FROM public.usuario u JOIN public.rol r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu AND r.estrol;
  IF NOT FOUND OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Tu perfil no puede ver el seguimiento.';
  END IF;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.orden DESC, x.codlea DESC), '[]'::jsonb) INTO v_resultado
  FROM (
    SELECT l.codlea, coalesce(ult.fecinisle, l.fecreglea) AS orden,
      jsonb_build_object(
        'codlea', l.codlea::text, 'nomlea', l.nomlea, 'tellea', l.tellea,
        'codmod', l.codmod::text, 'nommod', m.nommod, 'collea', l.collea,
        'canlea', l.canlea, 'orilea', l.orilea, 'tipreglea', l.tipreglea,
        'nomsed', ubi.nomubi, 'estlea', l.estlea, 'obslea', l.obslea, 'fecreglea', l.fecreglea,
        'codusu', l.codusu::text,
        'responsable', CASE WHEN u.codusu IS NULL THEN NULL ELSE jsonb_build_object(
          'codusu', u.codusu::text, 'nombre', btrim(u.nomusu || ' ' || coalesce(u.apepatusu, ''))) END,
        'proximo', ult.fecprosle,
        'historial', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
              'codsle', h.codsle::text, 'fecha', h.fecinisle, 'tipo', h.tipsle, 'detalle', h.dessle,
              'proximo', h.fecprosle, 'usuario', btrim(coalesce(us.nomusu, '') || ' ' || coalesce(us.apepatusu, '')))
            ORDER BY h.fecinisle DESC, h.codsle DESC)
          FROM (SELECT * FROM public.seguimientolead s WHERE s.codlea = l.codlea ORDER BY s.fecinisle DESC, s.codsle DESC LIMIT 30) h
          LEFT JOIN public.usuario us ON us.codusu = h.codusu
        ), '[]'::jsonb)
      ) AS item
    FROM public.lead l
    LEFT JOIN public.modelo m ON m.codmod = l.codmod
    LEFT JOIN public.sede se ON se.codsed = l.codsed
    LEFT JOIN public.ubicacion ubi ON ubi.codubi = se.codubi
    LEFT JOIN public.usuario u ON u.codusu = l.codusu
    LEFT JOIN LATERAL (
      SELECT s.fecinisle, s.fecprosle FROM public.seguimientolead s
      WHERE s.codlea = l.codlea ORDER BY s.fecinisle DESC, s.codsle DESC LIMIT 1
    ) ult ON true
    WHERE v_rol IN ('Gerente', 'Administradora') OR l.codusu = v_codusu
    ORDER BY coalesce(ult.fecinisle, l.fecreglea) DESC, l.codlea DESC
    LIMIT 500
  ) x;
  RETURN v_resultado;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Seguimiento: registrar un contacto y el nuevo estado del interesado
--    Estados: Contactado, En seguimiento, Convertido (venta concretada), Cerrado (sin venta)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seguimiento_registrar(
  p_codlea bigint,
  p_tipo text,
  p_detalle text,
  p_estado text DEFAULT NULL,
  p_proximo timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_codusu bigint; v_rol text; v_lead public.lead%ROWTYPE;
  v_tipo text; v_detalle text; v_estado text; v_cerrado boolean; v_codsle bigint;
  v_hoy timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima';
BEGIN
  SELECT u.codusu, r.nomrol INTO v_codusu, v_rol
  FROM public.usuario u JOIN public.rol r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu AND r.estrol
  FOR SHARE OF u, r;
  IF NOT FOUND OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Tu perfil no puede registrar seguimientos.';
  END IF;

  v_tipo := btrim(coalesce(p_tipo, ''));
  IF v_tipo NOT IN ('Llamada', 'WhatsApp', 'Visita', 'Prueba de manejo', 'Correo', 'Nota', 'Venta') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Elige el tipo de contacto.';
  END IF;
  v_detalle := btrim(regexp_replace(coalesce(p_detalle, ''), '[[:space:]]+', ' ', 'g'));
  IF char_length(v_detalle) < 5 OR char_length(v_detalle) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Cuenta brevemente qué pasó (entre 5 y 1000 caracteres).';
  END IF;
  IF p_estado IS NOT NULL AND p_estado NOT IN ('Contactado', 'En seguimiento', 'Convertido', 'Cerrado') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Elige un estado válido.';
  END IF;

  SELECT * INTO v_lead FROM public.lead WHERE codlea = p_codlea FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Ese interesado ya no existe.';
  END IF;
  IF v_rol = 'Vendedor' AND v_lead.codusu IS DISTINCT FROM v_codusu THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Este interesado ya no está a tu cargo. Actualiza la lista.';
  END IF;

  -- Sin estado elegido: una venta lo deja como «Convertido» y el primer contacto como «Contactado»
  v_estado := coalesce(p_estado, CASE WHEN v_tipo = 'Venta' THEN 'Convertido' WHEN v_lead.estlea = 'Nuevo' THEN 'Contactado' ELSE v_lead.estlea END);
  IF v_tipo = 'Venta' AND v_estado <> 'Convertido' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Una venta deja al interesado como «Venta concretada».';
  END IF;
  v_cerrado := v_estado IN ('Convertido', 'Cerrado');
  IF p_proximo IS NOT NULL THEN
    IF v_cerrado THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Si el interesado queda cerrado no hace falta otro contacto: deja la fecha vacía.';
    END IF;
    IF NOT isfinite(p_proximo) OR p_proximo < v_hoy OR p_proximo > now() + interval '1 year' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El próximo contacto debe ser desde hoy y dentro del próximo año.';
    END IF;
  END IF;

  UPDATE public.lead SET estlea = v_estado WHERE codlea = p_codlea;
  INSERT INTO public.seguimientolead(codlea, codusu, fecinisle, horsle, tipsle, dessle, fecprosle)
  VALUES (p_codlea, v_codusu, now(), (now() AT TIME ZONE 'America/Lima')::time, v_tipo, v_detalle, p_proximo)
  RETURNING codsle INTO v_codsle;
  RETURN jsonb_build_object('codlea', p_codlea::text, 'estlea', v_estado, 'codsle', v_codsle::text, 'proximo', p_proximo);
END;
$$;

-- ---------------------------------------------------------------------
-- 4. HU-003: ubicación inicial de una moto identificada a mano (sin ubicación)
--    Solo gerente o administradora; si ya tiene ubicación, se usa Trasladar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu003_ubicacion_inicial(p_coduni bigint, p_codubi bigint, p_observacion text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_codusu bigint; v_nombre text; v_unidad public.unidad%ROWTYPE; v_ubicacion public.ubicacion%ROWTYPE; v_obs text;
BEGIN
  IF coalesce(public.hu026_rol_actual(), '') NOT IN ('Gerente', 'Administradora') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo gerencia o administración registran la ubicación de una moto.';
  END IF;
  SELECT codusu, btrim(nomusu || ' ' || coalesce(apepatusu, '')) INTO v_codusu, v_nombre FROM public.usuario WHERE uuidusu = auth.uid();
  v_obs := nullif(btrim(regexp_replace(coalesce(p_observacion, ''), '[[:space:]]+', ' ', 'g')), '');
  IF char_length(coalesce(v_obs, '')) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'La observación admite hasta 500 caracteres.';
  END IF;
  SELECT * INTO v_unidad FROM public.unidad WHERE coduni = p_coduni FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'La moto no existe.';
  END IF;
  IF v_unidad.codubi IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La moto ya tiene ubicación registrada: usa Trasladar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.movimientoubicacion WHERE coduni = p_coduni AND estmub IN ('Pendiente', 'En transito')) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La moto tiene un traslado en curso.';
  END IF;
  SELECT * INTO v_ubicacion FROM public.ubicacion WHERE codubi = p_codubi;
  IF NOT FOUND OR NOT v_ubicacion.estubi THEN
    RAISE EXCEPTION USING ERRCODE = 'PT422', MESSAGE = 'Elige una ubicación activa.';
  END IF;
  UPDATE public.unidad
     SET codubi = p_codubi,
         obsuni = left(concat_ws(E'\n', obsuni, to_char(now() AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI') || ' · Ubicación inicial: ' || v_ubicacion.nomubi || ' (' || coalesce(v_nombre, 'sin usuario') || ')' || coalesce(' · ' || v_obs, '')), 4000)
   WHERE coduni = p_coduni;
  RETURN jsonb_build_object('coduni', p_coduni::text, 'ubicacionConfirmada', jsonb_build_object('codubi', v_ubicacion.codubi::text, 'nomubi', v_ubicacion.nomubi, 'tipubi', v_ubicacion.tipubi));
END;
$$;

-- ---------------------------------------------------------------------
-- 5. HU-001: motor y chasis de cada moto (gerente, administradora y vendedor)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu001_series_unidades()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF coalesce(public.hu026_rol_actual(), '') NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Perfil no autorizado';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('coduni', u.coduni::text, 'nummotuni', u.nummotuni, 'chauni', u.chauni) ORDER BY u.coduni)
                   FROM public.unidad u), '[]'::jsonb);
END;
$$;

-- Permisos: la web (visitante) solo registra interesados; el panel usa su sesión
REVOKE ALL ON FUNCTION public.web_registrar_interesado(text, text, bigint, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seguimiento_listar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seguimiento_registrar(bigint, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_registrar_interesado(text, text, bigint, text, bigint, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seguimiento_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seguimiento_registrar(bigint, text, text, text, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.hu003_ubicacion_inicial(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hu003_ubicacion_inicial(bigint, bigint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.hu001_series_unidades() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hu001_series_unidades() TO authenticated;

COMMIT;

-- Para que la API vea las funciones nuevas al instante
NOTIFY pgrst, 'reload schema';

-- Comprobación: deben salir las 5 funciones
SELECT proname FROM pg_proc
WHERE proname IN ('web_registrar_interesado', 'seguimiento_listar', 'seguimiento_registrar', 'hu003_ubicacion_inicial', 'hu001_series_unidades')
ORDER BY proname;
