import type { SupabaseClient } from '@supabase/supabase-js';
import type { EstadoEntregaResultado, RegistrarEntregaInput, RegistrarEntregaResultado } from '../types/entrega.types';

export async function consultarEntrega(db: SupabaseClient, codven: string): Promise<EstadoEntregaResultado> {
  const { data, error } = await db.rpc('hu032_consultar_entrega', { p_codven: codven });
  if (error) throw error;
  return data as EstadoEntregaResultado;
}

export async function registrarEntrega(db: SupabaseClient, datos: RegistrarEntregaInput): Promise<RegistrarEntregaResultado> {
  const { data, error } = await db.rpc('hu032_registrar_entrega', { ...datos });
  if (error) throw error;
  return data as RegistrarEntregaResultado;
}
