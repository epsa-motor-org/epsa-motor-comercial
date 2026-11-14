BEGIN;

-- Completa la prioridad comercial al cancelar sin cambiar la ubicación,
-- preparación, techo físico ni movimientos de HU-003.
DO $hu021_estado_movimiento$
DECLARE
  v_def text;
  v_nuevo text := $nuevo$ELSIF EXISTS (
    SELECT 1 FROM public.movimientoubicacion
    WHERE coduni = v_coduni AND estmub IN ('Pendiente', 'En transito')
  ) THEN
    v_estado_unidad := 'No disponible';
  ELSE
    v_estado_unidad := 'Disponible';
$nuevo$;
BEGIN
  FOREACH v_def IN ARRAY ARRAY[
    pg_catalog.pg_get_functiondef('public.hu021_cancelar_separacion(bigint,text,text,uuid)'::pg_catalog.regprocedure),
    pg_catalog.pg_get_functiondef('public.hu021_cancelar_venta(bigint,text,text,uuid)'::pg_catalog.regprocedure)
  ] LOOP
    IF pg_catalog.strpos(v_def, 'estmub IN (''Pendiente'', ''En transito'')') = 0 THEN
      IF pg_catalog.strpos(v_def, 'v_estado_unidad := ''Disponible'';') = 0 THEN
        RAISE EXCEPTION 'HU-021 140003: no se encontró el bloque esperado al actualizar estado de unidad';
      END IF;
      v_def := pg_catalog.regexp_replace(
        v_def,
        'ELSE[[:space:]]+v_estado_unidad := ''Disponible'';',
        v_nuevo
      );
      IF pg_catalog.strpos(v_def, 'estmub IN (''Pendiente'', ''En transito'')') = 0 THEN
        RAISE EXCEPTION 'HU-021 140003: regexp_replace no insertó la condición del movimiento activo en una RPC de cancelación';
      END IF;
      EXECUTE v_def;
    END IF;
  END LOOP;
END;
$hu021_estado_movimiento$;

-- Parchea la versión vigente de HU-006 (incluye descuentos de 140002) para
-- rechazar cualquier cambio de techo sobre una venta cancelada antes de los
-- retornos PT614/replay. No recalcula importes.
DO $hu021_techo_cancelado$
DECLARE
  v_def text;
  v_pos integer;
  v_bloque text := 'IF v_venta.estven = ''Cancelada'' THEN' || pg_catalog.chr(10)
    || '    RAISE EXCEPTION USING ERRCODE = ''PT623'', MESSAGE = ''La venta está cancelada y ya no se puede modificar'';' || pg_catalog.chr(10)
    || '  END IF;' || pg_catalog.chr(10) || '  ';
BEGIN
  v_def := pg_catalog.pg_get_functiondef(
    'public.hu006_guardar_techo_venta(bigint,text,bigint,numeric)'::pg_catalog.regprocedure
  );
  IF pg_catalog.strpos(v_def, 'v_venta.estven = ''Cancelada''') = 0 THEN
    v_pos := pg_catalog.strpos(v_def, 'IF p_decisiontecho NOT IN');
    IF v_pos = 0 THEN
      RAISE EXCEPTION 'HU-021 140003: no se encontró la versión vigente de hu006_guardar_techo_venta';
    END IF;
    v_def := pg_catalog.substr(v_def, 1, v_pos - 1) || v_bloque || pg_catalog.substr(v_def, v_pos);
    EXECUTE v_def;
  END IF;
END;
$hu021_techo_cancelado$;

-- Mantiene la lógica actual de comprobante externo, pero comprueba el estado
-- bajo lock antes de validar la referencia o retornar PT618/reutilizada.
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

  SELECT * INTO v_venta FROM public.venta WHERE codven = p_codven FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT601', MESSAGE = 'Venta inexistente';
  END IF;
  IF v_venta.estven = 'Cancelada' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT623', MESSAGE = 'La venta está cancelada y ya no se puede modificar';
  END IF;
  IF p_referencia IS NULL OR p_referencia ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'La referencia del comprobante no es válida';
  END IF;
  v_referencia := pg_catalog.btrim(p_referencia);
  IF v_referencia = '' OR pg_catalog.char_length(v_referencia) > 200 OR p_fecha IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT600', MESSAGE = 'Referencia y fecha del comprobante son obligatorias y deben ser válidas';
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

COMMIT;
