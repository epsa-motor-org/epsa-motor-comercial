import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type {
  CorreccionRelacionIndividualInput, IntercambioRelacionInput, ConsultaIntercambioInput
} from '../types/venta.correccion.types';

function objeto(valor: unknown, nombre: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor))
    throw new ErrorHttp(400, `${nombre} debe ser un objeto JSON`);
  return valor as Record<string, unknown>;
}

function textoMotivo(valor: unknown): string {
  if (typeof valor !== 'string') throw new ErrorHttp(400, 'motivo es obligatorio y debe ser texto');
  const motivo = valor.replace(/\s+/g, ' ').trim();
  if (!motivo || motivo.length > 500 || /[\u0000-\u001f\u007f]/.test(motivo))
    throw new ErrorHttp(400, 'motivo debe tener entre 1 y 500 caracteres válidos');
  return motivo;
}

function version(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 1 || valor > 2147483647)
    throw new ErrorHttp(400, `${campo} debe ser un entero positivo`);
  return valor;
}

function claveDesdeRawHeaders(rawHeaders: readonly string[]): string {
  const values: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === 'idempotency-key') values.push(rawHeaders[i + 1] ?? '');
  }
  if (values.length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(values[0]!.trim()))
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe ser un UUID válido');
  return values[0]!.trim().toLowerCase();
}

function campoOpcionalId(datos: Record<string, unknown>, campo: string): string | null {
  if (datos[campo] === undefined) return null;
  return validarIdCompra(datos[campo], campo);
}

export function validarCorreccionRelacionVenta(
  codven: unknown, body: unknown, rawHeaders: readonly string[]
): CorreccionRelacionIndividualInput {
  const datos = objeto(body, 'El cuerpo');
  const extra = Object.keys(datos).find(c => !['motivo', 'versionEsperada', 'codcliNuevo', 'coduniNuevo'].includes(c));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (datos.codcliNuevo === undefined && datos.coduniNuevo === undefined)
    throw new ErrorHttp(400, 'Indica codcliNuevo, coduniNuevo o ambos');
  return {
    p_codven: validarIdCompra(codven, 'codven'),
    p_codcli_nuevo: campoOpcionalId(datos, 'codcliNuevo'),
    p_coduni_nuevo: campoOpcionalId(datos, 'coduniNuevo'),
    p_version_esperada: version(datos.versionEsperada, 'versionEsperada'),
    p_motivo: textoMotivo(datos.motivo),
    p_idempotencia: claveDesdeRawHeaders(rawHeaders)
  };
}

export function validarIntercambioRelacionVentas(
  body: unknown, rawHeaders: readonly string[]
): IntercambioRelacionInput {
  const datos = objeto(body, 'El cuerpo');
  const extra = Object.keys(datos).find(c => !['motivo', 'operaciones'].includes(c));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (!Array.isArray(datos.operaciones) || datos.operaciones.length !== 2)
    throw new ErrorHttp(400, 'operaciones debe contener exactamente dos ventas');
  const operaciones = datos.operaciones.map((valor, indice) => {
    const op = objeto(valor, `operaciones[${indice}]`);
    const campoExtra = Object.keys(op).find(c => !['codven', 'versionEsperada', 'codcliNuevo', 'coduniNuevo'].includes(c));
    if (campoExtra) throw new ErrorHttp(400, `Campo no permitido en operaciones[${indice}]: ${campoExtra}`);
    if (op.coduniNuevo === undefined) throw new ErrorHttp(400, `operaciones[${indice}].coduniNuevo es obligatorio`);
    return {
      codven: validarIdCompra(op.codven, `operaciones[${indice}].codven`),
      versionEsperada: version(op.versionEsperada, `operaciones[${indice}].versionEsperada`),
      codcliNuevo: campoOpcionalId(op, 'codcliNuevo'),
      coduniNuevo: validarIdCompra(op.coduniNuevo, `operaciones[${indice}].coduniNuevo`)
    };
  });
  if (operaciones[0]!.codven === operaciones[1]!.codven)
    throw new ErrorHttp(400, 'El intercambio requiere dos ventas distintas');
  return {
    p_codven_a: operaciones[0]!.codven,
    p_codcli_a_nuevo: operaciones[0]!.codcliNuevo,
    p_coduni_a_nueva: operaciones[0]!.coduniNuevo,
    p_version_a: operaciones[0]!.versionEsperada,
    p_codven_b: operaciones[1]!.codven,
    p_codcli_b_nuevo: operaciones[1]!.codcliNuevo,
    p_coduni_b_nueva: operaciones[1]!.coduniNuevo,
    p_version_b: operaciones[1]!.versionEsperada,
    p_motivo: textoMotivo(datos.motivo),
    p_idempotencia: claveDesdeRawHeaders(rawHeaders)
  };
}

export function validarConsultaIntercambio(queryDesconocido: unknown): ConsultaIntercambioInput {
  if (!queryDesconocido || typeof queryDesconocido !== 'object' || Array.isArray(queryDesconocido))
    throw new ErrorHttp(400, 'Parámetros de consulta inválidos');
  const query = queryDesconocido as Record<string, unknown>;
  const extra = Object.keys(query).find(c => !['codvenA', 'codvenB'].includes(c));
  if (extra) throw new ErrorHttp(400, `Parámetro no permitido: ${extra}`);
  return {
    p_codven_a: validarIdCompra(query.codvenA, 'codvenA'),
    p_codven_b: validarIdCompra(query.codvenB, 'codvenB')
  };
}
