import { ErrorHttp } from './errores';

// HU-036 · Antes de registrar la URL de una foto se comprueba que el archivo sea de verdad una imagen PNG, JPG o
// WEBP legible (no basta con la extensión ni con el Content-Type que declaró quien lo subió). Así, aunque alguien
// suba a Storage un archivo dañado o de otro tipo y llame a la API sin pasar por el panel, no queda registrada una
// foto ilegible ni se reemplaza la foto válida anterior. Las rutas /images/... son archivos del propio frontend.

export const MAX_BYTES_IMAGEN = 6 * 1024 * 1024; // mismo límite que el bucket «modelos»
const ESPERA_MS = 15000;
export type FormatoImagen = 'png' | 'jpeg' | 'webp';

const DANADA = 'El archivo no es una imagen PNG, JPG o WEBP válida o está dañado. Sube otra foto.';
const lee32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const lee16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

// PNG: firma, cabecera IHDR con ancho y alto, bloques completos hasta IEND
function png(b: Uint8Array): boolean {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 45 || firma.some((v, i) => b[i] !== v)) return false;
  if (ascii(b, 12, 4) !== 'IHDR' || lee32(b, 8) !== 13 || !lee32(b, 16) || !lee32(b, 20)) return false;
  let i = 8;
  while (i + 12 <= b.length) {
    const largo = lee32(b, i);
    const tipo = ascii(b, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(tipo) || i + 12 + largo > b.length) return false;
    if (tipo === 'IEND') return true;
    i += 12 + largo;
  }
  return false;
}

// JPG: marcador de inicio, un marco SOF con alto y ancho, y marcador de fin después de los datos
// (se admiten datos extra al final, como los que agregan algunas cámaras de celular)
function jpeg(b: Uint8Array): boolean {
  if (b.length < 100 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return false;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return false;
    const marca = b[i + 1];
    if (marca === 0xff) { i++; continue; }
    if (marca === 0xd9 || marca === 0xda) return false; // terminó sin dimensiones
    const largo = lee16(b, i + 2);
    if (largo < 2 || i + 2 + largo > b.length) return false;
    const sof = marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca);
    if (sof) {
      if (largo < 7 || !lee16(b, i + 5) || !lee16(b, i + 7)) return false;
      for (let j = b.length - 2; j > i + 2 + largo; j--) if (b[j] === 0xff && b[j + 1] === 0xd9) return true;
      return false;
    }
    i += 2 + largo;
  }
  return false;
}

// WEBP: contenedor RIFF/WEBP de tamaño coherente y un bloque de imagen (VP8, VP8L o VP8X) completo
function webp(b: Uint8Array): boolean {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return false;
  const riff = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  if (riff + 8 > b.length || riff < 22) return false;
  const tipo = ascii(b, 12, 4);
  const largo = (b[16] | (b[17] << 8) | (b[18] << 16) | (b[19] << 24)) >>> 0;
  if (!['VP8 ', 'VP8L', 'VP8X'].includes(tipo) || 20 + largo > b.length || largo < 5) return false;
  if (tipo === 'VP8 ') return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a && ((b[26] | (b[27] << 8)) & 0x3fff) > 0 && ((b[28] | (b[29] << 8)) & 0x3fff) > 0;
  if (tipo === 'VP8L') return b[20] === 0x2f;
  return true;
}

// Comprueba los bytes de la imagen; devuelve su formato o rechaza con un 400 claro
export function verificarBytesImagen(bytes: Uint8Array): FormatoImagen {
  if (!bytes.length) throw new ErrorHttp(400, DANADA);
  if (bytes.length > MAX_BYTES_IMAGEN) throw new ErrorHttp(400, 'La imagen pesa más de 6 MB. Sube una más liviana.');
  if (png(bytes)) return 'png';
  if (jpeg(bytes)) return 'jpeg';
  if (webp(bytes)) return 'webp';
  throw new ErrorHttp(400, DANADA);
}

// Descarga la imagen (máximo 6 MB, con tiempo límite) para revisarla
export async function descargarImagen(url: string, buscar: typeof fetch = fetch): Promise<Uint8Array> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    let respuesta: Response;
    try { respuesta = await buscar(url, { signal: control.signal, redirect: 'follow' }); }
    catch { throw new ErrorHttp(400, 'No se pudo leer la imagen en esa dirección. Vuelve a subir la foto.'); }
    if (!respuesta.ok || !respuesta.body) throw new ErrorHttp(400, 'No se pudo leer la imagen en esa dirección. Vuelve a subir la foto.');
    const declarado = Number(respuesta.headers.get('content-length'));
    if (declarado > MAX_BYTES_IMAGEN) throw new ErrorHttp(400, 'La imagen pesa más de 6 MB. Sube una más liviana.');
    const partes: Uint8Array[] = [];
    let total = 0;
    const lector = respuesta.body.getReader();
    for (;;) {
      let leido: ReadableStreamReadResult<Uint8Array>;
      try { leido = await lector.read(); }
      catch { throw new ErrorHttp(400, 'No se pudo leer la imagen en esa dirección. Vuelve a subir la foto.'); }
      if (leido.done) break;
      total += leido.value.length;
      if (total > MAX_BYTES_IMAGEN) { await lector.cancel().catch(() => {}); throw new ErrorHttp(400, 'La imagen pesa más de 6 MB. Sube una más liviana.'); }
      partes.push(leido.value);
    }
    const bytes = new Uint8Array(total);
    let i = 0;
    for (const p of partes) { bytes.set(p, i); i += p.length; }
    return bytes;
  } finally { clearTimeout(reloj); }
}

// Revisión completa de una URL de foto (las rutas /images/... del frontend no se descargan)
export async function verificarImagenRemota(urlimo: string): Promise<void> {
  if (!urlimo.startsWith('https://')) return;
  verificarBytesImagen(await descargarImagen(urlimo));
}

// Las pruebas sin red pueden reemplazar la revisión (por defecto se usa la real)
let verificador: (urlimo: string) => Promise<void> = verificarImagenRemota;
export const verificarUrlImagen = (urlimo: string) => verificador(urlimo);
export function configurarVerificadorImagen(fn?: (urlimo: string) => Promise<void>) { verificador = fn ?? verificarImagenRemota; }
