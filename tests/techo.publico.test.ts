import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

const filas = [
  { codtte: 1, nombre: 'Sin techo', adicionalReferencial: '0.00', sinTecho: true, reqprotte: false, interno: 'x' },
  { codtte: 3, nombre: 'Techo clásico de fibra', adicionalReferencial: 1700, sinTecho: false }
];

async function entorno(
  verificar: (base: string, llamadas: unknown[][]) => Promise<void>,
  resultado: { data: unknown; error: unknown } = { data: filas, error: null }
) {
  const llamadas: unknown[][] = [];
  const fabricaPublica = (...args: unknown[]) => {
    assert.deepEqual(args, []);
    return { rpc: async (...parametros: unknown[]) => {
      llamadas.push(parametros);
      return resultado;
    } } as unknown as SupabaseClient;
  };
  const server = crearApp(undefined, fabricaPublica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    await verificar(`http://127.0.0.1:${(server.address() as { port: number }).port}`, llamadas);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('HU-006: GET /api/techos es público y devuelve solo nombre y adicional referencial', async () => entorno(async (base, llamadas) => {
  const r = await fetch(`${base}/api/techos`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { ok: true, data: [
    { codtte: '1', nombre: 'Sin techo', adicionalReferencial: 0, sinTecho: true },
    { codtte: '3', nombre: 'Techo clásico de fibra', adicionalReferencial: 1700, sinTecho: false }
  ] });
  assert.deepEqual(llamadas, [['hu006_tipos_techo_publicos']]);
}));

test('HU-006: GET /api/techos no admite parámetros ni rutas de escritura', async () => entorno(async (base, llamadas) => {
  assert.equal((await fetch(`${base}/api/techos?esttte=false`)).status, 400);
  assert.equal((await fetch(`${base}/api/techos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  assert.deepEqual(llamadas, []);
}));

test('HU-006: un error de Supabase en techos responde genérico, sin detalles internos', async () => entorno(async base => {
  const r = await fetch(`${base}/api/techos`);
  assert.equal(r.status, 500);
  const cuerpo = await r.json() as { ok: boolean; message: string };
  assert.deepEqual(cuerpo, { ok: false, message: 'Error al consultar los tipos de techo' });
}, { data: null, error: { message: 'relation tipotecho does not exist', code: '42P01', hint: 'interno' } }));

test('HU-006: catálogo vacío devuelve data []', async () => entorno(async base => {
  const r = await fetch(`${base}/api/techos`);
  assert.deepEqual(await r.json(), { ok: true, data: [] });
}, { data: null, error: null }));
