import { ErrorHttp } from './errores';
import { verificarBytesImagen } from './imagen.contenido';
import type { FormatoEvidencia, RegistrarCompradorInput } from '../types/separacion.apoyo.types';

// HU-005 · Validaciones de forma; la base valida además cada tipo de documento y los nombres.

export const MAX_BYTES_EVIDENCIA = 5 * 1024 * 1024; // mismo límite que el bucket separaciones-evidencia

const CAMPOS_COMPRADOR = [
  'codtdo', 'numeroDocumento', 'nombres', 'apellidoPaterno', 'apellidoMaterno', 'telefono', 'correo'
] as const;

export function validarNumeroDocumento(valor: unknown): string {
  if (typeof valor !== 'string') throw new ErrorHttp(400, 'numeroDocumento es obligatorio');
  const numero = valor.replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(numero))
    throw new ErrorHttp(400, 'numeroDocumento debe tener de 4 a 20 letras o números');
  return numero;
}

function textoOpcional(valor: unknown, campo: string, maximo: number): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} debe ser texto o null`);
  const texto = valor.replace(/\s+/g, ' ').trim();
  if (texto.length > maximo) throw new ErrorHttp(400, `${campo} admite hasta ${maximo} caracteres`);
  return texto || null;
}

export function validarRegistrarComprador(body: unknown): RegistrarCompradorInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ErrorHttp(400, 'El cuerpo debe ser un objeto JSON');
  const datos = body as Record<string, unknown>;
  const extra = Object.keys(datos).find(c => !CAMPOS_COMPRADOR.includes(c as typeof CAMPOS_COMPRADOR[number]));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (typeof datos.codtdo !== 'number' || !Number.isSafeInteger(datos.codtdo) || datos.codtdo <= 0)
    throw new ErrorHttp(400, 'codtdo debe ser un entero positivo');
  const nombres = textoOpcional(datos.nombres, 'nombres', 100);
  if (!nombres || nombres.length < 2) throw new ErrorHttp(400, 'nombres es obligatorio');
  const telefono = (textoOpcional(datos.telefono, 'telefono', 20) ?? '').replace(/[\s-]+/g, '');
  if (!/^9\d{8}$/.test(telefono)) throw new ErrorHttp(400, 'El celular debe tener 9 dígitos y empezar con 9');
  const correo = (textoOpcional(datos.correo, 'correo', 254) ?? '').toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(correo))
    throw new ErrorHttp(400, 'Escribe un correo válido');
  return {
    p_codtdo: String(datos.codtdo),
    p_numdoc: validarNumeroDocumento(datos.numeroDocumento),
    p_nombres: nombres,
    p_apellido_paterno: textoOpcional(datos.apellidoPaterno, 'apellidoPaterno', 100),
    p_apellido_materno: textoOpcional(datos.apellidoMaterno, 'apellidoMaterno', 100),
    p_telefono: telefono,
    p_correo: correo
  };
}

// Techo que eligió el cliente: { codtte } entero positivo
export function validarElegirTecho(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ErrorHttp(400, 'El cuerpo debe ser un objeto JSON');
  const datos = body as Record<string, unknown>;
  const extra = Object.keys(datos).find(c => c !== 'codtte');
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (typeof datos.codtte !== 'number' || !Number.isSafeInteger(datos.codtte) || datos.codtte <= 0)
    throw new ErrorHttp(400, 'codtte debe ser un entero positivo');
  return String(datos.codtte);
}

// La captura debe ser de verdad una imagen PNG, JPG o WEBP legible, o un PDF completo.
export function verificarBytesEvidencia(bytes: Uint8Array): FormatoEvidencia {
  if (!bytes.length) throw new ErrorHttp(400, 'Adjunta la captura de la transferencia');
  if (bytes.length > MAX_BYTES_EVIDENCIA) throw new ErrorHttp(400, 'La captura pesa más de 5 MB. Sube una más liviana.');
  const inicio = Buffer.from(bytes.subarray(0, 5)).toString('latin1');
  if (inicio === '%PDF-') {
    const final = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString('latin1');
    if (!final.includes('%%EOF')) throw new ErrorHttp(400, 'El PDF está incompleto o dañado. Sube otro archivo.');
    return 'pdf';
  }
  try {
    return verificarBytesImagen(bytes);
  } catch {
    throw new ErrorHttp(400, 'La captura debe ser una imagen PNG, JPG o WEBP legible, o un PDF.');
  }
}

export const TIPO_EVIDENCIA: Record<FormatoEvidencia, { contentType: string; extension: string }> = {
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
  pdf: { contentType: 'application/pdf', extension: 'pdf' }
};
