import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

interface RespuestaRPC { data: unknown; error: { code?: string; message?: string; details?: string; hint?: string } | null }
interface LlamadaRPC { nombre: string; parametros: unknown; token: string }
interface RespuestaHTTP { status: number; body: { ok?: boolean; message?: string; data?: unknown; warning?: { code?: string; message?: string } } }
interface Perfil { codusu: string; uuidusu: string; rol: string }
type ResolverRPC = (nombre: string, parametros: unknown, token: string, indice: number) => RespuestaRPC;
type Requester = (
  body?: unknown,
  token?: string,
  headers?: Record<string, string>,
  coduni?: string,
  method?: 'POST' | 'PUT'
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
  ingresoConfirmado: true,
  techo: { decision: 'Con techo', codtte: 2 }
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
      const personalizada = resolver?.(nombre, parametros, token, indice);
      if (personalizada) return personalizada;
      if (nombre === 'hu005_guardar_techo_separacion')
        return { data: { codsep: '123', decision: 'Con techo', codtte: '2', guardado: true, reutilizada: false }, error: null };
      return { data: { ...separacion, techo: { decision: 'Con techo', codtte: '2', guardado: false } }, error: null };
    },
    from: (tabla: string) => {
      accesosTabla.push(tabla);
      throw new Error(`Acceso directo no permitido a ${tabla}`);
    }
  } as unknown as SupabaseClient);
  const servidor = crearApp(fabrica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => servidor.once('listening', resolve));
  const direccion = servidor.address() as AddressInfo;
  const request: Requester = async (body = requestValido, token = 'gerente', headers, codsep = '12', method = 'POST') => {
    const cabeceras = headers ?? (method === 'POST' ? { 'Idempotency-Key': clave } : {});
    const path = method === 'PUT'
      ? `/api/separaciones/${codsep}/techo`
      : `/api/unidades/${codsep}/separaciones`;
    const respuesta = await fetch(`http://127.0.0.1:${direccion.port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cabeceras },
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

test('HU-005 API: crea transferencia y persiste techo con dos RPC del usuario autenticado', async () => entorno(async (request, llamadas, accesosTabla) => {
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
      p_ingreso_confirmado: true, p_idempotenciasep: clave,
      p_decisiontecho: 'Con techo', p_codttecomsep: '2'
    }
  }, {
    nombre: 'hu005_guardar_techo_separacion', token: 'vendedor',
    parametros: { p_codsep: '123', p_decisiontecho: 'Con techo', p_codttecomsep: '2' }
  }]);
  assert.deepEqual(accesosTabla, []);
}, (nombre, _parametros, token) => nombre === 'hu005_guardar_techo_separacion'
  ? { data: { codsep: '123', decision: 'Con techo', codtte: '2', guardado: true, reutilizada: false }, error: null }
  : { data: { ...separacion, codusuAutor: perfiles[token]?.codusu ?? '', confirmadoPor: '1' }, error: null }));

test('HU-005 API: Gerente y Administradora crean y el autor nunca viene del request', async () => entorno(async (request, llamadas) => {
  for (const token of ['gerente', 'administradora']) {
    const respuesta = await request(requestValido, token);
    assert.equal(respuesta.status, 201);
  }
  const creaciones = llamadas.filter(llamada => llamada.nombre === 'hu005_crear_separacion');
  assert.equal(creaciones.length, 2);
  assert.ok(creaciones.every(llamada => !('p_codusu' in (llamada.parametros as Record<string, unknown>))));

  for (const campo of ['codusu', 'codusuAutor', 'autor']) {
    assert.equal((await request({ ...requestValido, [campo]: 1 })).status, 400);
  }
  assert.equal(llamadas.filter(llamada => llamada.nombre === 'hu005_crear_separacion').length, 2);
}));

test('HU-005 API: efectivo válido no requiere referencia ni voucher', async () => entorno(async (request, llamadas) => {
  const respuesta = await request({
    codcli: 123, codusuResponsable: 6, monto: 250, fechaPago: '2026-11-06',
    medioPago: 'Efectivo', referencia: null, rutaEvidencia: null,
    observacion: 'Recibido en caja', ingresoConfirmado: true,
    techo: { decision: 'Sin techo' }
  }, 'vendedor');
  assert.equal(respuesta.status, 201);
  assert.deepEqual((llamadas[0]?.parametros as Record<string, unknown>), {
    p_coduni: '12', p_codcli: '123', p_codusuresp: '6', p_monadesep: 250,
    p_codusu_confirmador: null,
    p_fecpagsep: '2026-11-06', p_metpagsep: 'Efectivo', p_refsep: null,
    p_rutavouchersep: null, p_obssep: 'Recibido en caja', p_ingreso_confirmado: true,
    p_idempotenciasep: clave, p_decisiontecho: 'Sin techo', p_codttecomsep: null
  });
  assert.ok(llamadas.some(llamada => llamada.nombre === 'hu005_guardar_techo_separacion'));
}));

test('HU-005 API: mismo Idempotency-Key devuelve HTTP 201 y luego HTTP 200 con el mismo código', async () => {
  await entorno(async request => {
    const primera = await request();
    const segunda = await request();
    assert.equal(primera.status, 201);
    assert.equal(segunda.status, 200);
    assert.equal((segunda.body.data as typeof separacion).codsep, (primera.body.data as typeof separacion).codsep);
    assert.equal((segunda.body.data as typeof separacion).reutilizada, true);
  }, (nombre, _parametros, _token, indice) => {
    return nombre === 'hu005_guardar_techo_separacion'
      ? { data: { codsep: '123', decision: 'Con techo', codtte: '2', guardado: true, reutilizada: indice > 0 }, error: null }
      : { data: { ...separacion, reutilizada: indice > 1 }, error: null };
  });
});

test('HU-005 API: misma clave con payload distinto se traduce desde PostgreSQL a 409', async () => {
  let intentos = 0;
  await entorno(async request => {
    assert.equal((await request()).status, 201);
    assert.equal((await request({ ...requestValido, monto: 300 })).status, 409);
  }, (nombre) => nombre === 'hu005_crear_separacion'
    ? ++intentos === 1 ? { data: separacion, error: null } : errorRPC('PT431')
    : { data: { codsep: '123', decision: 'Con techo', codtte: '2', guardado: true, reutilizada: false }, error: null });
});

test('HU-005 API: el precio de lista limita el adelanto en PostgreSQL y se expone como 422', async () => entorno(async (request, llamadas) => {
  const respuesta = await request({ ...requestValido, monto: 250.01 });
  assert.equal(respuesta.status, 422);
  assert.equal(llamadas[0]?.nombre, 'hu005_crear_separacion');
  assert.equal((llamadas[0]?.parametros as Record<string, unknown>).p_monadesep, 250.01);
  assert.ok(!JSON.stringify(respuesta.body).includes('privado'));
}, () => errorRPC('PT435')));

test('HU-005 API: adelanto mínimo de S/ 100 rechaza 99.99 y acepta 100.00 y 100.01', async () => entorno(async (request, llamadas) => {
  const menor = await request({ ...requestValido, monto: 99.99 });
  assert.equal(menor.status, 422);
  assert.equal(llamadas.length, 0, 'la validación HTTP corta antes de la RPC');

  assert.equal((await request({ ...requestValido, monto: 100 })).status, 201);
  assert.equal((await request({ ...requestValido, monto: 100.01 })).status, 201);
  const creaciones = llamadas.filter(llamada => llamada.nombre === 'hu005_crear_separacion');
  assert.deepEqual(creaciones.map(llamada => (llamada.parametros as Record<string, unknown>).p_monadesep), [100, 100.01]);
}, (nombre, parametros) => nombre === 'hu005_guardar_techo_separacion'
  ? { data: { codsep: '123', decision: (parametros as Record<string, string>).p_decisiontecho, codtte: '2', guardado: true, reutilizada: false }, error: null }
  : { data: { ...separacion, techo: { decision: 'Con techo', codtte: '2', guardado: true } }, error: null }));

test('HU-005 API: acepta las tres decisiones válidas y valida el tipo antes de crear', async () => entorno(async (request, llamadas) => {
  for (const techo of [{ decision: 'Por definir' }, { decision: 'Sin techo' }, { decision: 'Con techo', codtte: 2 }]) {
    const respuesta = await request({ ...requestValido, techo });
    assert.equal(respuesta.status, 201);
    if (techo.decision === 'Por definir') {
      assert.deepEqual((respuesta.body.data as typeof separacion & { techo: unknown }).techo,
        { decision: 'Por definir', codtte: null, guardado: true });
      assert.equal(respuesta.body.warning, undefined,
        'Por definir correctamente guardado no es un fallo técnico pendiente');
    }
  }
  const creaciones = llamadas.filter(llamada => llamada.nombre === 'hu005_crear_separacion');
  assert.deepEqual(creaciones.map(llamada => {
    const parametros = llamada.parametros as Record<string, unknown>;
    return [parametros.p_decisiontecho, parametros.p_codttecomsep];
  }), [['Por definir', null], ['Sin techo', null], ['Con techo', '2']]);
}, (nombre, parametros) => nombre === 'hu005_guardar_techo_separacion'
  ? { data: { codsep: '123', decision: (parametros as Record<string, string>).p_decisiontecho, codtte: null, guardado: true, reutilizada: false }, error: null }
  : {
    data: {
      ...separacion,
      techo: {
        decision: (parametros as Record<string, string>).p_decisiontecho,
        codtte: (parametros as Record<string, string | null>).p_codttecomsep,
        guardado: true
      }
    },
    error: null
  }));

test('HU-005 API: PUT resuelve Por definir a Sin techo o Con techo sin crear otra separación', async () => {
  for (const eleccion of [
    { decision: 'Sin techo' },
    { decision: 'Con techo', codtte: 2 }
  ]) {
    let decisionActual = 'Por definir';
    let tipoActual: string | null = null;
    await entorno(async (request, llamadas) => {
      const respuesta = await request(eleccion, 'vendedor', {}, '123', 'PUT');
      assert.equal(respuesta.status, 200);
      assert.equal((respuesta.body.data as { decision: string }).decision, eleccion.decision);
      assert.equal((respuesta.body.data as { guardado: boolean }).guardado, true);
      assert.deepEqual(llamadas.map(llamada => llamada.nombre), ['hu005_guardar_techo_separacion']);
      assert.deepEqual(llamadas[0]?.parametros, {
        p_codsep: '123', p_decisiontecho: eleccion.decision,
        p_codttecomsep: 'codtte' in eleccion ? String(eleccion.codtte) : null
      });
    }, (nombre, parametros) => {
      assert.equal(nombre, 'hu005_guardar_techo_separacion');
      const p = parametros as { p_decisiontecho: string; p_codttecomsep: string | null };
      if (decisionActual !== 'Por definir'
        && (p.p_decisiontecho !== decisionActual || p.p_codttecomsep !== tipoActual)) return errorRPC('PT440');
      decisionActual = p.p_decisiontecho;
      tipoActual = p.p_codttecomsep;
      return { data: { codsep: '123', decision: decisionActual, codtte: tipoActual, guardado: true, reutilizada: false }, error: null };
    });
  }
});

test('HU-005 API: replay del POST Por definir conserva la separación y devuelve el techo resuelto', async () => {
  const solicitudOriginal = { ...requestValido, techo: { decision: 'Por definir' } };
  for (const eleccion of [
    { decision: 'Sin techo' },
    { decision: 'Con techo', codtte: 2 }
  ]) {
    let decisionActual = 'Por definir';
    let tipoActual: string | null = null;
    let creaciones = 0;
    await entorno(async (request, llamadas) => {
      const inicial = await request(solicitudOriginal, 'vendedor');
      assert.equal(inicial.status, 201);
      const codsepInicial = (inicial.body.data as typeof separacion).codsep;
      assert.deepEqual((inicial.body.data as typeof separacion & { techo: unknown }).techo,
        { decision: 'Por definir', codtte: null, guardado: true });

      const resuelta = await request(eleccion, 'vendedor', {}, '123', 'PUT');
      assert.equal(resuelta.status, 200);

      const replay = await request(solicitudOriginal, 'vendedor');
      assert.equal(replay.status, 200);
      const dataReplay = replay.body.data as typeof separacion & {
        reutilizada: boolean;
        techo: { decision: string; codtte: string | null; guardado: boolean };
      };
      assert.equal(dataReplay.codsep, codsepInicial);
      assert.equal(dataReplay.reutilizada, true);
      assert.deepEqual(dataReplay.techo, {
        decision: eleccion.decision,
        codtte: 'codtte' in eleccion ? String(eleccion.codtte) : null,
        guardado: true
      });
      assert.deepEqual(llamadas.map(llamada => llamada.nombre), [
        'hu005_crear_separacion', 'hu005_guardar_techo_separacion', 'hu005_crear_separacion'
      ]);
      const creacionesRPC = llamadas.filter(llamada => llamada.nombre === 'hu005_crear_separacion');
      assert.equal(creacionesRPC.length, 2, 'el replay sí consulta la RPC idempotente');
      assert.ok(creacionesRPC.every(llamada => {
        const parametros = llamada.parametros as Record<string, unknown>;
        return parametros.p_decisiontecho === 'Por definir'
          && parametros.p_codttecomsep === null
          && parametros.p_idempotenciasep === clave;
      }), 'ambos POST conservan el payload original y la misma Idempotency-Key');
      assert.equal(llamadas.filter(llamada => llamada.nombre === 'hu005_guardar_techo_separacion').length, 1,
        'el replay no vuelve a llamar al guardado del techo');
    }, (nombre, parametros) => {
      if (nombre === 'hu005_crear_separacion') {
        creaciones += 1;
        return {
          data: {
            ...separacion,
            reutilizada: creaciones > 1,
            techo: { decision: decisionActual, codtte: tipoActual, guardado: true }
          },
          error: null
        };
      }
      assert.equal(nombre, 'hu005_guardar_techo_separacion');
      const p = parametros as { p_decisiontecho: string; p_codttecomsep: string | null };
      decisionActual = p.p_decisiontecho;
      tipoActual = p.p_codttecomsep;
      return {
        data: { codsep: '123', decision: decisionActual, codtte: tipoActual, guardado: true, reutilizada: false },
        error: null
      };
    });
  }
});

test('HU-005 API: PUT rechaza cambiar una elección final con HTTP 409', async () => entorno(async (request, llamadas) => {
  const respuesta = await request({ decision: 'Con techo', codtte: 3 }, 'gerente', {}, '123', 'PUT');
  assert.equal(respuesta.status, 409);
  assert.deepEqual(llamadas.map(llamada => llamada.nombre), ['hu005_guardar_techo_separacion']);
}, () => errorRPC('PT440')));

test('HU-005 API: fallo al guardar techo informa separación parcial y permite reintento sin recrearla', async () => {
  let fallaPrimeraVez = true;
  await entorno(async (request, llamadas) => {
    const parcial = await request();
    assert.equal(parcial.status, 202);
    assert.equal(parcial.body.warning?.code, 'TECHO_PENDIENTE_GUARDAR');
    assert.equal((parcial.body.data as typeof separacion & { techo: { guardado: boolean } }).codsep, '123');
    assert.equal((parcial.body.data as typeof separacion & { techo: { guardado: boolean } }).techo.guardado, false);
    const reintento = await request({ decision: 'Con techo', codtte: 2 }, 'vendedor', {}, '123', 'PUT');
    assert.equal(reintento.status, 200);
    assert.equal((reintento.body.data as { guardado: boolean }).guardado, true);
    assert.equal(llamadas.filter(llamada => llamada.nombre === 'hu005_crear_separacion').length, 1);
    assert.equal(llamadas.filter(llamada => llamada.nombre === 'hu005_guardar_techo_separacion').length, 2);
    assert.deepEqual((llamadas.at(-1)?.parametros), {
      p_codsep: '123', p_decisiontecho: 'Con techo', p_codttecomsep: '2'
    });
  }, (nombre, parametros) => {
    if (nombre === 'hu005_guardar_techo_separacion' && fallaPrimeraVez) {
      fallaPrimeraVez = false;
      return errorRPC('XX000');
    }
    return nombre === 'hu005_guardar_techo_separacion'
      ? { data: { codsep: '123', decision: 'Con techo', codtte: '2', guardado: true, reutilizada: false }, error: null }
      : { data: separacion, error: null };
  });
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
    { ...requestValido, monto: 0 }, { ...requestValido, monto: 250.001 }, { ...requestValido, fechaPago: '2026-02-30' },
    { ...requestValido, medioPago: 5 }, { ...requestValido, referencia: 123 },
    { ...requestValido, rutaEvidencia: false }, { ...requestValido, observacion: 8 },
    { ...requestValido, ingresoConfirmado: 'true' }, { ...requestValido, codusuAutor: 99 },
    { ...requestValido, techo: undefined }, { ...requestValido, techo: { decision: 'Por definir', codtte: 1 } },
    { ...requestValido, techo: { decision: 'Sin techo', codtte: 1 } },
    { ...requestValido, techo: { decision: 'Con techo' } },
    { ...requestValido, techo: { decision: 'Desconocido' } },
    { ...requestValido, techo: { decision: 'Con techo', codtte: 0 } },
    { ...requestValido, techo: { decision: 'Con techo', codtte: 1.5 } }
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
  ['PT432', 422], ['PT433', 422], ['PT434', 422], ['PT435', 422], ['PT436', 422],
  ['PT437', 422], ['PT438', 409], ['PT439', 422], ['PT440', 409], ['PT441', 409], ['XX000', 500]
] as const) {
  test(`HU-005 API: error RPC ${code} devuelve ${status} sin filtrar detalles`, async () => entorno(async request => {
    const respuesta = await request();
    assert.equal(respuesta.status, status);
    if (code === 'PT438') assert.equal(respuesta.body.message,
      'La elección de techo no es compatible con el techo instalado o configurado en esta unidad');
    const mensajes: Record<string, string> = {
      PT434: 'La captura de la transferencia no está guardada o no corresponde a esta moto',
      PT435: 'El adelanto no puede superar el precio de lista de la moto',
      PT436: 'La moto no tiene precio de lista registrado; regístralo en Modelos antes de separar',
      PT437: 'La fecha del adelanto no puede ser de hace más de 30 días',
      PT438: 'La elección de techo no es compatible con el techo instalado o configurado en esta unidad',
      PT439: 'El tipo de techo no existe o está inactivo',
      PT440: 'La elección de techo ya está guardada y no se puede modificar',
      PT441: 'La separación ya no está activa'
    };
    if (mensajes[code]) assert.equal(respuesta.body.message, mensajes[code]);
    assert.ok(!JSON.stringify(respuesta.body).includes('privado'));
    assert.ok(!JSON.stringify(respuesta.body).includes('secreto'));
  }, () => errorRPC(code)));
}
