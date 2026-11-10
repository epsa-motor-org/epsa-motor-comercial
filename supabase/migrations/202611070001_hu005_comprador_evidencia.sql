BEGIN;

-- HU-005 · Complemento para separar desde el panel (sobre 202611050001 y 202611060001).
-- La RPC hu005_crear_separacion exige un comprador existente, un gerente confirmador y,
-- en transferencias, la ruta de la captura. Esta migración añade lo que el panel necesita
-- para reunir esos datos sin acceso directo a tablas:
--   1) Tipos de documento del comprador.
--   2) Buscar y registrar comprador (cliente) mediante RPC.
--   3) Datos del formulario (usuario actual, responsables y gerentes) para los tres roles comerciales.
--   4) Bucket privado para la captura y verificación de que la captura existe y es de la moto.
--   5) Consultar la separación activa de una moto (para su ficha).

-- 1) Tipos de documento (solo se agregan los que falten)
INSERT INTO public.tipodocumento(nomtdo, esttdo)
SELECT v.nomtdo, true
FROM (VALUES (1, 'DNI'), (2, 'RUC'), (3, 'Carné de extranjería'), (4, 'Pasaporte')) AS v(orden, nomtdo)
WHERE NOT EXISTS (SELECT 1 FROM public.tipodocumento AS t WHERE t.nomtdo = v.nomtdo)
ORDER BY v.orden;

-- Perfil comercial de quien llama (Gerente, Administradora o Vendedor activo)
CREATE OR REPLACE FUNCTION public.hu005_perfil_comercial()
RETURNS TABLE(codusu bigint, rol text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT u.codusu, r.nomrol::text
  FROM public.usuario AS u
  JOIN public.rol AS r ON r.codrol = u.codrol
  WHERE u.uuidusu = auth.uid() AND u.estusu AND r.estrol
    AND r.nomrol IN ('Gerente', 'Administradora', 'Vendedor');
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sesión o rol no autorizado para separaciones';
  END IF;
END;
$$;

-- Proyección pública del comprador (sin columnas internas)
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
  JOIN public.tipodocumento AS t ON t.codtdo = c.codtdo
  WHERE c.codcli = p_codcli
$$;

-- 3) Datos del formulario de separación
CREATE OR REPLACE FUNCTION public.hu005_formulario_separacion()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
BEGIN
  SELECT p.codusu, p.rol INTO v_codusu, v_rol FROM public.hu005_perfil_comercial() AS p;
  -- La cuenta técnica de integración (dominio interno) no es una persona: no se ofrece.
  RETURN pg_catalog.jsonb_build_object(
    'usuarioActual', pg_catalog.jsonb_build_object('codusu', v_codusu::text, 'rol', v_rol),
    'tiposDocumento', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('codtdo', t.codtdo::text, 'nombre', t.nomtdo) ORDER BY t.codtdo), '[]'::jsonb)
      FROM public.tipodocumento AS t WHERE t.esttdo),
    'responsables', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'codusu', u.codusu::text,
        'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', u.nomusu, u.apepatusu, u.apematusu), '[[:space:]]+', ' ', 'g')),
        'rol', r.nomrol) ORDER BY u.nomusu, u.apepatusu, u.codusu), '[]'::jsonb)
      FROM public.usuario AS u JOIN public.rol AS r ON r.codrol = u.codrol
      WHERE u.estusu AND r.estrol AND r.nomrol IN ('Gerente', 'Administradora', 'Vendedor')
        AND u.corusu NOT ILIKE '%@epsa.internal'),
    'gerentes', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'codusu', u.codusu::text,
        'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', u.nomusu, u.apepatusu, u.apematusu), '[[:space:]]+', ' ', 'g'))) ORDER BY u.nomusu, u.apepatusu, u.codusu), '[]'::jsonb)
      FROM public.usuario AS u JOIN public.rol AS r ON r.codrol = u.codrol
      WHERE u.estusu AND r.estrol AND r.nomrol = 'Gerente'
        AND u.corusu NOT ILIKE '%@epsa.internal')
  );
END;
$$;

