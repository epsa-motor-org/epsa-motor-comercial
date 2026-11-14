BEGIN;

-- HU-006: descuento comercial autorizado por teléfono. Las columnas quedan
-- NULL en ventas existentes: no hay información histórica suficiente para
-- afirmar que tuvieron descuento cero ni para inventar una autorización.
ALTER TABLE public.venta
  ADD COLUMN descuentoven numeric(10,2),
  ADD COLUMN motivodescuentoven text,
  ADD COLUMN codusuautorizadesc bigint,
  ADD COLUMN conftelefonicadesc boolean,
  ADD COLUMN fecconftelefonicadesc timestamptz;

ALTER TABLE public.venta
  ADD CONSTRAINT fk_hu006_venta_autorizador_descuento
    FOREIGN KEY (codusuautorizadesc) REFERENCES public.usuario(codusu),
  DROP CONSTRAINT chk_hu006_venta_importe,
  ADD CONSTRAINT chk_hu006_venta_importe
    CHECK (impven IS NULL OR (impven >= 0 AND impven = pg_catalog.round(impven, 2))),
  DROP CONSTRAINT chk_hu006_venta_desglose_precio,
  ADD CONSTRAINT chk_hu006_venta_desglose_precio CHECK (
    (prebaseven IS NULL AND adicionalrefven IS NULL AND adicionalacordadoven IS NULL
      AND descuentoven IS NULL)
    OR (prebaseven IS NOT NULL AND adicionalrefven IS NOT NULL AND adicionalacordadoven IS NOT NULL
      AND prebaseven > 0 AND adicionalrefven >= 0 AND adicionalacordadoven >= 0
      AND prebaseven = pg_catalog.round(prebaseven, 2)
      AND adicionalrefven = pg_catalog.round(adicionalrefven, 2)
      AND adicionalacordadoven = pg_catalog.round(adicionalacordadoven, 2)
      AND (
        (descuentoven IS NULL AND impven = prebaseven + adicionalacordadoven)
        OR (descuentoven IS NOT NULL AND descuentoven >= 0
          AND descuentoven = pg_catalog.round(descuentoven, 2)
          AND impven = prebaseven + adicionalacordadoven - descuentoven)
      ))
  ),
  ADD CONSTRAINT chk_hu006_venta_datos_descuento CHECK (
    (descuentoven IS NULL AND motivodescuentoven IS NULL AND codusuautorizadesc IS NULL
      AND conftelefonicadesc IS NULL AND fecconftelefonicadesc IS NULL)
    OR (descuentoven = 0 AND motivodescuentoven IS NULL AND codusuautorizadesc IS NULL
      AND conftelefonicadesc IS FALSE AND fecconftelefonicadesc IS NULL)
    OR (descuentoven > 0 AND descuentoven = pg_catalog.round(descuentoven, 2)
      AND motivodescuentoven IS NOT NULL AND pg_catalog.btrim(motivodescuentoven) <> ''
      AND pg_catalog.char_length(motivodescuentoven) <= 500
      AND motivodescuentoven !~ '[[:cntrl:]]'
      AND codusuautorizadesc IS NOT NULL
      AND conftelefonicadesc IS TRUE AND fecconftelefonicadesc IS NOT NULL)
  );

COMMENT ON COLUMN public.venta.descuentoven IS 'Descuento comercial en soles; NULL en ventas anteriores a HU-006 descuento.';
COMMENT ON COLUMN public.venta.motivodescuentoven IS 'Motivo declarado para el descuento comercial.';
COMMENT ON COLUMN public.venta.codusuautorizadesc IS 'Gerente o Administradora indicados como autorizador comercial telefónico.';
COMMENT ON COLUMN public.venta.conftelefonicadesc IS 'Declaración del operador autenticado de haber recibido autorización telefónica; no acredita la llamada.';
COMMENT ON COLUMN public.venta.fecconftelefonicadesc IS 'Instante de servidor en que se registró la declaración de autorización telefónica.';

