BEGIN;

CREATE OR REPLACE FUNCTION public.hu006_listar_ventas(
  p_busqueda text DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rol text;
  v_busqueda text;
  v_resultado jsonb;
BEGIN
  SELECT p.rol INTO v_rol FROM public.hu005_perfil_comercial() AS p;
  IF COALESCE(v_rol,'') NOT IN ('Gerente','Administradora','Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para consultar ventas';
  END IF;
  v_busqueda := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_busqueda,''),'[[:space:]]+',' ','g')),'');
  IF pg_catalog.char_length(COALESCE(v_busqueda,'')) > 200
    OR p_limite IS NULL OR p_limite < 1 OR p_limite > 100
    OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT622', MESSAGE = 'Parámetros de búsqueda o paginación inválidos';
  END IF;

  WITH filtradas AS MATERIALIZED (
    SELECT v.*, c.nomcli, c.apepatcli, c.apematcli, c.telcli,
      u.nummotuni, u.chauni, u.coluni, m.codmod, m.nommod,
      responsable.codusu AS codusu_responsable,
      pg_catalog.btrim(pg_catalog.concat_ws(' ',responsable.nomusu,responsable.apepatusu,responsable.apematusu)) AS responsable_nombre,
      sa.codsed AS codsed_atencion, ua.nomubi AS sede_atencion,
      se.codsed AS codsed_entrega, ue.nomubi AS sede_entrega,
      tt.nomtte
    FROM public.venta AS v
    JOIN public.cliente AS c ON c.codcli = v.codcli
    JOIN public.unidad AS u ON u.coduni = v.coduni
    JOIN public.modelo AS m ON m.codmod = u.codmod
    JOIN public.usuario AS responsable ON responsable.codusu = v.codusuresp
    JOIN public.sede AS sa ON sa.codsed = v.codsedatencion
    JOIN public.ubicacion AS ua ON ua.codubi = sa.codubi
    LEFT JOIN public.sede AS se ON se.codsed = v.codsedentregaprevista
    LEFT JOIN public.ubicacion AS ue ON ue.codubi = se.codubi
    LEFT JOIN public.tipotecho AS tt ON tt.codtte = v.codtteven
    WHERE v.estven IS NOT NULL
      AND (v_busqueda IS NULL OR
        pg_catalog.concat_ws(' ',c.nomcli,c.apepatcli,c.apematcli,c.telcli,u.nummotuni,u.chauni,v.refcompven)
          ILIKE '%' || v_busqueda || '%')
  ), pagina AS (
    SELECT * FROM filtradas ORDER BY fecven DESC,codven DESC LIMIT p_limite OFFSET p_offset
  ), elementos AS (
    SELECT pg_catalog.jsonb_build_object(
      'codven',p.codven::text,
      'fecha',p.fecven::date,
      'comprador',pg_catalog.jsonb_build_object(
        'codcli',p.codcli::text,
        'nombre',pg_catalog.btrim(pg_catalog.concat_ws(' ',p.nomcli,p.apepatcli,p.apematcli)),
        'celular',p.telcli),
      'unidad',pg_catalog.jsonb_build_object(
        'coduni',p.coduni::text,'motor',p.nummotuni,'chasis',p.chauni,'color',p.coluni),
      'modelo',pg_catalog.jsonb_build_object('codmod',p.codmod::text,'nombre',p.nommod),
      'responsable',pg_catalog.jsonb_build_object('codusu',p.codusu_responsable::text,'nombre',p.responsable_nombre),
      'modalidad',p.modcomven,
      'precioBaseAcordado',p.prebaseven,
      'adicionalTechoReferencial',p.adicionalrefven,
      'adicionalTechoAcordado',p.adicionalacordadoven,
      'total',p.impven,
      'adelanto',COALESCE((SELECT s.monadesep FROM public.separacion AS s
        WHERE s.codsep = p.codsep AND s.ingconfsep IS TRUE),0),
      'pagos',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'numero',pv.nropagven,'monto',pv.montopagven,'fecha',pv.fecpagven,
        'medioPago',pv.metpagven,'referencia',pv.refpagven) ORDER BY pv.nropagven)
        FROM public.pagoventa AS pv WHERE pv.codven = p.codven),'[]'::jsonb),
      'totalRecibido',pg_catalog.round(
        COALESCE((SELECT pg_catalog.sum(pv.montopagven) FROM public.pagoventa AS pv WHERE pv.codven=p.codven),0)
        + COALESCE((SELECT s.monadesep FROM public.separacion AS s WHERE s.codsep=p.codsep AND s.ingconfsep IS TRUE),0),2),
      'saldo',pg_catalog.round(p.impven
        - COALESCE((SELECT pg_catalog.sum(pv.montopagven) FROM public.pagoventa AS pv WHERE pv.codven=p.codven),0)
        - COALESCE((SELECT s.monadesep FROM public.separacion AS s WHERE s.codsep=p.codsep AND s.ingconfsep IS TRUE),0),2),
      'techo',pg_catalog.jsonb_build_object('decision',p.dectechoven,
        'codtte',p.codtteven::text,'nombre',p.nomtte),
      'sedeAtencion',pg_catalog.jsonb_build_object('codsed',p.codsed_atencion::text,'nombre',p.sede_atencion),
      'sedeEntregaPrevista',CASE WHEN p.codsed_entrega IS NULL THEN NULL ELSE
        pg_catalog.jsonb_build_object('codsed',p.codsed_entrega::text,'nombre',p.sede_entrega) END,
      'estado',p.estven,
      'comprobanteExterno',CASE WHEN p.refcompven IS NULL THEN NULL ELSE
        pg_catalog.jsonb_build_object('referencia',p.refcompven,'fecha',p.feccompven) END
    ) AS item, p.fecven, p.codven FROM pagina AS p
  )
  SELECT pg_catalog.jsonb_build_object(
    'items',COALESCE((SELECT pg_catalog.jsonb_agg(e.item ORDER BY e.fecven DESC,e.codven DESC) FROM elementos AS e),'[]'::jsonb),
    'total',(SELECT pg_catalog.count(*)::integer FROM filtradas),
    'limite',p_limite,'offset',p_offset
  ) INTO v_resultado;
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.hu006_listar_ventas(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu006_listar_ventas(text,integer,integer) TO authenticated;
COMMENT ON FUNCTION public.hu006_listar_ventas(text,integer,integer)
  IS 'Lista ventas persistidas en venta, con pagos y saldo; filtra texto y nunca consulta leads como ventas.';

COMMIT;
