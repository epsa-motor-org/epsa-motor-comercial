import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface RPCError { code?: string; message?: string; details?: string; hint?: string }
interface RPCResponse { data: unknown; error: RPCError | null }
interface RPCInvocation { name: string; params: Record<string, unknown>; token: string }
interface HTTPResponse { status: number; body: { ok?: boolean; message?: string; data?: Record<string, unknown> | null } }
interface Profile { codusu: string; uuidusu: string; rol: 'Gerente' | 'Administradora' | 'Vendedor' }
type Resolver = (name: string, params: Record<string, unknown>, token: string) => RPCResponse | null;

const KEY = '652fb7f9-cea8-404a-afcf-ddb82b2b8093';
const profiles: Record<string, Profile> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  admin: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' }
};
const data: Record<string, unknown> = {
  tipoOperacion: 'Separacion', codsep: '71', estado: 'Cancelada', cancelador: '3',
  fechaCancelacion: '2026-11-12T15:00:00Z', motivo: 'Solicitud del comprador',
  observacionDinero: 'Adelanto retenido hasta conciliación', estadoComercialUnidad: 'Disponible',
  unidadLiberada: true, finanzasConservadas: { adelanto: 100, totalRecibido: 100 }, reutilizada: false
};

async function entorno(caso: (base: string, llamadas: RPCInvocation[]) => Promise<void>, resolver?: Resolver) {
  const llamadas: RPCInvocation[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async () => ({ data: { user: { id: profiles[token]?.uuidusu ?? '00000000-0000-0000-0000-000000000004' } }, error: null }) },
    rpc: async (name: string, params?: Record<string, unknown>) => {
      if (name === 'hu007_usuario_actual') return { data: profiles[token] ?? null, error: null };
      const args = params ?? {};
      llamadas.push({ name, params: args, token });
      const custom = resolver?.(name, args, token);
      return custom ?? { data: { ...data, tipoOperacion: name.endsWith('separacion') ? 'Separacion' : 'Venta' }, error: null };
    },
    from: () => { throw new Error('No se permiten consultas directas a tablas'); }
  } as unknown as SupabaseClient);
  const server = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await caso(base, llamadas); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function request(base: string, path: string, token = 'vendedor', body: unknown = {
  motivo: 'Solicitud del comprador', observacionDinero: 'Adelanto retenido hasta conciliación'
}, key = KEY) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as HTTPResponse['body'] };
}

async function getRequest(base: string, path: string, token = 'vendedor') {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() as HTTPResponse['body'] };
}

test('HU-021 HTTP: gerente, administradora y vendedor llaman la RPC con clave idempotente y sin identidad del body', async () => {
  await entorno(async (base, llamadas) => {
    for (const token of ['gerente', 'admin', 'vendedor']) {
      const sep = await request(base, '/api/separaciones/71/cancelacion', token);
      assert.equal(sep.status, 200);
      const venta = await request(base, '/api/ventas/82/cancelacion', token);
      assert.equal(venta.status, 200);
    }
    assert.equal(llamadas.length, 6);
    assert.deepEqual(llamadas[0], {
      name: 'hu021_cancelar_separacion', token: 'gerente', params: {
        p_codsep: '71', p_motivo: 'Solicitud del comprador',
        p_observacion_dinero: 'Adelanto retenido hasta conciliación', p_idempotencia: KEY
      }
    });
    assert.deepEqual(llamadas[1], {
      name: 'hu021_cancelar_venta', token: 'gerente', params: {
        p_codven: '82', p_motivo: 'Solicitud del comprador',
        p_observacion_dinero: 'Adelanto retenido hasta conciliación', p_idempotencia: KEY
      }
    });
    for (const call of llamadas) {
      assert.ok(!('codusu' in call.params));
      assert.ok(!('codusuAutor' in call.params));
      assert.ok(!('autor' in call.params));
    }
  });
});

test('HU-021 HTTP: vendedor ajeno es rechazado por la RPC y errores de negocio no exponen SQL', async () => {
  await entorno(async (base, llamadas) => {
    const sep = await request(base, '/api/separaciones/71/cancelacion');
    assert.equal(sep.status, 403);
    assert.equal(sep.body.message, 'El vendedor no es el responsable comercial vigente de esta operación');
    const convertida = await request(base, '/api/separaciones/72/cancelacion');
    assert.equal(convertida.status, 409);
    const dinero = await request(base, '/api/ventas/82/cancelacion', 'vendedor');
    assert.equal(dinero.status, 422);
    assert.ok(!JSON.stringify([sep.body, convertida.body, dinero.body]).includes('detalle SQL privado'));
    assert.equal(llamadas.length, 3);
  }, (name, params) => {
    const id = name.endsWith('separacion') ? params.p_codsep : params.p_codven;
    const code = id === '71' ? 'PT652' : id === '72' ? 'PT653' : 'PT656';
    return { data: null, error: { code, message: 'detalle SQL privado', details: 'secretos', hint: 'privado' } };
  });
});

