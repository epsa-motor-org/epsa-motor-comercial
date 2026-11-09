import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CrearSeparacionInput, CrearSeparacionResultado, GuardarTechoSeparacionInput,
  GuardarTechoSeparacionResultado
} from '../types/separacion.types';

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
    p_idempotenciasep: datos.p_idempotenciasep,
    p_decisiontecho: datos.p_decisiontecho,
    p_codttecomsep: datos.p_codttecomsep
  });
  if (error) throw error;
  const separacion = data as CrearSeparacionResultado;
  if (datos.p_decisiontecho === 'Por definir') {
    return separacion;
  }
  try {
    const techoGuardado = await guardarTechoSeparacion(db, {
      p_codsep: separacion.codsep,
      p_decisiontecho: datos.p_decisiontecho,
      p_codttecomsep: datos.p_codttecomsep
    });
    if (!techoGuardado.guardado) throw new Error('La RPC no confirmó el guardado del techo');
    return { ...separacion, techo: { decision: datos.p_decisiontecho, codtte: datos.p_codttecomsep, guardado: true } };
  } catch {
    return { ...separacion, techo: { decision: datos.p_decisiontecho, codtte: datos.p_codttecomsep, guardado: false } };
  }
}

export async function guardarTechoSeparacion(
  db: SupabaseClient,
  datos: GuardarTechoSeparacionInput
): Promise<GuardarTechoSeparacionResultado> {
  const { data, error } = await db.rpc('hu005_guardar_techo_separacion', {
    p_codsep: datos.p_codsep,
    p_decisiontecho: datos.p_decisiontecho,
    p_codttecomsep: datos.p_codttecomsep
  });
  if (error) throw error;
  return data as GuardarTechoSeparacionResultado;
}
