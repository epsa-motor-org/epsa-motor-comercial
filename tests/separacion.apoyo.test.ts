import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { deflateSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

// HU-005 · Endpoints de apoyo del formulario de separación: datos del formulario, comprador y captura.

interface RespuestaRPC { data: unknown; error: { code?: string; message?: string; details?: string; hint?: string } | null }
interface Llamada { nombre: string; parametros: unknown; token: string }
interface Subida { bucket: string; ruta: string; bytes: number; opciones: unknown; token: string }
interface RespuestaHTTP { status: number; body: { ok?: boolean; message?: string; data?: unknown } }
type ResolverRPC = (nombre: string, parametros: unknown) => RespuestaRPC | undefined;
type ResolverSubida = (ruta: string) => { error: unknown } | undefined;

const perfiles: Record<string, { codusu: string; uuidusu: string; rol: string }> = {
  gerente: { codusu: '4', uuidusu: '00000000-0000-0000-0000-000000000004', rol: 'Gerente' },
  administradora: { codusu: '5', uuidusu: '00000000-0000-0000-0000-000000000005', rol: 'Administradora' },
  vendedor: { codusu: '6', uuidusu: '00000000-0000-0000-0000-000000000006', rol: 'Vendedor' },
  auxiliar: { codusu: '9', uuidusu: '00000000-0000-0000-0000-000000000009', rol: 'Auxiliar' }
};

const comprador = {
  codcli: '1', codtdo: '1', tipoDocumento: 'DNI', numeroDocumento: '45879632', nombres: 'Rosa',
  apellidoPaterno: 'Quispe', apellidoMaterno: 'Huamán', telefono: '987654321', correo: null, activo: true
};

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
function pngValido(): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(Buffer.alloc(14))), bloque('IEND', new Uint8Array())]);
}
const pdfValido = () => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');

async function entorno(
  caso: (base: string, llamadas: Llamada[], subidas: Subida[]) => Promise<void>,
  resolver?: ResolverRPC,
  resolverSubida?: ResolverSubida
) {
  const llamadas: Llamada[] = [];
  const subidas: Subida[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async (recibido: string) => ({
      data: { user: recibido === 'expired' ? null : { id: perfiles[recibido]?.uuidusu ?? perfiles.auxiliar.uuidusu } },
      error: recibido === 'expired' ? { message: 'token inválido' } : null
    }) },
    rpc: async (nombre: string, parametros?: unknown) => {
      if (nombre === 'hu007_usuario_actual') return { data: perfiles[token] ?? null, error: null };
      llamadas.push({ nombre, parametros, token });
      return resolver?.(nombre, parametros) ?? { data: null, error: null };
    },
    storage: { from: (bucket: string) => ({
      upload: async (ruta: string, cuerpo: Buffer, opciones: unknown) => {
        subidas.push({ bucket, ruta, bytes: cuerpo.length, opciones, token });
        return resolverSubida?.(ruta) ?? { data: { path: ruta }, error: null };
      }
    }) },
    from: (tabla: string) => { throw new Error(`Acceso directo no permitido a ${tabla}`); }
  } as unknown as SupabaseClient);
  const servidor = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  try { await caso(base, llamadas, subidas); }
  finally { servidor.closeAllConnections(); await new Promise<void>(resolve => servidor.close(() => resolve())); }
}

async function pedir(url: string, token = 'vendedor', init: RequestInit = {}): Promise<RespuestaHTTP> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const r = await fetch(url, { ...init, headers });
  return { status: r.status, body: await r.json() };
}
const json = (cuerpo: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
});
function archivo(bytes: Buffer, tipo: string, nombre = 'captura'): RequestInit {
  const formulario = new FormData();
  formulario.append('archivo', new Blob([bytes], { type: tipo }), nombre);
  return { method: 'POST', body: formulario };
}
const errorRPC = (code: string, message = 'detalle SQL privado'): RespuestaRPC =>
  ({ data: null, error: { code, message, details: 'detalle SQL privado', hint: 'secreto' } });

