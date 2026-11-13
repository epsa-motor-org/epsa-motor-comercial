-- HU-005, HU-006 y HU-021 · Techo ya configurado en la moto, catálogo único de techos, desglose en la ficha y apoyo
-- de lectura para las cancelaciones (13 de noviembre)
--
-- Requiere, en este orden: 202611100001, 202611100002 y las de Michelle 202611120001, 202611120002, 202611120003 y
-- 202611120004 (HU-021, cancelaciones). Va después de todas ellas.
-- Se puede volver a ejecutar. No borra datos ni cambia ventas o separaciones ya registradas.
--
-- 1) Techo configurado (CP-006-07 y CP-006-11 de Jazmín): una moto que ya tiene un techo configurado en su ficha
--    (HU-004), aunque todavía no esté instalado, no se separa ni se vende «Sin techo» ni con otro techo. Antes solo se
--    revisaba el techo «Instalado». Se admite «Por definir» o ese mismo techo, como con el instalado. Una moto
--    configurada «Sin techo» no queda comprometida con ningún techo. El error sigue siendo PT438 (la venta lo
--    devuelve como PT613), así que la API no cambia.
--
-- 2) Catálogo único de techos con su adicional referencial (regla de Harold del 11 de noviembre):
--    · hu005_formulario_separacion devuelve en tiposTecho el adicional referencial de cada tipo y los ordena de
--      menor a mayor adicional (Sin techo, Lona, Techo clásico de fibra, Fibra clásica equipada, Techo de fibra
--      deportiva). Lo usan separar, vender y elegir techo del panel.
--    · hu006_tipos_techo_publicos: el mismo catálogo para la web pública (GET /api/techos), sin datos internos.
--
-- 3) Decisión comercial de techo por moto (CP-006-06): hu006_techo_comercial_unidades devuelve, para las motos con
--    separación activa o venta registrada, la decisión de techo del comprador. El panel la usa para no mostrar
--    «Lista para entrega» una moto cuyo comprador eligió un techo que todavía no está configurado ni instalado, o
--    cuyo techo sigue por definir. Solo lectura; los tres roles comerciales.
--
-- 4) hu006_venta_de_unidad agrega el desglose de Michelle: precio base, adicional referencial y adicional acordado.
--    Mantiene el filtro de HU-021 (202611120004): solo devuelve la venta vigente, nunca una cancelada.
--
-- 5) Al revés de (1): si el comprador ya decidió el techo en su separación activa o en su venta («Sin techo» o «Con
--    techo» y su tipo), la configuración de techo de la moto (HU-004) solo puede ser esa: con «Con techo X», solo X;
--    con «Sin techo», ningún techo. Así la configuración física no contradice lo vendido. Con «Por definir» no se
--    restringe. Nuevo código PT423 (409 en la API de techo).
--
-- 6) CP-006-12 (dos conversiones simultáneas de la misma separación): la segunda solicitud esperaba el bloqueo de la
--    moto y, al continuar, ya no encontraba la separación activa y respondía 400 («La venta directa requiere una
--    decisión de techo válida»). hu006_crear_venta (versión de Michelle del 12/11, sin otros cambios) revisa antes si
--    la moto ya tiene una venta registrada y responde PT604 (409), igual que una venta directa simultánea. Lo mismo si
--    la separación que se convertía se canceló mientras tanto (HU-021): antes respondía 400 por falta de techo.
--
-- HU-021 (complementos al backend de Michelle, 202611120004; no cambian sus reglas ni sus respuestas):
-- 7) Una venta cancelada no se modifica: antes se podía elegir su techo «Por definir» (cambiando su total) o anotar su
--    comprobante por PUT /api/ventas/:codven/techo o /comprobante. Ahora responde PT623 (409). Las separaciones ya
--    exigían estar activas para cambiar su techo.
-- 8) Escenario 11 (venta sin responsable asignado): la ficha y «Ventas a clientes» la ocultaban porque unían el
--    responsable con JOIN. Se cambia solo esa unión a LEFT JOIN; el responsable sale con codusu null.
-- 9) hu021_cancelaciones_unidad: historial de separaciones y ventas canceladas de una moto (quién, cuándo, motivo,
--    observación del dinero y montos conservados). Solo lectura. Gerente y administradora ven todas; el vendedor,
--    solo las operaciones de las que es responsable vigente (misma regla que la consulta de Michelle).

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1) Techo configurado o instalado
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu005_validar_compatibilidad_techo_instalado(
  p_coduni bigint, p_decisiontecho text, p_codttecomsep bigint
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
  -- Una moto configurada «Sin techo» no está comprometida con ningún techo
  IF public.hu005_decision_de_techo(v_codtte_unidad) <> 'Con techo' THEN
    RETURN;
  END IF;

  SELECT p.esttecho INTO v_estado_techo
  FROM public.preparacionunidad AS p
  WHERE p.coduni = p_coduni
  FOR SHARE;

  -- Configurado (pendiente, en proceso) o instalado: solo ese mismo techo
  IF p_decisiontecho = 'Sin techo'
    OR (p_decisiontecho = 'Con techo' AND p_codttecomsep IS DISTINCT FROM v_codtte_unidad) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT438',
      MESSAGE = CASE WHEN v_estado_techo = 'Instalado'
        THEN 'La elección de techo no es compatible con el techo instalado en esta unidad'
        ELSE 'La elección de techo no es compatible con el techo configurado en esta unidad' END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_validar_compatibilidad_techo_instalado(bigint, text, bigint) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2) Catálogo de techos con su adicional referencial
