import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

// Complemento del 10 de noviembre: consulta de la venta de una moto (HU-006) y errores controlados de la
// separación (HU-005: adelanto mínimo, montos fuera de rango y base desactualizada sin error 500).

interface RespuestaRPC { data: unknown; error: { code?: string; message?: string } | null }
interface LlamadaRPC { nombre: string; parametros: unknown; token: string }
interface Perfil { codusu: string; uuidusu: string; rol: string }
type Resolver = (nombre: string, parametros: unknown) => RespuestaRPC | null;

const perfiles: Record<string, Perfil> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  admin: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' },
  auxiliar: { codusu: '4', uuidusu: '00000000-0000-0000-0000-000000000004', rol: 'Auxiliar' }
};
const ventaDeUnidad = {
  codven: '50', coduni: '10', codcli: '20', codsep: '7', importe: 17199, totalRecibido: 17199, saldo: 0,
  modalidad: 'Contado', pagos: [], techo: { decision: 'Con techo', codtte: '2', fecha: null, decididoPor: '3' },
  comprador: { codcli: '20', nombres: 'Rosa María', apellidoPaterno: 'Quispe', telefono: '987654321' },
  techoNombre: 'Lona', adelantoSeparacion: { codsep: '7', monto: 3000 }
};
const separacionValida = {
  codcli: 20, codusuResponsable: 3, monto: 300, fechaPago: '2026-11-10', medioPago: 'Efectivo',
  referencia: null, rutaEvidencia: null, observacion: 'Recibido en caja', ingresoConfirmado: true,
  techo: { decision: 'Por definir' }
};

async function entorno(caso: (base: string, llamadas: LlamadaRPC[]) => Promise<void>, resolver?: Resolver) {
  const llamadas: LlamadaRPC[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async (recibido: string) => ({ data: { user: { id: perfiles[recibido]?.uuidusu ?? '00000000-0000-0000-0000-000000000009' } }, error: null }) },
    rpc: async (nombre: string, parametros?: unknown) => {
      if (nombre === 'hu007_usuario_actual') return { data: perfiles[token] ?? null, error: null };
      llamadas.push({ nombre, parametros: parametros ?? {}, token });
      return resolver?.(nombre, parametros ?? {}) ?? { data: null, error: null };
    }
  } as unknown as SupabaseClient);
  const servidor = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  try { await caso(base, llamadas); }
  finally { servidor.closeAllConnections(); await new Promise<void>(resolve => servidor.close(() => resolve())); }
}
const leer = async (r: Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json() as { ok?: boolean; message?: string; data?: unknown } }; };

test('HU-006 HTTP: consulta la venta de una moto con la sesión del usuario y una sola RPC', async () => entorno(async (base, llamadas) => {
  const r = await leer(fetch(`${base}/api/unidades/10/venta`, { headers: { Authorization: 'Bearer vendedor' } }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, ventaDeUnidad);
  assert.deepEqual(llamadas, [{ nombre: 'hu006_venta_de_unidad', parametros: { p_coduni: '10' }, token: 'vendedor' }]);
}, nombre => (nombre === 'hu006_venta_de_unidad' ? { data: ventaDeUnidad, error: null } : null)));

test('HU-006 HTTP: una moto sin venta devuelve null; identificador inválido 400 sin llamar a la base', async () => entorno(async (base, llamadas) => {
  const sinVenta = await leer(fetch(`${base}/api/unidades/11/venta`, { headers: { Authorization: 'Bearer admin' } }));
  assert.equal(sinVenta.status, 200);
  assert.equal(sinVenta.body.data, null);
  for (const malo of ['0', '-1', 'abc', '1.5']) {
    const r = await leer(fetch(`${base}/api/unidades/${malo}/venta`, { headers: { Authorization: 'Bearer admin' } }));
    assert.equal(r.status, 400, malo);
  }
  assert.equal(llamadas.length, 1);
}));

test('HU-006 HTTP: la consulta de la venta exige sesión y rol comercial', async () => entorno(async (base, llamadas) => {
  assert.equal((await leer(fetch(`${base}/api/unidades/10/venta`))).status, 401);
  assert.equal((await leer(fetch(`${base}/api/unidades/10/venta`, { headers: { Authorization: 'Bearer auxiliar' } }))).status, 403);
  for (const token of ['gerente', 'admin', 'vendedor'])
    assert.equal((await leer(fetch(`${base}/api/unidades/10/venta`, { headers: { Authorization: `Bearer ${token}` } }))).status, 200);
  assert.equal(llamadas.length, 3);
}));

test('HU-006 HTTP: errores de la consulta controlados y sin detalles internos', async () => {
  for (const [codigo, status] of [['42501', 403], ['PT600', 400], ['PGRST202', 503], ['XX000', 500]] as const) {
    await entorno(async base => {
      const r = await leer(fetch(`${base}/api/unidades/10/venta`, { headers: { Authorization: 'Bearer vendedor' } }));
      assert.equal(r.status, status, codigo);
      assert.ok(!String(r.body.message).includes('detalle privado'));
    }, () => ({ data: null, error: { code: codigo, message: 'detalle privado' } }));
  }
});

test('HU-005 HTTP: adelanto mínimo, monto fuera de rango y base sin la RPC se responden sin error 500', async () => {
  const casos: Array<[string, number, RegExp]> = [
    ['PT442', 422, /mínimo es S\/ 100\.00/], ['22003', 422, /excede el rango/], ['22P02', 400, /formato inválido/],
    ['PGRST202', 503, /falta actualizar la base/], ['PT435', 422, /precio de lista/]
  ];
  for (const [codigo, status, mensaje] of casos) {
    await entorno(async base => {
      const r = await leer(fetch(`${base}/api/unidades/12/separaciones`, {
        method: 'POST',
        headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': 'a7400f31-b6b2-4fb1-82cf-3b59f65b77b1' },
        body: JSON.stringify(separacionValida)
      }));
      assert.equal(r.status, status, codigo);
      assert.match(String(r.body.message), mensaje);
      assert.ok(!String(r.body.message).includes('detalle SQL'));
    }, nombre => (nombre === 'hu005_crear_separacion' ? { data: null, error: { code: codigo, message: 'detalle SQL privado' } } : null));
  }
});