test('HU-005 apoyo: formulario para los tres roles comerciales y nadie más', async () => entorno(async (base, llamadas) => {
  for (const token of ['gerente', 'administradora', 'vendedor']) {
    const r = await pedir(`${base}/api/separaciones/formulario`, token);
    assert.equal(r.status, 200);
    assert.deepEqual((r.body.data as { gerentes: unknown[] }).gerentes, [{ codusu: '4', nombre: 'Flavio' }]);
  }
  assert.equal((await pedir(`${base}/api/separaciones/formulario`, '')).status, 401);
  assert.equal((await pedir(`${base}/api/separaciones/formulario`, 'expired')).status, 401);
  assert.equal((await pedir(`${base}/api/separaciones/formulario`, 'auxiliar')).status, 403);
  assert.deepEqual(llamadas.map(l => l.nombre), Array(3).fill('hu005_formulario_separacion'));
  assert.deepEqual(llamadas.map(l => l.token), ['gerente', 'administradora', 'vendedor']);
}, () => ({
  data: { usuarioActual: { codusu: '6', rol: 'Vendedor' }, tiposDocumento: [], responsables: [],
    gerentes: [{ codusu: '4', nombre: 'Flavio' }] }, error: null
})));

test('HU-005 apoyo: ya no se busca al comprador por documento', async () => entorno(async (base, llamadas) => {
  const r = await fetch(`${base}/api/separaciones/compradores?numero=45879632`, { headers: { Authorization: 'Bearer vendedor' } });
  assert.equal(r.status, 404);
  assert.equal(llamadas.length, 0);
}));

test('HU-005 apoyo: registra comprador sin documento (201), devuelve el existente (200) y valida el cuerpo', async () => entorno(async (base, llamadas) => {
  const nuevo = { nombres: '  Rosa   María ', apellidoPaterno: 'Quispe', apellidoMaterno: 'Huamán', telefono: '987 654-321' };
  const creado = await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json(nuevo));
  assert.equal(creado.status, 201);
  assert.equal((creado.body.data as { existente: boolean }).existente, false);
  assert.deepEqual(llamadas[0], {
    nombre: 'hu005_registrar_comprador', token: 'vendedor',
    parametros: { p_nombres: 'Rosa María', p_apellido_paterno: 'Quispe', p_apellido_materno: 'Huamán', p_telefono: '987654321' }
  });
  const repetido = await pedir(`${base}/api/separaciones/compradores`, 'gerente', json({ ...nuevo, telefono: '911111111' }));
  assert.equal(repetido.status, 200);
  assert.equal((repetido.body.data as { existente: boolean }).existente, true);
  const sinMaterno = await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json({ ...nuevo, apellidoMaterno: null }));
  assert.equal(sinMaterno.status, 201);
  assert.equal((llamadas[2]!.parametros as { p_apellido_materno: unknown }).p_apellido_materno, null);

  for (const malo of [{ ...nuevo, nombres: '' }, { ...nuevo, nombres: 'R2D2' }, { ...nuevo, apellidoPaterno: null },
    { ...nuevo, apellidoPaterno: 'Q' }, { ...nuevo, apellidoMaterno: 'Huamán 3' }, { ...nuevo, codtdo: 1 },
    { ...nuevo, nombres: 'Rosa-María' }, { ...nuevo, apellidoPaterno: "O'Brien" }, { ...nuevo, apellidoMaterno: 'Huamán.' },
    { ...nuevo, nombres: 'Rosa@' }, { ...nuevo, apellidoPaterno: 'Quispe!' },
    { ...nuevo, numeroDocumento: '45879632' }, { ...nuevo, correo: 'rosa@correo.pe' }, { ...nuevo, telefono: 'x'.repeat(21) },
    { ...nuevo, telefono: '512345678' }, { ...nuevo, telefono: '98765432' }, { ...nuevo, telefono: '9876543210' },
    { ...nuevo, telefono: '999999999' }, { ...nuevo, telefono: null }, []]) {
    assert.equal((await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json(malo))).status, 400, JSON.stringify(malo));
  }
  assert.equal(llamadas.length, 3);
}, (_nombre, parametros) => ({
  data: { ...comprador, codtdo: null, tipoDocumento: null, numeroDocumento: null,
    existente: (parametros as { p_telefono: string }).p_telefono === '911111111' }, error: null
})));

