BEGIN;

-- HU-003 representa la situación física. Un traslado activo no es por sí mismo
-- un bloqueo comercial ni debe impedir que una unidad libre vuelva a Disponible.
-- Se parchean las definiciones vigentes para preservar permisos, locks, historial,
-- idempotencia y demás reglas comerciales de HU-021/HU-022.
DO $hu021_cancelaciones$
DECLARE
  v_def text;
  v_nueva text;
  v_firma text;
  v_movimiento text := 'estmub IN (''Pendiente'', ''En transito'')';
  v_patron text := $regex$ELSIF EXISTS \([[:space:]]*SELECT 1 FROM public\.movimientoubicacion[[:space:]]+WHERE coduni = v_coduni AND estmub IN \('Pendiente', 'En transito'\)[[:space:]]*\) THEN[[:space:]]+v_estado_unidad := 'No disponible';[[:space:]]*$regex$;
BEGIN
  FOREACH v_firma IN ARRAY ARRAY[
    'public.hu021_cancelar_separacion(bigint,text,text,uuid)',
    'public.hu021_cancelar_venta(bigint,text,text,uuid)'
  ] LOOP
    v_def := pg_catalog.pg_get_functiondef(v_firma::pg_catalog.regprocedure);
    IF pg_catalog.strpos(v_def, v_movimiento) > 0 THEN
      v_nueva := pg_catalog.regexp_replace(v_def, v_patron, '');
      IF pg_catalog.strpos(v_nueva, v_movimiento) > 0
        OR pg_catalog.strpos(v_nueva, 'v_estado_unidad := ''Vendida'';') = 0
        OR pg_catalog.strpos(v_nueva, 'v_estado_unidad := ''Separada'';') = 0
        OR pg_catalog.strpos(v_nueva, 'v_estado_unidad := ''Disponible'';') = 0 THEN
        RAISE EXCEPTION 'HU-021 140005: no se pudo quitar de forma segura la prioridad del movimiento activo en %', v_firma;
      END IF;
      EXECUTE v_nueva;
    ELSIF pg_catalog.strpos(v_def, 'v_estado_unidad := ''Disponible'';') = 0
      OR pg_catalog.strpos(v_def, 'v_estado_unidad := ''Vendida'';') = 0
      OR pg_catalog.strpos(v_def, 'v_estado_unidad := ''Separada'';') = 0 THEN
      RAISE EXCEPTION 'HU-021 140005: la definición vigente de % no coincide con la esperada', v_firma;
    END IF;
  END LOOP;
END;
$hu021_cancelaciones$;

DO $hu022_correccion$
DECLARE
  v_def text;
  v_nueva text;
  v_movimiento text := 'estmub IN (''Pendiente'', ''En transito'')';
  v_patron text := $regex$WHEN EXISTS \(SELECT 1 FROM public\.movimientoubicacion x WHERE x\.coduni = v_venta\.coduni AND x\.estmub IN \('Pendiente', 'En transito'\)\) THEN 'No disponible'[[:space:]]*$regex$;
BEGIN
  v_def := pg_catalog.pg_get_functiondef(
    'public.hu022_corregir_venta(bigint,bigint,bigint,integer,text,uuid)'::pg_catalog.regprocedure
  );
  IF pg_catalog.strpos(v_def, v_movimiento) > 0 THEN
    v_nueva := pg_catalog.regexp_replace(v_def, v_patron, '');
    IF pg_catalog.strpos(v_nueva, v_movimiento) > 0
      OR pg_catalog.strpos(v_nueva, 'THEN ''Vendida''') = 0
      OR pg_catalog.strpos(v_nueva, 'THEN ''Separada''') = 0
      OR pg_catalog.strpos(v_nueva, 'ELSE ''Disponible''') = 0 THEN
      RAISE EXCEPTION 'HU-022 140005: no se pudo quitar de forma segura la prioridad del movimiento activo';
    END IF;
    EXECUTE v_nueva;
  ELSIF pg_catalog.strpos(v_def, 'THEN ''Vendida''') = 0
    OR pg_catalog.strpos(v_def, 'THEN ''Separada''') = 0
    OR pg_catalog.strpos(v_def, 'ELSE ''Disponible''') = 0 THEN
    RAISE EXCEPTION 'HU-022 140005: la definición vigente de hu022_corregir_venta no coincide con la esperada';
  END IF;
END;
$hu022_correccion$;

-- No se actualizan unidades históricas en bloque: el estado No disponible no
-- permite distinguir inequívocamente el motivo previo sin revisar sus compromisos.

COMMIT;
