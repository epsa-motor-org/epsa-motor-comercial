-- HU-022 · Corrección comprador–moto: misma regla de techo que HU-005/HU-006 e historial legible para la ficha
-- Va después de 202611140001, 202611140002 y 202611140003 (HU-021 de Michelle), y de 202611130002/0003 (HU-022).
-- Se puede volver a ejecutar. Solo reemplaza funciones y agrega una consulta de lectura; no cambia datos.
--
-- 1) hu022_validar_unidad_venta: la regla del PO del 13/11 (EMT-154/10115) dice que un techo solo configurado, todavía
--    sin instalar, no bloquea la elección comercial. La corrección de unidad rechazaba con PT693 una moto destino cuya
--    configuración no coincidía con el acuerdo de la venta, aunque no tuviera nada instalado (QA lo dejó observado en
--    EMT-162/10134). Ahora solo bloquea el techo instalado (PT438, mismo helper que separación y venta). Se mantiene la
--    validación de precio/modelo (PT688). La diferencia de configuración la muestra el panel para corregirla en la ficha.
-- 2) hu022_correcciones_detalle: historial de correcciones con nombres de comprador, motor/chasis/modelo/color de las
--    motos y autor, para mostrarlo en la ficha. Solo lectura y solo gerente/administradora (mismo perfil que el resto
--    de HU-022).
-- 3) hu006_guardar_techo_venta (202611140002): una venta registrada antes del descuento tiene descuentoven NULL y la
--    función respondía PT619 al elegir su techo «Por definir», así que esas ventas ya no podían resolver el techo
--    (CP-006-15). La restricción chk_hu006_venta_desglose_precio ya asegura que en esas ventas impven = precio base +
--    adicional, es decir, sin descuento: se recalcula con descuento 0 y la columna sigue NULL (no se inventa una
--    autorización). Se parchea la definición vigente, que ya incluye el PT623 de una venta cancelada agregado por
--    202611140003 (no se copia la función); si el texto esperado no está, la migración falla y no cambia nada.

BEGIN;

DO $$
DECLARE
  v_def text;
  v_nueva text;
  v_cambios jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_array(
      'IF v_venta.prebaseven IS NULL OR v_venta.descuentoven IS NULL THEN',
      'IF v_venta.prebaseven IS NULL THEN'),
    pg_catalog.jsonb_build_array(
      'v_total := v_importe_antes - v_venta.descuentoven;',
      'v_total := v_importe_antes - COALESCE(v_venta.descuentoven, 0);'));
  v_par jsonb;
