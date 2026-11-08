import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface RespuestaRPC { data: unknown; error: { code?: string; message?: string; details?: string; hint?: string } | null }
interface LlamadaRPC { nombre: string; parametros: unknown; token: string }
interface RespuestaHTTP { status: number; body: { ok?: boolean; message?: string; data?: unknown } }
interface Perfil { codusu: string; uuidusu: string; rol: string }
type ResolverRPC = (nombre: string, parametros: unknown, token: string, indice: number) => RespuestaRPC;
type Requester = (
  body?: unknown,
  token?: string,
  headers?: Record<string, string>,
  coduni?: string
) => Promise<RespuestaHTTP>;

const clave = 'a7400f31-b6b2-4fb1-82cf-3b59f65b77b1';
const perfiles: Record<string, Perfil> = {
  gerente: { codusu: '1', uuidusu: '00000000-0000-0000-0000-000000000001', rol: 'Gerente' },
  administradora: { codusu: '2', uuidusu: '00000000-0000-0000-0000-000000000002', rol: 'Administradora' },
  vendedor: { codusu: '3', uuidusu: '00000000-0000-0000-0000-000000000003', rol: 'Vendedor' },
  auxiliar: { codusu: '4', uuidusu: '00000000-0000-0000-0000-000000000004', rol: 'Auxiliar' }
};

const requestValido = {
  codcli: 123,
  codusuResponsable: 6,
  codusuConfirmador: 1,
  monto: 250,
  fechaPago: '2026-11-06',
  medioPago: 'Transferencia',
  referencia: 'OP-123456',
  rutaEvidencia: 'hu005/evidencias/voucher.pdf',
  observacion: 'Ingreso confirmado',
  ingresoConfirmado: true
};

const separacion = {
  codsep: '123', coduni: '12', codcli: '123', codusuAutor: '1', codusuResponsable: '6',
  monto: 250, fechaPago: '2026-11-06', medioPago: 'Transferencia', referencia: 'OP-123456',
  rutaEvidencia: 'hu005/evidencias/voucher.pdf', observacion: 'Ingreso confirmado',
  ingresoConfirmado: true, confirmadoPor: '1', fechaConfirmacion: '2026-11-06T15:30:00Z',
  fechaRegistro: '2026-11-06T15:30:00Z', estado: 'Activa', reutilizada: false
};