-- ---------------------------------------------------------------------------------------------
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
        'sinTecho', public.hu005_decision_de_techo(t.codtte) = 'Sin techo',
        'adicionalReferencial', t.adicionalref
      ) ORDER BY COALESCE(t.adicionalref, 0), t.codtte), '[]'::jsonb)
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

REVOKE ALL ON FUNCTION public.hu005_formulario_separacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_formulario_separacion() TO authenticated;

-- Catálogo público: solo nombre y adicional referencial de los tipos activos
CREATE OR REPLACE FUNCTION public.hu006_tipos_techo_publicos()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'codtte', t.codtte::text,
    'nombre', t.nomtte,
    'adicionalReferencial', t.adicionalref,
    'sinTecho', public.hu005_decision_de_techo(t.codtte) = 'Sin techo'
  ) ORDER BY t.adicionalref, t.codtte), '[]'::jsonb)
  FROM public.tipotecho AS t
  WHERE t.esttte IS TRUE AND t.adicionalref IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.hu006_tipos_techo_publicos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hu006_tipos_techo_publicos() TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3) Decisión comercial de techo por moto (separación activa o venta registrada)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu006_techo_comercial_unidades()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'coduni', x.coduni::text,
      'origen', x.origen,
      'codigo', x.codigo::text,
      'decision', x.decision,
      'codtte', x.codtte::text,
      'nombre', t.nomtte,
      'requiereInstalacion', COALESCE(t.reqinsttte, false)
    ) ORDER BY x.coduni)
    FROM (
      SELECT s.coduni, 'Separación'::text AS origen, s.codsep AS codigo, s.dectechosep AS decision, s.codttesep AS codtte
      FROM public.separacion AS s
      WHERE s.estsep = 'Activa'
      UNION ALL
      SELECT v.coduni, 'Venta'::text, v.codven, v.dectechoven, v.codtteven
      FROM public.venta AS v
      WHERE v.estven = 'Registrada'
    ) AS x
    LEFT JOIN public.tipotecho AS t ON t.codtte = x.codtte
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_techo_comercial_unidades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_techo_comercial_unidades() TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4) Venta de una moto con su desglose (precio base + adicional acordado = total)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu006_venta_de_unidad(p_coduni bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_venta public.venta%ROWTYPE;
  v_adelanto jsonb;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Unidad inválida';
  END IF;
  SELECT * INTO v_venta FROM public.venta
  WHERE coduni = p_coduni AND estven IS DISTINCT FROM 'Cancelada'
  ORDER BY codven DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_venta.codsep IS NOT NULL THEN
    SELECT pg_catalog.jsonb_build_object(
      'codsep', s.codsep::text, 'monto', s.monadesep, 'fechaPago', s.fecpagsep, 'medioPago', s.metpagsep,
      'referencia', s.refsep, 'ingresoConfirmado', s.ingconfsep, 'fechaRegistro', s.fecsep)
    INTO v_adelanto
    FROM public.separacion AS s WHERE s.codsep = v_venta.codsep;
  END IF;
  RETURN public.hu006_proyectar_venta(v_venta.codven) || pg_catalog.jsonb_build_object(
    'comprador', public.hu005_proyectar_cliente(v_venta.codcli),
    'techoNombre', (SELECT t.nomtte FROM public.tipotecho AS t WHERE t.codtte = v_venta.codtteven),
    'adelantoSeparacion', v_adelanto,
    'precioBaseAcordado', v_venta.prebaseven,
    'adicionalTechoReferencial', v_venta.adicionalrefven,
    'adicionalTechoAcordado', v_venta.adicionalacordadoven
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_venta_de_unidad(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_venta_de_unidad(bigint) TO authenticated;
COMMENT ON FUNCTION public.hu006_venta_de_unidad(bigint)
  IS 'HU-006/HU-021: devuelve solo la venta vigente de una unidad, con su desglose; las canceladas permanecen disponibles en el listado histórico.';

-- ---------------------------------------------------------------------------------------------
-- 5) La configuración de techo respeta el techo que eligió el comprador
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu006_verificar_techo_configurado_comercial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_decision text;
  v_codtte bigint;
BEGIN
  IF NEW.codtte IS NOT DISTINCT FROM OLD.codtte THEN
    RETURN NEW;
  END IF;
  SELECT x.decision, x.codtte INTO v_decision, v_codtte
  FROM (
    SELECT v.dectechoven AS decision, v.codtteven AS codtte, 1 AS orden
    FROM public.venta AS v
    WHERE v.coduni = NEW.coduni AND v.estven = 'Registrada'
    UNION ALL
    SELECT s.dectechosep, s.codttesep, 2
    FROM public.separacion AS s
    WHERE s.coduni = NEW.coduni AND s.estsep = 'Activa'
  ) AS x
  WHERE x.decision IN ('Sin techo', 'Con techo')
  ORDER BY x.orden
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF (v_decision = 'Con techo' AND NEW.codtte IS DISTINCT FROM v_codtte)
    OR (v_decision = 'Sin techo' AND NEW.codtte IS NOT NULL AND public.hu005_decision_de_techo(NEW.codtte) = 'Con techo') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT423',
      MESSAGE = 'La configuración de techo no coincide con el techo que eligió el comprador';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_verificar_techo_configurado_comercial() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS hu006_unidad_techo_comercial ON public.unidad;
CREATE TRIGGER hu006_unidad_techo_comercial BEFORE UPDATE OF codtte ON public.unidad
  FOR EACH ROW EXECUTE FUNCTION public.hu006_verificar_techo_configurado_comercial();

-- ---------------------------------------------------------------------------------------------
-- 6) Conversión simultánea: conflicto (409) en vez de datos inválidos. Copia exacta de la versión de Michelle
--    (202611120001) con la comprobación marcada «CP-006-12».
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu006_crear_venta(
  p_coduni bigint,
  p_codcli bigint,
  p_codusuresp bigint,
  p_codsedatencion bigint,
  p_fecven date,
  p_modcomven text,
  p_adicionalacordado numeric,
  p_codsedentregaprevista bigint,
  p_pagos jsonb,
  p_techo jsonb,
  p_refcompven text,
  p_feccompven date,
  p_obsven text,
  p_idempotenciaven uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
  v_codmod bigint;
  v_precio_base numeric(10,2);
  v_adicional_ref numeric(10,2);
  v_adicional_acordado numeric(10,2);
  v_importe numeric(10,2);
  v_decision text;
  v_codtte bigint;
  v_codtte_text text;
  v_separacion public.separacion%ROWTYPE;
  v_existente public.venta%ROWTYPE;
  v_resultado jsonb;
  v_finanzas jsonb;
  v_recibido numeric(10,2);
BEGIN
  SELECT p.codusu, p.rol INTO v_codusu, v_rol FROM public.hu005_perfil_comercial() AS p;
  IF v_codusu IS NULL OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para registrar ventas';
  END IF;
  IF p_idempotenciaven IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Idempotency-Key es obligatoria';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hu006-venta:' || p_idempotenciaven::text, 6));
  SELECT * INTO v_existente FROM public.venta
  WHERE idempotenciaven = p_idempotenciaven FOR UPDATE;

  IF FOUND THEN
    IF v_existente.codusu IS DISTINCT FROM v_codusu
      OR v_existente.payloadidempotenciaven IS NULL
      OR NOT (v_existente.payloadidempotenciaven ? 'precioBaseAcordado')
      OR NOT (v_existente.payloadidempotenciaven ? 'adicionalTechoReferencial')
      OR NOT (v_existente.payloadidempotenciaven ? 'adicionalTechoAcordado') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otro payload comercial';
    END IF;
    v_adicional_acordado := COALESCE(p_adicionalacordado, 0);
    IF v_adicional_acordado IS DISTINCT FROM (v_existente.payloadidempotenciaven->>'adicionalTechoAcordado')::numeric THEN
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otro adicional acordado';
    END IF;
    v_precio_base := (v_existente.payloadidempotenciaven->>'precioBaseAcordado')::numeric(10,2);
    v_adicional_ref := (v_existente.payloadidempotenciaven->>'adicionalTechoReferencial')::numeric(10,2);
    v_importe := (v_existente.payloadidempotenciaven->>'importe')::numeric(10,2);
    IF v_precio_base IS NULL OR v_adicional_ref IS NULL OR v_importe IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'La venta histórica no tiene snapshot comercial para reintento seguro';
    END IF;

    -- El helper compara su payload de creación original. Se quitan y restauran
    -- temporalmente las tres claves HU-006 añadidas por esta capa.
    UPDATE public.venta SET payloadidempotenciaven = payloadidempotenciaven
      - 'precioBaseAcordado' - 'adicionalTechoReferencial' - 'adicionalTechoAcordado'
    WHERE codven = v_existente.codven;
    v_resultado := public.hu006_crear_venta_base(
      p_coduni, p_codcli, p_codusuresp, p_codsedatencion, p_fecven, p_modcomven,
      v_importe, p_codsedentregaprevista, p_pagos, p_techo, p_refcompven,
      p_feccompven, p_obsven, p_idempotenciaven
    );
    UPDATE public.venta SET payloadidempotenciaven = v_existente.payloadidempotenciaven
    WHERE codven = v_existente.codven;
    v_recibido := COALESCE((v_resultado->>'totalRecibido')::numeric, 0);
    RETURN v_resultado || pg_catalog.jsonb_build_object(
      'precioBaseAcordado', v_existente.prebaseven,
      'adicionalTechoReferencial', v_existente.adicionalrefven,
      'adicionalTechoAcordado', v_existente.adicionalacordadoven,
      'importe', v_existente.impven,
      'saldo', pg_catalog.round(v_existente.impven - v_recibido, 2),
      'reutilizada', true
    );
  END IF;

  -- Se toma el mismo orden de bloqueo que HU-006/HU-005: unidad y luego separación.
  SELECT u.codmod INTO v_codmod FROM public.unidad AS u WHERE u.coduni = p_coduni FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Unidad inexistente';
  END IF;
  SELECT m.premod INTO v_precio_base FROM public.modelo AS m WHERE m.codmod = v_codmod FOR SHARE;
  IF v_precio_base IS NULL OR v_precio_base <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'El modelo no tiene precio base válido';
  END IF;

  SELECT * INTO v_separacion FROM public.separacion
  WHERE coduni = p_coduni AND estsep = 'Activa' FOR UPDATE;
  IF FOUND THEN
    v_decision := v_separacion.dectechosep;
    v_codtte := v_separacion.codttesep;
    IF p_techo IS NOT NULL THEN
      IF pg_catalog.jsonb_typeof(p_techo) <> 'object'
        OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_techo) k WHERE k NOT IN ('decision','codtte')) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Datos de techo inválidos';
      END IF;
      v_decision := pg_catalog.btrim(COALESCE(p_techo->>'decision',''));
      v_codtte_text := p_techo->>'codtte';
      IF v_decision = 'Con techo' THEN
        IF v_codtte_text IS NULL OR v_codtte_text !~ '^[1-9][0-9]*$' THEN
          RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Con techo requiere codtte válido';
        END IF;
        v_codtte := v_codtte_text::numeric::bigint;
      ELSE
        v_codtte := NULL;
      END IF;
      IF v_decision IS DISTINCT FROM v_separacion.dectechosep
        OR v_codtte IS DISTINCT FROM v_separacion.codttesep THEN
        RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'El techo enviado no coincide con la separación';
      END IF;
      v_codtte := v_separacion.codttesep;
    END IF;
    -- El helper de venta conserva el contrato de conversión; solo admite omitir techo
    -- cuando se hereda exactamente el acuerdo activo.
    IF v_decision IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'La separación no tiene decisión comercial de techo';
    END IF;
  ELSE
    -- CP-006-12: otra sesión pudo convertir la separación o vender la moto mientras esta solicitud esperaba el
    -- bloqueo de la unidad. Se responde como conflicto (409) y no como datos inválidos.
    IF EXISTS (SELECT 1 FROM public.venta AS v WHERE v.coduni = p_coduni AND v.estven = 'Registrada') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT604', MESSAGE = 'La unidad ya tiene una venta registrada';
    END IF;
    -- HU-021: la conversión (sin techo, se hereda de la separación) llega después de que cancelaron la separación
    IF p_techo IS NULL AND EXISTS (
      SELECT 1 FROM public.separacion AS s WHERE s.coduni = p_coduni AND s.estsep IN ('Cancelada', 'Convertida')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT604', MESSAGE = 'La separación que se quería convertir ya no está activa';
    END IF;
    IF p_techo IS NULL OR pg_catalog.jsonb_typeof(p_techo) <> 'object'
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_techo) k WHERE k NOT IN ('decision','codtte')) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'La venta directa requiere una decisión de techo válida';
    END IF;
    v_decision := pg_catalog.btrim(COALESCE(p_techo->>'decision',''));
    IF v_decision NOT IN ('Por definir','Sin techo','Con techo') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Decisión de techo inválida';
    END IF;
    v_codtte_text := p_techo->>'codtte';
    IF v_decision = 'Con techo' THEN
      IF v_codtte_text IS NULL OR v_codtte_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Con techo requiere codtte válido';
      END IF;
      v_codtte := v_codtte_text::numeric::bigint;
    ELSIF p_techo ? 'codtte' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'codtte solo se admite para Con techo';
    ELSE
      v_codtte := NULL;
    END IF;
  END IF;

  IF v_decision = 'Con techo' THEN
    SELECT t.adicionalref INTO v_adicional_ref FROM public.tipotecho AS t
    WHERE t.codtte = v_codtte AND t.esttte IS TRUE FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT610', MESSAGE = 'El tipo de techo no existe o está inactivo';
    END IF;
    IF v_adicional_ref IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'El tipo de techo no tiene adicional referencial configurado';
    END IF;
    IF p_adicionalacordado IS NULL OR p_adicionalacordado < 0
      OR p_adicionalacordado > 99999999.99 OR p_adicionalacordado <> pg_catalog.round(p_adicionalacordado,2) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Con techo requiere adicional acordado válido';
    END IF;
    v_adicional_acordado := p_adicionalacordado;
  ELSIF v_decision = 'Sin techo' THEN
    SELECT t.adicionalref INTO v_adicional_ref FROM public.tipotecho AS t
    WHERE t.nomtte = 'Sin techo' AND t.esttte IS TRUE FOR SHARE;
    IF NOT FOUND OR v_adicional_ref IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'El adicional referencial de Sin techo debe ser 0';
    END IF;
    IF p_adicionalacordado IS NOT NULL AND p_adicionalacordado <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Sin techo no admite adicional acordado';
    END IF;
    v_adicional_acordado := 0;
  ELSE
    IF p_adicionalacordado IS NOT NULL AND p_adicionalacordado <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Por definir no admite recargo de techo';
    END IF;
    v_adicional_ref := 0;
    v_adicional_acordado := 0;
  END IF;

  v_importe := v_precio_base + v_adicional_acordado;
  IF v_importe > 99999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'El total de la venta excede el rango permitido';
  END IF;
  v_resultado := public.hu006_crear_venta_base(
    p_coduni, p_codcli, p_codusuresp, p_codsedatencion, p_fecven, p_modcomven,
    v_importe, p_codsedentregaprevista, p_pagos, p_techo, p_refcompven,
    p_feccompven, p_obsven, p_idempotenciaven
  );
  v_finanzas := pg_catalog.jsonb_build_object(
    'precioBaseAcordado', v_precio_base,
    'adicionalTechoReferencial', v_adicional_ref,
    'adicionalTechoAcordado', v_adicional_acordado
  );
  UPDATE public.venta SET
    prebaseven = v_precio_base,
    adicionalrefven = v_adicional_ref,
    adicionalacordadoven = v_adicional_acordado,
    payloadidempotenciaven = payloadidempotenciaven || v_finanzas
  WHERE codven = (v_resultado->>'codven')::bigint;
  RETURN v_resultado || v_finanzas || pg_catalog.jsonb_build_object('importe', v_importe);
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7) HU-021 · Una venta cancelada queda tal como se canceló
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu021_proteger_venta_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.estven = 'Cancelada' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT623', MESSAGE = 'La venta está cancelada y ya no se puede modificar';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hu021_proteger_venta_cancelada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS hu021_venta_cancelada_inmutable ON public.venta;
CREATE TRIGGER hu021_venta_cancelada_inmutable BEFORE UPDATE ON public.venta
  FOR EACH ROW EXECUTE FUNCTION public.hu021_proteger_venta_cancelada();

