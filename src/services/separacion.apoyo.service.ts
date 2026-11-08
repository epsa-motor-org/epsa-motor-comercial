import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ErrorHttp } from '../utils/errores';
import { TIPO_EVIDENCIA } from '../utils/separacion.apoyo.validacion';
import type {
  CompradorSeparacion, EvidenciaSubida, FormatoEvidencia, FormularioSeparacion, RegistrarCompradorInput,
  SeparacionActiva
} from '../types/separacion.apoyo.types';

export const BUCKET_EVIDENCIA = 'separaciones-evidencia';

export async function obtenerFormulario(db: SupabaseClient): Promise<FormularioSeparacion> {
  const { data, error } = await db.rpc('hu005_formulario_separacion');
  if (error) throw error;
  return data as FormularioSeparacion;
}

export async function buscarComprador(db: SupabaseClient, numero: string): Promise<CompradorSeparacion | null> {
  const { data, error } = await db.rpc('hu005_buscar_cliente', { p_numdoc: numero });
  if (error) throw error;
  return (data ?? null) as CompradorSeparacion | null;
}

export async function registrarComprador(db: SupabaseClient, datos: RegistrarCompradorInput): Promise<CompradorSeparacion> {
  const { data, error } = await db.rpc('hu005_registrar_cliente', { ...datos });
  if (error) throw error;
  return data as CompradorSeparacion;
}

export async function obtenerSeparacionActiva(db: SupabaseClient, coduni: string): Promise<SeparacionActiva | null> {
  const { data, error } = await db.rpc('hu005_separacion_activa', { p_coduni: coduni });
  if (error) throw error;
  return (data ?? null) as SeparacionActiva | null;
}

function errorStorage(error: unknown): never {
  const detalle = error as { status?: number; statusCode?: string; error?: string };
  if (detalle?.status === 403 || ['403', 'Unauthorized', 'AccessDenied'].includes(detalle?.statusCode ?? detalle?.error ?? ''))
    throw new ErrorHttp(403, 'No tienes permisos para guardar la captura');
  if (detalle?.status === 413 || detalle?.statusCode === '413')
    throw new ErrorHttp(400, 'La captura pesa más de 5 MB. Sube una más liviana.');
  throw new ErrorHttp(502, 'No se pudo guardar la captura. Vuelve a intentarlo.');
}

// Guarda la captura en el bucket privado, en la carpeta de la moto. El nombre es único:
// subirla otra vez no reemplaza ninguna captura anterior.
export async function subirEvidencia(
  db: SupabaseClient, coduni: string, buffer: Buffer, formato: FormatoEvidencia
): Promise<EvidenciaSubida> {
  const { contentType, extension } = TIPO_EVIDENCIA[formato];
  const ruta = `separaciones/${coduni}/${randomUUID()}.${extension}`;
  try {
    const { error } = await db.storage.from(BUCKET_EVIDENCIA).upload(ruta, buffer, { contentType, upsert: false });
    if (error) errorStorage(error);
  } catch (error) {
    if (error instanceof ErrorHttp) throw error;
    errorStorage(error);
  }
  return { rutaEvidencia: ruta, tipo: contentType, tamano: buffer.length };
}