CREATE OR REPLACE FUNCTION public.hu006_validar_datos_descuento(
  p_descuento numeric,
  p_motivodescuento text,
  p_codusuautorizadesc bigint,
  p_conftelefonicadesc boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_autorizador bigint;
BEGIN
  IF p_descuento IS NULL OR p_descuento < 0 OR p_descuento > 99999999.99
    OR p_descuento <> pg_catalog.round(p_descuento, 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT624', MESSAGE = 'El descuento debe ser no negativo y tener hasta dos decimales';
  END IF;

  IF p_descuento = 0 THEN
    IF NULLIF(pg_catalog.btrim(COALESCE(p_motivodescuento, '')), '') IS NOT NULL
      OR p_codusuautorizadesc IS NOT NULL OR p_conftelefonicadesc IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'PT624', MESSAGE = 'Un descuento cero no requiere datos de autorización';
    END IF;
    RETURN;
  END IF;

  IF p_motivodescuento IS NULL OR pg_catalog.btrim(p_motivodescuento) = ''
    OR pg_catalog.char_length(pg_catalog.btrim(p_motivodescuento)) > 500
    OR p_motivodescuento ~ '[[:cntrl:]]'
    OR p_codusuautorizadesc IS NULL OR p_codusuautorizadesc <= 0
    OR p_conftelefonicadesc IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'PT624', MESSAGE = 'Un descuento mayor a cero requiere motivo, autorizador y confirmación telefónica';
  END IF;

  SELECT u.codusu INTO v_autorizador
  FROM public.usuario AS u
  JOIN public.rol AS r ON r.codrol = u.codrol
  WHERE u.codusu = p_codusuautorizadesc
    AND u.estusu IS TRUE AND r.estrol IS TRUE
    AND r.nomrol IN ('Gerente', 'Administradora')
  FOR SHARE OF u, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT625', MESSAGE = 'El autorizador no existe, está inactivo o no es Gerente o Administradora';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hu006_validar_datos_descuento(numeric,text,bigint,boolean)
  FROM PUBLIC, anon, authenticated;

-- El wrapper anterior calcula el precio sin descuento. Se conserva como helper
-- privado y se coloca una nueva capa pública que registra el descuento neto.
ALTER FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) RENAME TO hu006_crear_venta_sin_descuento_base;
REVOKE ALL ON FUNCTION public.hu006_crear_venta_sin_descuento_base(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hu006_crear_venta(
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
  p_idempotenciaven uuid,
  p_descuento numeric,
  p_motivodescuento text,
  p_codusuautorizadesc bigint,
  p_conftelefonicadesc boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
  v_existente public.venta%ROWTYPE;
  v_resultado jsonb;
  v_finanzas jsonb;
  v_descuento numeric;
  v_motivo text;
  v_autorizador bigint;
  v_confirmacion boolean;
  v_importe_base numeric(10,2);
  v_importe_antes numeric(10,2);
  v_total numeric(10,2);
  v_recibido numeric(10,2);
  v_fecha_confirmacion timestamptz;
BEGIN
  SELECT p.codusu, p.rol INTO v_codusu, v_rol FROM public.hu005_perfil_comercial() AS p;
  IF v_codusu IS NULL OR v_rol NOT IN ('Gerente','Administradora','Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para registrar ventas';
  END IF;
  IF p_idempotenciaven IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Idempotency-Key es obligatoria';
  END IF;

  v_descuento := p_descuento;
  v_motivo := NULLIF(pg_catalog.btrim(COALESCE(p_motivodescuento, '')), '');
  v_autorizador := p_codusuautorizadesc;
  v_confirmacion := COALESCE(p_conftelefonicadesc, FALSE);

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
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otra solicitud de venta';
    END IF;

    -- Ventas anteriores a esta migration conservan descuento NULL. Solo se
    -- permite su replay sin agregar datos de descuento retroactivamente.
    IF v_existente.descuentoven IS NULL THEN
      IF v_descuento IS DISTINCT FROM 0 OR v_motivo IS NOT NULL OR v_autorizador IS NOT NULL OR v_confirmacion THEN
        RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otro payload comercial';
      END IF;
      IF v_existente.payloadidempotenciaven ? 'descuento' THEN
        RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otro payload comercial';
      END IF;
    ELSE
      IF v_descuento IS DISTINCT FROM v_existente.descuentoven
        OR v_motivo IS DISTINCT FROM v_existente.motivodescuentoven
        OR v_autorizador IS DISTINCT FROM v_existente.codusuautorizadesc
        OR v_confirmacion IS DISTINCT FROM v_existente.conftelefonicadesc
        OR NOT (v_existente.payloadidempotenciaven ? 'descuento')
        OR (v_existente.payloadidempotenciaven->>'descuento')::numeric IS DISTINCT FROM v_descuento
        OR NULLIF(v_existente.payloadidempotenciaven->>'motivoDescuento','') IS DISTINCT FROM v_motivo
        OR NULLIF(v_existente.payloadidempotenciaven->>'codusuAutorizadorDescuento','')::bigint IS DISTINCT FROM v_autorizador
        OR COALESCE((v_existente.payloadidempotenciaven->>'confirmacionTelefonicaRecibida')::boolean,FALSE)
          IS DISTINCT FROM v_confirmacion THEN
        RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otro payload comercial';
      END IF;
    END IF;

    -- El helper inferior recibe el importe previo almacenado. Compara el resto
    -- del payload, pero no puede detectar por sí solo que cambió el adicional
    -- acordado; esta comparación conserva ese dato en la identidad del replay.
    IF COALESCE(p_adicionalacordado,0) IS DISTINCT FROM
      COALESCE((v_existente.payloadidempotenciaven->>'adicionalTechoAcordado')::numeric,0) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'Idempotency-Key ya fue usada con otro adicional acordado';
    END IF;

    v_importe_base := (v_existente.payloadidempotenciaven->>'importe')::numeric(10,2);
    IF v_importe_base IS NULL OR v_existente.prebaseven IS NULL
      OR v_existente.adicionalacordadoven IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT611', MESSAGE = 'La venta no tiene snapshot comercial suficiente para reintento seguro';
    END IF;

    -- El helper interno compara el payload de creación sin los snapshots de
    -- HU-006; restaurarlos conserva las claves usadas para los reintentos.
    UPDATE public.venta SET payloadidempotenciaven = payloadidempotenciaven
      - 'precioBaseAcordado' - 'adicionalTechoReferencial' - 'adicionalTechoAcordado'
      - 'importeAntesDescuento' - 'descuento' - 'motivoDescuento'
      - 'codusuAutorizadorDescuento' - 'confirmacionTelefonicaRecibida'
    WHERE codven = v_existente.codven;
    v_resultado := public.hu006_crear_venta_base(
      p_coduni,p_codcli,p_codusuresp,p_codsedatencion,p_fecven,p_modcomven,
      v_importe_base,p_codsedentregaprevista,p_pagos,p_techo,p_refcompven,
      p_feccompven,p_obsven,p_idempotenciaven
    );
    UPDATE public.venta SET payloadidempotenciaven = v_existente.payloadidempotenciaven
    WHERE codven = v_existente.codven;
    v_recibido := COALESCE((v_resultado->>'totalRecibido')::numeric,0);
    RETURN v_resultado || pg_catalog.jsonb_build_object(
      'precioBaseAcordado',v_existente.prebaseven,
      'adicionalTechoReferencial',v_existente.adicionalrefven,
      'adicionalTechoAcordado',v_existente.adicionalacordadoven,
      'importeAntesDescuento',v_existente.prebaseven + v_existente.adicionalacordadoven,
      'descuento',v_existente.descuentoven,
      'motivoDescuento',v_existente.motivodescuentoven,
      'codusuAutorizadorDescuento',v_existente.codusuautorizadesc::text,
      'nombreAutorizadorDescuento',(SELECT pg_catalog.btrim(pg_catalog.concat_ws(' ',u.nomusu,u.apepatusu,u.apematusu))
        FROM public.usuario AS u WHERE u.codusu=v_existente.codusuautorizadesc),
      'confirmacionTelefonicaRecibida',v_existente.conftelefonicadesc,
      'fechaConfirmacionTelefonica',v_existente.fecconftelefonicadesc,
      'importe',v_existente.impven,
      'saldo',pg_catalog.round(v_existente.impven-v_recibido,2),
      'reutilizada',TRUE
    );
  END IF;

  PERFORM public.hu006_validar_datos_descuento(
    v_descuento,v_motivo,v_autorizador,v_confirmacion
  );

  -- El helper calcula base + techo y conserva el adelanto/pagos. Se le entrega
  -- el importe previo al descuento; la capa aplica el descuento dentro de esta
  -- misma transacción tras verificar el dinero recibido.
  v_resultado := public.hu006_crear_venta_sin_descuento_base(
    p_coduni,p_codcli,p_codusuresp,p_codsedatencion,p_fecven,p_modcomven,
    p_adicionalacordado,p_codsedentregaprevista,p_pagos,p_techo,p_refcompven,
    p_feccompven,p_obsven,p_idempotenciaven
  );
  v_importe_antes := (v_resultado->>'precioBaseAcordado')::numeric
    + (v_resultado->>'adicionalTechoAcordado')::numeric;
  v_total := v_importe_antes - v_descuento;
  v_recibido := COALESCE((v_resultado->>'totalRecibido')::numeric,0);
  IF v_descuento > v_importe_antes THEN
    RAISE EXCEPTION USING ERRCODE = 'PT624', MESSAGE = 'El descuento no puede superar el importe antes del descuento';
  END IF;
  IF v_total < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT624', MESSAGE = 'El total de la venta no puede ser negativo';
  END IF;
  IF v_recibido > v_total THEN
    RAISE EXCEPTION USING ERRCODE = 'PT612', MESSAGE = 'Los pagos y el adelanto superan el importe neto de la venta';
  END IF;
  IF v_total > 99999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT624', MESSAGE = 'El total neto de la venta excede el rango permitido';
  END IF;

  v_fecha_confirmacion := CASE WHEN v_descuento > 0 THEN pg_catalog.clock_timestamp() ELSE NULL END;
  v_finanzas := pg_catalog.jsonb_build_object(
    'precioBaseAcordado',(v_resultado->>'precioBaseAcordado')::numeric,
    'adicionalTechoReferencial',(v_resultado->>'adicionalTechoReferencial')::numeric,
    'adicionalTechoAcordado',(v_resultado->>'adicionalTechoAcordado')::numeric,
    'importeAntesDescuento',v_importe_antes,
    'descuento',v_descuento,
    'motivoDescuento',v_motivo,
    'codusuAutorizadorDescuento',v_autorizador::text,
    'confirmacionTelefonicaRecibida',v_confirmacion
  );
  UPDATE public.venta SET
    impven = v_total,
    descuentoven = v_descuento,
    motivodescuentoven = v_motivo,
    codusuautorizadesc = v_autorizador,
    conftelefonicadesc = v_confirmacion,
    fecconftelefonicadesc = v_fecha_confirmacion,
    payloadidempotenciaven = payloadidempotenciaven || v_finanzas
  WHERE codven = (v_resultado->>'codven')::bigint;

  RETURN v_resultado || v_finanzas || pg_catalog.jsonb_build_object(
    'nombreAutorizadorDescuento',(SELECT pg_catalog.btrim(pg_catalog.concat_ws(' ',u.nomusu,u.apepatusu,u.apematusu))
      FROM public.usuario AS u WHERE u.codusu=v_autorizador),
    'fechaConfirmacionTelefonica',v_fecha_confirmacion,
    'importe',v_total,'totalRecibido',v_recibido,
    'saldo',pg_catalog.round(v_total-v_recibido,2),'reutilizada',FALSE
  );
END;
$$;

-- Compatibilidad para clientes/RPC antiguos: la variante de 14 parámetros
-- solo permite registrar una venta sin descuento y delega en la nueva regla.
CREATE FUNCTION public.hu006_crear_venta(
  p_coduni bigint,p_codcli bigint,p_codusuresp bigint,p_codsedatencion bigint,
  p_fecven date,p_modcomven text,p_adicionalacordado numeric,
  p_codsedentregaprevista bigint,p_pagos jsonb,p_techo jsonb,
  p_refcompven text,p_feccompven date,p_obsven text,p_idempotenciaven uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.hu006_crear_venta(
    p_coduni,p_codcli,p_codusuresp,p_codsedatencion,p_fecven,p_modcomven,
    p_adicionalacordado,p_codsedentregaprevista,p_pagos,p_techo,p_refcompven,
    p_feccompven,p_obsven,p_idempotenciaven,0,NULL,NULL,FALSE
  )
$$;

REVOKE ALL ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid,numeric,text,bigint,boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid,numeric,text,bigint,boolean
) TO authenticated;
REVOKE ALL ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) TO authenticated;

-- La proyección comparte el desglose para creación, ficha y resolución de techo.
CREATE OR REPLACE FUNCTION public.hu006_proyectar_venta(p_codven bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'codven',v.codven::text,'coduni',v.coduni::text,'codcli',v.codcli::text,'codsep',v.codsep::text,
    'autor',pg_catalog.jsonb_build_object('codusu',autor.codusu::text,
      'nombre',pg_catalog.btrim(pg_catalog.concat_ws(' ',autor.nomusu,autor.apepatusu,autor.apematusu))),
    'responsable',pg_catalog.jsonb_build_object('codusu',responsable.codusu::text,
      'nombre',pg_catalog.btrim(pg_catalog.concat_ws(' ',responsable.nomusu,responsable.apepatusu,responsable.apematusu))),
    'sedeAtencion',pg_catalog.jsonb_build_object('codsed',sa.codsed::text,'nombre',ua.nomubi),
    'sedeEntregaPrevista',CASE WHEN se.codsed IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('codsed',se.codsed::text,'nombre',ue.nomubi) END,
    'fechaVenta',v.fecven,'modalidad',v.modcomven,
    'precioBaseAcordado',v.prebaseven,
    'adicionalTechoReferencial',v.adicionalrefven,
    'adicionalTechoAcordado',v.adicionalacordadoven,
    'importeAntesDescuento',CASE WHEN v.prebaseven IS NULL OR v.adicionalacordadoven IS NULL THEN NULL
      ELSE v.prebaseven + v.adicionalacordadoven END,
    'descuento',v.descuentoven,
    'motivoDescuento',v.motivodescuentoven,
    'codusuAutorizadorDescuento',v.codusuautorizadesc::text,
    'nombreAutorizadorDescuento',CASE WHEN autorizador.codusu IS NULL THEN NULL ELSE
      pg_catalog.btrim(pg_catalog.concat_ws(' ',autorizador.nomusu,autorizador.apepatusu,autorizador.apematusu)) END,
    'confirmacionTelefonicaRecibida',v.conftelefonicadesc,
    'fechaConfirmacionTelefonica',v.fecconftelefonicadesc,
    'importe',v.impven,
    'totalRecibido',pg_catalog.round(
      COALESCE((SELECT pg_catalog.sum(p.montopagven) FROM public.pagoventa AS p WHERE p.codven=v.codven),0)
      + COALESCE((SELECT s.monadesep FROM public.separacion AS s WHERE s.codsep=v.codsep AND s.ingconfsep IS TRUE),0),2),
    'saldo',pg_catalog.round(v.impven
      - COALESCE((SELECT pg_catalog.sum(p.montopagven) FROM public.pagoventa AS p WHERE p.codven=v.codven),0)
      - COALESCE((SELECT s.monadesep FROM public.separacion AS s WHERE s.codsep=v.codsep AND s.ingconfsep IS TRUE),0),2),
    'pagos',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'codpagven',p.codpagven::text,'numero',p.nropagven,'monto',p.montopagven,'fecha',p.fecpagven,
      'medioPago',p.metpagven,'referencia',p.refpagven,'rutaEvidencia',p.rutavoucherven,
      'observacion',p.obspagven,'ingresoConfirmado',p.ingconfpag,'confirmadoPor',p.codusuconfpag::text,
      'fechaConfirmacion',p.fecconfpag,'autor',p.codusuautorpag::text)
      ORDER BY p.nropagven) FROM public.pagoventa AS p WHERE p.codven=v.codven),'[]'::jsonb),
    'techo',pg_catalog.jsonb_build_object('decision',v.dectechoven,'codtte',v.codtteven::text,
      'fecha',v.fecdectechoven,'decididoPor',v.codusudectechoven::text),
    'comprobanteExterno',CASE WHEN v.refcompven IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('referencia',v.refcompven,'fecha',v.feccompven) END,
    'observacion',v.obsven,'estado',v.estven
  )
  FROM public.venta AS v
  JOIN public.usuario AS autor ON autor.codusu=v.codusu
  LEFT JOIN public.usuario AS responsable ON responsable.codusu=v.codusuresp
  JOIN public.sede AS sa ON sa.codsed=v.codsedatencion
  JOIN public.ubicacion AS ua ON ua.codubi=sa.codubi
  LEFT JOIN public.sede AS se ON se.codsed=v.codsedentregaprevista
  LEFT JOIN public.ubicacion AS ue ON ue.codubi=se.codubi
  LEFT JOIN public.usuario AS autorizador ON autorizador.codusu=v.codusuautorizadesc
  WHERE v.codven=p_codven