test('HU-005 apoyo: los errores de la base no filtran detalles internos', async () => entorno(async base => {
  const valido = { nombres: 'Rosa', apellidoPaterno: 'Quispe', apellidoMaterno: null, telefono: '987654321' };
  const r = await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json(valido));
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'Celular inválido');
  const otro = await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json({ ...valido, telefono: '922222222' }));
  assert.equal(otro.status, 400);
  assert.equal(otro.body.message, 'Los datos del comprador no son válidos');
  const caido = await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json({ ...valido, telefono: '933333333' }));
  assert.equal(caido.status, 500);
  assert.equal(caido.body.message, 'Error interno al preparar la separación');
  assert.doesNotMatch(JSON.stringify(caido.body), /SQL privado|secreto/);
  const sinPermiso = await pedir(`${base}/api/separaciones/compradores`, 'vendedor', json({ ...valido, telefono: '944444444' }));
  assert.equal(sinPermiso.status, 403);
}, (_nombre, parametros) => {
  const telefono = (parametros as { p_telefono: string }).p_telefono;
  if (telefono === '987654321') return errorRPC('PT400', 'Celular inválido');
  if (telefono === '922222222') return errorRPC('PT400', 'detalle SQL privado');
  if (telefono === '933333333') return errorRPC('XX000');
  return errorRPC('42501');
}));

test('HU-005 apoyo: guarda la captura en la carpeta privada de la moto con nombre único', async () => entorno(async (base, _llamadas, subidas) => {
  const imagen = await pedir(`${base}/api/unidades/12/separaciones/evidencia`, 'vendedor', archivo(pngValido(), 'image/png'));
  assert.equal(imagen.status, 201);
  const datos = imagen.body.data as { rutaEvidencia: string; tipo: string; tamano: number };
  assert.match(datos.rutaEvidencia, /^separaciones\/12\/[0-9a-f-]{36}\.png$/);
  assert.equal(datos.tipo, 'image/png');
  const pdf = await pedir(`${base}/api/unidades/12/separaciones/evidencia`, 'administradora', archivo(pdfValido(), 'application/pdf'));
  assert.equal(pdf.status, 201);
  assert.match((pdf.body.data as { rutaEvidencia: string }).rutaEvidencia, /^separaciones\/12\/.+\.pdf$/);
  assert.notEqual((pdf.body.data as { rutaEvidencia: string }).rutaEvidencia, datos.rutaEvidencia);
  assert.deepEqual(subidas.map(s => [s.bucket, s.token, (s.opciones as { upsert: boolean }).upsert]),
    [['separaciones-evidencia', 'vendedor', false], ['separaciones-evidencia', 'administradora', false]]);
}));

test('HU-005 apoyo: rechaza capturas vacías, falsas, pesadas o de un rol no autorizado sin tocar Storage', async () => entorno(async (base, _llamadas, subidas) => {
  const url = `${base}/api/unidades/12/separaciones/evidencia`;
  const disfrazado = await pedir(url, 'vendedor', archivo(Buffer.from('no soy una imagen, solo texto de prueba'), 'image/png'));
  assert.equal(disfrazado.status, 400);
  assert.equal(disfrazado.body.message, 'La captura debe ser una imagen PNG, JPG o WEBP legible, o un PDF.');
  assert.equal((await pedir(url, 'vendedor', archivo(Buffer.from('%PDF-1.4 sin final'), 'application/pdf'))).status, 400);
  assert.equal((await pedir(url, 'vendedor', archivo(pngValido(), 'text/plain'))).status, 400);
  const pesado = Buffer.concat([pngValido(), Buffer.alloc(5 * 1024 * 1024)]);
  const grande = await pedir(url, 'vendedor', archivo(pesado, 'image/png'));
  assert.equal(grande.status, 400);
  assert.match(grande.body.message ?? '', /5 MB/);
  assert.equal((await pedir(url, 'vendedor', { method: 'POST', body: new FormData() })).status, 400);
  assert.equal((await pedir(`${base}/api/unidades/abc/separaciones/evidencia`, 'vendedor', archivo(pngValido(), 'image/png'))).status, 400);
  assert.equal((await pedir(url, 'auxiliar', archivo(pngValido(), 'image/png'))).status, 403);
  assert.equal((await pedir(url, '', archivo(pngValido(), 'image/png'))).status, 401);
  assert.equal(subidas.length, 0);
}));

