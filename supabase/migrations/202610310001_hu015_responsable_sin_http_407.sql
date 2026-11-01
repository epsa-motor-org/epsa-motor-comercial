-- HU-015 / HU-014 · Responsable inexistente o inactivo: de PT407 a PT422
-- PostgREST convierte un SQLSTATE «PTxyz» en el estado HTTP xyz. Con PT407 respondía HTTP 407 (Proxy Authentication
-- Required) y el cliente de la API fallaba antes de leer el error, así que el backend terminaba en su 500 genérico.
-- Se cambia ese código por PT422 en todas las funciones que lo usan (la API lo traduce a 404 con el mismo mensaje:
-- «El responsable no existe o no está habilitado»). Se reescribe la versión vigente de cada función tal como está
-- en la base, cambiando solo ese código: no se toca nada más y se conservan dueño y permisos.
-- Reaplicable: si ya no queda ninguna función con PT407, no hace nada.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc LIKE '%''PT407''%'
  LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), '''PT407''', '''PT422''');
  END LOOP;
END
$$;
