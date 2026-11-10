-- HU-005 y HU-006 · Adelanto mínimo y consulta de la venta de una moto (10 de noviembre)
--
-- Requiere, en este orden: 202611090001, 202611090002 y 202611090003 (HU-005 de Michelle) y 202611100001 (HU-006).
-- Se puede volver a ejecutar.
--
-- 1) Adelanto mínimo (OBS-S3-013, retest de Jazmín; monto confirmado por Harold): el adelanto de una separación
--    es de al menos S/ 100.00 y, como ya estaba, no supera el precio de lista del modelo de la moto ni tiene fecha
--    de hace más de 30 días. Lo revisa el
--    disparador de la tabla separacion, así se cumple aunque se llame a la RPC directamente.
--    Nuevo código: PT442 (422) «El adelanto mínimo es S/ 100.00».
--
-- 2) Venta de una moto para su ficha (HU-006): la API de Michelle registra la venta, su techo y su comprobante, pero
--    no tenía cómo consultarla después. hu006_venta_de_unidad devuelve la misma proyección de hu006_proyectar_venta
--    (importe, total recibido, saldo, pagos, techo, comprobante, sedes, responsable y autor) más el comprador, el
--    nombre del techo elegido y el adelanto de la separación que se convirtió. Solo lectura; los tres roles
--    comerciales (hu005_perfil_comercial). Devuelve null si la moto no tiene venta.
--
-- No cambia la creación de separaciones ni de ventas.

BEGIN;

CREATE OR REPLACE FUNCTION public.hu005_verificar_tope_adelanto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_precio numeric;
BEGIN
  -- Mínimo para comprometer una moto (regla de Harold): S/ 100.00
  IF NEW.monadesep < 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT442', MESSAGE = 'El adelanto mínimo es S/ 100.00';
  END IF;
  SELECT m.premod INTO v_precio
  FROM public.unidad AS u
  JOIN public.modelo AS m ON m.codmod = u.codmod
  WHERE u.coduni = NEW.coduni;
  IF v_precio IS NULL OR v_precio <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT436', MESSAGE = 'La moto no tiene precio de lista registrado';
  END IF;
  -- Máximo: el precio de lista de la moto
  IF NEW.monadesep > v_precio THEN
    RAISE EXCEPTION USING ERRCODE = 'PT435', MESSAGE = 'El adelanto no puede superar el precio de lista de la moto';
  END IF;
  -- Fecha del adelanto realista: de hoy o de los últimos 30 días (la RPC ya rechaza fechas futuras)
  IF NEW.fecpagsep < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT437', MESSAGE = 'La fecha del adelanto no puede ser de hace más de 30 días';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hu005_separacion_tope_adelanto ON public.separacion;
CREATE TRIGGER hu005_separacion_tope_adelanto BEFORE INSERT ON public.separacion
  FOR EACH ROW EXECUTE FUNCTION public.hu005_verificar_tope_adelanto();
REVOKE ALL ON FUNCTION public.hu005_verificar_tope_adelanto() FROM PUBLIC, anon, authenticated;

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
  SELECT * INTO v_venta FROM public.venta WHERE coduni = p_coduni ORDER BY codven DESC LIMIT 1;
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
    'adelantoSeparacion', v_adelanto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_venta_de_unidad(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu006_venta_de_unidad(bigint) TO authenticated;

COMMIT;
