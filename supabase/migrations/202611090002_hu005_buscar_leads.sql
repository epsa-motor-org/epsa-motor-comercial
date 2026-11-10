BEGIN;

-- Búsqueda acotada para reutilizar datos de contacto al completar un comprador.
-- No crea ni convierte clientes y mantiene el alcance de visibilidad por rol.
CREATE OR REPLACE FUNCTION public.hu005_buscar_leads(p_buscar text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
  v_buscar text;
  v_digitos text;
  v_es_busqueda_telefono boolean;
  v_resultado jsonb;
BEGIN
  SELECT u.codusu, r.nomrol INTO v_codusu, v_rol
  FROM public.usuario AS u
  JOIN public.rol AS r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu AND r.estrol
  FOR SHARE OF u, r;
  IF NOT FOUND OR v_rol NOT IN ('Gerente', 'Administradora', 'Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Perfil no autorizado para buscar leads';
  END IF;

  v_buscar := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_buscar, ''), '[[:space:]]+', ' ', 'g'));
  v_digitos := pg_catalog.regexp_replace(v_buscar, '[^0-9]', '', 'g');
  v_es_busqueda_telefono := v_buscar !~ '[[:alpha:]]' AND v_digitos <> '';
  IF v_buscar = '' OR pg_catalog.char_length(v_buscar) < 2 OR pg_catalog.char_length(v_buscar) > 100
    OR v_buscar ~ '[[:cntrl:]]'
    OR (v_es_busqueda_telefono AND pg_catalog.char_length(v_digitos) < 3) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Texto de búsqueda inválido';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.fecreglea DESC, q.codlea DESC), '[]'::jsonb)
  INTO v_resultado
  FROM (
    SELECT l.codlea, l.fecreglea,
      pg_catalog.jsonb_build_object(
        'codlead', l.codlea::text,
        'nombre', l.nomlea,
        'celular', l.tellea
      ) AS item
    FROM public.lead AS l
    WHERE l.estlea IN ('Nuevo', 'Contactado', 'En seguimiento')
      AND (v_rol IN ('Gerente', 'Administradora') OR l.codusu = v_codusu)
      AND (
        pg_catalog.strpos(pg_catalog.lower(l.nomlea), pg_catalog.lower(v_buscar)) > 0
        OR (v_es_busqueda_telefono AND pg_catalog.strpos(
          pg_catalog.regexp_replace(COALESCE(l.tellea, ''), '[^0-9]', '', 'g'), v_digitos
        ) > 0)
      )
    ORDER BY l.fecreglea DESC, l.codlea DESC
    LIMIT 20
  ) AS q;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_buscar_leads(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_buscar_leads(text) TO authenticated;
COMMENT ON FUNCTION public.hu005_buscar_leads(text)
IS 'Busca hasta 20 leads activos por coincidencia parcial de nombre o celular y devuelve solo codlead, nombre y celular; vendedores solo consultan leads asignados.';

COMMIT;