async function entorno(
  caso: (request: Requester, llamadas: LlamadaRPC[], accesosTabla: string[]) => Promise<void>,
  resolver?: ResolverRPC
) {
  const llamadas: LlamadaRPC[] = [];
  const accesosTabla: string[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async (recibido: string) => ({
      data: { user: recibido === 'expired' ? null : { id: perfiles[recibido]?.uuidusu ?? perfiles.auxiliar.uuidusu } },
      error: recibido === 'expired' ? { message: 'token inválido privado' } : null
    }) },
    rpc: async (nombre: string, parametros?: unknown) => {
      if (nombre === 'hu007_usuario_actual')
        return { data: token === 'inactive' ? null : perfiles[token] ?? null, error: null };
      const indice = llamadas.length;
      llamadas.push({ nombre, parametros, token });
      return resolver?.(nombre, parametros, token, indice)
        ?? { data: separacion, error: null };
    },
    from: (tabla: string) => {
      accesosTabla.push(tabla);
      throw new Error(`Acceso directo no permitido a ${tabla}`);
    }
  } as unknown as SupabaseClient);
  const servidor = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => servidor.once('listening', resolve));
  const direccion = servidor.address() as AddressInfo;
  const request: Requester = async (body = requestValido, token = 'gerente', headers = { 'Idempotency-Key': clave }, coduni = '12') => {
    const respuesta = await fetch(`http://127.0.0.1:${direccion.port}/api/unidades/${coduni}/separaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: respuesta.status, body: await respuesta.json() };
  };
  try { await caso(request, llamadas, accesosTabla); }
  finally { servidor.closeAllConnections(); await new Promise<void>(resolve => servidor.close(() => resolve())); }
}

function errorRPC(code: string, message = 'detalle SQL privado'): RespuestaRPC {
  return { data: null, error: { code, message, details: 'detalle interno privado', hint: 'secreto' } };
}

test('HU-005 API: exige Bearer válido y deniega rol no autorizado', async () => entorno(async request => {
  assert.equal((await request(requestValido, '')).status, 401);
  assert.equal((await request(requestValido, 'expired')).status, 401);
  assert.equal((await request(requestValido, 'auxiliar')).status, 403);
  assert.equal((await request(requestValido, 'inactive')).status, 403);
}));

test('HU-005 API: crea transferencia y usa una única RPC con el cliente del usuario autenticado', async () => entorno(async (request, llamadas, accesosTabla) => {
  const respuesta = await request(requestValido, 'vendedor');
  assert.equal(respuesta.status, 201);
  assert.equal((respuesta.body.data as typeof separacion).codusuAutor, '3');
  assert.equal((respuesta.body.data as typeof separacion).confirmadoPor, '1');
  assert.deepEqual(llamadas, [{
    nombre: 'hu005_crear_separacion', token: 'vendedor',
    parametros: {
      p_coduni: '12', p_codcli: '123', p_codusuresp: '6', p_monadesep: 250,
      p_codusu_confirmador: '1',
      p_fecpagsep: '2026-11-06', p_metpagsep: 'Transferencia', p_refsep: 'OP-123456',
      p_rutavouchersep: 'hu005/evidencias/voucher.pdf', p_obssep: 'Ingreso confirmado',
      p_ingreso_confirmado: true, p_idempotenciasep: clave
    }
  }]);
  assert.deepEqual(accesosTabla, []);
}, (_nombre, _parametros, token) => ({
  data: { ...separacion, codusuAutor: perfiles[token]?.codusu ?? '', confirmadoPor: '1' }, error: null
})));

test('HU-005 API: Gerente y Administradora crean y el autor nunca viene del request', async () => entorno(async (request, llamadas) => {
  for (const token of ['gerente', 'administradora']) {
    const respuesta = await request(requestValido, token);
    assert.equal(respuesta.status, 201);
  }
  assert.ok(llamadas.every(llamada => llamada.nombre === 'hu005_crear_separacion'));
  assert.ok(llamadas.every(llamada => !('p_codusu' in (llamada.parametros as Record<string, unknown>))));

  for (const campo of ['codusu', 'codusuAutor', 'autor']) {
    assert.equal((await request({ ...requestValido, [campo]: 1 })).status, 400);
  }
  assert.equal(llamadas.length, 2);
}));

test('HU-005 API: efectivo válido no requiere referencia ni voucher', async () => entorno(async (request, llamadas) => {
  const respuesta = await request({
    codcli: 123, codusuResponsable: 6, monto: 250, fechaPago: '2026-11-06',
    medioPago: 'Efectivo', referencia: null, rutaEvidencia: null,
    observacion: 'Recibido en caja', ingresoConfirmado: true
  }, 'vendedor');
  assert.equal(respuesta.status, 201);
  assert.deepEqual((llamadas[0]?.parametros as Record<string, unknown>), {
    p_coduni: '12', p_codcli: '123', p_codusuresp: '6', p_monadesep: 250,
    p_codusu_confirmador: null,
    p_fecpagsep: '2026-11-06', p_metpagsep: 'Efectivo', p_refsep: null,
    p_rutavouchersep: null, p_obssep: 'Recibido en caja', p_ingreso_confirmado: true,
    p_idempotenciasep: clave
  }, (_nombre, _parametros, token) => ({
    data: { ...separacion, medioPago: 'Efectivo', codusuAutor: perfiles[token]?.codusu ?? '',
      confirmadoPor: perfiles[token]?.codusu ?? '', rutaEvidencia: null, referencia: null }, error: null
  }));
}));

test('HU-005 API: mismo Idempotency-Key devuelve HTTP 201 y luego HTTP 200 con el mismo código', async () => {
  await entorno(async request => {
    const primera = await request();
    const segunda = await request();
    assert.equal(primera.status, 201);
    assert.equal(segunda.status, 200);
    assert.equal((segunda.body.data as typeof separacion).codsep, (primera.body.data as typeof separacion).codsep);
    assert.equal((segunda.body.data as typeof separacion).reutilizada, true);
  }, (_nombre, _parametros, _token, indice) => {
    return { data: { ...separacion, reutilizada: indice > 0 }, error: null };
  });
});

test('HU-005 API: misma clave con payload distinto se traduce desde PostgreSQL a 409', async () => {
  let intentos = 0;
  await entorno(async request => {
    assert.equal((await request()).status, 201);
    assert.equal((await request({ ...requestValido, monto: 300 })).status, 409);
  }, () => ++intentos === 1
    ? { data: separacion, error: null }
    : errorRPC('PT431'));
});

test('HU-005 API: errores de concurrencia comercial se traducen a 409', async () => {
  for (const code of ['PT429', 'PT430', 'PT431', '23505', '40001', '40P01']) {
    await entorno(async request => {
      const respuesta = await request();
      assert.equal(respuesta.status, 409, code);
      assert.ok(!JSON.stringify(respuesta.body).includes('privado'));
    }, () => errorRPC(code));
  }
});

test('HU-005 API: ingreso no confirmado, efectivo sin observación y responsable inválido conservan errores esperados', async () => {
  const casos: Array<[unknown, string, number]> = [
    [{ ...requestValido, ingresoConfirmado: false }, 'PT427', 422],
    [{ ...requestValido, medioPago: 'Efectivo', referencia: null, rutaEvidencia: null, observacion: null }, 'PT428', 422],
    [requestValido, 'PT407', 422]
  ];
  for (const [body, code, status] of casos)
    await entorno(async request => assert.equal((await request(body)).status, status, code), () => errorRPC(code));
});

test('HU-005 API: transferencia sin evidencia o sin referencia llega a PostgreSQL y se rechaza', async () => {
  await entorno(async (request, llamadas) => {
    const respuesta = await request({ ...requestValido, rutaEvidencia: null });
    assert.equal(respuesta.status, 400);
    assert.equal((llamadas[0]?.parametros as Record<string, unknown>).p_rutavouchersep, null);
  }, () => errorRPC('PT400'));
  await entorno(async (request, llamadas) => {
    const respuesta = await request({ ...requestValido, referencia: null });
    assert.equal(respuesta.status, 400);
    assert.equal((llamadas[0]?.parametros as Record<string, unknown>).p_refsep, null);
  }, () => errorRPC('PT400'));
});

test('HU-005 API: unidad inexistente y comprador inexistente se traducen a 404', async () => {
  await entorno(async request => {
    assert.equal((await request(requestValido, 'gerente', { 'Idempotency-Key': clave }, '999')).status, 404);
  }, () => errorRPC('PT404'));
  await entorno(async request => {
    assert.equal((await request({ ...requestValido, codcli: 999 })).status, 404);
  }, () => errorRPC('PT404'));
});

test('HU-005 API: existencia de unidad o comprador y sus estados se traducen a respuestas controladas', async () => {
  const casos: Array<[string, number]> = [['PT404', 404], ['PT426', 422], ['PT432', 422]];
  for (const [code, status] of casos)
    await entorno(async request => {
      const respuesta = await request();
      assert.equal(respuesta.status, status, code);
      assert.ok(!JSON.stringify(respuesta.body).includes('privado'));
    }, () => errorRPC(code));
});

test('HU-005 API: valida coduni, body, tipos y fecha antes de llamar a RPC', async () => entorno(async (request, llamadas) => {
  for (const coduni of ['0', '-1', '1.5', '9223372036854775808', 'abc'])
    assert.equal((await request(requestValido, 'gerente', { 'Idempotency-Key': clave }, coduni)).status, 400);

  const invalidos: unknown[] = [
    null, [], { ...requestValido, codcli: '123' }, { ...requestValido, codcli: 0 },
    { ...requestValido, codusuResponsable: 6.5 }, { ...requestValido, monto: '250' },
    { ...requestValido, codusuConfirmador: '1' }, { ...requestValido, codusuConfirmador: 0 },
    { ...requestValido, codusuConfirmador: 1.5 }, { ...requestValido, codusuConfirmador: null },
    { ...requestValido, monto: 0 }, { ...requestValido, fechaPago: '2026-02-30' },
    { ...requestValido, medioPago: 5 }, { ...requestValido, referencia: 123 },
    { ...requestValido, rutaEvidencia: false }, { ...requestValido, observacion: 8 },
    { ...requestValido, ingresoConfirmado: 'true' }, { ...requestValido, codusuAutor: 99 }
  ];
  for (const body of invalidos) assert.equal((await request(body)).status, 400, JSON.stringify(body));
  assert.equal(llamadas.length, 0);
}));

test('HU-005 API: Idempotency-Key es obligatorio, UUID y cabecera única', async () => entorno(async (request, llamadas) => {
  assert.equal((await request(requestValido, 'gerente', {})).status, 400);
  assert.equal((await request(requestValido, 'gerente', { 'Idempotency-Key': 'no-es-uuid' })).status, 400);
  assert.equal(llamadas.length, 0);
}));

for (const [code, status] of [
  ['42501', 403], ['PT400', 400], ['PT404', 404], ['PT407', 422], ['PT426', 422],
  ['PT427', 422], ['PT428', 422], ['PT429', 409], ['PT430', 409], ['PT431', 409],
  ['PT432', 422], ['PT433', 422], ['XX000', 500]
] as const) {
  test(`HU-005 API: error RPC ${code} devuelve ${status} sin filtrar detalles`, async () => entorno(async request => {
    const respuesta = await request();
    assert.equal(respuesta.status, status);
    assert.ok(!JSON.stringify(respuesta.body).includes('privado'));
    assert.ok(!JSON.stringify(respuesta.body).includes('secreto'));
  }, () => errorRPC(code)));
}
