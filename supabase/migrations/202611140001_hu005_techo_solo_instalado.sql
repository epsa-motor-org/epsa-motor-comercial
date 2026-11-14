BEGIN;

-- HU-005/HU-006: la compatibilidad comercial solo se restringe cuando hay
-- evidencia positiva de instalación física. unidad.codtte por sí sola expresa
-- configuración; preparacionunidad.esttecho confirma instalación.
CREATE OR REPLACE FUNCTION public.hu005_validar_compatibilidad_techo_instalado(
  p_coduni bigint,
  p_decisiontecho text,
  p_codttecomsep bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codtte_unidad bigint;
  v_estado_techo text;
BEGIN
  IF p_coduni IS NULL OR p_coduni <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'ID de unidad inválido';
  END IF;

  -- Mantener el orden de bloqueo de la preparación HU-033.
  SELECT u.codtte INTO v_codtte_unidad
  FROM public.unidad AS u
  WHERE u.coduni = p_coduni
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Unidad inexistente';
  END IF;

  -- Por definir no revierte ni modifica la configuración física existente.
  IF p_decisiontecho = 'Por definir' OR v_codtte_unidad IS NULL THEN
    RETURN;
  END IF;

  -- «Sin techo» configurado no es un techo físico instalado.
  IF public.hu005_decision_de_techo(v_codtte_unidad) <> 'Con techo' THEN
    RETURN;
  END IF;

  SELECT p.esttecho INTO v_estado_techo
  FROM public.preparacionunidad AS p
  WHERE p.coduni = p_coduni
  FOR SHARE;
  IF NOT FOUND OR v_estado_techo IS DISTINCT FROM 'Instalado' THEN
    RETURN;
  END IF;

  IF p_decisiontecho = 'Sin techo'
    OR (p_decisiontecho = 'Con techo' AND p_codttecomsep IS DISTINCT FROM v_codtte_unidad) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT438',
      MESSAGE = 'La elección de techo no es compatible con el techo instalado en esta unidad';
  END IF;
END;
$$;

-- Los permisos quedan como en la función que reemplaza.
REVOKE ALL ON FUNCTION public.hu005_validar_compatibilidad_techo_instalado(bigint, text, bigint)
  FROM PUBLIC, anon, authenticated;

COMMIT;
