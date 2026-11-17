BEGIN;

-- PTxyz es un estado HTTP para PostgREST, no un identificador de dominio.
-- PT604 sale como HTTP 604 antes de llegar al mapper de Express. Conservamos
-- los códigos PT600..PT626 en el JSON, con estados HTTP estándar. Las funciones
-- de negocio, sus permisos, bloqueos, transacciones e idempotencia no cambian.
CREATE OR REPLACE FUNCTION public.hu006_lanzar_error_http(p_codigo text, p_mensaje text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $body$
DECLARE
  v_status integer;
BEGIN
  v_status := CASE
    WHEN p_codigo IN ('PT600','PT616','PT622') THEN 400
    WHEN p_codigo IN ('PT601','PT608') THEN 404
    WHEN p_codigo IN ('PT604','PT605','PT611','PT613','PT614','PT618','PT623') THEN 409
    WHEN p_codigo = 'PT626' THEN 403
    WHEN p_codigo IN ('PT603','PT606','PT607','PT609','PT610','PT612','PT615',
      'PT617','PT619','PT620','PT621','PT624','PT625') THEN 422
    ELSE 500
  END;
  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = pg_catalog.jsonb_build_object(
      'code', p_codigo,
      'message', CASE WHEN v_status = 500 THEN 'Error interno al procesar la venta' ELSE p_mensaje END
    )::text,
    DETAIL = pg_catalog.jsonb_build_object('status', v_status, 'headers', '{}'::jsonb)::text;
END;
$body$;
REVOKE ALL ON FUNCTION public.hu006_lanzar_error_http(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_lanzar_error_http(text,text) TO authenticated;

-- Adaptadores de transporte exclusivamente para las cinco RPC de HU-006 que
-- consume Express. No se publica una segunda implementación de las ventas.
-- La firma se obtiene del catálogo para conservar tipos y valores por defecto.
DO $http$
DECLARE
  v_objetivo record;
  v_funcion record;
  v_args text;
  v_identidad text;
BEGIN
  FOR v_objetivo IN SELECT * FROM (VALUES
    ('hu006_crear_venta',18),
    ('hu006_guardar_techo_venta',4),
    ('hu006_guardar_comprobante_venta',3),
    ('hu006_listar_ventas',3),
    ('hu006_venta_de_unidad',1)
  ) AS funciones(nombre,argumentos)
  LOOP
    SELECT p.oid, p.proname, p.proargnames,
      pg_catalog.pg_get_function_arguments(p.oid) AS argumentos,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identidad
    INTO STRICT v_funcion
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=v_objetivo.nombre
      AND p.pronargs=v_objetivo.argumentos AND p.prokind='f';
    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a), ', ' ORDER BY posicion)
      INTO v_args FROM pg_catalog.unnest(v_funcion.proargnames) WITH ORDINALITY AS nombres(a,posicion);
    v_identidad := pg_catalog.format('public.%I(%s)', v_funcion.proname || '_http', v_funcion.identidad);
    EXECUTE pg_catalog.format($crear$
      CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb
      LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $adaptador$
      BEGIN
        RETURN public.%I(%s);
      EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE ~ '^PT6[0-9]{2}$' THEN
          PERFORM public.hu006_lanzar_error_http(SQLSTATE, SQLERRM);
        END IF;
        RAISE;
      END;
      $adaptador$;
    $crear$, v_funcion.proname || '_http', v_funcion.argumentos, v_funcion.proname, v_args);
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_identidad || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_identidad || ' TO authenticated';
  END LOOP;
END;
$http$;

NOTIFY pgrst, 'reload schema';
COMMIT;