test('HU-005 apoyo: si Storage rechaza o falla, responde claro y sin detalles internos', async () => entorno(async base => {
  const url = `${base}/api/unidades/12/separaciones/evidencia`;
  const denegado = await pedir(url, 'vendedor', archivo(pngValido(), 'image/png'));
  assert.equal(denegado.status, 403);
  const caido = await pedir(url, 'vendedor', archivo(pngValido(), 'image/png'));
  assert.equal(caido.status, 502);
  assert.equal(caido.body.message, 'No se pudo guardar la captura. Vuelve a intentarlo.');
}, undefined, (() => {
  let intento = 0;
  return () => (intento++ === 0
    ? { error: { statusCode: '403', message: 'new row violates row-level security policy' } }
    : { error: { statusCode: '500', message: 'storage caído' } });
})()));

test('HU-005 apoyo: la separación con una captura inexistente o de otra moto responde 422', async () => entorno(async base => {
  const r = await pedir(`${base}/api/unidades/12/separaciones`, 'vendedor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'a7400f31-b6b2-4fb1-82cf-3b59f65b77b1' },
    body: JSON.stringify({
      codcli: 1, codusuResponsable: 6, codusuConfirmador: 4, monto: 300, fechaPago: '2026-11-07',
      medioPago: 'Transferencia', referencia: 'OP-1', rutaEvidencia: 'separaciones/99/x.png',
      observacion: null, ingresoConfirmado: true
    })
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.message, 'La captura de la transferencia no está guardada o no corresponde a esta moto');
}, () => errorRPC('PT434', 'La captura no está guardada o no corresponde a esta moto')));

test('HU-005 apoyo: consulta la separación activa de una moto para los tres roles', async () => entorno(async (base, llamadas) => {
  for (const token of ['gerente', 'administradora', 'vendedor']) {
    const r = await pedir(`${base}/api/unidades/12/separacion`, token);
    assert.equal(r.status, 200);
    assert.equal((r.body.data as { codsep: string }).codsep, '7');
  }
  const libre = await pedir(`${base}/api/unidades/13/separacion`);
  assert.equal(libre.status, 200);
  assert.equal(libre.body.data, null);
  assert.equal((await pedir(`${base}/api/unidades/0/separacion`)).status, 400);
  assert.equal((await pedir(`${base}/api/unidades/12/separacion`, 'auxiliar')).status, 403);
  assert.equal((await pedir(`${base}/api/unidades/12/separacion`, '')).status, 401);
  assert.deepEqual(llamadas.map(l => [l.nombre, l.parametros]), [
    ['hu005_separacion_activa', { p_coduni: '12' }], ['hu005_separacion_activa', { p_coduni: '12' }],
    ['hu005_separacion_activa', { p_coduni: '12' }], ['hu005_separacion_activa', { p_coduni: '13' }]
  ]);
}, (_nombre, parametros) => ({
  data: (parametros as { p_coduni: string }).p_coduni === '12' ? { codsep: '7', coduni: '12', estado: 'Activa' } : null, error: null
})));

