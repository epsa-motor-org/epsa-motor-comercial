import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface Perfil { codusu: string; uuidusu: string; rol: 'Gerente' | 'Administradora' | 'Vendedor' }
interface Llamada { nombre: string; parametros: Record<string, unknown>; token: string }
interface ErrorRPC { code?: string; message?: string }
interface Respuesta { status: number; body: { ok?: boolean; message?: string; data?: unknown } }
type Resolver = (nombre: string, parametros: Record<string, unknown>, token: string) =>
  { data: unknown; error: ErrorRPC | null } | null;

const KEY = '2f39200e-3e65-4b45-8f15-359bdc44b5a1';
const perfiles: Record<string, Perfil> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  admin: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' }
};

async function entorno(
  ejecutar: (base: string, llamadas: Llamada[]) => Promise<void>, resolver?: Resolver
): Promise<void> {
  const llamadas: Llamada[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async (recibido: string) => ({
      data: { user: perfiles[recibido] ? { id: perfiles[recibido]!.uuidusu } : null }, error: null
    }) },
    rpc: async (nombre: string, parametros?: Record<string, unknown>) => {
      if (nombre === 'hu007_usuario_actual') return { data: perfiles[token] ?? null, error: null };
      const args = parametros ?? {};
      llamadas.push({ nombre, parametros: args, token });
      return resolver?.(nombre, args, token) ?? { data: { ok: true }, error: null };
    }
  } as unknown as SupabaseClient);
  const server = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await ejecutar(base, llamadas); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function leer(peticion: Promise<Response>): Promise<Respuesta> {
  const response = await peticion;
  return { status: response.status, body: await response.json() };
}

const resultado = {
  codcor: '9', tipo: 'Individual', motivo: 'Corrección revisada', actor: '1', reutilizada: false, operaciones: []
};

test('HU-022 HTTP: Gerente y Administradora pueden previsualizar y corregir; Vendedor recibe 403', async () => entorno(async (base, llamadas) => {
  for (const token of ['gerente', 'admin']) {
    const preview = await leer(fetch(`${base}/api/ventas/50/correccion-relacion`, {
      headers: { Authorization: `Bearer ${token}` }
    }));
    assert.equal(preview.status, 200);
    const correction = await leer(fetch(`${base}/api/ventas/50/correccion-relacion`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify({ motivo: 'Corrección revisada', versionEsperada: 1, codcliNuevo: 25 })
    }));
    assert.equal(correction.status, 200);
  }
  const seller = await leer(fetch(`${base}/api/ventas/50/correccion-relacion`, {
    method: 'POST', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify({ motivo: 'Aunque creó la venta', versionEsperada: 1, codcliNuevo: 25 })
  }));
  assert.equal(seller.status, 403);
  assert.equal(llamadas.filter(x => x.nombre === 'hu022_preview_correccion_venta').length, 2);
  assert.equal(llamadas.filter(x => x.nombre === 'hu022_corregir_venta').length, 2);
}, nombre => nombre === 'hu022_corregir_venta'
  ? { data: resultado, error: null }
  : nombre === 'hu022_preview_correccion_venta'
    ? { data: { venta: { codven: '50', versionRelacion: 1 }, advertencias: [] }, error: null }
    : null));

test('HU-022 HTTP: request individual aplica allowlist y envía versión/relación/idempotencia a una RPC', async () => entorno(async (base, llamadas) => {
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json', 'Idempotency-Key': KEY };
  const enviar = (body: unknown, key = KEY) => leer(fetch(`${base}/api/ventas/50/correccion-relacion`, {
    method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(body)
  }));
  assert.equal((await enviar({ motivo: 'Motivo', versionEsperada: 3, coduniNuevo: 41 })).status, 200);
  assert.deepEqual(llamadas[0], { nombre: 'hu022_corregir_venta', token: 'admin', parametros: {
    p_codven: '50', p_codcli_nuevo: null, p_coduni_nuevo: '41', p_version_esperada: 3,
    p_motivo: 'Motivo', p_idempotencia: KEY
  } });
  assert.equal((await enviar({ motivo: 'Motivo', versionEsperada: 3, codcliNuevo: 25, codusu: 1 })).status, 400);
  assert.equal((await enviar({ motivo: '  ', versionEsperada: 3, codcliNuevo: 25 })).status, 400);
  assert.equal((await leer(fetch(`${base}/api/ventas/50/correccion-relacion`, {
    method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: 'Motivo', versionEsperada: 3, codcliNuevo: 25 })
  }))).status, 400, 'Idempotency-Key obligatoria');
  assert.equal(llamadas.length, 1);
}, nombre => nombre === 'hu022_corregir_venta' ? { data: resultado, error: null } : null));

