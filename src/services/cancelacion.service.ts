import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CancelacionConsulta, CancelacionResultado, CancelarSeparacionInput, CancelarVentaInput
} from '../types/cancelacion.types';

export async function cancelarSeparacion(
  db: SupabaseClient, datos: CancelarSeparacionInput
): Promise<CancelacionResultado> {
  const { data, error } = await db.rpc('hu021_cancelar_separacion', { ...datos });
  if (error) throw error;
  return data as CancelacionResultado;
}

export async function cancelarVenta(db: SupabaseClient, datos: CancelarVentaInput): Promise<CancelacionResultado> {
  const { data, error } = await db.rpc('hu021_cancelar_venta', { ...datos });
  if (error) throw error;
  return data as CancelacionResultado;
}

export async function consultarCancelacionSeparacion(
  db: SupabaseClient, codsep: string
): Promise<CancelacionConsulta | null> {
  const { data, error } = await db.rpc('hu021_consultar_cancelacion_separacion', { p_codsep: codsep });
  if (error) throw error;
  return (data ?? null) as CancelacionConsulta | null;
}

export async function consultarCancelacionVenta(
  db: SupabaseClient, codven: string
): Promise<CancelacionConsulta | null> {
  const { data, error } = await db.rpc('hu021_consultar_cancelacion_venta', { p_codven: codven });
  if (error) throw error;
  return (data ?? null) as CancelacionConsulta | null;
}
