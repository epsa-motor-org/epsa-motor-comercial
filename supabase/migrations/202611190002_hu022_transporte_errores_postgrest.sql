BEGIN;
-- Transporta los códigos PT de HU-022 en JSON con estado HTTP estándar.
CREATE FUNCTION public.hu022_lanzar_error_http(p_codigo text, p_mensaje text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $body$
DECLARE
  v_status integer;
BEGIN
  v_status := CASE p_codigo
    WHEN 'PT680' THEN 404
    WHEN 'PT681' THEN 400
    WHEN 'PT682' THEN 422
    WHEN 'PT683' THEN 409
    WHEN 'PT684' THEN 409
    WHEN 'PT685' THEN 409
    WHEN 'PT686' THEN 403
    WHEN 'PT687' THEN 409
    WHEN 'PT688' THEN 409
    WHEN 'PT689' THEN 409
    WHEN 'PT690' THEN 409
    WHEN 'PT691' THEN 422
    WHEN 'PT692' THEN 409
    WHEN 'PT693' THEN 409
    WHEN 'PT438' THEN 409
    WHEN 'PT700' THEN 409
    ELSE 500
  END;
  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = pg_catalog.jsonb_build_object(
      'code', p_codigo,
      'message', CASE WHEN v_status = 500
        THEN 'Error interno al procesar la corrección de la venta' ELSE p_mensaje END,
      'details', NULL,
      'hint', NULL
    )::text,
    DETAIL = pg_catalog.jsonb_build_object('status', v_status, 'headers', '{}'::jsonb)::text;
END;
$body$;
REVOKE ALL ON FUNCTION public.hu022_lanzar_error_http(text,text) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.hu022_corregir_venta(bigint,bigint,bigint,integer,text,uuid)
  RENAME TO hu022_corregir_venta_negocio;
ALTER FUNCTION public.hu022_intercambiar_ventas(bigint,bigint,bigint,integer,bigint,bigint,bigint,integer,text,uuid)
  RENAME TO hu022_intercambiar_ventas_negocio;
REVOKE ALL ON FUNCTION public.hu022_corregir_venta_negocio(bigint,bigint,bigint,integer,text,uuid),
  public.hu022_intercambiar_ventas_negocio(bigint,bigint,bigint,integer,bigint,bigint,bigint,integer,text,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hu022_corregir_venta(
  p_codven bigint, p_codcli_nuevo bigint, p_coduni_nuevo bigint,
  p_version_esperada integer, p_motivo text, p_idempotencia uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu022_corregir_venta_negocio(
    p_codven, p_codcli_nuevo, p_coduni_nuevo, p_version_esperada, p_motivo, p_idempotencia
  );
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu022_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

CREATE FUNCTION public.hu022_intercambiar_ventas(
  p_codven_a bigint, p_codcli_a_nuevo bigint, p_coduni_a_nueva bigint, p_version_a integer,
  p_codven_b bigint, p_codcli_b_nuevo bigint, p_coduni_b_nueva bigint, p_version_b integer,
  p_motivo text, p_idempotencia uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu022_intercambiar_ventas_negocio(
    p_codven_a, p_codcli_a_nuevo, p_coduni_a_nueva, p_version_a,
    p_codven_b, p_codcli_b_nuevo, p_coduni_b_nueva, p_version_b, p_motivo, p_idempotencia
  );
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu022_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

REVOKE ALL ON FUNCTION public.hu022_corregir_venta(bigint,bigint,bigint,integer,text,uuid),
  public.hu022_intercambiar_ventas(bigint,bigint,bigint,integer,bigint,bigint,bigint,integer,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu022_corregir_venta(bigint,bigint,bigint,integer,text,uuid),
  public.hu022_intercambiar_ventas(bigint,bigint,bigint,integer,bigint,bigint,bigint,integer,text,uuid)
  TO authenticated;
COMMENT ON FUNCTION public.hu022_corregir_venta(bigint,bigint,bigint,integer,text,uuid)
  IS 'HU-022: adapta errores PT a HTTP estándar sin cambiar la lógica de negocio.';
COMMENT ON FUNCTION public.hu022_intercambiar_ventas(bigint,bigint,bigint,integer,bigint,bigint,bigint,integer,text,uuid)
  IS 'HU-022: adapta errores PT a HTTP estándar sin cambiar la lógica de negocio.';
NOTIFY pgrst, 'reload schema';
COMMIT;