test('HU-022 HTTP: el intercambio exige exactamente dos relaciones y construye la RPC canónica', async () => entorno(async (base, llamadas) => {
  const body = { motivo: 'Intercambio confirmado', operaciones: [
    { codven: 101, versionEsperada: 2, coduniNuevo: 42 },
    { codven: 102, versionEsperada: 7, codcliNuevo: 15, coduniNuevo: 41 }
  ] };
  const response = await leer(fetch(`${base}/api/ventas/correccion-relacion/intercambio`, {
    method: 'POST', headers: { Authorization: 'Bearer gerente', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify(body)
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(llamadas[0], { nombre: 'hu022_intercambiar_ventas', token: 'gerente', parametros: {
    p_codven_a: '101', p_codcli_a_nuevo: null, p_coduni_a_nueva: '42', p_version_a: 2,
    p_codven_b: '102', p_codcli_b_nuevo: '15', p_coduni_b_nueva: '41', p_version_b: 7,
    p_motivo: 'Intercambio confirmado', p_idempotencia: KEY
  } });
  const invalido = await leer(fetch(`${base}/api/ventas/correccion-relacion/intercambio`, {
    method: 'POST', headers: { Authorization: 'Bearer gerente', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify({ motivo: 'Motivo', operaciones: [body.operaciones[0]] })
  }));
  assert.equal(invalido.status, 400);
  const preview = await leer(fetch(`${base}/api/ventas/correccion-relacion/intercambio?codvenA=101&codvenB=102`, {
    headers: { Authorization: 'Bearer admin' }
  }));
  assert.equal(preview.status, 200);
  assert.equal(llamadas.filter(x => x.nombre === 'hu022_intercambiar_ventas').length, 1);
  assert.equal(llamadas.find(x => x.nombre === 'hu022_preview_intercambio_ventas')?.parametros.p_codven_a, '101');
}, nombre => nombre === 'hu022_intercambiar_ventas'
  ? { data: { ...resultado, tipo: 'Intercambio' }, error: null }
  : nombre === 'hu022_preview_intercambio_ventas'
    ? { data: { operaciones: [], advertencias: [] }, error: null }
    : null));

test('HU-022 HTTP: consulta el historial de correcciones mediante una RPC sanitizada', async () => entorno(async (base, llamadas) => {
  const response = await leer(fetch(`${base}/api/ventas/50/correcciones-relacion`, {
    headers: { Authorization: 'Bearer admin' }
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(llamadas, [{ nombre: 'hu022_historial_venta', parametros: { p_codven: '50' }, token: 'admin' }]);
}, nombre => nombre === 'hu022_historial_venta'
  ? { data: [], error: null }
  : null));

test('HU-022 HTTP: PT687, PT693 y PT438 distinguen idempotencia y los dos conflictos de techo', async () => {
  let errorCode = 'PT683';
  await entorno(async (base) => {
  const errorRespuesta = async (code: string) => {
    errorCode = code;
    return leer(fetch(`${base}/api/ventas/77/correccion-relacion`, {
      method: 'POST', headers: { Authorization: 'Bearer gerente', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify({ motivo: 'Motivo', versionEsperada: 1, codcliNuevo: 25 })
    }));
  };
  assert.equal((await errorRespuesta('PT683')).status, 409);
  assert.equal((await errorRespuesta('PT686')).status, 403);

  const idempotencia = await errorRespuesta('PT687');
  assert.equal(idempotencia.status, 409);
  assert.equal(idempotencia.body.message, 'Idempotency-Key ya fue usada con otra corrección');

  const configuracionTecho = await errorRespuesta('PT693');
  assert.equal(configuracionTecho.status, 409);
  assert.equal(configuracionTecho.body.message, 'La configuración de techo de la unidad destino contradice el acuerdo de la venta');

  const techoInstalado = await errorRespuesta('PT438');
  assert.equal(techoInstalado.status, 409);
  assert.equal(techoInstalado.body.message, 'La unidad destino tiene un techo instalado incompatible con el acuerdo de la venta');

  assert.equal((await errorRespuesta('PT692')).status, 409);
  assert.equal((await errorRespuesta('23505')).status, 409);
  assert.equal((await errorRespuesta('40001')).status, 409);
  assert.equal((await errorRespuesta('40P01')).status, 409);
  }, nombre => nombre === 'hu022_corregir_venta' ? { data: null, error: { code: errorCode } } : null);
});
