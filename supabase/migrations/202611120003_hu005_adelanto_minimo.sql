BEGIN;

-- HU-005: mínimo funcional confirmado por PO. La implementación previa queda
-- como helper privado y conserva el tope por modelo, idempotencia y compatibilidad.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.hu005_crear_separacion_base_minimo(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)') IS NULL THEN
    ALTER FUNCTION public.hu005_crear_separacion(
      bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
    ) RENAME TO hu005_crear_separacion_base_minimo;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hu005_crear_separacion_base_minimo(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hu005_crear_separacion(
  p_coduni bigint,
  p_codcli bigint,
  p_codusuresp bigint,
  p_codusu_confirmador bigint,
  p_monadesep numeric,
  p_fecpagsep date,
  p_metpagsep text,
  p_refsep text,
  p_rutavouchersep text,
  p_obssep text,
  p_ingreso_confirmado boolean,
  p_idempotenciasep uuid,
  p_decisiontecho text,
  p_codttecomsep bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_codusu bigint;
  v_rol text;
BEGIN
  SELECT p.codusu,p.rol INTO v_codusu,v_rol FROM public.hu005_perfil_comercial() AS p;
  IF v_codusu IS NULL OR v_rol NOT IN ('Gerente','Administradora','Vendedor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Rol no autorizado para registrar separaciones';
  END IF;
  IF p_monadesep IS NULL OR p_monadesep <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El monto del adelanto debe ser positivo';
  END IF;
  IF p_monadesep <> pg_catalog.round(p_monadesep, 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'El monto del adelanto debe tener como máximo dos decimales';
  END IF;
  IF p_monadesep < 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT442', MESSAGE = 'El adelanto mínimo para separar es S/ 100.00';
  END IF;
  RETURN public.hu005_crear_separacion_base_minimo(
    p_coduni,p_codcli,p_codusuresp,p_codusu_confirmador,p_monadesep,p_fecpagsep,
    p_metpagsep,p_refsep,p_rutavouchersep,p_obssep,p_ingreso_confirmado,
    p_idempotenciasep,p_decisiontecho,p_codttecomsep
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hu005_crear_separacion_base_minimo(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) TO authenticated;
COMMENT ON FUNCTION public.hu005_crear_separacion(
  bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint
) IS 'Crea separación HU-005 con adelanto mínimo S/100; la lógica transaccional previa queda en helper privado.';

COMMIT;
