import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

const resultadoAsignacion = { codlea: '10', responsableAnterior: null, responsableActual: '2', cambioRealizado: true };

async function entorno(fn: (request: (opciones?: RequestOptions) => Promise<any>, calls: any[]) => Promise<void>, respuesta?: any) {
  const calls: any[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async () => ({ data: { user: token === 'expired' ? null : { id: token } }, error: null }) },
    rpc: async (name: string, args?: unknown) => {
      if (name === 'hu007_usuario_actual') {
        const perfiles: Record<string, any> = {
          Gerente: { codusu: '1', uuidusu: 'Gerente', rol: 'Gerente' },
          Administradora: { codusu: '2', uuidusu: 'Administradora', rol: 'Administradora' },
          Vendedor: { codusu: '3', uuidusu: 'Vendedor', rol: 'Vendedor' },
          Otro: { codusu: '4', uuidusu: 'Otro', rol: 'Otro' }
        };
        return { data: token === 'inactive' ? null : perfiles[token], error: null };
      }
      calls.push({ name, args, token });
      return typeof respuesta === 'function' ? respuesta(name, args, token) : (respuesta ?? { data: [], error: null });
    }
  } as unknown as SupabaseClient);
  const server = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const request = async ({ path = '/api/leads', method = 'GET', body, token = 'Gerente' }: RequestOptions = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  try { await fn(request, calls); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

interface RequestOptions { path?: string; method?: string; body?: unknown; token?: string; }

test('HU015 HTTP: GET leads autenticado usa RPC y solo admite paginación, no filtros de identidad', async () => entorno(async (request, calls) => {
  const gerente = await request({ path: '/api/leads?limite=20&offset=10' });
  assert.equal(gerente.status, 200);
  assert.deepEqual(gerente.body, { ok: true, data: [] });
  assert.deepEqual(calls[0], { name: 'hu015_listar_leads', args: { p_limite: 20, p_offset: 10 }, token: 'Gerente' });

  const propios = await request({ path: '/api/leads', token: 'Vendedor' });
  assert.equal(propios.status, 200);
  assert.deepEqual(calls[1], { name: 'hu015_listar_leads', args: { p_limite: 50, p_offset: 0 }, token: 'Vendedor' });
  const vendedor = await request({ path: '/api/leads?codusu=1&rol=Gerente', token: 'Vendedor' });
  assert.equal(vendedor.status, 400);
  assert.equal(calls.length, 2);
}));

test('HU015 HTTP: responsables y asignación restringidos a Gerente/Administradora', async () => entorno(async (request, calls) => {
  for (const rol of ['Gerente', 'Administradora']) {
    const r = await request({ path: '/api/leads/responsables', token: rol });
    assert.equal(r.status, 200);
    assert.equal(calls.at(-1).name, 'hu015_listar_responsables');
    const cambio = await request({ path: '/api/leads/10/responsable', method: 'PATCH', token: rol,
      body: { codusuNuevo: '2', codusuEsperado: null, motivo: '  ' } });
    assert.equal(cambio.status, 200);
    assert.equal(calls.at(-1).name, 'hu015_asignar_responsable_lead');
    assert.deepEqual(calls.at(-1).args, {
      p_codlea: '10', p_codusunuevo: '2', p_codusuesperado: null, p_motivo: null
    });
    const transferencia = await request({ path: '/api/leads/10/responsable', method: 'PATCH', token: rol,
      body: { codusuNuevo: '4', codusuEsperado: '3', motivo: 'Disponibilidad' } });
    assert.equal(transferencia.status, 200);
    assert.deepEqual(calls.at(-1).args, {
      p_codlea: '10', p_codusunuevo: '4', p_codusuesperado: '3', p_motivo: 'Disponibilidad'
    });
  }
  assert.equal((await request({ path: '/api/leads/responsables', token: 'Vendedor' })).status, 403);
  assert.equal((await request({ path: '/api/leads/10/responsable', method: 'PATCH', token: 'Vendedor',
    body: { codusuNuevo: '2', codusuEsperado: null } })).status, 403);
}));

test('HU015 HTTP: valida ID, forma exacta y motivo obligatorio en transferencias', async () => entorno(async (request, calls) => {
  const invalidos = [
    { path: '/api/leads/01/responsable', body: { codusuNuevo: '2', codusuEsperado: null } },
    { path: '/api/leads/9223372036854775808/responsable', body: { codusuNuevo: '2', codusuEsperado: null } },
    { path: '/api/leads/10/responsable', body: { codusuNuevo: 2, codusuEsperado: null } },
    { path: '/api/leads/10/responsable', body: { codusuNuevo: '2' } },
    { path: '/api/leads/10/responsable', body: { codusuNuevo: '2', codusuEsperado: '1' } },
    { path: '/api/leads/10/responsable', body: { codusuNuevo: '2', codusuEsperado: '1', motivo: '  ' } },
    { path: '/api/leads/10/responsable', body: { codusuNuevo: '2', codusuEsperado: '1', motivo: 'x'.repeat(251) } },
    { path: '/api/leads/10/responsable', body: { codusuNuevo: '2', codusuEsperado: '1', motivo: 'cambio', codusuAut: '1' } }
  ];
  for (const item of invalidos) {
    assert.equal((await request({ ...item, method: 'PATCH' })).status, 400, JSON.stringify(item));
  }
  assert.equal(calls.length, 0);
}, { data: resultadoAsignacion, error: null }));

test('HU015 HTTP: asignación devuelve el resultado de la RPC y mapea conflicto esperado a 409', async () => entorno(async (request, calls) => {
  const ok = await request({ path: '/api/leads/10/responsable', method: 'PATCH',
    body: { codusuNuevo: '9', codusuEsperado: '8', motivo: '  Reorganización de cartera  ' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, data: resultadoAsignacion });
  assert.equal(calls[0].args.p_motivo, 'Reorganización de cartera');
  const repetida = await request({ path: '/api/leads/10/responsable', method: 'PATCH',
    body: { codusuNuevo: '9', codusuEsperado: '8', motivo: 'Reorganización' } });
  assert.equal(repetida.status, 200);
  assert.equal(repetida.body.data.cambioRealizado, false);
  const conflicto = await request({ path: '/api/leads/10/responsable', method: 'PATCH',
    body: { codusuNuevo: '9', codusuEsperado: '8', motivo: 'Reorganización' } });
  assert.equal(conflicto.status, 409);
  assert.deepEqual(conflicto.body, { ok: false,
    message: 'El responsable del lead cambió. Actualiza la lista e inténtalo nuevamente' });
  assert.ok(!JSON.stringify(conflicto.body).includes('SQL privado'));
}, (() => {
  let intentosAsignacion = 0;
  return (name: string) => name === 'hu015_asignar_responsable_lead' && ++intentosAsignacion === 3
    ? { data: null, error: { code: 'PT416', message: 'SQL privado', details: 'detalle privado' } }
    : { data: intentosAsignacion === 2
      ? { codlea: '10', responsableAnterior: '9', responsableActual: '9', cambioRealizado: false }
      : resultadoAsignacion, error: null };
})()));

test('HU015 HTTP: GET y PATCH requieren sesión válida; roles no autorizados reciben 403', async () => entorno(async request => {
  for (const path of ['/api/leads', '/api/leads/responsables', '/api/leads/10/responsable']) {
    const method = path.endsWith('/responsable') ? 'PATCH' : 'GET';
    const body = method === 'PATCH' ? { codusuNuevo: '2', codusuEsperado: null } : undefined;
    assert.equal((await request({ path, method, body, token: '' })).status, 401);
    assert.equal((await request({ path, method, body, token: 'expired' })).status, 401);
  }
  assert.equal((await request({ path: '/api/leads/responsables', token: 'Otro' })).status, 403);
}));

test('HU015 HTTP: errores de RPC devuelven respuestas controladas sin detalles internos', async () => {
  for (const [code, status] of [['PT400', 400], ['PT404', 404], ['PT407', 404], ['PT422', 404], ['42501', 403], ['XX000', 500]] as const) {
    await entorno(async request => {
      const r = await request({ path: '/api/leads/10/responsable', method: 'PATCH',
        body: { codusuNuevo: '2', codusuEsperado: null } });
      assert.equal(r.status, status, code);
      assert.ok(!JSON.stringify(r.body).includes('detalle privado'));
      assert.ok(!JSON.stringify(r.body).includes('SQL privado'));
    }, { data: null, error: { code, message: 'SQL privado', details: 'detalle privado' } });
  }
});
