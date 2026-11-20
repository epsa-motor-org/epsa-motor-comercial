BEGIN;

-- Preserve HU-021 domain codes while giving PostgREST a standard HTTP status.
-- Native permission and concurrency SQLSTATEs are not caught by these wrappers.
CREATE FUNCTION public.hu021_lanzar_error_http(p_codigo text, p_mensaje text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $body$
DECLARE
  v_status integer;
BEGIN
  v_status := CASE p_codigo
    WHEN 'PT650' THEN 400
    WHEN 'PT651' THEN 404
    WHEN 'PT652' THEN 403
    WHEN 'PT653' THEN 409
    WHEN 'PT654' THEN 409
    WHEN 'PT655' THEN 422
    WHEN 'PT656' THEN 422
    WHEN 'PT657' THEN 409
    WHEN 'PT658' THEN 409
    WHEN 'PT659' THEN 409
    WHEN 'PT701' THEN 400
    WHEN 'PT702' THEN 404
    WHEN 'PT703' THEN 409
    WHEN 'PT704' THEN 409
    WHEN 'PT705' THEN 409
    ELSE 500
  END;

  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = pg_catalog.jsonb_build_object(
      'code', p_codigo,
      'message', CASE WHEN v_status = 500
        THEN 'Error interno al procesar una operación HU-021'
        ELSE p_mensaje END,
      'details', NULL,
      'hint', NULL
    )::text,
    DETAIL = pg_catalog.jsonb_build_object('status', v_status, 'headers', '{}'::jsonb)::text;
END;
$body$;
REVOKE ALL ON FUNCTION public.hu021_lanzar_error_http(text,text) FROM PUBLIC, anon, authenticated;

-- Keep each existing implementation intact behind a private name. Public
-- signatures stay stable for PostgREST and the backend.
ALTER FUNCTION public.hu021_cancelar_separacion(bigint,text,text,uuid)
  RENAME TO hu021_cancelar_separacion_negocio;
ALTER FUNCTION public.hu021_cancelar_venta(bigint,text,text,uuid)
  RENAME TO hu021_cancelar_venta_negocio;
ALTER FUNCTION public.hu021_consultar_cancelacion_separacion(bigint)
  RENAME TO hu021_consultar_cancelacion_separacion_negocio;
ALTER FUNCTION public.hu021_consultar_cancelacion_venta(bigint)
  RENAME TO hu021_consultar_cancelacion_venta_negocio;
ALTER FUNCTION public.hu021_registrar_retorno(bigint,date,bigint,text,text,uuid)
  RENAME TO hu021_registrar_retorno_negocio;

REVOKE ALL ON FUNCTION
  public.hu021_cancelar_separacion_negocio(bigint,text,text,uuid),
  public.hu021_cancelar_venta_negocio(bigint,text,text,uuid),
  public.hu021_consultar_cancelacion_separacion_negocio(bigint),
  public.hu021_consultar_cancelacion_venta_negocio(bigint),
  public.hu021_registrar_retorno_negocio(bigint,date,bigint,text,text,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.hu021_cancelar_separacion(
  p_codsep bigint, p_motivo text, p_observacion_dinero text, p_idempotencia uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu021_cancelar_separacion_negocio(
    p_codsep, p_motivo, p_observacion_dinero, p_idempotencia
  );
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu021_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

CREATE FUNCTION public.hu021_cancelar_venta(
  p_codven bigint, p_motivo text, p_observacion_dinero text, p_idempotencia uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu021_cancelar_venta_negocio(
    p_codven, p_motivo, p_observacion_dinero, p_idempotencia
  );
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu021_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

CREATE FUNCTION public.hu021_consultar_cancelacion_separacion(p_codsep bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu021_consultar_cancelacion_separacion_negocio(p_codsep);
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu021_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

CREATE FUNCTION public.hu021_consultar_cancelacion_venta(p_codven bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu021_consultar_cancelacion_venta_negocio(p_codven);
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu021_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

CREATE FUNCTION public.hu021_registrar_retorno(
  p_codven bigint, p_fecharetorno date, p_codubi bigint, p_condicion text,
  p_observacion text, p_idempotencia uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE v_mensaje text;
BEGIN
  RETURN public.hu021_registrar_retorno_negocio(
    p_codven, p_fecharetorno, p_codubi, p_condicion, p_observacion, p_idempotencia
  );
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE ~ '^PT[0-9]{3}$' THEN
    GET STACKED DIAGNOSTICS v_mensaje = MESSAGE_TEXT;
    PERFORM public.hu021_lanzar_error_http(SQLSTATE, v_mensaje);
  END IF;
  RAISE;
END;
$body$;

REVOKE ALL ON FUNCTION
  public.hu021_cancelar_separacion(bigint,text,text,uuid),
  public.hu021_cancelar_venta(bigint,text,text,uuid),
  public.hu021_consultar_cancelacion_separacion(bigint),
  public.hu021_consultar_cancelacion_venta(bigint),
  public.hu021_registrar_retorno(bigint,date,bigint,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.hu021_cancelar_separacion(bigint,text,text,uuid),
  public.hu021_cancelar_venta(bigint,text,text,uuid),
  public.hu021_consultar_cancelacion_separacion(bigint),
  public.hu021_consultar_cancelacion_venta(bigint),
  public.hu021_registrar_retorno(bigint,date,bigint,text,text,uuid)
  TO authenticated;

COMMENT ON FUNCTION public.hu021_cancelar_separacion(bigint,text,text,uuid)
  IS 'HU-021: conserva la cancelación vigente y adapta sus códigos PT a HTTP estándar para PostgREST.';
COMMENT ON FUNCTION public.hu021_cancelar_venta(bigint,text,text,uuid)
  IS 'HU-021: conserva la cancelación vigente y adapta sus códigos PT a HTTP estándar para PostgREST.';
COMMENT ON FUNCTION public.hu021_consultar_cancelacion_separacion(bigint)
  IS 'HU-021: conserva la consulta vigente y adapta sus códigos PT a HTTP estándar para PostgREST.';
COMMENT ON FUNCTION public.hu021_consultar_cancelacion_venta(bigint)
  IS 'HU-021: conserva la consulta vigente y adapta sus códigos PT a HTTP estándar para PostgREST.';
COMMENT ON FUNCTION public.hu021_registrar_retorno(bigint,date,bigint,text,text,uuid)
  IS 'HU-021: conserva el retorno vigente y adapta sus códigos PT a HTTP estándar para PostgREST.';

NOTIFY pgrst, 'reload schema';
COMMIT;
