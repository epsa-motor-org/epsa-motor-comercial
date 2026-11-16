import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface RpcError { code?: string; message?: string }
interface RpcCall { name: string; args: unknown; token: string }
interface HttpResult { status: number; body: { ok?: boolean; message?: string; data?: unknown } }
interface Perfil { codusu: string; uuidusu: string; rol: 'Gerente' | 'Administradora' | 'Vendedor' }
type Resolver = (name: string, args: unknown, token: string) => { data: unknown; error: RpcError | null } | null;

const KEY = 'aa320000-0000-4000-8000-000000000001';
const perfiles: Record<string, Perfil> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  admin: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' },
  vendedor2: { codusu: '4', uuidusu: '00000000-0000-0000-0000-000000000004', rol: 'Vendedor' }
};
const solicitud = {
  coduni: 10,
  codcli: 20,
  modalidad: 'Armada',
  fecha: '2026-11-14',
  receptor: 'Comprador QA',
  documentosPendientes: false
};
const resultadoEntrega = {
  conflicto: false,
  reutilizada: false,
  estado: 'Entregada',
  entrega: { codentrega: '90', codven: '50', coduni: '10', codcli: '20', estado: 'Entregada' }
};

async function entorno(
  caso: (base: string, llamadas: RpcCall[]) => Promise<void>, resolver?: Resolver
) {
  const llamadas: RpcCall[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async () => ({ data: { user: token === 'expired' ? null : { id: perfiles[token]?.uuidusu ?? '00000000-0000-0000-0000-000000000099' } }, error: null }) },
    rpc: async (name: string, args?: unknown) => {
      if (name === 'hu007_usuario_actual')
        return { data: token === 'inactive' ? null : perfiles[token] ?? null, error: null };
      llamadas.push({ name, args: args ?? {}, token });
      const custom = resolver?.(name, args ?? {}, token);
      if (custom) return custom;
      if (name === 'hu032_consultar_entrega')
        return { data: { codven: '50', coduni: '10', codcli: '20', estadoVenta: 'Registrada',
          estado: 'Lista para entrega', entrega: null, condicionesFaltantes: [] }, error: null };
      return { data: resultadoEntrega, error: null };
    }
  } as unknown as SupabaseClient);
  const server = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await caso(base, llamadas); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function response(request: Promise<Response>): Promise<HttpResult> {
  const result = await request;
  return { status: result.status, body: await result.json() };
}

const url = (base: string, codven = '50') => `${base}/api/ventas/${codven}/entrega`;
const headers = (token = 'vendedor', key = KEY) => ({
  Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key
});

test('HU-032 HTTP: gerente, administradora y vendedor autenticados pueden registrar según la RPC', async () => entorno(async (base, llamadas) => {
  for (const token of ['gerente', 'admin', 'vendedor']) {
    const result = await response(fetch(url(base), {
      method: 'POST', headers: headers(token), body: JSON.stringify(solicitud)
    }));
    assert.equal(result.status, 201);
  }
  assert.deepEqual(llamadas.map(call => call.name), [
    'hu032_registrar_entrega', 'hu032_registrar_entrega', 'hu032_registrar_entrega'
  ]);
}));

test('HU-032 HTTP: el contrato valida y envía los parámetros canónicos, incluida la referencia de guía', async () => entorno(async (base, llamadas) => {
  const result = await response(fetch(url(base), {
    method: 'POST', headers: headers('vendedor', KEY.toUpperCase()),
    body: JSON.stringify({ ...solicitud, documentosPendientes: true,
      observacionDocumentos: 'Tarjeta y placa pendientes', referenciaGuia: 'GR-2026-44' })
  }));
  assert.equal(result.status, 201);
  assert.deepEqual(llamadas[0], {
    name: 'hu032_registrar_entrega', token: 'vendedor', args: {
      p_codven: '50', p_coduni: '10', p_codcli: '20', p_modalidad: 'Armada', p_fecha: '2026-11-14',
      p_receptor: 'Comprador QA', p_observacion: null, p_documentos_pendientes: true,
      p_observacion_documentos: 'Tarjeta y placa pendientes', p_referencia_guia: 'GR-2026-44', p_idempotencia: KEY
    }
  });
}));

