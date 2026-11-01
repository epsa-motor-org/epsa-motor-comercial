import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

const datos = () => ({ nomlea: 'Persona QA', tellea: '987654321', codmod: '3', canlea: 'WhatsApp',
  codcwa: '1', codusu: '5', estlea: 'Nuevo', fecprosle: new Date(Date.now() + 86400000).toISOString() });
async function entorno(fn: (request: any, calls: any[]) => Promise<void>, resultado: any = {
  data: { codlea: '9223372036854775807', codmod: '3', codusu: '5', codcrelea: '1', tipreglea: 'Manual', codcli: null }, error: null
}) {
  const calls: any[] = [];
  const fabrica = (token: string) => ({
    auth: { getUser: async () => ({ data: { user: token === 'expired' ? null : { id: token } }, error: null }) },
    rpc: async (name: string, args: unknown) => {
      if (name === 'hu007_usuario_actual') return { data: token === 'inactive' ? null :
        { codusu: '1', uuidusu: token, rol: token }, error: null };
      calls.push({ name, args, token }); return resultado;
    }
  } as unknown as SupabaseClient);
  const server = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const request = async (body: unknown = datos(), role = 'Gerente') => {
    const response = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${role}` } : {}) },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  try { await fn(request, calls); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

for (const rol of ['Gerente', 'Administradora', 'Vendedor']) {
  test(`HU014 API: ${rol} registra con su JWT y responsable independiente`, async () => entorno(async (request, calls) => {
    const r = await request({ ...datos(), nomlea: '  Persona   QA ', tellea: '+51 (987) 654-321',
      orilea: null, collea: null }, rol);
    assert.equal(r.status, 201); assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.data.codlea, 'string');
    assert.equal(r.body.message, 'Lead registrado correctamente');
    assert.equal(calls[0].name, 'hu014_registrar_lead_manual');
    assert.equal(calls[0].token, rol);
    assert.equal(calls[0].args.p_codusu, '5');
    assert.equal(calls[0].args.p_nomlea, 'Persona QA');
    assert.equal(calls[0].args.p_tellea, '51987654321');
    assert.equal(calls[0].args.p_orilea, null);
    assert.equal(calls[0].args.p_collea, null);
    assert.equal(calls[0].args.p_nueva_oportunidad, false);
    assert.ok(!('p_codcrelea' in calls[0].args));
  }));
}
test('HU014 API: sesión ausente/vencida y perfil no autorizado', async () => entorno(async (request, calls) => {
  for (const [rol, status] of [['', 401], ['expired', 401], ['inactive', 403], ['Otro', 403]] as const)
    assert.equal((await request(datos(), rol)).status, status);
  assert.equal(calls.length, 0);
}));
test('HU014 API: campos mínimos obligatorios, incluido estado', async () => entorno(async (request, calls) => {
  for (const campo of ['nomlea', 'tellea', 'codmod', 'canlea', 'estlea', 'codcwa']) {
    for (const valor of [undefined, null, '']) assert.equal((await request({ ...datos(), [campo]: valor })).status, 400, campo);
  }
  assert.equal(calls.length, 0);
}));
test('HU014 API: responsable ausente/null llega como null a la RPC, que rechaza sin ausencia', async () => entorno(async (request, calls) => {
  for (const codusu of [undefined, null]) {
    const r = await request({ ...datos(), codusu });
    assert.equal(r.status, 400);
    const llamada = calls[calls.length - 1];
    assert.equal(llamada.name, 'hu014_registrar_lead_manual');
    assert.equal(llamada.args.p_codusu, null);
  }
  assert.equal(calls.length, 2);
}, { data: null, error: { code: 'PT400', message: 'Responsable o próximo seguimiento inválido' } }));
test('HU014 API: IDs, teléfono, tipos, longitudes y campos desconocidos', async () => entorno(async (request, calls) => {
  const invalidos: unknown[] = [null, [], 'texto', {},
    { ...datos(), nomlea: ' '.repeat(4) }, { ...datos(), nomlea: 'a'.repeat(151) },
    { ...datos(), canlea: 'a'.repeat(51) }, { ...datos(), orilea: 'a'.repeat(31) },
    { ...datos(), orilea: ' Manual ' }, { ...datos(), obslea: 3 }, { ...datos(), obslea: 'a'.repeat(10001) },
    ...['123', '1234567890123456', '9abc87654321', '++51987654321', '987+654321'].map(tellea => ({ ...datos(), tellea })),
    ...['codmod', 'codusu', 'codcwa', 'codsed'].flatMap(campo => ['0', '-1', '1.5', '9223372036854775808', 1.5, {}]
      .map(valor => ({ ...datos(), [campo]: valor }))),
    { ...datos(), codusu: '' },
    ...['codcrelea', 'tipreglea', 'codcli', 'modo_ausencia', 'ausencia', 'coduni', 'correo'].map(campo => ({ ...datos(), [campo]: true })),
    ...['true', 1, null].map(nueva_oportunidad => ({ ...datos(), nueva_oportunidad }))];
  for (const body of invalidos) assert.equal((await request(body)).status, 400, JSON.stringify(body));
  assert.equal(calls.length, 0);
}));
test('HU014 API: canales presencial/WhatsApp validan sus referencias y se normalizan', async () => entorno(async (request, calls) => {
  assert.equal((await request({ ...datos(), canlea: 'presencial', codsed: null })).status, 400);
  assert.equal((await request({ ...datos(), canlea: ' presencial ', codsed: '2', codcwa: null })).status, 201);
  assert.equal(calls[0].args.p_canlea, 'Presencial'); assert.equal(calls[0].args.p_codsed, '2');
  assert.equal((await request({ ...datos(), canlea: ' WHATSAPP ', orilea: 'Facebook' })).status, 201);
  assert.equal(calls[1].args.p_canlea, 'WhatsApp'); assert.equal(calls[1].args.p_orilea, 'Facebook');
  assert.equal((await request({ ...datos(), canlea: 'Llamada', codcwa: null })).status, 201);
}));
test('HU014 API: cinco colores normalizados; NULL permitido y catálogo cerrado', async () => entorno(async (request, calls) => {
  for (const color of ['Rojo', 'Azul', 'Amarillo', 'Verde', 'Negro']) {
    assert.equal((await request({ ...datos(), collea: ` ${color.toUpperCase()} ` })).status, 201);
    assert.equal(calls[calls.length - 1].args.p_collea, color);
  }
  assert.equal((await request({ ...datos(), collea: null })).status, 201);
  assert.equal((await request({ ...datos(), collea: 'Morado' })).status, 400);
}));
test('HU014 API: activos con fecha válida; Cerrado exige NULL y Convertido se rechaza', async () => entorno(async (request, calls) => {
  for (const estlea of ['Nuevo', 'Contactado', 'En seguimiento']) {
    assert.equal((await request({ ...datos(), estlea })).status, 201);
  }
  assert.equal((await request({ ...datos(), estlea: 'Cerrado', fecprosle: null })).status, 201);
  assert.equal((await request({ ...datos(), estlea: 'Cerrado', fecprosle: undefined })).status, 201);
  const previas = calls.length;
  assert.equal((await request({ ...datos(), estlea: 'Cerrado' })).status, 400);
  assert.equal(calls.length, previas);
  for (const estlea of ['Convertido', 'Inventado']) assert.equal((await request({ ...datos(), estlea })).status, 400);
}));
test('HU014 API: activos sin fecha llegan a RPC y reciben 400 por PT400 en modo normal', async () => entorno(async (request, calls) => {
  for (const estlea of ['Nuevo', 'Contactado', 'En seguimiento']) {
    for (const fecprosle of [undefined, null]) {
      const r = await request({ ...datos(), estlea, fecprosle });
      assert.equal(r.status, 400);
      assert.equal(r.body.ok, false);
      const llamada = calls[calls.length - 1];
      assert.equal(llamada.name, 'hu014_registrar_lead_manual');
      assert.equal(llamada.args.p_estlea, estlea);
      assert.equal(llamada.args.p_codusu, '5');
      assert.equal(llamada.args.p_fecprosle, null);
    }
  }
  assert.equal(calls.length, 6);
}, { data: null, error: { code: 'PT400', message: 'Responsable o próximo seguimiento inválido' } }));
test('HU014 API: HTTP permite responsable y fecha NULL; la RPC puede autorizar la ausencia futura', async () => entorno(async (request, calls) => {
  for (const estlea of ['Nuevo', 'Contactado', 'En seguimiento']) {
    const r = await request({ ...datos(), estlea, codusu: null, fecprosle: null });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.data, { codlea: '12', estlea: 'Nuevo', codusu: null, fecprosle: null });
    const llamada = calls[calls.length - 1];
    assert.equal(llamada.name, 'hu014_registrar_lead_manual');
    assert.equal(llamada.args.p_estlea, estlea);
    assert.equal(llamada.args.p_codusu, null);
    assert.equal(llamada.args.p_fecprosle, null);
  }
  assert.equal(calls.length, 3);
}, { data: { codlea: '12', estlea: 'Nuevo', codusu: null, fecprosle: null }, error: null }));
test('HU014 API: fecha futura con zona horaria explícita; rechaza fechas inválidas o pasadas', async () => entorno(async (request, calls) => {
  for (const fecprosle of ['', '2020-01-01T00:00:00Z', '2030-02-30T12:00:00Z', '2030-01-01',
    '2030-01-01T12:00:00', '2030-13-01T12:00:00Z', '2030-01-01T25:00:00Z', 123])
    assert.equal((await request({ ...datos(), fecprosle })).status, 400);
  assert.equal((await request({ ...datos(), fecprosle: '2030-01-01T15:00:00-05:00' })).status, 201);
  assert.equal(calls[0].args.p_fecprosle, '2030-01-01T20:00:00.000Z');
}));
test('HU014 API: nueva oportunidad explícita llega a RPC', async () => entorno(async (request, calls) => {
  assert.equal((await request({ ...datos(), nueva_oportunidad: true })).status, 201);
  assert.equal(calls[0].args.p_nueva_oportunidad, true);
}));
test('HU014 API: coincidencia 409 expone únicamente ID, modelo y estado', async () => entorno(async request => {
  const r = await request(); assert.equal(r.status, 409);
  assert.deepEqual(r.body.coincidencia, { codlea: '12', codmod: '3', estlea: 'En seguimiento' });
  assert.ok(!JSON.stringify(r.body).includes('privado'));
}, { data: null, error: { code: 'PT409', message: 'SQL privado', details: JSON.stringify({
  codlea: '12', codmod: '3', estlea: 'En seguimiento', tellea: 'privado', obslea: 'privado'
}) } }));
test('HU014 API: conflicto malformado no filtra details', async () => entorno(async request => {
  const r = await request(); assert.equal(r.status, 409); assert.ok(!('coincidencia' in r.body));
}, { data: null, error: { code: 'PT409', details: '{privado' } }));
for (const [code, status] of [['PT400', 400], ['PT404', 404], ['PT405', 404], ['PT406', 404],
  ['PT407', 404], ['PT422', 404], ['42501', 403], ['XX000', 500], ['23514', 400]] as const) {
  test(`HU014 API: ${code} devuelve ${status} sin errores internos`, async () => entorno(async request => {
    const r = await request(); assert.equal(r.status, status); assert.ok(!JSON.stringify(r.body).includes('privado'));
    if (code === 'PT404') assert.equal(r.body.message, 'El modelo no existe o no está publicado');
  }, { data: null, error: { code, message: 'SQL privado', details: 'detalle privado' } }));
}
