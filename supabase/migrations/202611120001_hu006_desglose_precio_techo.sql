BEGIN;

-- HU-006: catálogo de valores referenciales y snapshot financiero por venta.
-- `impven` conserva su significado de total final para compatibilidad.
ALTER TABLE public.tipotecho
  ADD COLUMN IF NOT EXISTS adicionalref numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tipotecho'::pg_catalog.regclass
      AND conname = 'chk_tipotecho_adicionalref_no_negativo'
  ) THEN
    ALTER TABLE public.tipotecho
      ADD CONSTRAINT chk_tipotecho_adicionalref_no_negativo
      CHECK (adicionalref IS NULL OR (adicionalref >= 0 AND adicionalref = pg_catalog.round(adicionalref, 2)));
  END IF;
END;
$$;

-- «Fibra clásica equipada» es una opción comercial distinta. Sus requisitos
-- operativos siguen el tipo clásico existente; la HU no define proveedor requerido.
INSERT INTO public.tipotecho(nomtte, reqprotte, reqinsttte, esttte)
VALUES ('Fibra clásica equipada', false, true, true)
ON CONFLICT (nomtte) DO NOTHING;

UPDATE public.tipotecho
SET adicionalref = CASE nomtte
  WHEN 'Sin techo' THEN 0
  WHEN 'Lona' THEN 200
  WHEN 'Techo clásico de fibra' THEN 1700
  WHEN 'Fibra clásica equipada' THEN 3200
  WHEN 'Techo de fibra deportiva' THEN 4000
END
WHERE nomtte IN ('Sin techo', 'Lona', 'Techo clásico de fibra', 'Fibra clásica equipada', 'Techo de fibra deportiva');

ALTER TABLE public.venta
  ADD COLUMN IF NOT EXISTS prebaseven numeric(10,2),
  ADD COLUMN IF NOT EXISTS adicionalrefven numeric(10,2),
  ADD COLUMN IF NOT EXISTS adicionalacordadoven numeric(10,2);

-- Conciliar las ventas creadas antes de este desglose. Su impven histórico es
-- el precio base registrado entonces; no se reconstruye desde el precio actual
-- del modelo, que pudo cambiar desde la venta.
DO $$
DECLARE
  v_codven bigint;
BEGIN
  SELECT v.codven INTO v_codven
  FROM public.venta AS v
  LEFT JOIN public.tipotecho AS t ON t.codtte = v.codtteven
  WHERE v.dectechoven = 'Con techo'
    AND (v.codtteven IS NULL OR t.codtte IS NULL OR t.adicionalref IS NULL)
  ORDER BY v.codven
  LIMIT 1;

  IF v_codven IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PT623',
      MESSAGE = pg_catalog.format(
        'No se puede conciliar la venta histórica %s: falta un tipo de techo o su adicional referencial',
        v_codven
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.venta AS v
    WHERE v.dectechoven IN ('Por definir', 'Sin techo', 'Con techo')
      AND v.impven IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PT623',
      MESSAGE = 'No se puede conciliar una venta histórica sin importe';
  END IF;
END;
$$;

UPDATE public.venta AS v
SET prebaseven = v.impven,
    adicionalrefven = 0,
    adicionalacordadoven = 0
WHERE v.dectechoven IN ('Por definir', 'Sin techo');

UPDATE public.venta AS v
SET prebaseven = v.impven,
    adicionalrefven = t.adicionalref,
    adicionalacordadoven = t.adicionalref,
    impven = v.impven + t.adicionalref
FROM public.tipotecho AS t
WHERE v.dectechoven = 'Con techo'
  AND t.codtte = v.codtteven;

-- El CHECK se agrega después del backfill porque impven conserva el total,
-- mientras que los snapshots históricos comienzan a quedar completos aquí.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.venta'::pg_catalog.regclass AND conname = 'chk_hu006_venta_desglose_precio'
  ) THEN
    ALTER TABLE public.venta ADD CONSTRAINT chk_hu006_venta_desglose_precio CHECK (
      (prebaseven IS NULL AND adicionalrefven IS NULL AND adicionalacordadoven IS NULL)
      OR (prebaseven IS NOT NULL AND adicionalrefven IS NOT NULL AND adicionalacordadoven IS NOT NULL
        AND prebaseven > 0 AND adicionalrefven >= 0 AND adicionalacordadoven >= 0
        AND prebaseven = pg_catalog.round(prebaseven, 2)
        AND adicionalrefven = pg_catalog.round(adicionalrefven, 2)
        AND adicionalacordadoven = pg_catalog.round(adicionalacordadoven, 2)
        AND impven = prebaseven + adicionalacordadoven)
    );
  END IF;
END;
$$;

