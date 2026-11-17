// HU-002 · PDF de la factura · Sprint 2: fotos de modelos (HU-036) y vouchers de separación (HU-005)
import { MODO_REAL } from "./config";
import { consultarPdfFacturaApi, subirPdfFacturaApi, urlPdfFacturaApi } from "./api";
import { ApiError } from "./errores";
import { hoyLocal } from "./validar";

const memoria = new Map();
export const MAX_PDF = 10 * 1024 * 1024;

// Validar el archivo
export function validarPdf(archivo) {
  if (!archivo) return "Elige un archivo.";
  const tipoOk = ["application/pdf", "application/x-pdf"].includes(archivo.type) || (!archivo.type && /\.pdf$/i.test(archivo.name || ""));
  if (!tipoOk) return "Solo se aceptan archivos PDF.";
  if (!archivo.size) return "El PDF está vacío.";
  if (archivo.size > MAX_PDF) return "El PDF supera los 10 MB.";
  return "";
}

export async function validarPdfContenido(archivo) {
  const rapido = validarPdf(archivo);
  if (rapido) return rapido;
  try {
    const cabecera = await archivo.slice(0, 5).text();
    if (!cabecera.startsWith("%PDF")) return "El archivo no es un PDF válido.";
  } catch {}
  return "";
}

// Guardado local (modo demostración)
function db() {
  return new Promise((ok, mal) => {
    try {
      const r = indexedDB.open("epsa-archivos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("archivos");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    } catch (e) { mal(e); }
  });
}
async function guardarLocal(clave, blob) {
  try {
    const d = await db();
    await new Promise((ok, mal) => { const t = d.transaction("archivos", "readwrite"); t.objectStore("archivos").put(blob, clave); t.oncomplete = ok; t.onerror = () => mal(t.error); });
  } catch { memoria.set(clave, blob); }
}
async function leerLocal(clave) {
  if (memoria.has(clave)) return memoria.get(clave);
  try {
    const d = await db();
    return await new Promise((ok, mal) => { const r = d.transaction("archivos").objectStore("archivos").get(clave); r.onsuccess = () => ok(r.result || null); r.onerror = () => mal(r.error); });
  } catch { return null; }
}

// Subir, buscar y abrir el PDF
export async function subirPdfFactura(codcom, archivo) {
  const error = await validarPdfContenido(archivo);
  if (error) throw new ApiError(400, error);
  const fecha = hoyLocal();
  if (MODO_REAL) {
    await subirPdfFacturaApi(codcom, archivo);
    return { codcom: String(codcom), api: true, nombre: archivo.name, tamano: archivo.size, fecha };
  }
  const nombre = archivo.name.replace(/[^\w.-]+/g, "_");
  const ruta = `compra-${codcom}/${Date.now()}-${nombre}`;
  await guardarLocal(ruta, archivo);
  return { ruta, nombre: archivo.name, tamano: archivo.size, fecha };
}

export async function buscarPdfFactura(codcom) {
  if (!MODO_REAL) return null;
  try {
    const r = await consultarPdfFacturaApi(codcom);
    return r.data?.archivo_adjuntado ? { codcom: String(codcom), api: true, nombre: "factura.pdf" } : null;
  } catch { return null; }
}

export async function urlPdfFactura(adjunto) {
  if (MODO_REAL) {
    if (!adjunto?.codcom) throw new ApiError(404, "Esta factura no tiene PDF adjunto.");
    const r = await urlPdfFacturaApi(adjunto.codcom);
    if (!r.data?.url) throw new ApiError(500, "No se pudo abrir el PDF.");
    return r.data.url;
  }
  if (!adjunto?.ruta) throw new ApiError(404, "Esta factura no tiene PDF adjunto.");
  const blob = await leerLocal(adjunto.ruta);
  if (!blob) throw new ApiError(404, "Este PDF no está disponible en este equipo; adjúntalo de nuevo para verlo aquí.");
  return URL.createObjectURL(blob);
}

// Recordar el adjunto
const CLAVE_ADJ = "epsa-adjuntos-factura";
export function adjuntoRecordado(codcom) {
  try { return JSON.parse(localStorage.getItem(CLAVE_ADJ) || "{}")[codcom] || null; } catch { return null; }
}
export function recordarAdjunto(codcom, adjunto) {
  try { const m = JSON.parse(localStorage.getItem(CLAVE_ADJ) || "{}"); m[codcom] = adjunto; localStorage.setItem(CLAVE_ADJ, JSON.stringify(m)); } catch {}
}

// Sprint 2 · Archivos guardados en este navegador (hasta conectar Supabase Storage)
export const guardarArchivoLocal = guardarLocal;
export const leerArchivoLocal = leerLocal;
export async function borrarArchivoLocal(clave) {
  memoria.delete(clave);
  try {
    const d = await db();
    await new Promise((ok) => { const t = d.transaction("archivos", "readwrite"); t.objectStore("archivos").delete(clave); t.oncomplete = ok; t.onerror = ok; });
  } catch {}
}

// Reducir una foto antes de guardarla (lado mayor y calidad)
export function comprimirImagen(archivo, { lado = 1600, calidad = 0.85, tipo = "image/webp" } = {}) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo procesar la imagen."))), tipo, calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("No se pudo leer la imagen. Prueba con otra foto.")); };
    img.src = url;
  });
}

// Validar fotos y vouchers
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
export const MAX_FOTO = 2 * 1024 * 1024;
export const MAX_VOUCHER = 5 * 1024 * 1024;
export function validarFoto(a) {
  if (!a) return "Elige una foto.";
  if (!TIPOS_FOTO.includes(a.type)) return `${a.name}: usa JPG, PNG o WEBP.`;
  if (a.size > MAX_FOTO) return `${a.name}: pesa más de 2 MB. Redúcela e inténtalo de nuevo.`;
  return "";
}
export function validarVoucher(a) {
  if (!a) return "Adjunta el voucher del pago.";
  if (![...TIPOS_FOTO, "application/pdf"].includes(a.type)) return "El voucher debe ser una foto (JPG, PNG o WEBP) o un PDF.";
  if (a.size > MAX_VOUCHER) return "El voucher pesa más de 5 MB.";
  if (!a.size) return "El archivo está vacío.";
  return "";
}
export const pesoLegible = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
