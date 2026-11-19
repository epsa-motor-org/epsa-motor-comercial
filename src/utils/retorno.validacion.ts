import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type { RegistrarRetornoInput } from '../types/retorno.types';

const CAMPOS_RETORNO = ['fechaRetorno', 'codubi', 'condicion', 'observacion'] as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarTexto(valor: unknown, campo: string, maximo: number): string {
  if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} es obligatorio y debe ser texto`);
  const texto = valor.replace(/\s+/g, ' ').trim();
  if (!texto || texto.length > maximo || /[\u0000-\u001f\u007f]/.test(texto))
    throw new ErrorHttp(400, `${campo} no tiene un formato válido`);
  return texto;
}

function validarFecha(valor: unknown): string {
  if (typeof valor !== 'string' || !FECHA.test(valor))
    throw new ErrorHttp(400, 'fechaRetorno debe tener el formato YYYY-MM-DD');
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio!, mes! - 1, dia!));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() + 1 !== mes || fecha.getUTCDate() !== dia)
    throw new ErrorHttp(400, 'fechaRetorno no es una fecha calendario válida');
  return valor;
}

function validarClave(valor: unknown): string {
  if (typeof valor !== 'string' || !UUID.test(valor.trim()))
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe ser un UUID válido');
  return valor.trim().toLowerCase();
}

export function obtenerClaveIdempotenciaRetorno(rawHeaders: readonly string[]): string {
  const valores: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === 'idempotency-key') valores.push(rawHeaders[i + 1] ?? '');
  }
  if (valores.length !== 1)
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe enviarse una sola vez');
  return validarClave(valores[0]);
}

export function validarRegistrarRetorno(codven: unknown, body: unknown, clave: unknown): RegistrarRetornoInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ErrorHttp(400, 'El cuerpo debe ser un objeto JSON');
  const datos = body as Record<string, unknown>;
  const extra = Object.keys(datos).find(campo => !CAMPOS_RETORNO.includes(campo as typeof CAMPOS_RETORNO[number]));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (typeof datos.codubi !== 'number' || !Number.isSafeInteger(datos.codubi) || datos.codubi <= 0)
    throw new ErrorHttp(400, 'codubi debe ser un entero positivo');
  return {
    p_codven: validarIdCompra(codven, 'codven'),
    p_fecharetorno: validarFecha(datos.fechaRetorno),
    p_codubi: String(datos.codubi),
    p_condicion: validarTexto(datos.condicion, 'condicion', 500),
    p_observacion: validarTexto(datos.observacion, 'observacion', 1000),
    p_idempotencia: validarClave(clave)
  };
}