-- Mantén la implementación ya aplicada como helper interno; el RPC público nuevo
-- calcula el total en PostgreSQL y nunca recibe un total impuesto por el cliente.
ALTER FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) RENAME TO hu006_crear_venta_base;
REVOKE ALL ON FUNCTION public.hu006_crear_venta_base(
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

-- El RPC antiguo no puede seguir aceptando un total arbitrario directamente.
REVOKE ALL ON FUNCTION public.hu006_crear_venta_base(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_crear_venta(
  bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid
) TO authenticated;

-- La función anterior se conserva como helper interno para mantener las validaciones
-- atómicas ya desplegadas. El wrapper aplica la nueva compatibilidad financiera.
ALTER FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint)
  RENAME TO hu006_guardar_techo_venta_base;
REVOKE ALL ON FUNCTION public.hu006_guardar_techo_venta_base(bigint,text,bigint)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hu006_guardar_techo_venta(
  p_codven bigint, p_decisiontecho text, p_codtte bigint, p_adicionalacordado numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
  v_coduni bigint;
  v_venta public.venta%ROWTYPE;
  v_adicional_ref numeric(10,2);
  v_adicional_acordado numeric(10,2);
  v_total numeric(10,2);
  v_recibido numeric(10,2);
  v_base_result jsonb;
  v_proyeccion jsonb;
BEGIN
  SELECT p.codusu, p.rol INTO v_codusu, v_rol FROM public.hu005_perfil_comercial() AS p;
  IF v_codusu IS NULL OR v_rol NOT IN ('Gerente','Administradora','Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para resolver el techo';
  END IF;
  IF p_codven IS NULL OR p_codven <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Código de venta inválido';
  END IF;
  SELECT v.coduni INTO v_coduni FROM public.venta AS v WHERE v.codven = p_codven;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Venta inexistente';
  END IF;
  PERFORM 1 FROM public.unidad WHERE coduni = v_coduni FOR UPDATE;
  SELECT * INTO v_venta FROM public.venta WHERE codven = p_codven FOR UPDATE;
  IF p_decisiontecho NOT IN ('Por definir','Sin techo','Con techo')
    OR (p_decisiontecho = 'Con techo' AND (p_codtte IS NULL OR p_codtte <= 0))
    OR (p_decisiontecho <> 'Con techo' AND p_codtte IS NOT NULL) THEN
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
    RETURN v_base_result || pg_catalog.jsonb_build_object(
      'precioBaseAcordado',v_venta.prebaseven,'adicionalTechoReferencial',v_venta.adicionalrefven,
      'adicionalTechoAcordado',v_venta.adicionalacordadoven,'importe',v_venta.impven,
      'totalRecibido',(v_proyeccion->>'totalRecibido')::numeric,
      'saldo',(v_proyeccion->>'saldo')::numeric
    );
  END IF;

  IF p_decisiontecho = 'Por definir' THEN
    IF p_adicionalacordado IS NOT NULL AND p_adicionalacordado <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT620', MESSAGE = 'Por definir no admite recargo de techo';
    END IF;
    v_base_result := public.hu006_guardar_techo_venta_base(p_codven,p_decisiontecho,p_codtte);
    RETURN v_base_result || pg_catalog.jsonb_build_object(
      'precioBaseAcordado',v_venta.prebaseven,'adicionalTechoReferencial',v_venta.adicionalrefven,
      'adicionalTechoAcordado',v_venta.adicionalacordadoven,'importe',v_venta.impven
    );
  END IF;
  IF v_venta.prebaseven IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT619', MESSAGE = 'La venta histórica requiere conciliación de su precio base antes de resolver el techo';
  END IF;

  IF p_decisiontecho = 'Sin techo' THEN
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
    SELECT t.adicionalref INTO v_adicional_ref FROM public.tipotecho AS t
    WHERE t.codtte = p_codtte AND t.esttte IS TRUE FOR SHARE;
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
  END IF;
  v_total := v_venta.prebaseven + v_adicional_acordado;
  SELECT COALESCE((SELECT pg_catalog.sum(p.montopagven) FROM public.pagoventa AS p WHERE p.codven = p_codven),0)
       + COALESCE((SELECT s.monadesep FROM public.separacion AS s WHERE s.codsep = v_venta.codsep AND s.ingconfsep IS TRUE),0)
    INTO v_recibido;
  IF v_recibido > v_total THEN
    RAISE EXCEPTION USING ERRCODE = 'PT621', MESSAGE = 'Los pagos superan el total recalculado de la venta';
  END IF;

  v_base_result := public.hu006_guardar_techo_venta_base(p_codven,p_decisiontecho,p_codtte);
  UPDATE public.venta SET
    impven = v_total,
    adicionalrefven = v_adicional_ref,
    adicionalacordadoven = v_adicional_acordado
  WHERE codven = p_codven;
  v_proyeccion := public.hu006_proyectar_venta(p_codven);
  RETURN v_base_result || pg_catalog.jsonb_build_object(
    'precioBaseAcordado',v_venta.prebaseven,'adicionalTechoReferencial',v_adicional_ref,
    'adicionalTechoAcordado',v_adicional_acordado,'importe',v_total,
    'totalRecibido',(v_proyeccion->>'totalRecibido')::numeric,
    'saldo',(v_proyeccion->>'saldo')::numeric
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_guardar_techo_venta_base(bigint,text,bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint,numeric)
  TO authenticated;

COMMENT ON COLUMN public.tipotecho.adicionalref IS 'Adicional referencial vigente, no vinculante; se copia como snapshot al registrar la venta.';
COMMENT ON COLUMN public.venta.prebaseven IS 'Snapshot del precio base tomado de modelo.premod al crear la venta.';
COMMENT ON COLUMN public.venta.adicionalrefven IS 'Snapshot del adicional referencial del catálogo al crear o resolver el techo.';
COMMENT ON COLUMN public.venta.adicionalacordadoven IS 'Adicional de techo explícitamente acordado con el comprador.';

COMMIT;
