import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface RespuestaRPC { data: unknown; error: { code?: string; message?: string; details?: string; hint?: string } | null }
interface LlamadaRPC { nombre: string; parametros: unknown; token: string }
interface RespuestaHTTP { status: number; body: { ok?: boolean; message?: string; data?: unknown } }
interface Perfil { codusu: string; uuidusu: string; rol: 'Gerente' | 'Administradora' | 'Vendedor' }
type Resolver = (nombre: string, parametros: unknown, token: string) => RespuestaRPC | null;

const KEY = 'd0eac3a9-4eae-47ee-b8b8-11fad1ffa91c';
const perfiles: Record<string, Perfil> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  admin: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' }
};
const requestValido = {
  codcli: 20,
  codusuResponsable: 3,
  codsedAtencion: 2,
  fechaVenta: '2026-11-09',
  modalidad: 'Crédito',
  codsedEntregaPrevista: 3,
  pagos: [],
  techo: { decision: 'Por definir' },
  comprobanteExterno: null,
  observacion: 'Atención de prueba'
};
const venta = {
  codven: '50', coduni: '10', codcli: '20', codsep: null, autor: { codusu: '3', nombre: 'QA Vendedor' },
  responsable: { codusu: '3', nombre: 'QA Vendedor' }, sedeAtencion: { codsed: '2', nombre: 'Comas' },
  sedeEntregaPrevista: { codsed: '3', nombre: 'Ventanilla' }, fechaVenta: '2026-11-09T00:00:00Z',
  modalidad: 'Crédito', precioBaseAcordado: 10000, adicionalTechoReferencial: 0,
  adicionalTechoAcordado: 0, importe: 10000, totalRecibido: 0, saldo: 10000, pagos: [],
  techo: { decision: 'Por definir', codtte: null, fecha: null, decididoPor: '3' },
  comprobanteExterno: null, observacion: 'Atención de prueba', estado: 'Registrada', reutilizada: false
};

async function entorno(
  caso: (base: string, llamadas: LlamadaRPC[], cargas: Array<{ bucket: string; ruta: string }>) => Promise<void>,
  resolver?: Resolver
) {
  const llamadas: LlamadaRPC[] = [];
  const cargas: Array<{ bucket: string; ruta: string }> = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async (recibido: string) => ({
      data: { user: recibido === 'expired' ? null : { id: perfiles[recibido]?.uuidusu ?? '00000000-0000-0000-0000-000000000004' } },
      error: recibido === 'expired' ? { message: 'token expirado interno' } : null
    }) },
    rpc: async (nombre: string, parametros?: unknown) => {
      if (nombre === 'hu007_usuario_actual')
        return { data: token === 'inactive' ? null : perfiles[token] ?? null, error: null };
      const args = parametros ?? {};
      llamadas.push({ nombre, parametros: args, token });
      const respuesta = resolver?.(nombre, args, token);
      if (respuesta) return respuesta;
      if (nombre === 'hu006_guardar_techo_venta')
        return { data: { codven: '50', decision: 'Sin techo', codtte: null, guardado: true, reutilizada: false }, error: null };
      return { data: { ...venta, autor: { codusu: perfiles[token]?.codusu ?? '0', nombre: 'QA' } }, error: null };
    },
    storage: { from: (bucket: string) => ({ upload: async (ruta: string) => {
      cargas.push({ bucket, ruta });
      return { data: { path: ruta }, error: null };
    } }) }
  } as unknown as SupabaseClient);
  const servidor = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  try { await caso(base, llamadas, cargas); }
  finally { servidor.closeAllConnections(); await new Promise<void>(resolve => servidor.close(() => resolve())); }
}

async function respuesta(fetchPromise: Promise<Response>): Promise<RespuestaHTTP> {
  const r = await fetchPromise;
  return { status: r.status, body: await r.json() };
}

test('HU-006 HTTP: registra venta directa con el rol autenticado y llama una RPC', async () => entorno(async (base, llamadas) => {
  const r = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify(requestValido)
  }));
  assert.equal(r.status, 201);
  assert.equal((r.body.data as typeof venta).codven, '50');
  assert.deepEqual(llamadas, [{
    nombre: 'hu006_crear_venta', token: 'vendedor', parametros: {
      p_coduni: '10', p_codcli: '20', p_codusuresp: '3', p_codsedatencion: '2',
      p_fecven: '2026-11-09', p_modcomven: 'Crédito', p_adicionalacordado: null,
      p_codsedentregaprevista: '3', p_pagos: [], p_techo: { decision: 'Por definir' },
      p_refcompven: null, p_feccompven: null, p_obsven: 'Atención de prueba', p_idempotenciaven: KEY
    }
  }]);
  assert.ok(!('p_codusu' in (llamadas[0]!.parametros as Record<string, unknown>)));
}));

