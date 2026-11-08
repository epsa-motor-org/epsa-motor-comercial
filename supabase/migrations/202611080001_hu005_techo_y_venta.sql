BEGIN;

-- HU-005 · Ajustes del equipo (2026-11-08). Complementa 202611050001, 202611060001 y 202611070001.
--   1) Situación comercial: toda moto identificada está libre para vender hasta que se separa o se vende.
--      «No disponible» deja de usarse: las motos existentes pasan a «Disponible» y las nuevas nacen así.
--   2) Preparación (HU-033): la moto se vende con o sin techo. Solo cuenta como pendiente el techo que el cliente
--      eligió y falta instalar. El armado de Ventanilla y el techo aún no elegido ya no son pendientes.
--      Los datos de armado y el historial se conservan; solo cambia qué se exige para «lista para entrega».
--   3) Techo elegido al separar: los tres roles comerciales lo registran, solo en motos con separación activa.
--      El proveedor (FIVESA, JAVICAR o FIBRAT) lo sigue configurando gerencia o administración (HU-004).
--   4) Comprador nuevo: celular de 9 dígitos que empieza con 9 y correo, obligatorios.
--   5) El formulario de separación trae los tipos de techo y la separación activa muestra el techo elegido.
-- Se puede volver a ejecutar sin efectos adicionales.

-- 1) Situación comercial -------------------------------------------------------------------------------------
ALTER TABLE public.unidad ALTER COLUMN estcomuni SET DEFAULT 'Disponible';
UPDATE public.unidad SET estcomuni = 'Disponible' WHERE estcomuni = 'No disponible';

-- 2) Preparación: solo el techo elegido que falta instalar queda pendiente ------------------------------------
CREATE OR REPLACE FUNCTION public.hu033_proyectar_preparacion_unidad(p_coduni bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE resultado jsonb;
  condiciones text[];
BEGIN
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'ID de unidad inválido';
  END IF;

  SELECT array_remove(ARRAY[
      CASE WHEN u.codtte IS NOT NULL AND t.reqinsttte AND p.esttecho <> 'Instalado'
        THEN 'Instalación de techo pendiente' END,
      CASE WHEN u.codtte IS NOT NULL AND NOT t.reqinsttte AND p.esttecho <> 'No requiere'
        THEN 'Estado de techo incompatible con la configuración' END
    ]::text[], NULL::text)
  INTO condiciones
  FROM public.unidad u
  JOIN public.preparacionunidad p ON p.coduni = u.coduni
  LEFT JOIN public.tipotecho t ON t.codtte = u.codtte
  WHERE u.coduni = p_coduni;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.unidad WHERE coduni = p_coduni) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La preparación de la unidad no está inicializada';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'coduni', u.coduni::text,
    'armado', p.estarmado,
    'techo', pg_catalog.jsonb_build_object(
      'estado', p.esttecho,
      'codtte', t.codtte::text,
      'configuracion', t.nomtte,
      'requiereInstalacion', t.reqinsttte
    ),
    'version', p.versionprep::text,
    'preparacionCompleta', pg_catalog.cardinality(condiciones) = 0,
    'condicionesFaltantes', pg_catalog.to_jsonb(condiciones),
    'ultimaActualizacion', p.fecactualizacion,
    'actualizadoPor', CASE WHEN autor.codusu IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object(
        'codusu', autor.codusu::text,
        'nombre', pg_catalog.btrim(pg_catalog.concat_ws(' ', autor.nomusu, autor.apepatusu, autor.apematusu))
      ) END
  ) INTO resultado
  FROM public.unidad u
  JOIN public.preparacionunidad p ON p.coduni = u.coduni
  LEFT JOIN public.tipotecho t ON t.codtte = u.codtte
  LEFT JOIN public.usuario autor ON autor.codusu = p.codusuactualiza
  WHERE u.coduni = p_coduni;

  RETURN resultado;
END
$$;

-- 3a) El cambio de techo lo hacen gerencia y administración; el vendedor solo en una moto con separación activa
--     (a través de hu005_elegir_techo, porque no tiene acceso directo a la tabla ni a HU-004)
CREATE OR REPLACE FUNCTION public.hu033_reiniciar_techo_por_configuracion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE actor bigint;
  rol_actual text;
  requiere_instalacion boolean;
  estado_nuevo text;
  preparacion_actual public.preparacionunidad%ROWTYPE;
