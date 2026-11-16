import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type { ModalidadEntrega, RegistrarEntregaInput } from '../types/entrega.types';

const CAMPOS_ENTREGA = [
  'coduni', 'codcli', 'modalidad', 'fecha', 'receptor', 'observacion',
  'documentosPendientes', 'observacionDocumentos', 'referenciaGuia'
] as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function objeto(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ErrorHttp(400, 'El cuerpo debe ser un objeto JSON');
  const datos = body as Record<string, unknown>;
  const extra = Object.keys(datos).find(campo => !CAMPOS_ENTREGA.includes(campo as typeof CAMPOS_ENTREGA[number]));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  return datos;
}

function texto(valor: unknown, campo: string, maximo: number, obligatorio = false): string | null {
  if (valor === undefined || valor === null) {
    if (obligatorio) throw new ErrorHttp(400, `${campo} es obligatorio`);
    return null;
  }
  if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} debe ser texto`);
  const normalizado = valor.replace(/\s+/g, ' ').trim();
  if (normalizado.length > maximo || /[\u0000-\u001f\u007f]/.test(normalizado))
    throw new ErrorHttp(400, `${campo} no tiene un formato válido`);
  if (obligatorio && !normalizado) throw new ErrorHttp(400, `${campo} es obligatorio`);
  return normalizado || null;
}

function fechaISO(valor: unknown): string {
  if (typeof valor !== 'string' || !FECHA.test(valor))
    throw new ErrorHttp(400, 'fecha debe tener el formato YYYY-MM-DD');
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio!, mes! - 1, dia!));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() + 1 !== mes || fecha.getUTCDate() !== dia)
    throw new ErrorHttp(400, 'fecha no es una fecha calendario válida');
  return valor;
}

function claveIdempotencia(valor: unknown): string {
  if (typeof valor !== 'string' || !UUID.test(valor.trim()))
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe ser un UUID válido');
  return valor.trim().toLowerCase();
}

export function obtenerClaveIdempotenciaEntrega(rawHeaders: readonly string[]): string {
  const valores: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === 'idempotency-key') valores.push(rawHeaders[i + 1] ?? '');
  }
  if (valores.length !== 1)
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe enviarse una sola vez');
  return claveIdempotencia(valores[0]);
}

export function validarRegistrarEntrega(codven: unknown, body: unknown, clave: unknown): RegistrarEntregaInput {
  const datos = objeto(body);
  if (datos.modalidad !== 'Armada' && datos.modalidad !== 'Embalada')
    throw new ErrorHttp(400, 'modalidad debe ser Armada o Embalada');
  if (typeof datos.documentosPendientes !== 'boolean')
    throw new ErrorHttp(400, 'documentosPendientes debe ser boolean');
  const receptor = texto(datos.receptor, 'receptor', 200, true)!;
  const observacion = texto(datos.observacion, 'observacion', 1000);
  const observacionDocumentos = texto(datos.observacionDocumentos, 'observacionDocumentos', 1000);
  const referenciaGuia = texto(datos.referenciaGuia, 'referenciaGuia', 250);
  if (datos.documentosPendientes && (!observacionDocumentos || !referenciaGuia))
    throw new ErrorHttp(400, 'Si tarjeta o placa quedan pendientes, registra observación y referencia de guía');
  if (!datos.documentosPendientes && observacionDocumentos)
    throw new ErrorHttp(400, 'observacionDocumentos requiere marcar documentosPendientes');
  return {
    p_codven: validarIdCompra(codven, 'codven'),
    p_coduni: validarIdCompra(datos.coduni, 'coduni'),
    p_codcli: validarIdCompra(datos.codcli, 'codcli'),
    p_modalidad: datos.modalidad as ModalidadEntrega,
    p_fecha: fechaISO(datos.fecha),
    p_receptor: receptor,
    p_observacion: observacion,
    p_documentos_pendientes: datos.documentosPendientes,
    p_observacion_documentos: observacionDocumentos,
    p_referencia_guia: referenciaGuia,
    p_idempotencia: claveIdempotencia(clave)
  };
}

export function validarConsultaEntrega(codven: unknown): string {
  return validarIdCompra(codven, 'codven');
}

