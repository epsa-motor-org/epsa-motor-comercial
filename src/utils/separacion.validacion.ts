import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type { CrearSeparacionInput } from '../types/separacion.types';

const CAMPOS_PERMITIDOS = [
  'codcli', 'codusuResponsable', 'codusuConfirmador', 'monto', 'fechaPago', 'medioPago',
  'referencia', 'rutaEvidencia', 'observacion', 'ingresoConfirmado'
] as const;

function validarObjeto(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ErrorHttp(400, 'El cuerpo debe ser un objeto JSON');
  const datos = body as Record<string, unknown>;
  const campoExtra = Object.keys(datos).find(
    campo => !CAMPOS_PERMITIDOS.includes(campo as typeof CAMPOS_PERMITIDOS[number])
  );
  if (campoExtra) throw new ErrorHttp(400, `Campo no permitido: ${campoExtra}`);
  return datos;
}

function validarIdNumerico(valor: unknown, campo: string): string {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0)
    throw new ErrorHttp(400, `${campo} debe ser un entero positivo`);
  return String(valor);
}

function validarFecha(valor: unknown): string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)
    || valor < '0001-01-01' || !Number.isFinite(Date.parse(valor))
    || new Date(valor).toISOString().slice(0, 10) !== valor)
    throw new ErrorHttp(400, 'fechaPago debe ser una fecha válida YYYY-MM-DD');
  return valor;
}

function validarTextoOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} debe ser texto o null`);
  return valor.trim() || null;
}

function validarClaveIdempotencia(valor: unknown): string {
  if (typeof valor !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(valor.trim()))
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe ser un UUID válido');
  return valor.trim().toLowerCase();
}

export function obtenerClaveIdempotencia(rawHeaders: readonly string[]): string {
  const valores: string[] = [];
  for (let indice = 0; indice < rawHeaders.length; indice += 2) {
    if (rawHeaders[indice]?.toLowerCase() === 'idempotency-key')
      valores.push(rawHeaders[indice + 1] ?? '');
  }
  if (valores.length !== 1)
    throw new ErrorHttp(400, 'El header Idempotency-Key es obligatorio y debe enviarse una sola vez');
  return validarClaveIdempotencia(valores[0]);
}

export function validarCrearSeparacion(
  coduni: unknown,
  body: unknown,
  claveIdempotencia: unknown
): CrearSeparacionInput {
  const datos = validarObjeto(body);
  if (typeof datos.monto !== 'number' || !Number.isFinite(datos.monto) || datos.monto <= 0)
    throw new ErrorHttp(400, 'monto debe ser un número positivo');
  if (typeof datos.medioPago !== 'string' || !datos.medioPago.trim())
    throw new ErrorHttp(400, 'medioPago es obligatorio y debe ser texto');
  if (typeof datos.ingresoConfirmado !== 'boolean')
    throw new ErrorHttp(400, 'ingresoConfirmado debe ser booleano');
  const codusuConfirmador = datos.codusuConfirmador === undefined
    ? null
    : validarIdNumerico(datos.codusuConfirmador, 'codusuConfirmador');

  return {
    p_coduni: validarIdCompra(coduni, 'coduni'),
    p_codcli: validarIdNumerico(datos.codcli, 'codcli'),
    p_codusuresp: validarIdNumerico(datos.codusuResponsable, 'codusuResponsable'),
    p_codusu_confirmador: codusuConfirmador,
    p_monadesep: datos.monto,
    p_fecpagsep: validarFecha(datos.fechaPago),
    p_metpagsep: datos.medioPago.trim(),
    p_refsep: validarTextoOpcional(datos.referencia, 'referencia'),
    p_rutavouchersep: validarTextoOpcional(datos.rutaEvidencia, 'rutaEvidencia'),
    p_obssep: validarTextoOpcional(datos.observacion, 'observacion'),
    p_ingreso_confirmado: datos.ingresoConfirmado,
    p_idempotenciasep: validarClaveIdempotencia(claveIdempotencia)
  };
}