test('HU-006 HTTP: Con techo envía solo el adicional acordado, nunca un total impuesto por el cliente', async () => entorno(async (base, llamadas) => {
  const r = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify({ ...requestValido, techo: { decision: 'Con techo', codtte: 4 }, adicionalTechoAcordado: 3250 })
  }));
  assert.equal(r.status, 201);
  assert.deepEqual((llamadas[0]!.parametros as Record<string, unknown>), {
    p_coduni: '10', p_codcli: '20', p_codusuresp: '3', p_codsedatencion: '2',
    p_fecven: '2026-11-09', p_modcomven: 'Crédito', p_adicionalacordado: 3250,
    p_codsedentregaprevista: '3', p_pagos: [], p_techo: { decision: 'Con techo', codtte: 4 },
    p_refcompven: null, p_feccompven: null, p_obsven: 'Atención de prueba', p_idempotenciaven: KEY
  });
  assert.ok(!('p_impven' in (llamadas[0]!.parametros as Record<string, unknown>)));
}));

test('HU-006 HTTP: replay devuelve 200 y la conversión puede heredar techo sin mandarlo', async () => {
  let creaciones = 0;
  await entorno(async (base, llamadas) => {
  const primera = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify({ ...requestValido, techo: undefined })
  }));
  assert.equal(primera.status, 201);
  const replay = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify({ ...requestValido, techo: undefined })
  }));
  assert.equal(replay.status, 200);
  assert.equal((replay.body.data as typeof venta).reutilizada, true);
  assert.equal(llamadas.length, 2);
    assert.equal((llamadas[0]!.parametros as Record<string, unknown>).p_techo, null);
  }, nombre => nombre === 'hu006_crear_venta'
    ? { data: { ...venta, codsep: '8', reutilizada: ++creaciones > 1 }, error: null }
    : null);
});

test('HU-006 HTTP: conversión con techo heredado envía adicionalTechoAcordado aunque techo sea null', async () => entorno(async (base, llamadas) => {
  const r = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
    body: JSON.stringify({ ...requestValido, techo: null, adicionalTechoAcordado: 175 })
  }));
  assert.equal(r.status, 201);
  assert.equal((llamadas[0]!.parametros as Record<string, unknown>).p_techo, null);
  assert.equal((llamadas[0]!.parametros as Record<string, unknown>).p_adicionalacordado, 175);
  assert.equal(llamadas.length, 1, 'la conversión solo crea mediante hu006_crear_venta; la BD hereda el techo');
}, nombre => nombre === 'hu006_crear_venta' ? { data: venta, error: null } : null));

test('HU-006 HTTP: los tres roles comerciales están permitidos; sesión ausente o rol ajeno se rechaza', async () => entorno(async (base, llamadas) => {
  for (const token of ['gerente', 'admin', 'vendedor']) {
    const r = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify(requestValido)
    }));
    assert.equal(r.status, 201);
  }
  assert.equal((await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY }, body: JSON.stringify(requestValido)
  }))).status, 401);
  assert.equal((await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { Authorization: 'Bearer auxiliar', 'Content-Type': 'application/json', 'Idempotency-Key': KEY }, body: JSON.stringify(requestValido)
  }))).status, 403);
  assert.equal(llamadas.length, 3);
}));

test('HU-006 HTTP: valida payload, techo, comprobante e Idempotency-Key antes de la RPC', async () => entorno(async (base, llamadas) => {
  const headers = { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY };
  const enviar = (body: unknown, key = KEY) => respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(body)
  }));
  assert.equal((await enviar({ ...requestValido, codusuAutor: 3 })).status, 400);
  assert.equal((await enviar({ ...requestValido, importe: 1.001 })).status, 400);
  assert.equal((await enviar({ ...requestValido, adicionalTechoAcordado: 1.001 })).status, 400);
  assert.equal((await enviar({ ...requestValido, adicionalTechoAcordado: 100000000 })).status, 400);
  assert.equal((await enviar({ ...requestValido, techo: { decision: 'Con techo' } })).status, 400);
  assert.equal((await enviar({ ...requestValido, techo: { decision: 'Con techo', codtte: 2 } })).status, 400);
  assert.equal((await enviar({ ...requestValido, comprobanteExterno: { referencia: 'FAC-1', fecha: null } })).status, 400);
  assert.equal((await enviar(requestValido, 'bad')).status, 400);
  assert.equal(llamadas.length, 0);
}));

