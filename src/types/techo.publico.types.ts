import type { SupabaseClient } from '@supabase/supabase-js';

export type FabricaClientePublicoTechos = () => SupabaseClient;

export interface TipoTechoPublico {
  codtte: string;
  nombre: string;
  adicionalReferencial: number;
  sinTecho: boolean;
}
