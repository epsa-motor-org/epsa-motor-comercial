import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistrarRetornoInput, RetornoResultado } from '../types/retorno.types';

export async function registrarRetorno(
  db: SupabaseClient, datos: RegistrarRetornoInput
): Promise<RetornoResultado> {
  const { data, error } = await db.rpc('hu021_registrar_retorno', { ...datos });
  if (error) throw error;
  return data as RetornoResultado;
}
