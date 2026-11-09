-- HU-005 · Comprador sin documento (8 de noviembre)
--
-- El panel ya no pide tipo ni número de documento ni busca al comprador por DNI. La tabla cliente es nuestra (no está
-- conectada a RENIEC ni a ningún padrón): la búsqueda solo encontraba a quienes ya se registraron aquí al separar,
-- y los leads guardan su nombre y celular en su propia tabla, sin crear clientes. Desde ahora el comprador se
-- registra con nombres, apellido paterno, apellido materno (si tiene) y celular. Tipo y número de documento quedan
-- vacíos y el correo deja de pedirse. Para eso, tipo y número de documento de la tabla cliente dejan de ser
-- obligatorios (el número sigue siendo único cuando se registra). Revisión de Michelle: cambia su tabla cliente.
--
-- Mismo comprador = mismos nombres y apellidos (sin distinguir mayúsculas, tildes ni espacios) y mismo celular:
-- se devuelve el registro que ya existe. Así, si la red falla y se vuelve a enviar, no se duplica el comprador.
--
-- No cambia la separación (RPC de Michelle) ni a los compradores ya registrados. Se puede volver a ejecutar.

BEGIN;

ALTER TABLE public.cliente ALTER COLUMN codtdo DROP NOT NULL;
ALTER TABLE public.cliente ALTER COLUMN numdoccli DROP NOT NULL;

-- El comprador puede no tener documento: el tipo de documento se une con LEFT JOIN
CREATE OR REPLACE FUNCTION public.hu005_proyectar_cliente(p_codcli bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'codcli', c.codcli::text,
    'codtdo', c.codtdo::text,
    'tipoDocumento', t.nomtdo,
    'numeroDocumento', c.numdoccli,
    'nombres', c.nomcli,
    'apellidoPaterno', c.apepatcli,
    'apellidoMaterno', c.apematcli,
    'telefono', c.telcli,
    'correo', c.corcli,
    'activo', c.estcli)
  FROM public.cliente AS c
  LEFT JOIN public.tipodocumento AS t ON t.codtdo = c.codtdo
  WHERE c.codcli = p_codcli
$$;

-- Texto para comparar nombres: minúsculas, sin tildes y con un solo espacio entre palabras
CREATE OR REPLACE FUNCTION public.hu005_clave_nombre(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.translate(
    pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_texto, ''), '[[:space:]]+', ' ', 'g'))),
    'áéíóúüàèìòù', 'aeiouuaeiou')
$$;

CREATE OR REPLACE FUNCTION public.hu005_registrar_comprador(
  p_nombres text,
  p_apellido_paterno text,
  p_apellido_materno text,
  p_telefono text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nombres text;
  v_paterno text;
  v_materno text;
  v_telefono text;
  v_codcli bigint;
  -- Solo letras (con tildes, ñ y ü) y un espacio entre palabras: ni números ni símbolos
  v_letras constant text := '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+( [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$';
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();

  v_nombres := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_nombres, ''), '[[:space:]]+', ' ', 'g')), '');
  v_paterno := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_apellido_paterno, ''), '[[:space:]]+', ' ', 'g')), '');
  v_materno := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_apellido_materno, ''), '[[:space:]]+', ' ', 'g')), '');
  v_telefono := pg_catalog.regexp_replace(COALESCE(p_telefono, ''), '[[:space:]-]', '', 'g');

  IF v_nombres IS NULL OR pg_catalog.char_length(v_nombres) NOT BETWEEN 2 AND 100 OR v_nombres !~ v_letras
    OR pg_catalog.char_length(pg_catalog.regexp_replace(v_nombres, '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]', '', 'g')) < 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Nombres inválidos';
  END IF;
  IF v_paterno IS NULL OR pg_catalog.char_length(v_paterno) NOT BETWEEN 2 AND 100 OR v_paterno !~ v_letras
    OR pg_catalog.char_length(pg_catalog.regexp_replace(v_paterno, '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]', '', 'g')) < 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Apellido paterno inválido';
  END IF;
  IF v_materno IS NOT NULL AND (pg_catalog.char_length(v_materno) NOT BETWEEN 2 AND 100 OR v_materno !~ v_letras
    OR pg_catalog.char_length(pg_catalog.regexp_replace(v_materno, '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]', '', 'g')) < 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Apellido materno inválido';
  END IF;
  -- Celular peruano: 9 dígitos que empiezan con 9, no todos iguales (se guardan solo los dígitos)
  IF v_telefono !~ '^9[0-9]{8}$' OR v_telefono ~ '^(.)\1{8}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Celular inválido';
  END IF;

  -- Dos registros simultáneos del mismo celular se serializan; el segundo recibe el existente
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hu005-comprador:' || v_telefono, 5));
  SELECT c.codcli INTO v_codcli
  FROM public.cliente AS c
  WHERE c.telcli = v_telefono AND COALESCE(c.estcli, true)
    AND public.hu005_clave_nombre(c.nomcli) = public.hu005_clave_nombre(v_nombres)
    AND public.hu005_clave_nombre(c.apepatcli) = public.hu005_clave_nombre(v_paterno)
    AND public.hu005_clave_nombre(c.apematcli) = public.hu005_clave_nombre(v_materno)
  ORDER BY c.codcli
  LIMIT 1;
  IF FOUND THEN
    RETURN public.hu005_proyectar_cliente(v_codcli) || pg_catalog.jsonb_build_object('existente', true);
  END IF;

  INSERT INTO public.cliente(codtdo, numdoccli, nomcli, apepatcli, apematcli, telcli, corcli, estcli)
  VALUES (NULL, NULL, v_nombres, v_paterno, v_materno, v_telefono, NULL, true)
  RETURNING codcli INTO v_codcli;
  RETURN public.hu005_proyectar_cliente(v_codcli) || pg_catalog.jsonb_build_object('existente', false);
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_clave_nombre(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_registrar_comprador(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_registrar_comprador(text,text,text,text) TO authenticated;

COMMIT;
