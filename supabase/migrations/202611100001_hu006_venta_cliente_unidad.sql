BEGIN;

-- HU-006: venta transaccional, pagos nuevos, vínculo con separación y techo comercial.
-- No se copia el adelanto de HU-005 a pagoventa. Las ventas históricas conservan
-- sus columnas nuevas en NULL; las creadas por esta RPC llevan la instantánea
-- comercial y la clave de idempotencia.

ALTER TABLE public.venta
  ADD COLUMN IF NOT EXISTS codsep bigint,
  ADD COLUMN IF NOT EXISTS codusuresp bigint,
  ADD COLUMN IF NOT EXISTS codsedatencion bigint,
  ADD COLUMN IF NOT EXISTS codsedentregaprevista bigint,
  ADD COLUMN IF NOT EXISTS impven numeric(10,2),
  ADD COLUMN IF NOT EXISTS refcompven text,
  ADD COLUMN IF NOT EXISTS feccompven date,
  ADD COLUMN IF NOT EXISTS idempotenciaven uuid,
  ADD COLUMN IF NOT EXISTS payloadidempotenciaven jsonb,
  ADD COLUMN IF NOT EXISTS dectechoven varchar(20),
  ADD COLUMN IF NOT EXISTS codtteven bigint,
  ADD COLUMN IF NOT EXISTS fecdectechoven timestamptz,
  ADD COLUMN IF NOT EXISTS codusudectechoven bigint;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.venta
    GROUP BY coduni HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HU-006 requiere revisar ventas históricas duplicadas por unidad antes de crear la unicidad';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'fk_hu006_venta_separacion') THEN
    ALTER TABLE public.venta ADD CONSTRAINT fk_hu006_venta_separacion
      FOREIGN KEY (codsep) REFERENCES public.separacion(codsep);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'fk_hu006_venta_responsable') THEN
    ALTER TABLE public.venta ADD CONSTRAINT fk_hu006_venta_responsable
      FOREIGN KEY (codusuresp) REFERENCES public.usuario(codusu);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'fk_hu006_venta_sede_atencion') THEN
    ALTER TABLE public.venta ADD CONSTRAINT fk_hu006_venta_sede_atencion
      FOREIGN KEY (codsedatencion) REFERENCES public.sede(codsed);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'fk_hu006_venta_sede_entrega') THEN
    ALTER TABLE public.venta ADD CONSTRAINT fk_hu006_venta_sede_entrega
      FOREIGN KEY (codsedentregaprevista) REFERENCES public.sede(codsed);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'fk_hu006_venta_tipotecho') THEN
    ALTER TABLE public.venta ADD CONSTRAINT fk_hu006_venta_tipotecho
      FOREIGN KEY (codtteven) REFERENCES public.tipotecho(codtte);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'fk_hu006_venta_autor_techo') THEN
    ALTER TABLE public.venta ADD CONSTRAINT fk_hu006_venta_autor_techo
      FOREIGN KEY (codusudectechoven) REFERENCES public.usuario(codusu);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'chk_hu006_venta_importe') THEN
    ALTER TABLE public.venta ADD CONSTRAINT chk_hu006_venta_importe
      CHECK (impven IS NULL OR (impven > 0 AND impven = round(impven, 2)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'chk_hu006_venta_modalidad') THEN
    ALTER TABLE public.venta ADD CONSTRAINT chk_hu006_venta_modalidad
      CHECK (modcomven IN ('Contado', 'Crédito') OR idempotenciaven IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'chk_hu006_venta_comprobante') THEN
    ALTER TABLE public.venta ADD CONSTRAINT chk_hu006_venta_comprobante
      CHECK ((refcompven IS NULL AND feccompven IS NULL)
        OR (refcompven IS NOT NULL AND pg_catalog.btrim(refcompven) <> '' AND feccompven IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'chk_hu006_venta_techo') THEN
    ALTER TABLE public.venta ADD CONSTRAINT chk_hu006_venta_techo
      CHECK (
        (dectechoven IS NULL AND codtteven IS NULL)
        OR (dectechoven IN ('Por definir', 'Sin techo') AND codtteven IS NULL)
        OR (dectechoven = 'Con techo' AND codtteven IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.venta'::regclass AND conname = 'chk_hu006_venta_idempotencia') THEN
    ALTER TABLE public.venta ADD CONSTRAINT chk_hu006_venta_idempotencia
      CHECK ((idempotenciaven IS NULL AND payloadidempotenciaven IS NULL)
        OR (idempotenciaven IS NOT NULL AND payloadidempotenciaven IS NOT NULL
          AND codusuresp IS NOT NULL AND codsedatencion IS NOT NULL AND impven IS NOT NULL
          AND dectechoven IS NOT NULL));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hu006_venta_unidad ON public.venta(coduni);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu006_venta_separacion ON public.venta(codsep);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hu006_venta_idempotencia ON public.venta(idempotenciaven);

CREATE TABLE IF NOT EXISTS public.pagoventa (
  codpagven bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  codven bigint NOT NULL,
  nropagven integer NOT NULL,
  codusuautorpag bigint NOT NULL,
  montopagven numeric(10,2) NOT NULL,
  fecpagven date NOT NULL,
  metpagven varchar(20) NOT NULL,
  refpagven varchar(200),
  rutavoucherven text,
  obspagven varchar(2000),
  ingconfpag boolean NOT NULL,
  codusuconfpag bigint NOT NULL,
  fecconfpag timestamptz NOT NULL,
  CONSTRAINT fk_hu006_pago_venta FOREIGN KEY (codven) REFERENCES public.venta(codven),
  CONSTRAINT fk_hu006_pago_autor FOREIGN KEY (codusuautorpag) REFERENCES public.usuario(codusu),
  CONSTRAINT fk_hu006_pago_confirmador FOREIGN KEY (codusuconfpag) REFERENCES public.usuario(codusu),
  CONSTRAINT uq_hu006_pago_orden UNIQUE (codven, nropagven),
  CONSTRAINT chk_hu006_pago_orden CHECK (nropagven > 0),
  CONSTRAINT chk_hu006_pago_monto CHECK (montopagven > 0 AND montopagven = round(montopagven, 2)),
  CONSTRAINT chk_hu006_pago_medio CHECK (metpagven IN ('Efectivo', 'Transferencia')),
  CONSTRAINT chk_hu006_pago_confirmado CHECK (ingconfpag IS TRUE),
  CONSTRAINT chk_hu006_pago_referencia CHECK (refpagven IS NULL OR (pg_catalog.btrim(refpagven) <> '' AND pg_catalog.char_length(refpagven) <= 200)),
  CONSTRAINT chk_hu006_pago_evidencia CHECK (rutavoucherven IS NULL OR (
    pg_catalog.btrim(rutavoucherven) <> '' AND pg_catalog.char_length(rutavoucherven) <= 2048
    AND rutavoucherven !~ '[[:cntrl:]]')),
  CONSTRAINT chk_hu006_pago_transferencia CHECK (metpagven <> 'Transferencia'
    OR (refpagven IS NOT NULL AND rutavoucherven IS NOT NULL AND codusuconfpag IS NOT NULL AND fecconfpag IS NOT NULL)),
  CONSTRAINT chk_hu006_pago_efectivo CHECK (metpagven <> 'Efectivo'
    OR (obspagven IS NOT NULL AND pg_catalog.btrim(obspagven) <> '' AND rutavoucherven IS NULL AND refpagven IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_hu006_pagoventa_venta ON public.pagoventa(codven, nropagven);

-- Evidencia propia de venta: no comparte bucket, prefijo ni policy con HU-005.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ventas-evidencia', 'ventas-evidencia', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS hu006_venta_evidencia_subida ON storage.objects;
CREATE POLICY hu006_venta_evidencia_subida ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ventas-evidencia'
    AND (storage.foldername(name))[1] = 'ventas'
    AND COALESCE(public.hu026_rol_actual(), '') IN ('Gerente', 'Administradora', 'Vendedor'));
DROP POLICY IF EXISTS hu006_venta_evidencia_lectura ON storage.objects;
CREATE POLICY hu006_venta_evidencia_lectura ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ventas-evidencia'
    AND COALESCE(public.hu026_rol_actual(), '') IN ('Gerente', 'Administradora', 'Vendedor'));

CREATE OR REPLACE FUNCTION public.hu006_verificar_evidencia_pago_venta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_coduni bigint;
BEGIN
  IF NEW.metpagven = 'Transferencia' THEN
    SELECT v.coduni INTO v_coduni FROM public.venta AS v WHERE v.codven = NEW.codven;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM storage.objects AS o
      WHERE o.bucket_id = 'ventas-evidencia' AND o.name = NEW.rutavoucherven
        AND o.name LIKE 'ventas/' || v_coduni::text || '/%'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT615', MESSAGE = 'La evidencia de pago no existe o no corresponde a la unidad';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hu006_pago_venta_evidencia ON public.pagoventa;
CREATE TRIGGER hu006_pago_venta_evidencia BEFORE INSERT ON public.pagoventa
  FOR EACH ROW EXECUTE FUNCTION public.hu006_verificar_evidencia_pago_venta();

CREATE OR REPLACE FUNCTION public.hu006_proyectar_venta(p_codven bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'codven', v.codven::text,
    'coduni', v.coduni::text,
    'codcli', v.codcli::text,
    'codsep', v.codsep::text,
    'autor', pg_catalog.jsonb_build_object('codusu', autor.codusu::text,
      'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', autor.nomusu, autor.apepatusu, autor.apematusu))),
    'responsable', pg_catalog.jsonb_build_object('codusu', responsable.codusu::text,
      'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', responsable.nomusu, responsable.apepatusu, responsable.apematusu))),
    'sedeAtencion', pg_catalog.jsonb_build_object('codsed', sa.codsed::text, 'nombre', ua.nomubi),
    'sedeEntregaPrevista', CASE WHEN se.codsed IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('codsed', se.codsed::text, 'nombre', ue.nomubi) END,
    'fechaVenta', v.fecven,
    'modalidad', v.modcomven,
    'importe', v.impven,
    'totalRecibido', pg_catalog.round(
      COALESCE((SELECT pg_catalog.sum(p.montopagven) FROM public.pagoventa p WHERE p.codven = v.codven), 0)
      + COALESCE((SELECT s.monadesep FROM public.separacion s WHERE s.codsep = v.codsep AND s.ingconfsep IS TRUE), 0), 2),
    'saldo', pg_catalog.round(v.impven -
      COALESCE((SELECT pg_catalog.sum(p.montopagven) FROM public.pagoventa p WHERE p.codven = v.codven), 0)
      - COALESCE((SELECT s.monadesep FROM public.separacion s WHERE s.codsep = v.codsep AND s.ingconfsep IS TRUE), 0), 2),
    'pagos', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'codpagven', p.codpagven::text, 'numero', p.nropagven, 'monto', p.montopagven,
      'fecha', p.fecpagven, 'medioPago', p.metpagven, 'referencia', p.refpagven,
      'rutaEvidencia', p.rutavoucherven, 'observacion', p.obspagven,
      'ingresoConfirmado', p.ingconfpag, 'confirmadoPor', p.codusuconfpag::text,
      'fechaConfirmacion', p.fecconfpag, 'autor', p.codusuautorpag::text
    ) ORDER BY p.nropagven) FROM public.pagoventa p WHERE p.codven = v.codven), '[]'::jsonb),
    'techo', pg_catalog.jsonb_build_object('decision', v.dectechoven,
      'codtte', v.codtteven::text, 'fecha', v.fecdectechoven,
      'decididoPor', v.codusudectechoven::text),
    'comprobanteExterno', CASE WHEN v.refcompven IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('referencia', v.refcompven, 'fecha', v.feccompven) END,
    'observacion', v.obsven,
    'estado', v.estven
  )
  FROM public.venta v
  JOIN public.usuario autor ON autor.codusu = v.codusu
  JOIN public.usuario responsable ON responsable.codusu = v.codusuresp
  JOIN public.sede sa ON sa.codsed = v.codsedatencion
  JOIN public.ubicacion ua ON ua.codubi = sa.codubi
  LEFT JOIN public.sede se ON se.codsed = v.codsedentregaprevista
  LEFT JOIN public.ubicacion ue ON ue.codubi = se.codubi
  WHERE v.codven = p_codven
