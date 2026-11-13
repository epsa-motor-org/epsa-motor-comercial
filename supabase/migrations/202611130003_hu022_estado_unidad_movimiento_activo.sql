BEGIN;

-- Preserve HU-022's applied correction migration and incrementally account for active HU-003 movements.
CREATE OR REPLACE FUNCTION public.hu022_corregir_venta(
  p_codven bigint, p_codcli_nuevo bigint, p_coduni_nuevo bigint,
  p_version_esperada integer, p_motivo text, p_idempotencia uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor bigint; v_rol text; v_motivo text; v_payload jsonb; v_evento public.hu022_correccion_relacion%ROWTYPE;
  v_venta public.venta%ROWTYPE; v_coduni_observada bigint; v_codcli_objetivo bigint; v_coduni_objetivo bigint;
  v_cliente public.cliente%ROWTYPE; v_unidad public.unidad%ROWTYPE; v_estado_antes text; v_estado_nuevo_antes text;
  v_estado_anterior text; v_estado_nuevo text; v_version_despues integer; v_codcor bigint; v_resultado jsonb;
  v_tiene_dinero boolean;
BEGIN
  SELECT p.codusu, p.rol INTO v_actor, v_rol FROM public.hu022_perfil_autorizado() p;
  IF p_codven IS NULL OR p_codven <= 0 OR p_version_esperada IS NULL OR p_version_esperada <= 0 OR p_idempotencia IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT681', MESSAGE = 'La solicitud de corrección está incompleta';
  END IF;
  v_motivo := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_motivo, ''), '[[:space:]]+', ' ', 'g')), '');
  IF v_motivo IS NULL OR pg_catalog.char_length(v_motivo) > 500 OR v_motivo ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT681', MESSAGE = 'El motivo es obligatorio y admite hasta 500 caracteres';
  END IF;
  v_payload := pg_catalog.jsonb_build_object('tipo', 'Individual', 'codven', p_codven::text,
    'codcliNuevo', p_codcli_nuevo::text, 'coduniNuevo', p_coduni_nuevo::text,
    'versionEsperada', p_version_esperada, 'motivo', v_motivo);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hu022:' || p_idempotencia::text, 22));
  SELECT * INTO v_evento FROM public.hu022_correccion_relacion WHERE idempotencia = p_idempotencia;
  IF FOUND THEN
    IF v_evento.codusu IS DISTINCT FROM v_actor OR v_evento.payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION USING ERRCODE = 'PT687', MESSAGE = 'Idempotency-Key ya fue usada con otra corrección';
    END IF;
    RETURN v_evento.resultado || pg_catalog.jsonb_build_object('reutilizada', true);
  END IF;

  SELECT coduni INTO v_coduni_observada FROM public.venta WHERE codven = p_codven;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT680', MESSAGE = 'Venta inexistente'; END IF;
  v_coduni_objetivo := COALESCE(p_coduni_nuevo, v_coduni_observada);
  PERFORM u.coduni FROM public.unidad u WHERE u.coduni = ANY(ARRAY[v_coduni_observada, v_coduni_objetivo])
    ORDER BY u.coduni FOR UPDATE;
  SELECT * INTO v_venta FROM public.venta WHERE codven = p_codven FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT680', MESSAGE = 'Venta inexistente'; END IF;
  IF v_venta.coduni IS DISTINCT FROM v_coduni_observada OR v_venta.hu022_versionrelacion <> p_version_esperada THEN
    RAISE EXCEPTION USING ERRCODE = 'PT683', MESSAGE = 'La relación cambió desde la consulta; actualiza la vista antes de corregir';
  END IF;
  IF v_venta.estven <> 'Registrada' THEN RAISE EXCEPTION USING ERRCODE = 'PT689', MESSAGE = 'Solo se corrigen ventas Registradas'; END IF;
  IF v_venta.codsep IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.separacion s WHERE s.codsep = v_venta.codsep AND s.estsep = 'Convertida') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT692', MESSAGE = 'La separación vinculada no está en estado Convertida';
  END IF;
  v_codcli_objetivo := COALESCE(p_codcli_nuevo, v_venta.codcli);
  IF v_codcli_objetivo = v_venta.codcli AND v_coduni_objetivo = v_venta.coduni THEN
    RAISE EXCEPTION USING ERRCODE = 'PT684', MESSAGE = 'La corrección no cambia comprador ni unidad';
  END IF;
  IF v_codcli_objetivo <> v_venta.codcli THEN
    SELECT * INTO v_cliente FROM public.cliente WHERE codcli = v_codcli_objetivo AND estcli IS TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT682', MESSAGE = 'El comprador destino no existe o está inactivo'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.pagoventa WHERE codven = p_codven)
      OR v_venta.refcompven IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.separacion s WHERE s.codsep = v_venta.codsep
        AND s.ingconfsep IS TRUE AND s.monadesep > 0)
    INTO v_tiene_dinero;
    IF v_tiene_dinero AND v_rol <> 'Gerente' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT686', MESSAGE = 'El cambio de comprador con dinero o comprobante requiere revisión y confirmación de Gerente';
    END IF;
  END IF;
  IF v_coduni_objetivo <> v_venta.coduni THEN
    SELECT * INTO v_unidad FROM public.unidad WHERE coduni = v_coduni_objetivo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT681', MESSAGE = 'La unidad destino no existe'; END IF;
    IF v_unidad.estcomuni <> 'Disponible'
      OR EXISTS (SELECT 1 FROM public.venta x WHERE x.coduni = v_coduni_objetivo AND x.estven <> 'Cancelada')
      OR EXISTS (SELECT 1 FROM public.separacion x WHERE x.coduni = v_coduni_objetivo AND x.estsep = 'Activa') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT685', MESSAGE = 'La unidad destino tiene un compromiso o no está disponible';
    END IF;
    SELECT estcomuni INTO v_estado_antes FROM public.unidad WHERE coduni = v_venta.coduni;
    v_estado_nuevo_antes := v_unidad.estcomuni;
    PERFORM public.hu022_validar_unidad_venta(p_codven, v_coduni_objetivo);
  ELSE
    SELECT estcomuni INTO v_estado_antes FROM public.unidad WHERE coduni = v_venta.coduni;
    v_estado_nuevo_antes := v_estado_antes;
  END IF;

  UPDATE public.venta SET codcli = v_codcli_objetivo, coduni = v_coduni_objetivo WHERE codven = p_codven;
  IF v_coduni_objetivo <> v_venta.coduni THEN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.venta x WHERE x.coduni = v_venta.coduni AND x.estven <> 'Cancelada') THEN 'Vendida'
      WHEN EXISTS (SELECT 1 FROM public.separacion x WHERE x.coduni = v_venta.coduni AND x.estsep = 'Activa') THEN 'Separada'
      WHEN EXISTS (SELECT 1 FROM public.movimientoubicacion x WHERE x.coduni = v_venta.coduni AND x.estmub IN ('Pendiente', 'En transito')) THEN 'No disponible'
      ELSE 'Disponible' END INTO v_estado_anterior;
    UPDATE public.unidad SET estcomuni = v_estado_anterior WHERE coduni = v_venta.coduni;
    UPDATE public.unidad SET estcomuni = 'Vendida' WHERE coduni = v_coduni_objetivo;
  ELSE v_estado_anterior := v_estado_antes;
  END IF;
  SELECT estcomuni INTO v_estado_nuevo FROM public.unidad WHERE coduni = v_coduni_objetivo;
  SELECT hu022_versionrelacion INTO v_version_despues FROM public.venta WHERE codven = p_codven;
  v_codcor := pg_catalog.nextval('public.hu022_correccion_relacion_codcor_seq');
  v_resultado := pg_catalog.jsonb_build_object('codcor', v_codcor::text, 'tipo', 'Individual',
    'motivo', v_motivo, 'actor', v_actor::text, 'reutilizada', false,
    'operaciones', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'codven', p_codven::text, 'codcliAnterior', v_venta.codcli::text, 'codcliNuevo', v_codcli_objetivo::text,
      'coduniAnterior', v_venta.coduni::text, 'coduniNueva', v_coduni_objetivo::text,
      'versionAnterior', v_venta.hu022_versionrelacion, 'versionRelacion', v_version_despues,
      'estadoUnidadAnterior', v_estado_antes, 'estadoUnidadOrigenResultante', v_estado_anterior,
      'estadoUnidadDestinoAnterior', v_estado_nuevo_antes, 'estadoUnidadResultante', v_estado_nuevo,
      'codsepVinculada', v_venta.codsep::text, 'venta', public.hu022_proyectar_venta(p_codven))));
  INSERT INTO public.hu022_correccion_relacion(codcor, tipocor, codusu, motivocor, idempotencia, payload, resultado)
  VALUES (v_codcor, 'Individual', v_actor, v_motivo, p_idempotencia, v_payload, v_resultado);
  INSERT INTO public.hu022_correccion_relacion_detalle(codcor, codven, codcli_anterior, codcli_nuevo,
    coduni_anterior, coduni_nueva, codsep, estado_unidad_anterior, estado_unidad_origen_resultante,
    estado_unidad_destino_anterior, estado_unidad_resultante,
    version_anterior, version_resultante)
  VALUES (v_codcor, p_codven, v_venta.codcli, v_codcli_objetivo, v_venta.coduni, v_coduni_objetivo,
    v_venta.codsep, v_estado_antes, v_estado_anterior, v_estado_nuevo_antes, v_estado_nuevo,
    v_venta.hu022_versionrelacion, v_version_despues);
  RETURN v_resultado;
END;
$$;

COMMIT;