test('HU-032 HTTP: validación local rechaza campos arbitrarios, datos vacíos, guía incompleta y falta de clave sin RPC', async () => entorno(async (base, llamadas) => {
  const enviar = (body: unknown, key = KEY) => response(fetch(url(base), {
    method: 'POST', headers: headers('vendedor', key), body: JSON.stringify(body)
  }));
  assert.equal((await enviar({ ...solicitud, codusu: 1 })).status, 400);
  assert.equal((await enviar({ ...solicitud, receptor: ' ' })).status, 400);
  assert.equal((await enviar({ ...solicitud, fecha: '2026-02-30' })).status, 400);
  assert.equal((await enviar({ ...solicitud, documentosPendientes: true,
    observacionDocumentos: 'Pendiente tarjeta' })).status, 400);
  assert.equal((await response(fetch(url(base), {
    method: 'POST', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json' },
    body: JSON.stringify(solicitud)
  }))).status, 400);
  assert.equal(llamadas.length, 0);
}));

test('HU-032 HTTP: replay usa 200, primer registro 201 y conflicto funcional 409', async () => {
  let turno = 0;
  await entorno(async (base, llamadas) => {
    const first = await response(fetch(url(base), { method: 'POST', headers: headers(), body: JSON.stringify(solicitud) }));
    const replay = await response(fetch(url(base), { method: 'POST', headers: headers(), body: JSON.stringify(solicitud) }));
    const conflict = await response(fetch(url(base), { method: 'POST', headers: headers('vendedor', 'bb320000-0000-4000-8000-000000000001'), body: JSON.stringify(solicitud) }));
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(conflict.status, 409);
    assert.equal((conflict.body.data as { conflicto: boolean }).conflicto, true);
    assert.equal(llamadas.length, 3);
  }, () => {
    turno += 1;
    return { data: turno === 3 ? { conflicto: true, reutilizada: false, mensaje: 'Existente', entregaExistente: resultadoEntrega.entrega }
      : { ...resultadoEntrega, reutilizada: turno === 2 }, error: null };
  });
});

test('HU-032 HTTP: consulta devuelve 200 y usa exclusivamente la RPC HU-032', async () => entorno(async (base, llamadas) => {
  const result = await response(fetch(url(base), { headers: { Authorization: 'Bearer admin' } }));
  assert.equal(result.status, 200);
  assert.equal((result.body.data as { estado: string }).estado, 'Lista para entrega');
  assert.deepEqual(llamadas, [{ name: 'hu032_consultar_entrega', token: 'admin', args: { p_codven: '50' } }]);
}));

test('HU-032 HTTP: falta de sesión, usuario inactivo y vendedor sin responsabilidad se rechazan', async () => entorno(async (base, llamadas) => {
  assert.equal((await response(fetch(url(base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(solicitud) }))).status, 401);
  assert.equal((await response(fetch(url(base), { method: 'POST', headers: headers('inactive'), body: JSON.stringify(solicitud) }))).status, 403);
  const denied = await response(fetch(url(base), {
    method: 'POST', headers: headers('vendedor2'), body: JSON.stringify(solicitud)
  }));
  assert.equal(denied.status, 403);
  assert.deepEqual(llamadas, [{ name: 'hu032_registrar_entrega', token: 'vendedor2', args: {
    p_codven: '50', p_coduni: '10', p_codcli: '20', p_modalidad: 'Armada', p_fecha: '2026-11-14',
    p_receptor: 'Comprador QA', p_observacion: null, p_documentos_pendientes: false,
    p_observacion_documentos: null, p_referencia_guia: null, p_idempotencia: KEY
  } }]);
}, name => name === 'hu032_registrar_entrega'
  ? { data: null, error: { code: 'PT697', message: 'internal responsibility detail' } }
  : null));

test('HU-032 HTTP: mapea errores de negocio sin filtrar el detalle interno', async () => {
  let index = 0;
  await entorno(async (base, llamadas) => {
  const cases = [
    ['PT694', 400], ['PT695', 404], ['PT696', 409], ['PT697', 403], ['PT698', 409], ['PT700', 409]
  ] as const;
  for (const [code, status] of cases) {
    const result = await response(fetch(url(base), { method: 'POST', headers: headers(), body: JSON.stringify(solicitud) }));
    assert.equal(result.status, status);
    assert.equal(JSON.stringify(result.body).includes('secret-db-detail'), false);
  }
  const unknown = await response(fetch(url(base), { method: 'POST', headers: headers(), body: JSON.stringify(solicitud) }));
  assert.equal(unknown.status, 500);
  assert.equal(JSON.stringify(unknown.body).includes('secret-db-detail'), false);
  assert.equal(llamadas.length, cases.length + 1);
  }, (name, _args, _token) => {
    const code = ['PT694', 'PT695', 'PT696', 'PT697', 'PT698', 'PT700', 'XX999'][Math.min(index, 6)]!;
    index += 1;
    return { data: null, error: { code, message: 'secret-db-detail' } };
  });
});