-- 2a) Buscar comprador por número de documento (único en la tabla cliente)
CREATE OR REPLACE FUNCTION public.hu005_buscar_cliente(p_numdoc text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_num text;
  v_codcli bigint;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  v_num := pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_numdoc, ''), '[[:space:]-]+', '', 'g'));
  IF v_num !~ '^[A-Z0-9]{4,20}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Número de documento inválido';
  END IF;
  SELECT c.codcli INTO v_codcli FROM public.cliente AS c WHERE c.numdoccli = v_num;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN public.hu005_proyectar_cliente(v_codcli);
END;
$$;

-- 2b) Registrar comprador. Si el documento ya existe, devuelve el registro existente sin modificarlo.
CREATE OR REPLACE FUNCTION public.hu005_registrar_cliente(
  p_codtdo bigint,
  p_numdoc text,
  p_nombres text,
  p_apellido_paterno text,
  p_apellido_materno text,
  p_telefono text,
  p_correo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tipo text;
  v_num text;
  v_nombres text;
  v_paterno text;
  v_materno text;
  v_telefono text;
  v_correo text;
  v_codcli bigint;
  v_es_empresa boolean;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();

  SELECT t.nomtdo INTO v_tipo FROM public.tipodocumento AS t WHERE t.codtdo = p_codtdo AND t.esttdo;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Tipo de documento inválido';
  END IF;
  v_num := pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_numdoc, ''), '[[:space:]-]+', '', 'g'));
  IF (v_tipo = 'DNI' AND v_num !~ '^[0-9]{8}$')
    OR (v_tipo = 'RUC' AND v_num !~ '^(10|15|17|20)[0-9]{9}$')
    OR (v_tipo = 'Carné de extranjería' AND v_num !~ '^[A-Z0-9]{9,12}$')
    OR (v_tipo = 'Pasaporte' AND v_num !~ '^[A-Z0-9]{6,12}$')
    OR v_num !~ '^[A-Z0-9]{4,20}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El número no corresponde al tipo de documento';
  END IF;

  v_es_empresa := v_tipo = 'RUC' AND v_num LIKE '20%';
  v_nombres := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_nombres, ''), '[[:space:]]+', ' ', 'g')), '');
  v_paterno := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_apellido_paterno, ''), '[[:space:]]+', ' ', 'g')), '');
  v_materno := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_apellido_materno, ''), '[[:space:]]+', ' ', 'g')), '');
  v_telefono := NULLIF(pg_catalog.btrim(COALESCE(p_telefono, '')), '');
  v_correo := pg_catalog.lower(NULLIF(pg_catalog.btrim(COALESCE(p_correo, '')), ''));

  IF v_nombres IS NULL OR pg_catalog.char_length(v_nombres) NOT BETWEEN 2 AND 100
    OR (NOT v_es_empresa AND v_nombres !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'' .-]+$')
    OR (v_es_empresa AND v_nombres !~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ&.,'' -]+$') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Nombre o razón social inválido';
  END IF;
  IF v_es_empresa THEN
    v_paterno := NULL;
    v_materno := NULL;
  ELSIF v_paterno IS NULL OR pg_catalog.char_length(v_paterno) NOT BETWEEN 2 AND 100 OR v_paterno !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'' .-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Apellido paterno inválido';
  END IF;
  IF v_materno IS NOT NULL AND (pg_catalog.char_length(v_materno) > 100 OR v_materno !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'' .-]+$') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Apellido materno inválido';
  END IF;
  IF v_telefono IS NOT NULL AND (pg_catalog.char_length(v_telefono) > 20 OR v_telefono !~ '^[+]?[0-9 ()-]+$'
    OR pg_catalog.char_length(pg_catalog.regexp_replace(v_telefono, '[^0-9]', '', 'g')) NOT BETWEEN 7 AND 15) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Teléfono inválido';
  END IF;
  IF v_correo IS NOT NULL AND (pg_catalog.char_length(v_correo) > 254
    OR v_correo !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Correo inválido';
  END IF;

  -- Dos registros simultáneos del mismo documento se serializan; el segundo recibe el existente.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hu005-cliente:' || v_num, 5));
  SELECT c.codcli INTO v_codcli FROM public.cliente AS c WHERE c.numdoccli = v_num;
  IF FOUND THEN
    RETURN public.hu005_proyectar_cliente(v_codcli) || pg_catalog.jsonb_build_object('existente', true);
  END IF;

  INSERT INTO public.cliente(codtdo, numdoccli, nomcli, apepatcli, apematcli, telcli, corcli, estcli)
  VALUES (p_codtdo, v_num, v_nombres, v_paterno, v_materno, v_telefono, v_correo, true)
  RETURNING codcli INTO v_codcli;
  RETURN public.hu005_proyectar_cliente(v_codcli) || pg_catalog.jsonb_build_object('existente', false);
END;
$$;

-- 4) Bucket privado para la captura de la transferencia (imagen o PDF, hasta 5 MB)
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('separaciones-evidencia', 'separaciones-evidencia', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS hu005_evidencia_subida ON storage.objects;
CREATE POLICY hu005_evidencia_subida ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'separaciones-evidencia'
    AND (storage.foldername(name))[1] = 'separaciones'
    AND COALESCE(public.hu026_rol_actual(), '') IN ('Gerente', 'Administradora', 'Vendedor')
  );
