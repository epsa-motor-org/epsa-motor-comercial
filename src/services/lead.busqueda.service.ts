import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuscarLeadsInput, LeadParaSeparacion } from '../types/lead.busqueda.types';

export async function buscarLeadsParaSeparacion(
  db: SupabaseClient,
  datos: BuscarLeadsInput
): Promise<LeadParaSeparacion[]> {
  const { data, error } = await db.rpc('hu005_buscar_leads', datos);
  if (error) throw error;
  return data as LeadParaSeparacion[];
}