$$;

CREATE OR REPLACE FUNCTION public.hu006_crear_venta(
  p_coduni bigint,
  p_codcli bigint,
  p_codusuresp bigint,
  p_codsedatencion bigint,
  p_fecven date,
  p_modcomven text,
  p_impven numeric,
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
  v_autor bigint;
  v_rol text;
  v_unidad public.unidad%ROWTYPE;
  v_separacion public.separacion%ROWTYPE;
  v_cliente public.cliente%ROWTYPE;
  v_venta_existente public.venta%ROWTYPE;
  v_venta public.venta%ROWTYPE;
  v_item jsonb;
  v_pago jsonb;
  v_pago_monto numeric(10,2);
  v_pago_monto_completo numeric;
  v_fecha_pago date;
  v_medio text;
  v_referencia text;
  v_ruta text;
  v_observacion_pago text;
  v_codusu_confirmador bigint;
  v_codtte bigint;
  v_decision text;
  v_techo jsonb;
  v_pagos jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_total_pagos numeric(10,2) := 0;
  v_adelanto numeric(10,2) := 0;
  v_codven bigint;
  v_codsep bigint;
  v_orden integer := 0;
  v_fecha_text text;
  v_clave_text text;
  v_id_completo numeric;
  v_roles_permitidos text[] := ARRAY['Gerente', 'Administradora', 'Vendedor'];
BEGIN
  SELECT p.codusu, p.rol INTO v_autor, v_rol FROM public.hu005_perfil_comercial() AS p;
  IF v_rol <> ALL(v_roles_permitidos) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para registrar ventas';
  END IF;
  IF p_coduni IS NULL OR p_coduni <= 0 OR p_codcli IS NULL OR p_codcli <= 0
    OR p_codusuresp IS NULL OR p_codusuresp <= 0 OR p_codsedatencion IS NULL OR p_codsedatencion <= 0
    OR p_fecven IS NULL OR p_idempotenciaven IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Datos obligatorios de venta inválidos';
  END IF;
  IF p_modcomven NOT IN ('Contado', 'Crédito') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'La modalidad debe ser Contado o Crédito';
  END IF;
  IF p_impven IS NULL OR p_impven <= 0 OR p_impven > 99999999.99
    OR p_impven <> pg_catalog.round(p_impven, 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'El importe debe ser positivo y tener hasta dos decimales';
  END IF;
  IF p_pagos IS NULL OR pg_catalog.jsonb_typeof(p_pagos) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'Los pagos deben enviarse como una lista';
  END IF;
  IF (p_refcompven IS NULL AND p_feccompven IS NOT NULL)
    OR (p_refcompven IS NOT NULL AND (pg_catalog.btrim(p_refcompven) = '' OR p_feccompven IS NULL))
    OR (p_refcompven IS NOT NULL AND (pg_catalog.char_length(p_refcompven) > 200 OR p_refcompven ~ '[[:cntrl:]]')) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT616', MESSAGE = 'La referencia y fecha del comprobante externo deben informarse juntas';
  END IF;
  IF p_obsven IS NOT NULL AND (pg_catalog.char_length(p_obsven) > 2000 OR p_obsven ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'La observación de venta no tiene un formato válido';
  END IF;

  IF p_techo IS NULL THEN
    v_techo := NULL;
  ELSE
    IF pg_catalog.jsonb_typeof(p_techo) <> 'object'
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_techo) k WHERE k NOT IN ('decision', 'codtte')) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Datos de techo inválidos';
    END IF;
    v_decision := pg_catalog.btrim(COALESCE(p_techo ->> 'decision', ''));
    IF v_decision NOT IN ('Por definir', 'Sin techo', 'Con techo') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Decisión de techo inválida';
    END IF;
    IF v_decision = 'Con techo' THEN
      v_clave_text := p_techo ->> 'codtte';
      IF v_clave_text IS NULL OR v_clave_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Con techo requiere codtte válido';
      END IF;
      v_id_completo := v_clave_text::numeric;
      IF v_id_completo > 9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Con techo requiere codtte válido';
      END IF;
      v_codtte := v_id_completo::bigint;
    ELSE
      IF p_techo ? 'codtte' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'codtte solo se admite para Con techo';
      END IF;
      v_codtte := NULL;
    END IF;
    v_techo := pg_catalog.jsonb_build_object('decision', v_decision, 'codtte', v_codtte::text);
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_pagos) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_item) k
        WHERE k NOT IN ('monto', 'fecha', 'medioPago', 'referencia', 'rutaEvidencia', 'observacion', 'ingresoConfirmado', 'codusuConfirmador')) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'Datos de pago inválidos';
    END IF;
    IF pg_catalog.jsonb_typeof(v_item -> 'monto') <> 'number'
      OR COALESCE(v_item ->> 'monto', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'El monto del pago debe ser positivo y tener hasta dos decimales';
    END IF;
    v_pago_monto_completo := (v_item ->> 'monto')::numeric;
    IF v_pago_monto_completo <= 0 OR v_pago_monto_completo > 99999999.99 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'El monto del pago debe ser positivo';
    END IF;
    v_pago_monto := v_pago_monto_completo::numeric(10,2);
    v_fecha_text := v_item ->> 'fecha';
    BEGIN
      v_fecha_pago := v_fecha_text::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'La fecha del pago es inválida';
    END;
    IF v_fecha_text IS NULL OR pg_catalog.to_char(v_fecha_pago, 'YYYY-MM-DD') <> v_fecha_text THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'La fecha del pago debe usar YYYY-MM-DD';
    END IF;
    v_medio := pg_catalog.btrim(COALESCE(v_item ->> 'medioPago', ''));
    IF v_medio NOT IN ('Efectivo', 'Transferencia') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'Medio de pago no admitido';
    END IF;
    v_referencia := NULLIF(pg_catalog.btrim(COALESCE(v_item ->> 'referencia', '')), '');
    v_ruta := NULLIF(pg_catalog.btrim(COALESCE(v_item ->> 'rutaEvidencia', '')), '');
    v_observacion_pago := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(v_item ->> 'observacion', ''), '[[:space:]]+', ' ', 'g')), '');
    IF v_referencia IS NOT NULL AND (pg_catalog.char_length(v_referencia) > 200 OR v_referencia ~ '[[:cntrl:]]')
      OR v_ruta IS NOT NULL AND (pg_catalog.char_length(v_ruta) > 2048 OR v_ruta ~ '[[:cntrl:]]')
      OR v_observacion_pago IS NOT NULL AND pg_catalog.char_length(v_observacion_pago) > 2000 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'Texto de pago inválido';
    END IF;
    IF v_item -> 'ingresoConfirmado' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'Confirma el ingreso antes de registrar el pago';
    END IF;
    IF v_medio = 'Transferencia' THEN
      IF v_referencia IS NULL OR v_ruta IS NULL OR v_ruta !~ ('^ventas/' || p_coduni::text || '/[^/]+$') THEN
        RAISE EXCEPTION USING ERRCODE = 'PT615', MESSAGE = 'La transferencia requiere referencia y evidencia de esta unidad';
      END IF;
      v_clave_text := v_item ->> 'codusuConfirmador';
      IF v_clave_text IS NULL OR v_clave_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT617', MESSAGE = 'La transferencia requiere confirmador';
      END IF;
      v_id_completo := v_clave_text::numeric;
      IF v_id_completo > 9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT617', MESSAGE = 'El confirmador debe ser un gerente activo';
      END IF;
      v_codusu_confirmador := v_id_completo::bigint;
      PERFORM 1 FROM public.usuario u JOIN public.rol r ON r.codrol = u.codrol
      WHERE u.codusu = v_codusu_confirmador AND u.estusu AND r.estrol AND r.nomrol = 'Gerente'
      FOR SHARE OF u, r;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'PT617', MESSAGE = 'El confirmador debe ser un gerente activo';
      END IF;
    ELSE
      IF v_referencia IS NOT NULL OR v_ruta IS NOT NULL OR v_observacion_pago IS NULL
        OR COALESCE(v_item ->> 'codusuConfirmador', '') <> '' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT609', MESSAGE = 'El efectivo requiere observación y no usa referencia bancaria ni voucher';
      END IF;
      v_codusu_confirmador := v_autor;
    END IF;
    v_total_pagos := v_total_pagos + v_pago_monto;
    v_orden := v_orden + 1;
    v_pago := pg_catalog.jsonb_build_object(
      'monto', v_pago_monto, 'fecha', v_fecha_text, 'medioPago', v_medio,
      'referencia', v_referencia, 'rutaEvidencia', v_ruta, 'observacion', v_observacion_pago,
      'ingresoConfirmado', true, 'codusuConfirmador', v_codusu_confirmador::text);
    v_pagos := v_pagos || pg_catalog.jsonb_build_array(v_pago);
  END LOOP;

  v_payload := pg_catalog.jsonb_build_object(
    'coduni', p_coduni::text, 'codcli', p_codcli::text, 'codusuResponsable', p_codusuresp::text,
    'codsedAtencion', p_codsedatencion::text, 'fechaVenta', p_fecven::text,
    'modalidad', p_modcomven, 'importe', p_impven, 'codsedEntregaPrevista', p_codsedentregaprevista::text,
    'pagos', v_pagos, 'techo', v_techo, 'comprobanteExterno', CASE WHEN p_refcompven IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object('referencia', pg_catalog.btrim(p_refcompven), 'fecha', p_feccompven::text) END,
    'observacion', NULLIF(pg_catalog.btrim(COALESCE(p_obsven, '')), ''));

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hu006-venta:' || p_idempotenciaven::text, 6));
  SELECT * INTO v_venta_existente FROM public.venta
  WHERE idempotenciaven = p_idempotenciaven FOR UPDATE;
  IF FOUND THEN
    IF v_venta_existente.codusu IS DISTINCT FROM v_autor
      OR v_venta_existente.payloadidempotenciaven IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key reutilizada con otra solicitud de venta';
    END IF;
    RETURN public.hu006_proyectar_venta(v_venta_existente.codven)
      || pg_catalog.jsonb_build_object('reutilizada', true);
  END IF;

  SELECT * INTO v_unidad FROM public.unidad WHERE coduni = p_coduni FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Unidad inexistente';
  END IF;
  IF pg_catalog.btrim(COALESCE(v_unidad.nummotuni, '')) = ''
    OR pg_catalog.btrim(COALESCE(v_unidad.chauni, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT603', MESSAGE = 'La unidad todavía no está identificada';
  END IF;
  IF v_unidad.estcomuni = 'Vendida'
    OR EXISTS (SELECT 1 FROM public.venta WHERE coduni = p_coduni) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT604', MESSAGE = 'La unidad ya tiene una venta';
  END IF;

  SELECT * INTO v_separacion FROM public.separacion
  WHERE coduni = p_coduni AND estsep = 'Activa' FOR UPDATE;
  IF FOUND THEN
    IF v_separacion.codcli IS DISTINCT FROM p_codcli THEN
      RAISE EXCEPTION USING ERRCODE = 'PT605', MESSAGE = 'La unidad está separada para otro comprador';
    END IF;
    IF v_unidad.estcomuni <> 'Separada' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT604', MESSAGE = 'El estado comercial no coincide con la separación activa';
    END IF;
    v_codsep := v_separacion.codsep;
    IF v_techo IS NOT NULL AND (
      v_techo ->> 'decision' IS DISTINCT FROM v_separacion.dectechosep
      OR NULLIF(v_techo ->> 'codtte', '') IS DISTINCT FROM v_separacion.codttesep::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'El techo enviado no coincide con la decisión de la separación';
    END IF;
    v_decision := v_separacion.dectechosep;
    v_codtte := v_separacion.codttesep;
    v_adelanto := CASE WHEN v_separacion.ingconfsep IS TRUE THEN v_separacion.monadesep ELSE 0 END;
  ELSE
    IF v_unidad.estcomuni <> 'Disponible' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT603', MESSAGE = 'La unidad no está disponible para la venta';
    END IF;
    IF v_techo IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'La venta directa requiere una decisión de techo';
    END IF;
    v_decision := v_techo ->> 'decision';
    v_codtte := NULLIF(v_techo ->> 'codtte', '')::bigint;
  END IF;

  SELECT * INTO v_cliente FROM public.cliente WHERE codcli = p_codcli FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Comprador inexistente';
  END IF;
  IF NOT v_cliente.estcli THEN
    RAISE EXCEPTION USING ERRCODE = 'PT606', MESSAGE = 'Comprador inactivo';
  END IF;

  PERFORM 1 FROM public.usuario u JOIN public.rol r ON r.codrol = u.codrol
  WHERE u.codusu = p_codusuresp AND u.estusu AND r.estrol
    AND r.nomrol IN ('Gerente', 'Administradora', 'Vendedor')
    AND pg_catalog.lower(u.corusu) <> 'integracion.facturas@epsa.internal' FOR SHARE OF u, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT607', MESSAGE = 'Responsable inexistente, inactivo o no autorizado';
  END IF;

  PERFORM 1 FROM public.sede s JOIN public.ubicacion u ON u.codubi = s.codubi
  WHERE s.codsed = p_codsedatencion AND s.estsed AND u.estubi AND u.tipubi = 'Sede'
  FOR SHARE OF s, u;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT608', MESSAGE = 'Sede de atención inexistente o inactiva';
  END IF;
  IF p_codsedentregaprevista IS NOT NULL THEN
    PERFORM 1 FROM public.sede s JOIN public.ubicacion u ON u.codubi = s.codubi
    WHERE s.codsed = p_codsedentregaprevista AND s.estsed AND u.estubi AND u.tipubi = 'Sede'
    FOR SHARE OF s, u;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT608', MESSAGE = 'Sede prevista de entrega inexistente o inactiva';
    END IF;
  END IF;
  IF v_decision = 'Con techo' THEN
    PERFORM 1 FROM public.tipotecho WHERE codtte = v_codtte AND esttte IS TRUE FOR SHARE;
    IF NOT FOUND OR public.hu005_decision_de_techo(v_codtte) <> 'Con techo' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT610', MESSAGE = 'El tipo de techo no existe, está inactivo o no corresponde a Con techo';
    END IF;
  END IF;
  BEGIN
    PERFORM public.hu005_validar_compatibilidad_techo_instalado(p_coduni, v_decision, v_codtte);
  EXCEPTION WHEN SQLSTATE 'PT438' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'La elección no es compatible con el techo instalado';
  END;
  IF v_total_pagos + v_adelanto > p_impven THEN
    RAISE EXCEPTION USING ERRCODE = 'PT612', MESSAGE = 'Los pagos superan el importe pendiente de la venta';
  END IF;

  INSERT INTO public.venta(
    coduni, codcli, codusu, fecven, modcomven, obsven, estven,
    codsep, codusuresp, codsedatencion, codsedentregaprevista, impven,
    refcompven, feccompven, idempotenciaven, payloadidempotenciaven,
    dectechoven, codtteven, fecdectechoven, codusudectechoven
  ) VALUES (
    p_coduni, p_codcli, v_autor, p_fecven::timestamptz, p_modcomven,
    NULLIF(pg_catalog.btrim(COALESCE(p_obsven, '')), ''), 'Registrada',
    v_codsep, p_codusuresp, p_codsedatencion, p_codsedentregaprevista, p_impven,
    NULLIF(pg_catalog.btrim(COALESCE(p_refcompven, '')), ''), p_feccompven,
    p_idempotenciaven, v_payload, v_decision, v_codtte,
    CASE WHEN v_codsep IS NOT NULL THEN v_separacion.fecdectechosep ELSE CURRENT_TIMESTAMP END,
    CASE WHEN v_codsep IS NOT NULL THEN v_separacion.codusudectechosep ELSE v_autor END
  ) RETURNING * INTO v_venta;

  v_orden := 0;
  FOR v_pago IN SELECT value FROM pg_catalog.jsonb_array_elements(v_pagos) LOOP
    v_orden := v_orden + 1;
    INSERT INTO public.pagoventa(
      codven, nropagven, codusuautorpag, montopagven, fecpagven, metpagven,
      refpagven, rutavoucherven, obspagven, ingconfpag, codusuconfpag, fecconfpag
    ) VALUES (
      v_venta.codven, v_orden, v_autor, (v_pago ->> 'monto')::numeric(10,2),
      (v_pago ->> 'fecha')::date, v_pago ->> 'medioPago', v_pago ->> 'referencia',
      v_pago ->> 'rutaEvidencia', v_pago ->> 'observacion', true,
      (v_pago ->> 'codusuConfirmador')::bigint, CURRENT_TIMESTAMP
    );
  END LOOP;

  IF v_codsep IS NOT NULL THEN
    UPDATE public.separacion SET estsep = 'Convertida' WHERE codsep = v_codsep AND estsep = 'Activa';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT605', MESSAGE = 'La separación dejó de estar activa durante la venta';
    END IF;
  END IF;
  UPDATE public.unidad SET estcomuni = 'Vendida' WHERE coduni = p_coduni;

  RETURN public.hu006_proyectar_venta(v_venta.codven)
    || pg_catalog.jsonb_build_object('reutilizada', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.hu006_guardar_techo_venta(
  p_codven bigint, p_decisiontecho text, p_codtte bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_autor bigint;
  v_venta public.venta%ROWTYPE;
  v_coduni bigint;
  v_decision text;
BEGIN
  SELECT p.codusu INTO v_autor FROM public.hu005_perfil_comercial() AS p;
  IF p_codven IS NULL OR p_codven <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Código de venta inválido';
  END IF;
  v_decision := pg_catalog.btrim(COALESCE(p_decisiontecho, ''));
  IF v_decision NOT IN ('Por definir', 'Sin techo', 'Con techo')
    OR (v_decision = 'Con techo' AND (p_codtte IS NULL OR p_codtte <= 0))
    OR (v_decision <> 'Con techo' AND p_codtte IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Decisión o tipo de techo inválidos';
  END IF;
  SELECT coduni INTO v_coduni FROM public.venta WHERE codven = p_codven;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Venta inexistente';
  END IF;
  PERFORM 1 FROM public.unidad WHERE coduni = v_coduni FOR UPDATE;
  SELECT * INTO v_venta FROM public.venta WHERE codven = p_codven FOR UPDATE;
  IF v_venta.dectechoven IS DISTINCT FROM 'Por definir'
    AND (v_venta.dectechoven IS DISTINCT FROM v_decision OR v_venta.codtteven IS DISTINCT FROM p_codtte) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT614', MESSAGE = 'La decisión final de techo de la venta no se puede modificar';
  END IF;
  IF v_decision = 'Con techo' THEN
    PERFORM 1 FROM public.tipotecho WHERE codtte = p_codtte AND esttte IS TRUE FOR SHARE;
    IF NOT FOUND OR public.hu005_decision_de_techo(p_codtte) <> 'Con techo' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT610', MESSAGE = 'El tipo de techo no existe, está inactivo o no corresponde a Con techo';
    END IF;
  END IF;
  BEGIN
    PERFORM public.hu005_validar_compatibilidad_techo_instalado(v_coduni, v_decision, p_codtte);
  EXCEPTION WHEN SQLSTATE 'PT438' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'La elección no es compatible con el techo instalado';
  END;
  IF v_venta.dectechoven = 'Por definir' THEN
    UPDATE public.venta SET dectechoven = v_decision, codtteven = p_codtte,
      fecdectechoven = CURRENT_TIMESTAMP, codusudectechoven = v_autor
    WHERE codven = p_codven;
  END IF;
  RETURN pg_catalog.jsonb_build_object('codven', p_codven::text, 'decision', v_decision,
    'codtte', p_codtte::text, 'guardado', true, 'reutilizada', v_venta.dectechoven = v_decision
      AND v_venta.codtteven IS NOT DISTINCT FROM p_codtte);
END;
$$;

CREATE OR REPLACE FUNCTION public.hu006_guardar_comprobante_venta(
  p_codven bigint,
  p_referencia text,
  p_fecha date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
  v_referencia text;
  v_venta public.venta%ROWTYPE;
BEGIN
  SELECT p.codusu, p.rol INTO v_codusu, v_rol
  FROM public.hu005_perfil_comercial() AS p;
  IF v_codusu IS NULL OR v_rol IS NULL OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para registrar el comprobante de venta';
  END IF;
  IF p_codven IS NULL OR p_codven <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Código de venta inválido';
  END IF;
  IF p_referencia IS NULL OR p_referencia ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'La referencia del comprobante no es válida';
  END IF;
  v_referencia := pg_catalog.btrim(p_referencia);
  IF v_referencia = '' OR pg_catalog.char_length(v_referencia) > 200 OR p_fecha IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Referencia y fecha del comprobante son obligatorias y deben ser válidas';
  END IF;

  SELECT * INTO v_venta FROM public.venta WHERE codven = p_codven FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Venta inexistente';
  END IF;
  IF v_venta.refcompven IS NOT NULL OR v_venta.feccompven IS NOT NULL THEN
    IF v_venta.refcompven IS DISTINCT FROM v_referencia OR v_venta.feccompven IS DISTINCT FROM p_fecha THEN
      RAISE EXCEPTION USING ERRCODE = 'PT618', MESSAGE = 'La venta ya tiene un comprobante externo diferente';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'codven', v_venta.codven::text,
      'comprobanteExterno', pg_catalog.jsonb_build_object('referencia', v_venta.refcompven, 'fecha', v_venta.feccompven),
      'guardado', true,
      'reutilizada', true
    );
  END IF;

  UPDATE public.venta SET refcompven = v_referencia, feccompven = p_fecha
  WHERE codven = p_codven;
  RETURN pg_catalog.jsonb_build_object(
    'codven', v_venta.codven::text,
    'comprobanteExterno', pg_catalog.jsonb_build_object('referencia', v_referencia, 'fecha', p_fecha),
    'guardado', true,
    'reutilizada', false
  );
END;
$$;

ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagoventa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venta, public.pagoventa FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS hu006_venta_solo_rpc ON public.venta;
CREATE POLICY hu006_venta_solo_rpc ON public.venta
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS hu006_pagoventa_solo_rpc ON public.pagoventa;
CREATE POLICY hu006_pagoventa_solo_rpc ON public.pagoventa
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DO $$
DECLARE v_secuencia text;
BEGIN
  v_secuencia := pg_catalog.pg_get_serial_sequence('public.pagoventa', 'codpagven');
  IF v_secuencia IS NOT NULL THEN
    EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_secuencia::pg_catalog.regclass);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_verificar_evidencia_pago_venta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_proyectar_venta(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_crear_venta(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_guardar_comprobante_venta(bigint,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_crear_venta(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_guardar_comprobante_venta(bigint,text,date) TO authenticated;

COMMENT ON TABLE public.pagoventa IS 'Pagos nuevos registrados con una venta HU-006; los adelantos de separación se conservan en separacion y no se duplican aquí.';
COMMENT ON COLUMN public.venta.codsep IS 'Separación HU-005 convertida por esta venta; NULL para venta directa.';
COMMENT ON COLUMN public.venta.payloadidempotenciaven IS 'Instantánea normalizada e inmutable del payload de creación para comparar reintentos.';
COMMENT ON COLUMN public.venta.dectechoven IS 'Decisión comercial de techo de esta venta; no modifica unidad.codtte ni preparación.';
COMMENT ON FUNCTION public.hu006_crear_venta(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)
  IS 'Registra una venta directa o convierte una separación activa en una transacción idempotente y protegida por bloqueo de unidad.';
COMMENT ON FUNCTION public.hu006_guardar_comprobante_venta(bigint,text,date)
  IS 'Registra una sola vez el comprobante externo emitido fuera de la plataforma; reintentos idénticos son seguros.';

COMMIT;
