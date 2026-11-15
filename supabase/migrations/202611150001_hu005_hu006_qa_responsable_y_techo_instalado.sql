-- HU-005 / HU-006 · Ajustes por QA de Jazmín del 14/11 (EMT-156)
-- Va después de 202611140005. Se puede volver a ejecutar: solo agrega una función y parchea dos funciones vigentes
-- (sin copiarlas). No cambia datos.
--
-- 1) Responsable (bug de permisos): un vendedor solo registra separaciones y ventas a su nombre. Gerente y
--    administradora pueden registrarlas para otra persona. Al convertir una separación en venta, el vendedor puede
--    mantener al responsable que ya tenía la separación. Error PT443 (separación) / PT626 (venta), 403.
-- 2) Techo instalado (CP-006-07/11): con un techo físicamente instalado, «Por definir» deja de aceptarse en una
--    separación nueva o en una venta directa, igual que «Sin techo» u otro tipo (PT438, 409). Solo se acepta ese
--    techo. No cambia la conversión de una separación (hereda su acuerdo), la resolución posterior del techo
--    (ya exige el instalado) ni la corrección HU-022. Un reintento con la misma Idempotency-Key no se bloquea.

BEGIN;

CREATE OR REPLACE FUNCTION public.hu006_rechazar_por_definir_con_techo_instalado(p_coduni bigint, p_decision text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nombre text;
BEGIN
  IF p_decision IS DISTINCT FROM 'Por definir' THEN
    RETURN;
  END IF;
  -- Lectura sin bloqueo: la función de creación toma después los bloqueos en su orden habitual (unidad, separación)
  SELECT t.nomtte INTO v_nombre
  FROM public.unidad AS u
  JOIN public.preparacionunidad AS p ON p.coduni = u.coduni
  JOIN public.tipotecho AS t ON t.codtte = u.codtte
  WHERE u.coduni = p_coduni AND u.codtte IS NOT NULL AND p.esttecho = 'Instalado'
    AND public.hu005_decision_de_techo(u.codtte) = 'Con techo';
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT438',
      MESSAGE = 'La unidad tiene un techo instalado (' || v_nombre || '): elige ese techo, no Por definir';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hu006_rechazar_por_definir_con_techo_instalado(bigint,text) FROM PUBLIC, anon, authenticated;

-- Venta: se inserta antes de validar el descuento, es decir, después de devolver un reintento ya guardado
DO $hu006$
DECLARE
  v_firma text := 'public.hu006_crear_venta(bigint,bigint,bigint,bigint,date,text,numeric,bigint,jsonb,jsonb,text,date,text,uuid,numeric,text,bigint,boolean)';
  v_def text;
  v_marca text := '-- QA 14/11 (EMT-156): responsable y techo instalado';
  v_ancla text := '  PERFORM public.hu006_validar_datos_descuento(';
  v_bloque text;
BEGIN
  v_def := pg_catalog.pg_get_functiondef(v_firma::pg_catalog.regprocedure);
  IF pg_catalog.strpos(v_def, v_marca) > 0 THEN
    RETURN; -- ya aplicado
  END IF;
  IF (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_ancla, ''))) / pg_catalog.length(v_ancla) <> 1 THEN
    RAISE EXCEPTION 'hu006_crear_venta no tiene el punto esperado para el ajuste de QA';
  END IF;
  v_bloque := '  ' || v_marca || E'\n'
    || E'  -- Una conversión (sin techo) cuya separación ya no está activa sigue respondiendo el conflicto de la base (PT604)\n'
    || E'  IF v_rol = ''Vendedor'' AND p_codusuresp IS DISTINCT FROM v_codusu\n'
    || E'    AND NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = p_coduni AND s.estsep = ''Activa'' AND s.codusuresp = p_codusuresp)\n'
    || E'    AND NOT (p_techo IS NULL AND NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = p_coduni AND s.estsep = ''Activa'')) THEN\n'
    || E'    RAISE EXCEPTION USING ERRCODE = ''PT626'', MESSAGE = ''Un vendedor solo puede registrar la venta a su nombre'';\n'
    || E'  END IF;\n'
    || E'  IF NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = p_coduni AND s.estsep = ''Activa'') THEN\n'
    || E'    PERFORM public.hu006_rechazar_por_definir_con_techo_instalado(p_coduni, pg_catalog.btrim(COALESCE(p_techo->>''decision'', '''')));\n'
    || E'  END IF;\n\n';
  EXECUTE pg_catalog.replace(v_def, v_ancla, v_bloque || v_ancla);
END;
$hu006$;

-- Separación: antes de llamar a la función base (que devuelve los reintentos)
DO $hu005$
DECLARE
  v_firma text := 'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)';
  v_def text;
  v_marca text := '-- QA 14/11 (EMT-156): responsable y techo instalado';
  v_ancla text := '  RETURN public.hu005_crear_separacion_base_minimo(';
  v_bloque text;
BEGIN
  v_def := pg_catalog.pg_get_functiondef(v_firma::pg_catalog.regprocedure);
  IF pg_catalog.strpos(v_def, v_marca) > 0 THEN
    RETURN;
  END IF;
  IF (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_ancla, ''))) / pg_catalog.length(v_ancla) <> 1 THEN
    RAISE EXCEPTION 'hu005_crear_separacion no tiene el punto esperado para el ajuste de QA';
  END IF;
  v_bloque := '  ' || v_marca || E'\n'
    || E'  IF NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.idempotenciasep = p_idempotenciasep) THEN\n'
    || E'    IF v_rol = ''Vendedor'' AND p_codusuresp IS DISTINCT FROM v_codusu THEN\n'
    || E'      RAISE EXCEPTION USING ERRCODE = ''PT443'', MESSAGE = ''Un vendedor solo puede registrar la separación a su nombre'';\n'
    || E'    END IF;\n'
    || E'    PERFORM public.hu006_rechazar_por_definir_con_techo_instalado(p_coduni, pg_catalog.btrim(COALESCE(p_decisiontecho, '''')));\n'
    || E'  END IF;\n';
  EXECUTE pg_catalog.replace(v_def, v_ancla, v_bloque || v_ancla);
END;
$hu005$;

COMMIT;
