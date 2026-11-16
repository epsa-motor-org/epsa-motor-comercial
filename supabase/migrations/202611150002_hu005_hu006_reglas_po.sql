BEGIN;

-- HU-005/HU-006 · Ajustes incrementales a las funciones vigentes según la
-- definición final del PO del 15/11/2026. No actualiza datos históricos ni
-- cambia el estado físico de las unidades.
DO $hu005_hu006_po$
DECLARE
  v_patch record;
  v_firma text;
  v_def text;
  v_nueva text;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.hu005_crear_separacion_base_minimo(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.hu005_guardar_techo_separacion(bigint,text,bigint)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.hu006_crear_venta(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid,numeric,text,bigint,boolean)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.hu006_crear_venta_sin_descuento_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.hu006_crear_venta_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.hu006_guardar_techo_venta_base(bigint,text,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'HU-005/HU-006 202611150001 requiere las versiones vigentes de HU-005/HU-006, incluyendo migrations 202611140001 a 202611140005';
  END IF;

  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)',
        $orig1$IF p_monadesep IS NULL OR p_monadesep <= 0 THEN$orig1$,
        $repl1$IF v_rol = 'Vendedor' AND p_codusuresp IS DISTINCT FROM v_codusu THEN
    RAISE EXCEPTION USING ERRCODE = 'PT443', MESSAGE = 'El vendedor solo puede registrarse como responsable de la separación';
  END IF;
  IF p_monadesep IS NULL OR p_monadesep <= 0 THEN$repl1$,
        'PT443', false
      ),
      (
        'public.hu006_crear_venta(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid,numeric,text,bigint,boolean)',
        $orig2$IF p_idempotenciaven IS NULL THEN$orig2$,
        $repl2$IF v_rol = 'Vendedor' AND p_codusuresp IS DISTINCT FROM v_codusu THEN
    RAISE EXCEPTION USING ERRCODE = 'PT626', MESSAGE = 'El vendedor solo puede registrarse como responsable de la venta';
  END IF;
  IF p_idempotenciaven IS NULL THEN$repl2$,
        'PT626', false
      ),
      (
        'public.hu005_crear_separacion_base_minimo(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)',
        $orig3$PERFORM[[:space:]]+public\.hu005_validar_compatibilidad_techo_instalado\([[:space:]]*p_coduni,[[:space:]]*v_decision,[[:space:]]*p_codttecomsep[[:space:]]*\);$orig3$,
        $repl3$-- HU-005 PO 2026-11-15: la decisión comercial no valida ni cambia el techo físico.$repl3$,
        'HU-005 PO 2026-11-15: la decisión comercial no valida ni cambia el techo físico', true
      ),
      (
        'public.hu005_guardar_techo_separacion(bigint,text,bigint)',
        $orig4$PERFORM[[:space:]]+public\.hu005_validar_compatibilidad_techo_instalado\([[:space:]]*v_separacion\.coduni,[[:space:]]*v_decision,[[:space:]]*p_codttecomsep[[:space:]]*\);$orig4$,
        $repl4$-- HU-005 PO 2026-11-15: la decisión comercial no se restringe por el techo físico.$repl4$,
        'HU-005 PO 2026-11-15: la decisión comercial no se restringe por el techo físico', true
      ),
      (
        'public.hu006_crear_venta_sin_descuento_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)',
        $orig5$IF v_decision IS DISTINCT FROM v_separacion\.dectechosep[[:space:]]+OR v_codtte IS DISTINCT FROM v_separacion\.codttesep THEN[[:space:]]+RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'El techo enviado no coincide con la separación';[[:space:]]+END IF;[[:space:]]+v_codtte := v_separacion\.codttesep;$orig5$,
        $repl5$-- HU-006 PO 2026-11-15: la conversión puede guardar una elección de techo distinta a la antecedente.$repl5$,
        'HU-006 PO 2026-11-15: la conversión puede guardar una elección de techo distinta a la antecedente', true
      ),
      (
        'public.hu006_crear_venta_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)',
        $orig6$IF v_techo IS NOT NULL AND \([[:space:]]*v_techo ->> 'decision' IS DISTINCT FROM v_separacion\.dectechosep[[:space:]]+OR NULLIF\(v_techo ->> 'codtte', ''\) IS DISTINCT FROM v_separacion\.codttesep::text[[:space:]]*\) THEN[[:space:]]+RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'El techo enviado no coincide con la decisión de la separación';[[:space:]]+END IF;[[:space:]]+v_decision := v_separacion\.dectechosep;[[:space:]]+v_codtte := v_separacion\.codttesep;$orig6$,
        $repl6$-- HU-006 PO 2026-11-15: respetar la decisión explícita o heredar la separación si techo es NULL.
    IF v_techo IS NULL THEN
      v_decision := v_separacion.dectechosep;
      v_codtte := v_separacion.codttesep;
    ELSE
      v_decision := v_techo ->> 'decision';
      v_codtte := NULLIF(v_techo ->> 'codtte', '')::bigint;
    END IF;$repl6$,
        'HU-006 PO 2026-11-15: respetar la decisión explícita o heredar la separación si techo es NULL', true
      ),
      (
        'public.hu006_crear_venta_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)',
        $orig7$CASE WHEN v_codsep IS NOT NULL THEN v_separacion\.fecdectechosep ELSE CURRENT_TIMESTAMP END,[[:space:]]*CASE WHEN v_codsep IS NOT NULL THEN v_separacion\.codusudectechosep ELSE v_autor END$orig7$,
        $repl7$    CASE WHEN v_codsep IS NOT NULL AND (v_techo IS NULL OR (
      v_techo ->> 'decision' IS NOT DISTINCT FROM v_separacion.dectechosep
      AND NULLIF(v_techo ->> 'codtte', '') IS NOT DISTINCT FROM v_separacion.codttesep::text
    )) THEN v_separacion.fecdectechosep ELSE CURRENT_TIMESTAMP END,
    CASE WHEN v_codsep IS NOT NULL AND (v_techo IS NULL OR (
      v_techo ->> 'decision' IS NOT DISTINCT FROM v_separacion.dectechosep
      AND NULLIF(v_techo ->> 'codtte', '') IS NOT DISTINCT FROM v_separacion.codttesep::text
    )) THEN v_separacion.codusudectechosep ELSE v_autor END$repl7$,
        'v_techo ->> ''decision'' IS NOT DISTINCT FROM v_separacion.dectechosep', true
      ),
      (
        'public.hu006_crear_venta_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)',
        $orig8$BEGIN[[:space:]]+PERFORM public\.hu005_validar_compatibilidad_techo_instalado\(p_coduni,[[:space:]]*v_decision,[[:space:]]*v_codtte\);[[:space:]]+EXCEPTION WHEN SQLSTATE 'PT438' THEN[[:space:]]+RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'La elección no es compatible con el techo instalado';[[:space:]]+END;$orig8$,
        $repl8$  -- La elección de techo para una venta no altera ni restringe la instalación física.$repl8$,
        'La elección de techo para una venta no altera ni restringe la instalación física', true
      ),
      (
        'public.hu006_guardar_techo_venta_base(bigint,text,bigint)',
        $orig9$BEGIN[[:space:]]+PERFORM public\.hu005_validar_compatibilidad_techo_instalado\(v_coduni,[[:space:]]*v_decision,[[:space:]]*p_codtte\);[[:space:]]+EXCEPTION WHEN SQLSTATE 'PT438' THEN[[:space:]]+RAISE EXCEPTION USING ERRCODE = 'PT613', MESSAGE = 'La elección no es compatible con el techo instalado';[[:space:]]+END;$orig9$,
        $repl9$  -- Resolver la decisión comercial no altera ni restringe la instalación física.$repl9$,
        'Resolver la decisión comercial no altera ni restringe la instalación física', true
      )
    ) AS patches(firma, original, reemplazo, marcador, es_regex)
  LOOP
    v_def := pg_catalog.pg_get_functiondef(v_patch.firma::pg_catalog.regprocedure);
    IF pg_catalog.strpos(v_def, v_patch.marcador) > 0 THEN
      CONTINUE;
    END IF;
    IF (v_patch.es_regex AND v_def !~ v_patch.original)
      OR (NOT v_patch.es_regex AND pg_catalog.strpos(v_def, v_patch.original) = 0) THEN
      RAISE EXCEPTION 'HU-005/HU-006 202611150001: no se encontró el bloque esperado (%), en %',
        v_patch.marcador, v_patch.firma;
    END IF;
    IF v_patch.es_regex THEN
      v_nueva := pg_catalog.regexp_replace(v_def, v_patch.original, v_patch.reemplazo, 'g');
    ELSE
      v_nueva := pg_catalog.replace(v_def, v_patch.original, v_patch.reemplazo);
    END IF;
    IF v_nueva = v_def OR pg_catalog.strpos(v_nueva, v_patch.marcador) = 0 THEN
      RAISE EXCEPTION 'HU-005/HU-006 202611150001: no se pudo aplicar de forma segura el ajuste (%), en %',
        v_patch.marcador, v_patch.firma;
    END IF;
    EXECUTE v_nueva;
  END LOOP;

  -- Los flujos de HU-005/HU-006 no deben conservar llamadas indirectas al
  -- helper legado de compatibilidad física. HU-022 mantiene su validación propia.
  FOREACH v_firma IN ARRAY ARRAY[
    'public.hu005_crear_separacion_base_minimo(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)',
    'public.hu005_guardar_techo_separacion(bigint,text,bigint)',
    'public.hu006_crear_venta_base(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid)',
    'public.hu006_guardar_techo_venta_base(bigint,text,bigint)'
  ] LOOP
    v_def := pg_catalog.pg_get_functiondef(v_firma::pg_catalog.regprocedure);
    IF pg_catalog.strpos(v_def, 'hu005_validar_compatibilidad_techo_instalado(') > 0 THEN
      RAISE EXCEPTION 'HU-005/HU-006 202611150001: quedó una validación de techo físico en %', v_firma;
    END IF;
  END LOOP;
END;
$hu005_hu006_po$;

-- El cambio de responsabilidades se obtiene de la versión vigente de la
-- sesión HU-007. Las funciones base siguen privadas y no reciben llamadas del cliente.
COMMIT;