test('HU-006 HTTP: transferencia exige gerente, referencia, evidencia y confirmación; efectivo exige observación', async () => entorno(async (base, llamadas) => {
  const headers = { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY };
  const enviar = (pago: unknown) => respuesta(fetch(`${base}/api/unidades/10/ventas`, {
    method: 'POST', headers, body: JSON.stringify({ ...requestValido, pagos: [pago] })
  }));
  assert.equal((await enviar({ monto: 100, fecha: '2026-11-09', medioPago: 'Transferencia', ingresoConfirmado: false,
    referencia: 'OP-1', rutaEvidencia: 'ventas/10/a.pdf', codusuConfirmador: 1 })).status, 422);
  assert.equal((await enviar({ monto: 100, fecha: '2026-11-09', medioPago: 'Transferencia', ingresoConfirmado: true,
    referencia: null, rutaEvidencia: null, codusuConfirmador: 1 })).status, 422);
  assert.equal((await enviar({ monto: 100, fecha: '2026-11-09', medioPago: 'Efectivo', ingresoConfirmado: true,
    observacion: null })).status, 422);
  assert.equal(llamadas.length, 0);
}));

test('HU-006 HTTP: evidencia de venta se guarda en bucket y prefijo separados de HU-005', async () => entorno(async (base, _llamadas, cargas) => {
  const form = new FormData();
  form.append('archivo', new Blob(['%PDF-1.4\ncontenido de prueba\n%%EOF'], { type: 'application/pdf' }), 'voucher.pdf');
  const r = await respuesta(fetch(`${base}/api/unidades/10/ventas/evidencia`, {
    method: 'POST', headers: { Authorization: 'Bearer vendedor' }, body: form
  }));
  assert.equal(r.status, 201);
  assert.equal(cargas.length, 1);
  assert.equal(cargas[0]!.bucket, 'ventas-evidencia');
  assert.match(cargas[0]!.ruta, /^ventas\/10\/[0-9a-f-]+\.pdf$/i);
}));

test('HU-006 HTTP: resolver techo usa solo la RPC de venta y decisiones finales distintas responden 409', async () => entorno(async (base, llamadas) => {
  const ok = await respuesta(fetch(`${base}/api/ventas/50/techo`, {
    method: 'PUT', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'Sin techo' })
  }));
  assert.equal(ok.status, 200);
  assert.deepEqual(llamadas[0], {
    nombre: 'hu006_guardar_techo_venta', token: 'vendedor',
    parametros: { p_codven: '50', p_decisiontecho: 'Sin techo', p_codtte: null, p_adicionalacordado: null }
  });
  const con = await respuesta(fetch(`${base}/api/ventas/50/techo`, {
    method: 'PUT', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'Con techo', codtte: 4, adicionalAcordado: 3200 })
  }));
  assert.equal(con.status, 200);
  assert.deepEqual(llamadas[1], {
    nombre: 'hu006_guardar_techo_venta', token: 'vendedor',
    parametros: { p_codven: '50', p_decisiontecho: 'Con techo', p_codtte: '4', p_adicionalacordado: 3200 }
  });
}, (nombre) => nombre === 'hu006_guardar_techo_venta'
  ? { data: { codven: '50', decision: 'Sin techo', codtte: null, guardado: true, reutilizada: false }, error: null }
  : null));

test('HU-006 HTTP: registra posteriormente el comprobante por la RPC y admite los tres roles', async () => entorno(async (base, llamadas) => {
  for (const token of ['gerente', 'admin', 'vendedor']) {
    const r = await respuesta(fetch(`${base}/api/ventas/50/comprobante`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ referencia: ' F001-001234 ', fecha: '2026-11-10' })
    }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { codven: '50',
      comprobanteExterno: { referencia: 'F001-001234', fecha: '2026-11-10' }, guardado: true, reutilizada: true });
  }
  assert.deepEqual(llamadas.map(llamada => ({ nombre: llamada.nombre, parametros: llamada.parametros })), [
    { nombre: 'hu006_guardar_comprobante_venta', parametros: { p_codven: '50', p_referencia: 'F001-001234', p_fecha: '2026-11-10' } },
    { nombre: 'hu006_guardar_comprobante_venta', parametros: { p_codven: '50', p_referencia: 'F001-001234', p_fecha: '2026-11-10' } },
    { nombre: 'hu006_guardar_comprobante_venta', parametros: { p_codven: '50', p_referencia: 'F001-001234', p_fecha: '2026-11-10' } }
  ]);
}, nombre => nombre === 'hu006_guardar_comprobante_venta'
  ? { data: { codven: '50', comprobanteExterno: { referencia: 'F001-001234', fecha: '2026-11-10' }, guardado: true, reutilizada: true }, error: null }
  : null));

