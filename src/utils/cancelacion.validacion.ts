import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type { CancelarOperacionRequest, CancelarSeparacionInput, CancelarVentaInput } from '../types/cancelacion.types';

const CAMPOS_CANCELACION = ['motivo', 'observacionDinero'] as const;

function validarCuerpo(valor: unknown): CancelarOperacionRequest {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor))
    throw new ErrorHttp(400, 'El cuerpo debe ser un objeto JSON');
  const body = valor as Record<string, unknown>;
  const extra = Object.keys(body).find(campo => !CAMPOS_CANCELACION.includes(campo as typeof CAMPOS_CANCELACION[number]));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (typeof body.motivo !== 'string') throw new ErrorHttp(400, 'motivo es obligatorio y debe ser texto');
  const motivo = normalizarTexto(body.motivo, 'motivo', 250, true)!;
  const observacionDinero = body.observacionDinero === undefined || body.observacionDinero === null
    ? null : normalizarTexto(body.observacionDinero, 'observacionDinero', 2000, false);
  return { motivo, observacionDinero };
}

function normalizarTexto(valor: unknown, campo: string, maximo: number, obligatorio: boolean): string | null {
  if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} debe ser texto`);
  const texto = valor.replace(/\s+/g, ' ').trim();
  if (texto.length > maximo || /[\u0000-\u001f\u007f]/.test(texto))
    throw new ErrorHttp(400, `${campo} no tiene un formato válido`);
  if (obligatorio && !texto) throw new ErrorHttp(400, `${campo} es obligatorio`);
  return texto || null;
}

function validarClaveIdempotencia(valor: unknown): string {
  if (typeof valor !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(valor.trim()))
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe ser un UUID válido');
  return valor.trim().toLowerCase();
}

export function obtenerClaveIdempotenciaCancelacion(rawHeaders: readonly string[]): string {
  const valores: string[] = [];
  for (let indice = 0; indice < rawHeaders.length; indice += 2) {
    if (rawHeaders[indice]?.toLowerCase() === 'idempotency-key') valores.push(rawHeaders[indice + 1] ?? '');
  }
  if (valores.length !== 1)
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe enviarse una sola vez');
  return validarClaveIdempotencia(valores[0]);
}

export function validarCancelarSeparacion(
  codsep: unknown, body: unknown, clave: unknown
): CancelarSeparacionInput {
  const datos = validarCuerpo(body);
  return {
    p_codsep: validarIdCompra(codsep, 'codsep'),
    p_motivo: datos.motivo,
    p_observacion_dinero: datos.observacionDinero ?? null,
    p_idempotencia: validarClaveIdempotencia(clave)
  };
}

export function validarCancelarVenta(codven: unknown, body: unknown, clave: unknown): CancelarVentaInput {
  const datos = validarCuerpo(body);
  return {
    p_codven: validarIdCompra(codven, 'codven'),
    p_motivo: datos.motivo,
    p_observacion_dinero: datos.observacionDinero ?? null,
    p_idempotencia: validarClaveIdempotencia(clave)
  };
}