DROP POLICY IF EXISTS hu005_evidencia_lectura ON storage.objects;
CREATE POLICY hu005_evidencia_lectura ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'separaciones-evidencia'
    AND COALESCE(public.hu026_rol_actual(), '') IN ('Gerente', 'Administradora', 'Vendedor')
  );
-- Sin UPDATE ni DELETE: la captura queda como evidencia aunque la separación no se complete.

-- La separación por transferencia solo se guarda si su captura existe y es de esa moto.
CREATE OR REPLACE FUNCTION public.hu005_verificar_evidencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.metpagsep = 'Transferencia' AND NOT EXISTS (
    SELECT 1 FROM storage.objects AS o
    WHERE o.bucket_id = 'separaciones-evidencia'
      AND o.name = NEW.rutavouchersep
      AND o.name LIKE 'separaciones/' || NEW.coduni::text || '/%'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT434', MESSAGE = 'La captura no está guardada o no corresponde a esta moto';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hu005_separacion_evidencia ON public.separacion;
CREATE TRIGGER hu005_separacion_evidencia
  BEFORE INSERT ON public.separacion
  FOR EACH ROW EXECUTE FUNCTION public.hu005_verificar_evidencia();

-- 5) Separación activa de una moto, con nombres de comprador, autor, responsable y confirmador.
--    Devuelve NULL si la moto no tiene una separación activa.
CREATE OR REPLACE FUNCTION public.hu005_separacion_activa(p_coduni bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Unidad inválida';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'codsep', s.codsep::text,
    'coduni', s.coduni::text,
    'comprador', public.hu005_proyectar_cliente(s.codcli),
    'autor', CASE WHEN a.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'codusu', a.codusu::text, 'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', a.nomusu, a.apepatusu, a.apematusu), '[[:space:]]+', ' ', 'g'))) END,
    'responsable', CASE WHEN r.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'codusu', r.codusu::text, 'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', r.nomusu, r.apepatusu, r.apematusu), '[[:space:]]+', ' ', 'g'))) END,
    'confirmador', CASE WHEN c.codusu IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'codusu', c.codusu::text, 'nombre', pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.concat_ws(' ', c.nomusu, c.apepatusu, c.apematusu), '[[:space:]]+', ' ', 'g'))) END,
    'monto', s.monadesep,
    'fechaPago', s.fecpagsep,
    'medioPago', s.metpagsep,
    'referencia', s.refsep,
    'rutaEvidencia', s.rutavouchersep,
    'observacion', s.obssep,
    'ingresoConfirmado', s.ingconfsep,
    'fechaConfirmacion', s.fecconfsep,
    'fechaRegistro', s.fecsep,
    'estado', s.estsep
  )
  INTO v_resultado
  FROM public.separacion AS s
  LEFT JOIN public.usuario AS a ON a.codusu = s.codusu
  LEFT JOIN public.usuario AS r ON r.codusu = s.codusuresp
  LEFT JOIN public.usuario AS c ON c.codusu = s.codusuconfsep
  WHERE s.coduni = p_coduni AND s.estsep = 'Activa'
  ORDER BY s.codsep DESC
  LIMIT 1;
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_perfil_comercial() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hu005_proyectar_cliente(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_formulario_separacion() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hu005_buscar_cliente(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hu005_registrar_cliente(bigint,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hu005_verificar_evidencia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_separacion_activa(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_perfil_comercial() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_formulario_separacion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_buscar_cliente(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_registrar_cliente(bigint,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_separacion_activa(bigint) TO authenticated;

COMMIT;
