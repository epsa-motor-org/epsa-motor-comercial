import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ErrorHttp } from '../utils/errores';
import { TIPO_EVIDENCIA } from '../utils/separacion.apoyo.validacion';
import type { FormatoEvidencia } from '../types/separacion.apoyo.types';
import type {
  CrearVentaInput, CrearVentaResultado, EvidenciaVentaSubida, GuardarTechoVentaInput,
  GuardarTechoVentaResultado, GuardarComprobanteVentaInput, GuardarComprobanteVentaResultado,
  ConsultaVentasInput, ConsultaVentasResultado
} from '../types/venta.types';

export const BUCKET_EVIDENCIA_VENTA = 'ventas-evidencia';

export async function crearVenta(db: SupabaseClient, datos: CrearVentaInput): Promise<CrearVentaResultado> {
  const { data, error } = await db.rpc('hu006_crear_venta', { ...datos });
  if (error) throw error;
  return data as CrearVentaResultado;
}

export async function guardarTechoVenta(
  db: SupabaseClient, datos: GuardarTechoVentaInput
): Promise<GuardarTechoVentaResultado> {
  const { data, error } = await db.rpc('hu006_guardar_techo_venta', { ...datos });
  if (error) throw error;
  return data as GuardarTechoVentaResultado;
}

export async function guardarComprobanteVenta(
  db: SupabaseClient, datos: GuardarComprobanteVentaInput
): Promise<GuardarComprobanteVentaResultado> {
  const { data, error } = await db.rpc('hu006_guardar_comprobante_venta', { ...datos });
  if (error) throw error;
  return data as GuardarComprobanteVentaResultado;
}

export async function consultarVentas(
  db: SupabaseClient, filtros: ConsultaVentasInput
): Promise<ConsultaVentasResultado> {
  const { data, error } = await db.rpc('hu006_listar_ventas', filtros);
  if (error) throw error;
  return data as ConsultaVentasResultado;
}

function errorStorage(error: unknown): never {
  const detalle = error as { status?: number; statusCode?: string; error?: string };
  if (detalle?.status === 403 || ['403', 'Unauthorized', 'AccessDenied'].includes(detalle?.statusCode ?? detalle?.error ?? ''))
    throw new ErrorHttp(403, 'No tienes permisos para guardar la evidencia del pago');
  if (detalle?.status === 413 || detalle?.statusCode === '413')
    throw new ErrorHttp(400, 'La evidencia pesa más de 5 MB. Sube un archivo más liviano.');
  throw new ErrorHttp(502, 'No se pudo guardar la evidencia del pago. Vuelve a intentarlo.');
}

export async function subirEvidenciaVenta(
  db: SupabaseClient, coduni: string, buffer: Buffer, formato: FormatoEvidencia
): Promise<EvidenciaVentaSubida> {
  const { contentType, extension } = TIPO_EVIDENCIA[formato];
  const ruta = `ventas/${coduni}/${randomUUID()}.${extension}`;
  try {
    const { error } = await db.storage.from(BUCKET_EVIDENCIA_VENTA)
      .upload(ruta, buffer, { contentType, upsert: false });
    if (error) errorStorage(error);
  } catch (error) {
    if (error instanceof ErrorHttp) throw error;
    errorStorage(error);
  }
  return { rutaEvidencia: ruta, tipo: contentType, tamano: buffer.length };
}