test('HU-005 apoyo: registra el techo que eligió el cliente de una moto separada', async () => entorno(async (base, llamadas) => {
  const url = `${base}/api/unidades/12/separacion/techo`;
  for (const token of ['gerente', 'administradora', 'vendedor']) {
    const r = await pedir(url, token, json({ codtte: 2 }));
    assert.equal(r.status, 200);
    assert.equal((r.body.data as { techo: { nombre: string } }).techo.nombre, 'Lona');
  }
  const libre = await pedir(`${base}/api/unidades/13/separacion/techo`, 'vendedor', json({ codtte: 2 }));
  assert.equal(libre.status, 409);
  assert.equal(libre.body.message, 'La moto no tiene una separación activa');
  const inactivo = await pedir(url, 'vendedor', json({ codtte: 99 }));
  assert.equal(inactivo.status, 400);
  assert.equal(inactivo.body.message, 'Tipo de techo inexistente o inactivo');
  for (const malo of [{ codtte: '2' }, { codtte: 0 }, { codtte: 2, codpro: 1 }, {}, []]) {
    assert.equal((await pedir(url, 'vendedor', json(malo))).status, 400);
  }
  assert.equal((await pedir(url, 'auxiliar', json({ codtte: 2 }))).status, 403);
  assert.equal((await pedir(url, '', json({ codtte: 2 }))).status, 401);
  assert.deepEqual(llamadas.map(l => l.parametros), [
    { p_coduni: '12', p_codtte: '2' }, { p_coduni: '12', p_codtte: '2' }, { p_coduni: '12', p_codtte: '2' },
    { p_coduni: '13', p_codtte: '2' }, { p_coduni: '12', p_codtte: '99' }
  ]);
}, (_nombre, parametros) => {
  const { p_coduni, p_codtte } = parametros as { p_coduni: string; p_codtte: string };
  if (p_coduni === '13') return errorRPC('PT409', 'La moto no tiene una separación activa');
  if (p_codtte === '99') return errorRPC('PT400', 'Tipo de techo inexistente o inactivo');
  return { data: { coduni: p_coduni, techo: { codtte: '2', nombre: 'Lona', requiereInstalacion: true }, preparacion: {} }, error: null };
}));

test('HU-005 apoyo: un adelanto mayor al precio de lista responde 422 con un mensaje claro', async () => entorno(async base => {
  const r = await pedir(`${base}/api/unidades/12/separaciones`, 'vendedor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'c9a1e6b2-3f4d-4a5b-8c7d-1e2f3a4b5c6d' },
    body: JSON.stringify({
      codcli: 1, codusuResponsable: 6, monto: 5000000, fechaPago: '2026-11-08', medioPago: 'Efectivo',
      referencia: null, rutaEvidencia: null, observacion: 'Recibido en tienda', ingresoConfirmado: true
    })
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.message, 'El adelanto no puede superar el precio de lista de la moto');
}, () => errorRPC('PT435', 'El adelanto no puede superar el precio de lista de la moto')));

test('HU-005 apoyo: una moto sin precio de lista no se separa y lo explica', async () => entorno(async base => {
  const r = await pedir(`${base}/api/unidades/12/separaciones`, 'vendedor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'd2b7f3c4-5e6a-4b7c-9d8e-2f3a4b5c6d7e' },
    body: JSON.stringify({
      codcli: 1, codusuResponsable: 6, monto: 300, fechaPago: '2026-11-08', medioPago: 'Efectivo',
      referencia: null, rutaEvidencia: null, observacion: 'Recibido en tienda', ingresoConfirmado: true
    })
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.message, 'La moto no tiene precio de lista registrado; regístralo en Modelos antes de separar');
}, () => errorRPC('PT436', 'La moto no tiene precio de lista registrado')));

test('HU-005 apoyo: una fecha de adelanto de hace más de 30 días responde 422', async () => entorno(async base => {
  const r = await pedir(`${base}/api/unidades/12/separaciones`, 'vendedor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e3c8a4d5-6f7a-4c8d-9e0f-3a4b5c6d7e8f' },
    body: JSON.stringify({
      codcli: 1, codusuResponsable: 6, monto: 300, fechaPago: '2026-01-02', medioPago: 'Efectivo',
      referencia: null, rutaEvidencia: null, observacion: 'Recibido en tienda', ingresoConfirmado: true
    })
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.message, 'La fecha del adelanto no puede ser de hace más de 30 días');
}, () => errorRPC('PT437', 'La fecha del adelanto no puede ser de hace más de 30 días')));
