import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CorreccionRelacionIndividualInput, CorreccionRelacionResultado, HistorialCorreccionRelacionItem,
  IntercambioRelacionInput, PreviewCorreccionRelacionResultado, PreviewIntercambioRelacionResultado,
  ConsultaIntercambioInput
} from '../types/venta.correccion.types';

type RpcCorreccionHU022 = 'hu022_corregir_venta' | 'hu022_intercambiar_ventas';

function codigoErrorSanitizado(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown';
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return 'unknown';
  const normalized = code.toUpperCase();
  return /^[A-Z0-9_]{1,16}$/.test(normalized) ? normalized : 'unknown';
}

async function ejecutarRpcCorreccionHU022<T>(
  db: SupabaseClient, rpc: RpcCorreccionHU022, parametros: Record<string, unknown>
): Promise<T> {
  try {
    const { data, error } = await db.rpc(rpc, parametros);
    if (error) throw error;
    return data as T;
  } catch (error) {
    try { console.error(`HU022 error rpc=${rpc} code=${codigoErrorSanitizado(error)}`); }
    catch { /* El registro diagnóstico no debe alterar la respuesta HTTP. */ }
    throw error;
  }
}

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
  return ejecutarRpcCorreccionHU022<CorreccionRelacionResultado>(db, 'hu022_corregir_venta', { ...datos });
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
  return ejecutarRpcCorreccionHU022<CorreccionRelacionResultado>(db, 'hu022_intercambiar_ventas', { ...datos });
}

export async function consultarHistorialCorreccionVenta(
  db: SupabaseClient, codven: string
): Promise<HistorialCorreccionRelacionItem[]> {
  const { data, error } = await db.rpc('hu022_historial_venta', { p_codven: codven });
  if (error) throw error;
  return (data ?? []) as HistorialCorreccionRelacionItem[];
}
