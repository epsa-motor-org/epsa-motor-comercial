import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface Perfil {
  codusu: string;
  uuidusu: string;
  rol: 'Gerente' | 'Administradora' | 'Vendedor';
}
interface RpcError { code?: string; message?: string; details?: string; hint?: string }
interface RpcCall { name: string; args: Record<string, unknown>; token: string }
interface HttpResponse { status: number; body: { ok?: boolean; message?: string; data?: Record<string, unknown> } }
type Resolver = (name: string, args: Record<string, unknown>, token: string) => { data: unknown; error: RpcError | null } | null;

const KEY = '1a021000-0000-4000-8000-000000000021';
const perfiles: Record<string, Perfil> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  admin: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' }
};
const requestBody = {
  fechaRetorno: '2026-11-18', codubi: 2, condicion: 'Sin daños visibles', observacion: 'Retorno recibido en sede'
};
const retorno = {
  estado: 'Retornada',
  venta: { codven: '50', estado: 'Cancelada' },
  entrega: { codentrega: '90', codven: '50', coduni: '10', estado: 'Entregada' },
  retorno: { codretorno: '17', codven: '50', coduni: '10', fechaRetorno: '2026-11-18' },
  ubicacionActual: { codubi: '2', nombre: 'Ventanilla', tipo: 'Sede' },
  estadoComercialUnidad: 'Disponible', reutilizada: false
};

async function entorno(caso: (base: string, llamadas: RpcCall[]) => Promise<void>, resolver?: Resolver) {
  const llamadas: RpcCall[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async () => ({ data: { user: token === 'expired' ? null
      : { id: perfiles[token]?.uuidusu ?? '00000000-0000-0000-0000-000000000099' } }, error: null }) },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'hu007_usuario_actual') return { data: perfiles[token] ?? null, error: null };
      const params = args ?? {};
      llamadas.push({ name, args: params, token });
      const custom = resolver?.(name, params, token);
      return custom ?? { data: { ...retorno }, error: null };
    },
    from: () => { throw new Error('No se permiten consultas directas a tablas'); }
  } as unknown as SupabaseClient);
  const server = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await caso(base, llamadas); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function enviar(base: string, options: {
  token?: string; path?: string; body?: unknown; key?: string; incluirKey?: boolean
} = {}): Promise<HttpResponse> {
  const token = options.token ?? 'gerente';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.incluirKey !== false) headers['Idempotency-Key'] = options.key ?? KEY;
  const response = await fetch(`${base}${options.path ?? '/api/ventas/50/retorno'}`, {
    method: 'POST', headers, body: JSON.stringify(options.body ?? requestBody)
  });
  return { status: response.status, body: await response.json() as HttpResponse['body'] };
}

test('HU-021 retorno HTTP: solo Gerente puede llamar la RPC; admin, vendedor y anónimo quedan bloqueados', async () => entorno(async (base, llamadas) => {
  assert.equal((await enviar(base)).status, 201);
  assert.equal((await enviar(base, { token: 'admin' })).status, 403);
  assert.equal((await enviar(base, { token: 'vendedor' })).status, 403);
  const anonima = await fetch(`${base}/api/ventas/50/retorno`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY }, body: JSON.stringify(requestBody)
  });
  assert.equal(anonima.status, 401);
  assert.equal(llamadas.length, 1, 'solo la solicitud de Gerente llega a PostgreSQL');
  assert.equal(llamadas[0]!.name, 'hu021_registrar_retorno');
}));

test('HU-021 retorno HTTP: envía el contrato canónico y devuelve 201/200 según replay', async () => {
  let intento = 0;
  await entorno(async (base, llamadas) => {
    const primero = await enviar(base);
    const replay = await enviar(base);
    assert.equal(primero.status, 201);
    assert.equal(primero.body.data?.estado, 'Retornada');
    assert.equal(replay.status, 200);
    assert.equal(llamadas.length, 2);
    assert.deepEqual(llamadas[0], {
      name: 'hu021_registrar_retorno', token: 'gerente', args: {
        p_codven: '50', p_fecharetorno: '2026-11-18', p_codubi: '2',
        p_condicion: 'Sin daños visibles', p_observacion: 'Retorno recibido en sede', p_idempotencia: KEY
      }
    });
    assert.ok(!('p_codusu' in llamadas[0]!.args));
  }, () => ({ data: { ...retorno, reutilizada: intento++ > 0 }, error: null }));
});

test('HU-021 retorno HTTP: rechaza campos de identidad y datos inválidos antes de llamar la RPC', async () => entorno(async (base, llamadas) => {
  for (const body of [
    { ...requestBody, codusu: 1 }, { ...requestBody, coduni: 10 },
    { ...requestBody, estadoComercialUnidad: 'Disponible' }, { ...requestBody, registradoPor: 1 },
    { ...requestBody, fechaRetorno: '2026-02-30' }, { ...requestBody, codubi: 0 },
    { ...requestBody, condicion: ' ' }, { ...requestBody, observacion: '' }
  ]) assert.equal((await enviar(base, { body })).status, 400);
  assert.equal((await enviar(base, { incluirKey: false })).status, 400);
  assert.equal((await enviar(base, { key: 'no-uuid' })).status, 400);
  assert.equal((await enviar(base, { path: '/api/ventas/no-id/retorno' })).status, 400);
  assert.equal(llamadas.length, 0);
}));

test('HU-021 retorno HTTP: mapea errores de negocio/conflicto sin filtrar detalles SQL', async () => {
  const casos: Array<[string, number]> = [['PT701', 400], ['PT702', 404], ['PT703', 409], ['PT704', 409],
    ['PT705', 409], ['42501', 403], ['40001', 409], ['40P01', 409]];
  let turno = 0;
  await entorno(async (base, llamadas) => {
    for (const [codigo, status] of casos) {
      const result = await enviar(base);
      assert.equal(result.status, status, codigo);
      assert.ok(!JSON.stringify(result.body).includes('detalle SQL privado'));
      if (codigo === 'PT701') {
        assert.equal(result.body.message,
          'Los datos del retorno no son válidos o la ubicación no es un lugar EPSA activo para unidades');
      }
    }
    assert.equal(llamadas.length, casos.length);
  }, () => ({ data: null, error: { code: casos[turno++]?.[0], message: 'detalle SQL privado', details: 'secreto', hint: 'oculto' } }));
});