test('HU-021 HTTP: consulta log sanitizado por ambas rutas y con clave de operación', async () => {
  const log = {
    tipoOperacion: 'Separacion', codOperacion: '71', accion: 'Cancelacion',
    actor: { codusu: '3', nombre: 'Vendedor Prueba' }, fecha: '2026-11-12T15:00:00Z',
    motivo: 'Solicitud del comprador', observacionFinanciera: 'Adelanto retenido hasta conciliación',
    estadoAnterior: 'Activa', estadoResultante: 'Cancelada', estadoComercialResultante: 'Disponible'
  };
  await entorno(async (base, llamadas) => {
    const sep = await getRequest(base, '/api/separaciones/71/cancelacion', 'gerente');
    assert.equal(sep.status, 200);
    assert.deepEqual(sep.body.data, log);
    const venta = await getRequest(base, '/api/ventas/82/cancelacion', 'vendedor');
    assert.equal(venta.status, 200);
    assert.deepEqual(venta.body.data, { ...log, tipoOperacion: 'Venta', codOperacion: '82' });
    assert.equal(llamadas.length, 2);
    assert.deepEqual(llamadas.map(({ name, params }) => ({ name, params })), [
      { name: 'hu021_consultar_cancelacion_separacion', params: { p_codsep: '71' } },
      { name: 'hu021_consultar_cancelacion_venta', params: { p_codven: '82' } }
    ]);
    assert.ok(!JSON.stringify(sep.body.data).includes('payload'));
    assert.ok(!JSON.stringify(sep.body.data).includes('resultado'));
  }, (name, _params) => name.startsWith('hu021_consultar_cancelacion')
    ? { data: { ...log, tipoOperacion: name.endsWith('venta') ? 'Venta' : 'Separacion',
      codOperacion: name.endsWith('venta') ? '82' : '71' }, error: null }
    : null);
});

test('HU-021 HTTP: lectura de log requiere sesión/rol, valida identificador y maneja ausencia/error sin filtrar SQL', async () => {
  await entorno(async (base, llamadas) => {
    const sinToken = await fetch(`${base}/api/separaciones/71/cancelacion`);
    assert.equal(sinToken.status, 401);
    assert.equal((await getRequest(base, '/api/separaciones/71/cancelacion', 'auxiliar')).status, 403);
    assert.equal((await getRequest(base, '/api/separaciones/no-id/cancelacion')).status, 400);
    const sinEvento = await getRequest(base, '/api/ventas/82/cancelacion', 'admin');
    assert.equal(sinEvento.status, 200);
    assert.equal(sinEvento.body.data, null);
    const ajeno = await getRequest(base, '/api/ventas/83/cancelacion');
    assert.equal(ajeno.status, 403);
    assert.equal(ajeno.body.message, 'No tienes permisos para consultar o cancelar esta operación');
    const inexistente = await getRequest(base, '/api/separaciones/999/cancelacion', 'gerente');
    assert.equal(inexistente.status, 404);
    assert.ok(!JSON.stringify([ajeno.body, inexistente.body]).includes('detalle SQL privado'));
    assert.equal(llamadas.length, 3);
  }, (name, params) => {
    if (!name.startsWith('hu021_consultar_cancelacion')) return null;
    if (params.p_codven === '82') return { data: null, error: null };
    if (params.p_codven === '83') return { data: null, error: { code: '42501', message: 'detalle SQL privado' } };
    if (params.p_codsep === '999') return { data: null, error: { code: 'PT651', message: 'detalle SQL privado' } };
    return null;
  });
});

test('HU-021 HTTP: valida UUID, operación y body antes de llamar a la RPC', async () => {
  await entorno(async (base, llamadas) => {
    const path = '/api/separaciones/71/cancelacion';
    const sinToken = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Válido' }) });
    assert.equal(sinToken.status, 401);
    assert.equal((await request(base, path, 'auxiliar')).status, 403);
    assert.equal((await request(base, path, 'vendedor', { motivo: '' })).status, 400);
    for (const [ruta, campo] of [
      ['/api/separaciones/71/cancelacion', 'codusuresp'],
      ['/api/separaciones/71/cancelacion', 'codusuResponsable'],
      ['/api/separaciones/71/cancelacion', 'codusu'],
      ['/api/separaciones/71/cancelacion', 'codusuAutor'],
      ['/api/ventas/82/cancelacion', 'codusuresp'],
      ['/api/ventas/82/cancelacion', 'codusuResponsable'],
      ['/api/ventas/82/cancelacion', 'codusu'],
      ['/api/ventas/82/cancelacion', 'codusuAutor']
    ] as const) {
      assert.equal((await request(base, ruta, 'vendedor', { motivo: 'válido', [campo]: 3 })).status, 400,
        `${ruta} debe rechazar ${campo}`);
    }
    assert.equal((await request(base, '/api/ventas/no-es-id/cancelacion')).status, 400);
    assert.equal((await request(base, path, 'vendedor', { motivo: 'válido' }, 'no-uuid')).status, 400);
    assert.equal(llamadas.length, 0);
  });
});

test('HU-021 HTTP: replay retorna 200 reutilizada y concurrencia PostgreSQL se mapea como conflicto', async () => {
  let llamada = 0;
  await entorno(async (base, llamadas) => {
    const replay = await request(base, '/api/ventas/82/cancelacion');
    assert.equal(replay.status, 200);
    const conflicto = await request(base, '/api/ventas/82/cancelacion', 'vendedor', {
      motivo: 'Solicitud del comprador', observacionDinero: 'Adelanto retenido hasta conciliación'
    }, 'a7400f31-b6b2-4fb1-82cf-3b59f65b77b1');
    assert.equal(conflicto.status, 409);
    const deadlock = await request(base, '/api/ventas/82/cancelacion', 'vendedor', {
      motivo: 'Solicitud del comprador', observacionDinero: 'Adelanto retenido hasta conciliación'
    }, 'b7400f31-b6b2-4fb1-82cf-3b59f65b77b1');
    assert.equal(deadlock.status, 409);
    assert.equal(llamadas.length, 3);
  }, (_name, _params, _token) => llamada++ === 0
    ? { data: { ...data, tipoOperacion: 'Venta', codven: '82', reutilizada: true }, error: null }
    : { data: null, error: { code: llamada === 2 ? '40001' : '40P01', message: 'sql detail' } });
});