test('HU-006 HTTP: valida el comprobante posterior y mapea conflicto sin filtrar SQL', async () => {
  await entorno(async (base, llamadas) => {
    const enviar = (body: unknown) => respuesta(fetch(`${base}/api/ventas/50/comprobante`, {
      method: 'PUT', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }));
    assert.equal((await enviar({ referencia: '  ', fecha: '2026-11-10' })).status, 400);
    assert.equal((await enviar({ referencia: 'F001-1', fecha: '2026-02-30' })).status, 400);
    assert.equal((await enviar({ referencia: 'F001-1', fecha: '2026-11-10', otraCosa: true })).status, 400);
    assert.equal(llamadas.length, 0);
  });
  await entorno(async base => {
    const r = await respuesta(fetch(`${base}/api/ventas/50/comprobante`, {
      method: 'PUT', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json' },
      body: JSON.stringify({ referencia: 'F001-DIFERENTE', fecha: '2026-11-10' })
    }));
    assert.equal(r.status, 409);
    assert.ok(!JSON.stringify(r.body).includes('detalle SQL privado'));
  }, nombre => nombre === 'hu006_guardar_comprobante_venta'
    ? { data: null, error: { code: 'PT618', message: 'detalle SQL privado' } }
    : null);
});

test('HU-006 HTTP: mapea errores de negocio y contrato sin filtrar detalles internos', async () => {
  const casos: Array<[string, number]> = [
    ['PT604', 409], ['PT605', 409], ['PT611', 409], ['PT612', 422], ['PT613', 409],
    ['PT615', 422], ['PT617', 422], ['PT618', 409], ['PT620', 422], ['PT621', 422], ['PT622', 400],
    ['22P02', 400], ['22003', 422], ['PGRST202', 503], ['XX000', 500]
  ];
  for (const [codigo, status] of casos) await entorno(async base => {
    const r = await respuesta(fetch(`${base}/api/unidades/10/ventas`, {
      method: 'POST', headers: { Authorization: 'Bearer vendedor', 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify(requestValido)
    }));
    assert.equal(r.status, status, codigo);
    assert.ok(!JSON.stringify(r.body).includes('detalle SQL privado'));
  }, nombre => nombre === 'hu006_crear_venta'
    ? { data: null, error: { code: codigo, message: 'detalle SQL privado', details: 'privado', hint: 'secreto' } }
    : null);
}
);

test('HU-006 HTTP: GET /api/ventas lista ventas reales para los tres roles y normaliza búsqueda/paginación', async () => {
  const lista = { items: [], total: 0, limite: 20, offset: 5 };
  await entorno(async (base, llamadas) => {
    for (const token of ['gerente', 'admin', 'vendedor']) {
      const r = await respuesta(fetch(`${base}/api/ventas?q=HU006-M-26&limite=20&offset=5`, {
        headers: { Authorization: `Bearer ${token}` }
      }));
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data, lista);
    }
    assert.deepEqual(llamadas, ['gerente', 'admin', 'vendedor'].map(token => ({
      nombre: 'hu006_listar_ventas', token,
      parametros: { p_busqueda: 'HU006-M-26', p_limite: 20, p_offset: 5 }
    })));
  }, nombre => nombre === 'hu006_listar_ventas' ? { data: lista, error: null } : null);
});

test('HU-006 HTTP: GET /api/ventas mantiene lista vacía como 200 y restringe autenticación y roles', async () => {
  await entorno(async base => {
    const vacia = await respuesta(fetch(`${base}/api/ventas`, { headers: { Authorization: 'Bearer vendedor' } }));
    assert.equal(vacia.status, 200);
    assert.deepEqual(vacia.body.data, { items: [], total: 0, limite: 50, offset: 0 });
    assert.equal((await respuesta(fetch(`${base}/api/ventas`))).status, 401);
    assert.equal((await respuesta(fetch(`${base}/api/ventas`, { headers: { Authorization: 'Bearer auxiliar' } }))).status, 403);
  }, nombre => nombre === 'hu006_listar_ventas'
    ? { data: { items: [], total: 0, limite: 50, offset: 0 }, error: null }
    : null);
});

test('HU-006 HTTP: GET /api/ventas valida filtros antes de RPC y no filtra errores internos', async () => {
  await entorno(async base => {
    for (const query of ['?limite=0', '?limite=101', '?offset=-1', '?q=a&q=b', '?otro=x']) {
      const r = await respuesta(fetch(`${base}/api/ventas${query}`, { headers: { Authorization: 'Bearer vendedor' } }));
      assert.equal(r.status, 400, query);
    }
  });
  await entorno(async base => {
    const r = await respuesta(fetch(`${base}/api/ventas`, { headers: { Authorization: 'Bearer vendedor' } }));
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(r.body).includes('detalle SQL privado'));
  }, nombre => nombre === 'hu006_listar_ventas'
    ? { data: null, error: { code: 'PGRST202', message: 'detalle SQL privado' } }
    : null);
});
