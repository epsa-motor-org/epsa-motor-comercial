import type { SupabaseClient } from '@supabase/supabase-js';
import type { CrearVentaResultado } from '../types/venta.types';

// Venta registrada de una moto, para su ficha (HU-006). null si la moto no tiene venta.
export interface VentaDeUnidad extends Omit<CrearVentaResultado, 'reutilizada'> {
  comprador: Record<string, unknown> | null;
  techoNombre: string | null;
  adelantoSeparacion: {
    codsep: string; monto: number; fechaPago: string; medioPago: string;
    referencia: string | null; ingresoConfirmado: boolean; fechaRegistro: string;
  } | null;
}

export async function ventaDeUnidad(db: SupabaseClient, coduni: string): Promise<VentaDeUnidad | null> {
  const { data, error } = await db.rpc('hu006_venta_de_unidad', { p_coduni: coduni });
  if (error) throw error;
  return (data ?? null) as VentaDeUnidad | null;
}