$$;

-- La elección del techo sigue siendo la misma operación; el recálculo resta el
-- descuento guardado y rechaza si pagos/adelanto ya superan el nuevo total.
CREATE OR REPLACE FUNCTION public.hu006_guardar_techo_venta(
  p_codven bigint,p_decisiontecho text,p_codtte bigint,p_adicionalacordado numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
  v_coduni bigint;
  v_venta public.venta%ROWTYPE;
  v_adicional_ref numeric(10,2);
  v_adicional_acordado numeric(10,2);
  v_importe_antes numeric(10,2);
  v_total numeric(10,2);
  v_recibido numeric(10,2);
  v_base_result jsonb;
  v_proyeccion jsonb;
BEGIN
  SELECT p.codusu,p.rol INTO v_codusu,v_rol FROM public.hu005_perfil_comercial() AS p;
  IF v_codusu IS NULL OR v_rol NOT IN ('Gerente','Administradora','Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para resolver el techo';
  END IF;
  IF p_codven IS NULL OR p_codven <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Código de venta inválido';
  END IF;
  SELECT v.coduni INTO v_coduni FROM public.venta AS v WHERE v.codven=p_codven;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Venta inexistente';
  END IF;
  PERFORM 1 FROM public.unidad WHERE coduni=v_coduni FOR UPDATE;
  SELECT * INTO v_venta FROM public.venta WHERE codven=p_codven FOR UPDATE;
  IF p_decisiontecho NOT IN ('Por definir','Sin techo','Con techo')
    OR (p_decisiontecho='Con techo' AND (p_codtte IS NULL OR p_codtte <= 0))
    OR (p_decisiontecho<>'Con techo' AND p_codtte IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Decisión o tipo de techo inválidos';
  END IF;

  IF v_venta.dectechoven IS DISTINCT FROM 'Por definir' THEN
    IF v_venta.dectechoven IS DISTINCT FROM p_decisiontecho
      OR v_venta.codtteven IS DISTINCT FROM p_codtte
      OR COALESCE(p_adicionalacordado,0) IS DISTINCT FROM v_venta.adicionalacordadoven THEN
      RAISE EXCEPTION USING ERRCODE = 'PT614', MESSAGE = 'La decisión final de techo de la venta no se puede modificar';
    END IF;
    v_base_result := public.hu006_guardar_techo_venta_base(p_codven,p_decisiontecho,p_codtte);
    v_proyeccion := public.hu006_proyectar_venta(p_codven);
    RETURN v_base_result || v_proyeccion;
  END IF;

  IF p_decisiontecho='Por definir' THEN
    IF p_adicionalacordado IS NOT NULL AND p_adicionalacordado<>0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Por definir no admite recargo de techo';
    END IF;
    v_base_result := public.hu006_guardar_techo_venta_base(p_codven,p_decisiontecho,p_codtte);
    RETURN v_base_result || public.hu006_proyectar_venta(p_codven);
  END IF;

  IF v_venta.prebaseven IS NULL OR v_venta.descuentoven IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'La venta histórica no tiene snapshots financieros suficientes para resolver el techo con seguridad';
  END IF;

  IF p_decisiontecho='Sin techo' THEN
    SELECT t.adicionalref INTO v_adicional_ref FROM public.tipotecho AS t
    WHERE t.nomtte='Sin techo' AND t.esttte IS TRUE FOR SHARE;
    IF NOT FOUND OR v_adicional_ref IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'El adicional referencial de Sin techo debe ser 0';
    END IF;
    IF p_adicionalacordado IS NOT NULL AND p_adicionalacordado<>0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Sin techo no admite adicional acordado';
    END IF;
    v_adicional_acordado := 0;
  ELSE
    SELECT t.adicionalref INTO v_adicional_ref FROM public.tipotecho AS t
    WHERE t.codtte=p_codtte AND t.esttte IS TRUE FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT610', MESSAGE = 'El tipo de techo no existe o está inactivo';
    END IF;
    IF v_adicional_ref IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'El tipo de techo no tiene adicional referencial configurado';
    END IF;
    IF p_adicionalacordado IS NULL OR p_adicionalacordado<0 OR p_adicionalacordado>99999999.99
      OR p_adicionalacordado<>pg_catalog.round(p_adicionalacordado,2) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Con techo requiere adicional acordado válido';
    END IF;
    v_adicional_acordado := p_adicionalacordado;
  END IF;

  v_importe_antes := v_venta.prebaseven + v_adicional_acordado;
  v_total := v_importe_antes - v_venta.descuentoven;
  IF v_total < 0 OR v_total > 99999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'El total neto recalculado no es válido';
  END IF;
  SELECT COALESCE((SELECT pg_catalog.sum(p.montopagven) FROM public.pagoventa AS p WHERE p.codven=p_codven),0)
    + COALESCE((SELECT s.monadesep FROM public.separacion AS s WHERE s.codsep=v_venta.codsep AND s.ingconfsep IS TRUE),0)
    INTO v_recibido;
  IF v_recibido > v_total THEN
    RAISE EXCEPTION USING ERRCODE = 'PT621', MESSAGE = 'Los pagos recibidos superan el total recalculado de la venta';
  END IF;

  v_base_result := public.hu006_guardar_techo_venta_base(p_codven,p_decisiontecho,p_codtte);
  UPDATE public.venta SET
    impven=v_total,
    adicionalrefven=v_adicional_ref,
    adicionalacordadoven=v_adicional_acordado
  WHERE codven=p_codven;
  v_proyeccion := public.hu006_proyectar_venta(p_codven);
  RETURN v_base_result || v_proyeccion;
END;
$$;

-- Mantener el listado existente y enriquecer sus items desde venta en una sola
-- consulta; no se cambian búsqueda, paginación ni reglas de visibilidad.
ALTER FUNCTION public.hu006_listar_ventas(text,integer,integer)
  RENAME TO hu006_listar_ventas_sin_descuento;
REVOKE ALL ON FUNCTION public.hu006_listar_ventas_sin_descuento(text,integer,integer)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.hu006_listar_ventas(
  p_busqueda text DEFAULT NULL,p_limite integer DEFAULT 50,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
  v_items jsonb;
BEGIN
  v_resultado := public.hu006_listar_ventas_sin_descuento(p_busqueda,p_limite,p_offset);
  SELECT COALESCE(pg_catalog.jsonb_agg(
    x.item || pg_catalog.jsonb_build_object(
      'importeAntesDescuento',CASE WHEN v.prebaseven IS NULL OR v.adicionalacordadoven IS NULL THEN NULL
        ELSE v.prebaseven + v.adicionalacordadoven END,
      'descuento',v.descuentoven,
      'motivoDescuento',v.motivodescuentoven,
      'codusuAutorizadorDescuento',v.codusuautorizadesc::text,
      'nombreAutorizadorDescuento',CASE WHEN au.codusu IS NULL THEN NULL ELSE
        pg_catalog.btrim(pg_catalog.concat_ws(' ',au.nomusu,au.apepatusu,au.apematusu)) END,
      'confirmacionTelefonicaRecibida',v.conftelefonicadesc,
      'fechaConfirmacionTelefonica',v.fecconftelefonicadesc
    ) ORDER BY x.ord
  ),'[]'::jsonb) INTO v_items
  FROM pg_catalog.jsonb_array_elements(COALESCE(v_resultado->'items','[]'::jsonb)) WITH ORDINALITY AS x(item,ord)
  JOIN public.venta AS v ON v.codven=(x.item->>'codven')::bigint
  LEFT JOIN public.usuario AS au ON au.codusu=v.codusuautorizadesc;
  RETURN pg_catalog.jsonb_set(v_resultado,'{items}',v_items,TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.hu006_listar_ventas(text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_listar_ventas(text,integer,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.hu006_crear_venta_sin_descuento_base(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint,numeric) TO authenticated;

COMMIT;
