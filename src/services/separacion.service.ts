import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrearSeparacionInput, CrearSeparacionResultado } from '../types/separacion.types';

export async function crearSeparacion(
  db: SupabaseClient,
  datos: CrearSeparacionInput
): Promise<CrearSeparacionResultado> {
  const { data, error } = await db.rpc('hu005_crear_separacion', {
    p_coduni: datos.p_coduni,
    p_codcli: datos.p_codcli,
    p_codusuresp: datos.p_codusuresp,
    p_codusu_confirmador: datos.p_codusu_confirmador,
    p_monadesep: datos.p_monadesep,
    p_fecpagsep: datos.p_fecpagsep,
    p_metpagsep: datos.p_metpagsep,
    p_refsep: datos.p_refsep,
    p_rutavouchersep: datos.p_rutavouchersep,
    p_obssep: datos.p_obssep,
    p_ingreso_confirmado: datos.p_ingreso_confirmado,
    p_idempotenciasep: datos.p_idempotenciasep
  });
  if (error) throw error;
  return data as CrearSeparacionResultado;
}