BEGIN
  IF OLD.codtte IS NOT DISTINCT FROM NEW.codtte
     AND OLD.codpro IS NOT DISTINCT FROM NEW.codpro
     AND OLD.dettecuni IS NOT DISTINCT FROM NEW.dettecuni THEN
    RETURN NEW;
  END IF;

  rol_actual := public.hu026_rol_actual();
  IF coalesce(rol_actual, '') NOT IN ('Gerente', 'Administradora')
     AND NOT (rol_actual = 'Vendedor' AND EXISTS (
       SELECT 1 FROM public.separacion s WHERE s.coduni = NEW.coduni AND s.estsep = 'Activa')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Perfil no autorizado';
  END IF;
  SELECT u.codusu INTO actor
  FROM public.usuario u
  WHERE u.uuidusu = auth.uid() AND u.estusu;
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Perfil no autorizado';
  END IF;

  IF NEW.codtte IS NULL THEN
    requiere_instalacion := NULL;
    estado_nuevo := 'Pendiente';
  ELSE
    SELECT t.reqinsttte INTO requiere_instalacion
    FROM public.tipotecho t
    WHERE t.codtte = NEW.codtte;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Tipo de techo no disponible para recalcular la preparación';
    END IF;
    estado_nuevo := CASE WHEN requiere_instalacion THEN 'Pendiente' ELSE 'No requiere' END;
  END IF;

  SELECT * INTO preparacion_actual
  FROM public.preparacionunidad p
  WHERE p.coduni = NEW.coduni
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La preparación de la unidad no está inicializada';
  END IF;

  UPDATE public.preparacionunidad
  SET esttecho = estado_nuevo,
      versionprep = versionprep + 1,
      fecactualizacion = now(),
      codusuactualiza = actor
  WHERE coduni = NEW.coduni;

  IF preparacion_actual.esttecho IS DISTINCT FROM estado_nuevo THEN
    INSERT INTO public.historialpreparacionunidad(
      coduni, etapaprep, estadoanterior, estadonuevo, versionesperada,
      codusu, fecprep, obspreparacion, fuente, codpro, idempotencia
    ) VALUES (
      NEW.coduni, 'Techo', preparacion_actual.esttecho, estado_nuevo, NULL,
      actor, now(), 'Avance de techo reajustado por cambio de configuración.',
      'Configuración techo', NEW.codpro, NULL
    );
  END IF;

  RETURN NEW;
END
$$;

-- 3b) Techo que eligió el cliente de una moto separada. Elegir el mismo techo otra vez no cambia nada.
--     Al cambiar de techo se borra el proveedor: gerencia o administración lo configuran después (HU-004).
CREATE OR REPLACE FUNCTION public.hu005_elegir_techo(p_coduni bigint, p_codtte bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actual bigint;
  v_tipo public.tipotecho%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.hu005_perfil_comercial();
  IF p_coduni IS NULL OR p_coduni <= 0 OR p_codtte IS NULL OR p_codtte <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Moto o techo inválido';
  END IF;
  SELECT u.codtte INTO v_actual FROM public.unidad AS u WHERE u.coduni = p_coduni FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = p_coduni AND s.estsep = 'Activa') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'La moto no tiene una separación activa';
  END IF;
  SELECT * INTO v_tipo FROM public.tipotecho AS t WHERE t.codtte = p_codtte AND COALESCE(t.esttte, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Tipo de techo inexistente o inactivo';
  END IF;
  IF v_actual IS DISTINCT FROM p_codtte THEN
    UPDATE public.unidad SET codtte = p_codtte, codpro = NULL, dettecuni = NULL WHERE coduni = p_coduni;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'coduni', p_coduni::text,
    'techo', pg_catalog.jsonb_build_object(
      'codtte', v_tipo.codtte::text, 'nombre', v_tipo.nomtte, 'requiereInstalacion', COALESCE(v_tipo.reqinsttte, false)),
    'preparacion', public.hu033_proyectar_preparacion_unidad(p_coduni)
  );
END;
$$;

-- 4) Comprador nuevo con celular y correo obligatorios ---------------------------------------------------------
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
  -- Celular peruano obligatorio: 9 dígitos que empiezan con 9 (se guardan solo los dígitos)
  v_telefono := pg_catalog.regexp_replace(COALESCE(v_telefono, ''), '[ -]', '', 'g');
  IF v_telefono !~ '^9[0-9]{8}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Teléfono inválido';
  END IF;
  IF v_correo IS NULL OR (pg_catalog.char_length(v_correo) > 254
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

-- 5) Formulario con los tipos de techo y separación activa con su techo ----------------------------------------
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
    'tiposTecho', (
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'codtte', t.codtte::text, 'nombre', t.nomtte, 'requiereInstalacion', COALESCE(t.reqinsttte, false)
      ) ORDER BY COALESCE(t.reqinsttte, false), t.codtte), '[]'::jsonb)
      FROM public.tipotecho AS t
      WHERE COALESCE(t.esttte, true)
    ),
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
    'estado', s.estsep,
    'techo', pg_catalog.jsonb_build_object(
      'codtte', un.codtte::text,
      'nombre', tt.nomtte,
      'requiereInstalacion', COALESCE(tt.reqinsttte, false),
      'estado', pu.esttecho,
      'proveedor', pr.nompro
    )
  )
  INTO v_resultado
  FROM public.separacion AS s
  JOIN public.unidad AS un ON un.coduni = s.coduni
  LEFT JOIN public.tipotecho AS tt ON tt.codtte = un.codtte
  LEFT JOIN public.preparacionunidad AS pu ON pu.coduni = s.coduni
  LEFT JOIN public.proveedor AS pr ON pr.codpro = un.codpro
  LEFT JOIN public.usuario AS a ON a.codusu = s.codusu
  LEFT JOIN public.usuario AS r ON r.codusu = s.codusuresp
  LEFT JOIN public.usuario AS c ON c.codusu = s.codusuconfsep
  WHERE s.coduni = p_coduni AND s.estsep = 'Activa'
  ORDER BY s.codsep DESC
  LIMIT 1;
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_elegir_techo(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hu005_elegir_techo(bigint, bigint) TO authenticated;

COMMIT;
