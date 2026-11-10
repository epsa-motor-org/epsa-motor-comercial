import { ErrorHttp } from './errores';
import { verificarBytesImagen } from './imagen.contenido';
import type { FormatoEvidencia, RegistrarCompradorInput } from '../types/separacion.apoyo.types';

// HU-005 · Validaciones de forma; la base vuelve a validar los nombres y el celular.

export const MAX_BYTES_EVIDENCIA = 5 * 1024 * 1024; // mismo límite que el bucket separaciones-evidencia

// Comprador sin documento: nombres, apellidos y celular (8 de noviembre)
const CAMPOS_COMPRADOR = ['nombres', 'apellidoPaterno', 'apellidoMaterno', 'telefono'] as const;
// Solo letras (con tildes, ñ y ü) y un espacio entre palabras: ni números ni símbolos
const NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+( [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;
const esNombre = (t: string) => t.length >= 2 && t.length <= 100 && NOMBRE.test(t) && (t.match(/\p{L}/gu) ?? []).length >= 2;

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
  const nombres = textoOpcional(datos.nombres, 'nombres', 100);
  if (!nombres || !esNombre(nombres)) throw new ErrorHttp(400, 'Escribe los nombres del comprador (solo letras)');
  const paterno = textoOpcional(datos.apellidoPaterno, 'apellidoPaterno', 100);
  if (!paterno || !esNombre(paterno)) throw new ErrorHttp(400, 'Escribe el apellido paterno del comprador (solo letras)');
  const materno = textoOpcional(datos.apellidoMaterno, 'apellidoMaterno', 100);
  if (materno && !esNombre(materno)) throw new ErrorHttp(400, 'El apellido materno solo lleva letras');
  const telefono = (textoOpcional(datos.telefono, 'telefono', 20) ?? '').replace(/[\s-]+/g, '');
  if (!/^9\d{8}$/.test(telefono) || /^(\d)\1{8}$/.test(telefono))
    throw new ErrorHttp(400, 'El celular debe tener 9 dígitos y empezar con 9');
  return { p_nombres: nombres, p_apellido_paterno: paterno, p_apellido_materno: materno, p_telefono: telefono };
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