BEGIN
  v_def := pg_catalog.pg_get_functiondef('public.hu006_guardar_techo_venta(bigint,text,bigint,numeric)'::regprocedure);
  v_nueva := v_def;
  FOR v_par IN SELECT * FROM pg_catalog.jsonb_array_elements(v_cambios) LOOP
    IF pg_catalog.strpos(v_nueva, v_par->>1) > 0 THEN
      CONTINUE; -- ya aplicado
    ELSIF pg_catalog.strpos(v_nueva, v_par->>0) > 0 THEN
      v_nueva := pg_catalog.replace(v_nueva, v_par->>0, v_par->>1);
    ELSE
      RAISE EXCEPTION 'hu006_guardar_techo_venta no tiene el texto esperado: %', v_par->>0;
    END IF;
  END LOOP;
  IF v_nueva <> v_def THEN EXECUTE v_nueva; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_guardar_techo_venta(bigint,text,bigint,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.hu022_validar_unidad_venta(p_codven bigint, p_coduni bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_venta public.venta%ROWTYPE;
  v_unidad public.unidad%ROWTYPE;
  v_precio numeric;
BEGIN
  SELECT * INTO v_venta FROM public.venta WHERE codven = p_codven;
  SELECT * INTO v_unidad FROM public.unidad WHERE coduni = p_coduni;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT681', MESSAGE = 'La unidad destino no existe';
  END IF;
  IF pg_catalog.btrim(COALESCE(v_unidad.nummotuni, '')) = ''
    OR pg_catalog.btrim(COALESCE(v_unidad.chauni, '')) = '' OR v_unidad.codmod IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT691', MESSAGE = 'La unidad destino no tiene identificación suficiente';
  END IF;
  SELECT m.premod INTO v_precio FROM public.modelo AS m WHERE m.codmod = v_unidad.codmod;
  IF v_unidad.codmod IS DISTINCT FROM (SELECT u.codmod FROM public.unidad AS u WHERE u.coduni = v_venta.coduni)
    AND (v_venta.prebaseven IS NULL OR v_precio IS DISTINCT FROM v_venta.prebaseven) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT688', MESSAGE = 'El modelo destino no es compatible con el precio base pactado';
  END IF;
  -- Solo un techo instalado físicamente bloquea (HU-005/HU-006, 202611140001)
  PERFORM public.hu005_validar_compatibilidad_techo_instalado(
    p_coduni, v_venta.dectechoven, v_venta.codtteven);
END;
$$;
REVOKE ALL ON FUNCTION public.hu022_validar_unidad_venta(bigint,bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hu022_correcciones_detalle(p_codven bigint DEFAULT NULL, p_coduni bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor bigint;
  v_rol text;
BEGIN
  SELECT p.codusu, p.rol INTO v_actor, v_rol FROM public.hu022_perfil_autorizado() AS p;
  IF (p_codven IS NULL AND p_coduni IS NULL) OR p_codven <= 0 OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT681', MESSAGE = 'Indica la venta o la unidad';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(x.item ORDER BY x.feccor DESC, x.codcor DESC, x.codven)
    FROM (
      SELECT e.feccor, e.codcor, d.codven, pg_catalog.jsonb_build_object(
        'codcor', e.codcor::text,
        'tipo', e.tipocor,
        'fecha', e.feccor,
        'motivo', e.motivocor,
        'actor', pg_catalog.jsonb_build_object('codusu', e.codusu::text,
          'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', a.nomusu, a.apepatusu, a.apematusu))),
        'codven', d.codven::text,
        'compradorAnterior', pg_catalog.jsonb_build_object('codcli', d.codcli_anterior::text,
          'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', ca.nomcli, ca.apepatcli, ca.apematcli))),
        'compradorNuevo', pg_catalog.jsonb_build_object('codcli', d.codcli_nuevo::text,
          'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', cn.nomcli, cn.apepatcli, cn.apematcli))),
        'unidadAnterior', pg_catalog.jsonb_build_object('coduni', d.coduni_anterior::text, 'motor', ua.nummotuni,
          'chasis', ua.chauni, 'modelo', ma.nommod, 'color', ua.coluni),
        'unidadNueva', pg_catalog.jsonb_build_object('coduni', d.coduni_nueva::text, 'motor', un.nummotuni,
          'chasis', un.chauni, 'modelo', mn.nommod, 'color', un.coluni),
        'estadoUnidadOrigenResultante', d.estado_unidad_origen_resultante,
        'estadoUnidadResultante', d.estado_unidad_resultante,
        'otrasVentas', COALESCE((SELECT pg_catalog.jsonb_agg(o.codven::text ORDER BY o.codven)
          FROM public.hu022_correccion_relacion_detalle AS o WHERE o.codcor = e.codcor AND o.codven <> d.codven), '[]'::jsonb)
      ) AS item
      FROM public.hu022_correccion_relacion AS e
      JOIN public.hu022_correccion_relacion_detalle AS d ON d.codcor = e.codcor
      JOIN public.usuario AS a ON a.codusu = e.codusu
      LEFT JOIN public.cliente AS ca ON ca.codcli = d.codcli_anterior
      LEFT JOIN public.cliente AS cn ON cn.codcli = d.codcli_nuevo
      LEFT JOIN public.unidad AS ua ON ua.coduni = d.coduni_anterior
      LEFT JOIN public.modelo AS ma ON ma.codmod = ua.codmod
      LEFT JOIN public.unidad AS un ON un.coduni = d.coduni_nueva
      LEFT JOIN public.modelo AS mn ON mn.codmod = un.codmod
      WHERE (p_codven IS NULL OR d.codven = p_codven)
        AND (p_coduni IS NULL OR p_coduni IN (d.coduni_anterior, d.coduni_nueva))
    ) AS x
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.hu022_correcciones_detalle(bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu022_correcciones_detalle(bigint,bigint) TO authenticated;
COMMENT ON FUNCTION public.hu022_correcciones_detalle(bigint,bigint)
  IS 'HU-022: correcciones comprador–moto de una venta o de una moto, con nombres y motor/chasis. Solo gerente y administradora.';

COMMIT;
