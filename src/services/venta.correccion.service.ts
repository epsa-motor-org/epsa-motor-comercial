import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CorreccionRelacionIndividualInput, CorreccionRelacionResultado, HistorialCorreccionRelacionItem,
  IntercambioRelacionInput, PreviewCorreccionRelacionResultado, PreviewIntercambioRelacionResultado,
  ConsultaIntercambioInput
} from '../types/venta.correccion.types';

export async function previsualizarCorreccionVenta(
  db: SupabaseClient, codven: string
): Promise<PreviewCorreccionRelacionResultado> {
  const { data, error } = await db.rpc('hu022_preview_correccion_venta', { p_codven: codven });
  if (error) throw error;
  return data as PreviewCorreccionRelacionResultado;
}

export async function corregirRelacionVenta(
  db: SupabaseClient, datos: CorreccionRelacionIndividualInput
): Promise<CorreccionRelacionResultado> {
  const { data, error } = await db.rpc('hu022_corregir_venta', { ...datos });
  if (error) throw error;
  return data as CorreccionRelacionResultado;
}

export async function previsualizarIntercambioVentas(
  db: SupabaseClient, datos: ConsultaIntercambioInput
): Promise<PreviewIntercambioRelacionResultado> {
  const { data, error } = await db.rpc('hu022_preview_intercambio_ventas', { ...datos });
  if (error) throw error;
  return data as PreviewIntercambioRelacionResultado;
}

export async function intercambiarRelacionVentas(
  db: SupabaseClient, datos: IntercambioRelacionInput
): Promise<CorreccionRelacionResultado> {
  const { data, error } = await db.rpc('hu022_intercambiar_ventas', { ...datos });
  if (error) throw error;
  return data as CorreccionRelacionResultado;
}

export async function consultarHistorialCorreccionVenta(
  db: SupabaseClient, codven: string
): Promise<HistorialCorreccionRelacionItem[]> {
  const { data, error } = await db.rpc('hu022_historial_venta', { p_codven: codven });
  if (error) throw error;
  return (data ?? []) as HistorialCorreccionRelacionItem[];
}