-- ---------------------------------------------------------------------------------------------
-- 8) HU-021 escenario 11 · La venta sin responsable asignado sigue visible (LEFT JOIN del responsable)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_definicion text;
  v_actualizada text;
BEGIN
  v_definicion := pg_catalog.pg_get_functiondef('public.hu006_proyectar_venta(bigint)'::pg_catalog.regprocedure);
  IF pg_catalog.strpos(v_definicion, 'LEFT JOIN public.usuario responsable ON') = 0 THEN
    v_actualizada := pg_catalog.replace(v_definicion,
      'JOIN public.usuario responsable ON responsable.codusu = v.codusuresp',
      'LEFT JOIN public.usuario responsable ON responsable.codusu = v.codusuresp');
    IF v_actualizada = v_definicion THEN
      RAISE EXCEPTION 'No se encontró la unión del responsable en hu006_proyectar_venta';
    END IF;
    EXECUTE v_actualizada;
  END IF;

  v_definicion := pg_catalog.pg_get_functiondef('public.hu006_listar_ventas(text,integer,integer)'::pg_catalog.regprocedure);
  IF pg_catalog.strpos(v_definicion, 'LEFT JOIN public.usuario AS responsable ON') = 0 THEN
    v_actualizada := pg_catalog.replace(v_definicion,
      'JOIN public.usuario AS responsable ON responsable.codusu = v.codusuresp',
      'LEFT JOIN public.usuario AS responsable ON responsable.codusu = v.codusuresp');
    IF v_actualizada = v_definicion THEN
      RAISE EXCEPTION 'No se encontró la unión del responsable en hu006_listar_ventas';
    END IF;
    EXECUTE v_actualizada;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 9) HU-021 · Cancelaciones de una moto (solo lectura)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hu021_cancelaciones_unidad(p_coduni bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor bigint;
  v_rol text;
BEGIN
  SELECT u.codusu, r.nomrol INTO v_actor, v_rol
  FROM public.usuario AS u JOIN public.rol AS r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu IS TRUE AND r.estrol IS TRUE;
  IF NOT FOUND OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol comercial no autorizado para consultar cancelaciones';
  END IF;
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT650', MESSAGE = 'Unidad inválida';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(x.item ORDER BY x.fecaccion DESC, x.codhcan DESC)
    FROM (
      SELECT h.fecaccion, h.codhcan, pg_catalog.jsonb_build_object(
        'tipoOperacion', h.tipoperacion,
        'codOperacion', COALESCE(h.codsep, h.codven)::text,
        'fechaOperacion', COALESCE(s.fecsep, v.fecven),
        'fecha', h.fecaccion,
        'actor', pg_catalog.jsonb_build_object('codusu', h.codusu::text,
          'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', a.nomusu, a.apepatusu, a.apematusu))),
        'responsable', CASE WHEN r.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('codusu', r.codusu::text,
          'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', r.nomusu, r.apepatusu, r.apematusu))) END,
        'comprador', pg_catalog.btrim(pg_catalog.concat_ws(' ', c.nomcli, c.apepatcli, c.apematcli)),
        'motivo', h.motivo,
        'observacionFinanciera', h.observaciondinero,
        'estadoAnterior', h.estadoanterior,
        'estadoResultante', h.estadoresultante,
        'estadoComercialResultante', h.estcomuniresultante,
        'finanzasConservadas', h.resultado -> 'finanzasConservadas'
      ) AS item
      FROM public.historialcancelacion AS h
      LEFT JOIN public.separacion AS s ON s.codsep = h.codsep
      LEFT JOIN public.venta AS v ON v.codven = h.codven
      LEFT JOIN public.cliente AS c ON c.codcli = COALESCE(s.codcli, v.codcli)
      LEFT JOIN public.usuario AS a ON a.codusu = h.codusu
      LEFT JOIN public.usuario AS r ON r.codusu = COALESCE(s.codusuresp, v.codusuresp)
      WHERE COALESCE(s.coduni, v.coduni) = p_coduni
        AND (v_rol <> 'Vendedor' OR COALESCE(s.codusuresp, v.codusuresp) = v_actor)
    ) AS x
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.hu021_cancelaciones_unidad(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu021_cancelaciones_unidad(bigint) TO authenticated;
COMMENT ON FUNCTION public.hu021_cancelaciones_unidad(bigint)
  IS 'HU-021: separaciones y ventas canceladas de una unidad, con autor, fecha, motivo y montos conservados. Vendedor: solo las que tiene como responsable vigente.';

COMMIT;
