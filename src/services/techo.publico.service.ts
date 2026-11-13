import type { SupabaseClient } from '@supabase/supabase-js';
import type { TipoTechoPublico } from '../types/techo.publico.types';

// HU-006 · Catálogo de techos con su adicional referencial (el mismo que usan separar y vender en el panel)
export async function listarTiposTechoPublicos(db: SupabaseClient): Promise<TipoTechoPublico[]> {
  const { data, error } = await db.rpc('hu006_tipos_techo_publicos');
  if (error) throw error;

  // Lista blanca explícita también en el límite Express.
  return ((data ?? []) as TipoTechoPublico[]).map(t => ({
    codtte: String(t.codtte),
    nombre: t.nombre,
    adicionalReferencial: Number(t.adicionalReferencial),
    sinTecho: t.sinTecho === true
  }));
}
