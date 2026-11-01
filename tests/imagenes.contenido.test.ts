import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deflateSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';
import { descargarImagen, MAX_BYTES_IMAGEN, verificarBytesImagen } from '../src/utils/imagen.contenido';
import { ErrorHttp } from '../src/utils/errores';

// --- Imágenes de prueba reales (generadas aquí, sin archivos externos) ---
function crc32(datos: Uint8Array): number {
  let c = ~0;
  for (const b of datos) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function bloque(tipo: string, datos: Uint8Array): Buffer {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), Buffer.from(datos)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
function pngValido(ancho = 2, alto = 2): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloque('IHDR', ihdr), bloque('IDAT', deflateSync(filas)), bloque('IEND', new Uint8Array())]);
}
function jpegValido(): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(1)];
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x00];
  return Buffer.from([0xff, 0xd8, ...app0, ...dqt, ...sof, ...sos, 0xff, 0xd9]);
}
function webpValido(): Buffer {
  const vp8l = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08, 0x00, 0x00]);
  const riff = Buffer.alloc(4); riff.writeUInt32LE(4 + 8 + vp8l.length);
  const largo = Buffer.alloc(4); largo.writeUInt32LE(vp8l.length);
  return Buffer.concat([Buffer.from('RIFF'), riff, Buffer.from('WEBPVP8L'), largo, vp8l]);
}
const rechaza400 = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof ErrorHttp && e.status === 400);

test('HU-036: acepta PNG, JPG y WEBP legibles', () => {
  assert.equal(verificarBytesImagen(pngValido()), 'png');
  assert.equal(verificarBytesImagen(jpegValido()), 'jpeg');
  assert.equal(verificarBytesImagen(webpValido()), 'webp');
});

test('HU-036: rechaza texto, tipo falso, archivos cortados y vacíos', () => {
  rechaza400(() => verificarBytesImagen(new TextEncoder().encode('esto es texto de prueba, no una imagen PNG')));
  rechaza400(() => verificarBytesImagen(new Uint8Array()));
  rechaza400(() => verificarBytesImagen(Buffer.from('GIF89a' + ' '.repeat(80))));
  rechaza400(() => verificarBytesImagen(Buffer.from('%PDF-1.7\n' + ' '.repeat(200))));
  const png = pngValido();
  rechaza400(() => verificarBytesImagen(png.subarray(0, png.length - 20))); // sin bloque final
  const malo = Buffer.from(png); malo.write('XXXX', 12, 'ascii'); // cabecera IHDR dañada
  rechaza400(() => verificarBytesImagen(malo));
  const jpg = jpegValido();
  rechaza400(() => verificarBytesImagen(jpg.subarray(0, jpg.length - 2))); // sin marcador de fin
  assert.equal(verificarBytesImagen(Buffer.concat([jpg, Buffer.from('datos extra de la cámara')])), 'jpeg'); // con datos al final
  rechaza400(() => verificarBytesImagen(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('texto con firma PNG falsa'.repeat(3))])));
});

test('HU-036: rechaza imágenes de más de 6 MB', () => {
  rechaza400(() => verificarBytesImagen(new Uint8Array(MAX_BYTES_IMAGEN + 1)));
});

test('HU-036: descarga con límite y falla de forma controlada', async () => {
  const servidor = createServer((req, res) => {
    if (req.url === '/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(pngValido()); return; }
    if (req.url === '/grande') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.alloc(MAX_BYTES_IMAGEN + 10)); return; }
    res.writeHead(404); res.end();
  }).listen(0, '127.0.0.1');
  await new Promise<void>(r => servidor.once('listening', r));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  try {
    assert.equal(verificarBytesImagen(await descargarImagen(`${base}/ok.png`)), 'png');
    await assert.rejects(descargarImagen(`${base}/grande`), (e: unknown) => e instanceof ErrorHttp && e.status === 400 && /6 MB/.test(e.message));
    await assert.rejects(descargarImagen(`${base}/no-existe.png`), (e: unknown) => e instanceof ErrorHttp && e.status === 400);
    await assert.rejects(descargarImagen('http://127.0.0.1:1/caido.png'), (e: unknown) => e instanceof ErrorHttp && e.status === 400);
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>(r => servidor.close(() => r()));
  }
});

// --- La API no registra una imagen dañada (POST) ni reemplaza la anterior por una dañada (PUT) ---
test('HU-036: la API rechaza el archivo dañado sin llamar a la base; acepta el válido', async () => {
  const archivos: Record<string, Buffer> = {
    '/storage/v1/object/public/modelos/18/danada.png': Buffer.from('texto de prueba, no una imagen PNG decodificable'),
    '/storage/v1/object/public/modelos/18/buena.png': pngValido()
  };
  const storage = createServer((req, res) => {
    const archivo = archivos[req.url ?? ''];
    if (!archivo) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(archivo);
  }).listen(0, '127.0.0.1');
  await new Promise<void>(r => storage.once('listening', r));
  const puerto = (storage.address() as AddressInfo).port;
  // La API solo admite https: se redirige la descarga al servidor local de prueba
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    return fetchOriginal(url.startsWith('https://storage.test/') ? url.replace('https://storage.test/', `http://127.0.0.1:${puerto}/`) : entrada, init);
  }) as typeof fetch;
  const llamadas: string[] = [];
  const fabricaPrivada = () => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-0000-0000-000000000001' } }, error: null }) },
    rpc: async (nombre: string) => {
      if (nombre === 'hu007_usuario_actual') return { data: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' }, error: null };
      llamadas.push(nombre);
      return { data: { codimo: '30', codmod: '18', urlimo: 'ok', ordimo: 2, estimo: true }, error: null };
    }
  }) as unknown as SupabaseClient;
  const app = crearApp(fabricaPrivada, () => ({ rpc: async () => ({ data: [], error: null }) }) as unknown as SupabaseClient).listen(0, '127.0.0.1');
  await new Promise<void>(r => app.once('listening', r));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/modelos`;
  const headers = { Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json' };
  try {
    const danada = await fetchOriginal(`${base}/18/imagenes`, { method: 'POST', headers, body: JSON.stringify({ urlimo: 'https://storage.test/storage/v1/object/public/modelos/18/danada.png', ordimo: 2 }) });
    assert.equal(danada.status, 400);
    assert.match((await danada.json()).message, /no es una imagen PNG, JPG o WEBP válida/);
    const reemplazo = await fetchOriginal(`${base}/18/imagenes/30`, { method: 'PUT', headers, body: JSON.stringify({ urlimo: 'https://storage.test/storage/v1/object/public/modelos/18/danada.png', ordimo: 1 }) });
    assert.equal(reemplazo.status, 400);
    const caida = await fetchOriginal(`${base}/18/imagenes`, { method: 'POST', headers, body: JSON.stringify({ urlimo: 'https://storage.test/storage/v1/object/public/modelos/18/no-subida.png', ordimo: 2 }) });
    assert.equal(caida.status, 400);
    assert.deepEqual(llamadas, [], 'con un archivo dañado no se llama a la base');
    const buena = await fetchOriginal(`${base}/18/imagenes`, { method: 'POST', headers, body: JSON.stringify({ urlimo: 'https://storage.test/storage/v1/object/public/modelos/18/buena.png', ordimo: 2 }) });
    assert.equal(buena.status, 201);
    assert.deepEqual(llamadas, ['hu012_agregar_imagen_modelo']);
  } finally {
    globalThis.fetch = fetchOriginal;
    app.closeAllConnections(); storage.closeAllConnections();
    await new Promise<void>(r => app.close(() => r()));
    await new Promise<void>(r => storage.close(() => r()));
  }
});
