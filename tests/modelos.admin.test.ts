import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';
import { configurarVerificadorImagen } from '../src/utils/imagen.contenido';

// Estas pruebas no tienen red: la revisión de los bytes de la imagen se prueba aparte (imagenes.contenido.test.ts)
configurarVerificadorImagen(async () => {});

const UUIDS = {
  Gerente: '00000000-0000-0000-0000-000000000001',
  Administradora: '00000000-0000-0000-0000-000000000002',
  Vendedor: '00000000-0000-0000-0000-000000000003'
} as const;

async function entorno(
  rpc: (nombre: string, parametros?: Record<string, unknown>, rol?: string) => Promise<{ data: unknown; error: unknown }>,
  verificar: (base: string) => Promise<void>,
  rpcPublica?: (nombre: string, parametros?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
) {
  const fabricaPrivada = (token: string) => {
    const rol = token.replace('token-', '');
    const uuid = UUIDS[rol as keyof typeof UUIDS] ?? UUIDS.Gerente;
    return {
      auth: { getUser: async () => ({ data: { user: { id: uuid } }, error: null }) },
      rpc: async (nombre: string, parametros?: Record<string, unknown>) => {
        if (nombre === 'hu007_usuario_actual') {
          if (!(rol in UUIDS)) return { data: null, error: { message: 'usuario inválido' } };
          return { data: { codusu: '1', uuidusu: uuid, rol }, error: null };
        }
        return rpc(nombre, parametros, rol);
      }
    } as unknown as SupabaseClient;
  };
  const fabricaPublica = () => ({
    rpc: async (nombre: string, parametros?: Record<string, unknown>) =>
      rpcPublica ? rpcPublica(nombre, parametros) : { data: [], error: null }
  }) as unknown as SupabaseClient;
  const server = crearApp(fabricaPrivada, fabricaPublica).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/modelos`;
  try { await verificar(base); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

const modelo = {
  codmod: '9', codtmo: '1', nommod: 'Torito prueba', marmod: 'Bajaj',
  desmod: 'Descripción', carmod: 'Características', premod: null,
  estmod: 'Borrador', colores: [], imagenes: []
};

test('HU-012: administración exige token y solo Gerente o Administradora', async () => {
  const llamadas: string[] = [];
  await entorno(async nombre => { llamadas.push(nombre); return { data: [modelo], error: null }; }, async base => {
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    for (const token of ['token-Vendedor']) {
      const respuesta = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(respuesta.status, 403);
    }
    for (const rol of ['Gerente', 'Administradora']) {
      const respuesta = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer token-${rol}` } });
      assert.equal(respuesta.status, 200);
      assert.deepEqual(await respuesta.json(), { ok: true, data: [modelo] });
    }
    assert.deepEqual(llamadas, ['hu012_modelos_admin', 'hu012_modelos_admin']);
  });
});

test('HU-012/HU-009: rutas públicas existentes siguen sin token y conservan las URLs', async () => {
  const llamadas: unknown[][] = [];
  await entorno(async () => ({ data: modelo, error: null }), async base => {
    const lista = await fetch(base);
    assert.equal(lista.status, 200);
    assert.equal((await lista.json()).ok, true);
    const detalle = await fetch(`${base}/9`);
    assert.equal(detalle.status, 200);
    assert.deepEqual(await detalle.json(), { ok: true, data: modelo });
  }, async (nombre, parametros) => {
    llamadas.push([nombre, parametros]);
    return nombre === 'hu012_modelos_publicados' ? { data: [modelo], error: null } : { data: modelo, error: null };
  });
  assert.deepEqual(llamadas, [['hu012_modelos_publicados', undefined], ['hu009_modelo_publicado_por_id', { p_codmod: '9' }]]);
});

test('HU-012: POST crea con precio null, valores por defecto y colores normalizados; valida campos/precio', async () => {
  const llamadas: Array<[string, Record<string, unknown> | undefined]> = [];
  await entorno(async (nombre, parametros) => {
    llamadas.push([nombre, parametros]);
    return { data: modelo, error: null };
  }, async base => {
    const headers = { Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json' };
    const cuerpo = { codtmo: '1', nommod: ' Torito   ejemplo ', desmod: ' Descripción ', carmod: ' Características ', premod: null,
      colores: [' Rojo ', 'Azul   Marino', 'rojo', '  azul marino  '] };
    const respuesta = await fetch(base, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
    assert.equal(respuesta.status, 201);
    assert.deepEqual(await respuesta.json(), { ok: true, message: 'Modelo registrado correctamente', data: modelo });
    assert.deepEqual(llamadas[0], ['hu012_crear_modelo', {
      p_codtmo: '1', p_nommod: 'Torito ejemplo', p_marmod: 'Bajaj', p_desmod: 'Descripción', p_carmod: 'Características',
      p_premod: null, p_colores: ['Rojo', 'Azul Marino'], p_estmod: 'Borrador'
    }]);
    for (const invalid of [
      { ...cuerpo, premod: -0.01 },
      { ...cuerpo, sorpresita: true },
      { ...cuerpo, colores: [''] },
      { ...cuerpo, colores: ['x'.repeat(51)] },
      { ...cuerpo, premod: 1.234 }
    ]) {
      const bad = await fetch(base, { method: 'POST', headers, body: JSON.stringify(invalid) });
      assert.equal(bad.status, 400);
    }
    assert.equal(llamadas.length, 1);
  });
});

test('HU-012: PUT reemplaza colores y no permite cambiar estado; PATCH usa ruta específica', async () => {
  const llamadas: Array<[string, Record<string, unknown> | undefined]> = [];
  await entorno(async (nombre, parametros) => {
    llamadas.push([nombre, parametros]);
    return { data: modelo, error: null };
  }, async base => {
    const headers = { Authorization: 'Bearer token-Administradora', 'Content-Type': 'application/json' };
    const respuesta = await fetch(`${base}/9`, { method: 'PUT', headers,
      body: JSON.stringify({ premod: 14500, colores: ['Azul', ' azul ', 'Rojo'], carmod: 'Datos nuevos' }) });
    assert.equal(respuesta.status, 200);
    assert.deepEqual(llamadas[0], ['hu012_actualizar_modelo', {
      p_codmod: '9', p_cambios: { premod: 14500, colores: ['Azul', 'Rojo'], carmod: 'Datos nuevos' }
    }]);
    const estado = await fetch(`${base}/9/estado`, { method: 'PATCH', headers, body: JSON.stringify({ estmod: 'Publicado' }) });
    assert.equal(estado.status, 200);
    assert.deepEqual(llamadas[1], ['hu012_cambiar_estado_modelo', { p_codmod: '9', p_estmod: 'Publicado' }]);
    const estadoEnPut = await fetch(`${base}/9`, { method: 'PUT', headers, body: JSON.stringify({ estmod: 'Publicado' }) });
    assert.equal(estadoEnPut.status, 400);
  });
});

test('HU-012: rutas de imágenes requieren sesión y solo permiten Gerente o Administradora', async () => {
  const llamadas: Array<[string, Record<string, unknown> | undefined, string | undefined]> = [];
  const imagen = { codimo: '21', codmod: '9', urlimo: '/images/modelos/9/principal.png', ordimo: 1, estimo: true };
  await entorno(async (nombre, parametros, rol) => {
    llamadas.push([nombre, parametros, rol]);
    return { data: imagen, error: null };
  }, async base => {
    const url = `${base}/9/imagenes`;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urlimo: '/images/modelos/9/principal.png', ordimo: 1 }) })).status, 401);
    const headers = (rol: string) => ({ Authorization: `Bearer token-${rol}`, 'Content-Type': 'application/json' });
    for (const rol of ['Gerente', 'Administradora']) {
      const respuesta = await fetch(url, { method: 'POST', headers: headers(rol), body: JSON.stringify({ urlimo: '/images/modelos/9/principal.png', ordimo: 1 }) });
      assert.equal(respuesta.status, 201);
      assert.deepEqual((await respuesta.json()).data, imagen);
    }
    const vendedor = await fetch(url, { method: 'POST', headers: headers('Vendedor'), body: JSON.stringify({ urlimo: '/images/modelos/9/principal.png', ordimo: 1 }) });
    assert.equal(vendedor.status, 403);
  });
  assert.deepEqual(llamadas, [
    ['hu012_agregar_imagen_modelo', { p_codmod: '9', p_urlimo: '/images/modelos/9/principal.png', p_ordimo: 1 }, 'Gerente'],
    ['hu012_agregar_imagen_modelo', { p_codmod: '9', p_urlimo: '/images/modelos/9/principal.png', p_ordimo: 1 }, 'Administradora']
  ]);
});

test('HU-012: urlimo admite rutas /images y HTTPS válidas; rechaza esquemas activos o rutas inseguras', async () => {
  const llamadas: Array<[string, unknown]> = [];
  await entorno(async (nombre, parametros) => { llamadas.push([nombre, parametros?.p_urlimo]); return { data: { codimo: '21', urlimo: 'ok', ordimo: 1, estimo: true }, error: null }; }, async base => {
    const headers = { Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json' };
    const urlStorage = 'https://epsa-test.supabase.co/storage/v1/object/public/modelos/3/principal.webp';
    for (const urlimo of [' /images/modelos/3/principal.png ', 'https://example.com/foto.webp', 'https://imagenes.example.test/modelo.png', urlStorage]) {
      const respuesta = await fetch(`${base}/3/imagenes`, { method: 'POST', headers, body: JSON.stringify({ urlimo, ordimo: 1 }) });
      assert.equal(respuesta.status, 201);
    }
    for (const urlimo of [
      'data:image/png;base64,AAAA', 'javascript:alert(1)', 'file:///tmp/modelo.png',
      'http://example.com/foto.webp', 'ftp://imagenes.example.test/modelo.png', 'https://', 'https://user:pass@imagenes.example.test/modelo.png',
      '/images/../privado.png', '/images/%2e%2e/privado.png', '/images/modelos/3/a.png?x=1'
    ]) {
      const respuesta = await fetch(`${base}/3/imagenes`, { method: 'POST', headers, body: JSON.stringify({ urlimo, ordimo: 1 }) });
      assert.equal(respuesta.status, 400, urlimo);
    }
    for (const body of [
      { urlimo: '/images/modelos/3/a.png', ordimo: 0 },
      { urlimo: '/images/modelos/3/a.png', ordimo: 1.2 },
      { urlimo: '/images/modelos/3/a.png', ordimo: 1, inesperado: true },
      { urlimo: '   ', ordimo: 1 }
    ]) {
      const respuesta = await fetch(`${base}/3/imagenes`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(respuesta.status, 400);
    }
  });
  assert.deepEqual(llamadas, [
    ['hu012_agregar_imagen_modelo', '/images/modelos/3/principal.png'],
    ['hu012_agregar_imagen_modelo', 'https://example.com/foto.webp'],
    ['hu012_agregar_imagen_modelo', 'https://imagenes.example.test/modelo.png'],
    ['hu012_agregar_imagen_modelo', 'https://epsa-test.supabase.co/storage/v1/object/public/modelos/3/principal.webp']
  ]);
});

test('HU-012: PUT y PATCH administran imágenes con modelo e imagen explícitos', async () => {
  const llamadas: Array<[string, Record<string, unknown> | undefined]> = [];
  await entorno(async (nombre, parametros) => {
    llamadas.push([nombre, parametros]);
    return { data: { codimo: '21', codmod: '9', urlimo: '/images/modelos/9/nueva.png', ordimo: 2, estimo: false }, error: null };
  }, async base => {
    const headers = { Authorization: 'Bearer token-Administradora', 'Content-Type': 'application/json' };
    const actualizada = await fetch(`${base}/9/imagenes/21`, { method: 'PUT', headers, body: JSON.stringify({ urlimo: '/images/modelos/9/nueva.png', ordimo: 2 }) });
    assert.equal(actualizada.status, 200);
    const estado = await fetch(`${base}/9/imagenes/21/estado`, { method: 'PATCH', headers, body: JSON.stringify({ estimo: false }) });
    assert.equal(estado.status, 200);
    assert.equal((await fetch(`${base}/9/imagenes/0`, { method: 'PUT', headers, body: JSON.stringify({ urlimo: '/images/x.png', ordimo: 1 }) })).status, 400);
  });
  assert.deepEqual(llamadas, [
    ['hu012_actualizar_imagen_modelo', { p_codmod: '9', p_codimo: '21', p_urlimo: '/images/modelos/9/nueva.png', p_ordimo: 2 }],
    ['hu012_cambiar_estado_imagen_modelo', { p_codmod: '9', p_codimo: '21', p_estimo: false }]
  ]);
  await entorno(async () => ({ data: null, error: { code: 'PT404', message: 'Imagen inexistente para el modelo', details: 'privado' } }), async base => {
    const respuesta = await fetch(`${base}/9/imagenes/22`, { method: 'PUT', headers: {
      Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json'
    }, body: JSON.stringify({ urlimo: '/images/modelos/9/nueva.png', ordimo: 2 }) });
    assert.equal(respuesta.status, 404);
    assert.deepEqual(await respuesta.json(), { ok: false, message: 'La imagen no existe para el modelo' });
  });
  await entorno(async () => ({ data: null, error: { code: 'PT404', message: 'Modelo inexistente', details: 'privado' } }), async base => {
    const respuesta = await fetch(`${base}/999/imagenes`, { method: 'POST', headers: {
      Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json'
    }, body: JSON.stringify({ urlimo: '/images/modelos/999/principal.png', ordimo: 1 }) });
    assert.equal(respuesta.status, 404);
    assert.deepEqual(await respuesta.json(), { ok: false, message: 'El modelo no existe' });
  });
});

test('HU-012: POST y PATCH traducen la publicación incompleta a un 400 controlado', async () => {
  await entorno(async () => ({ data: null, error: { code: 'PT422', message: 'Modelo incompleto para publicación', details: 'SQL privado' } }), async base => {
    const headers = { Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json' };
    const body = { codtmo: '1', nommod: 'Modelo', desmod: 'Descripción', carmod: 'Características', estmod: 'Publicado' };
    const crear = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
    const publicar = await fetch(`${base}/9/estado`, { method: 'PATCH', headers, body: JSON.stringify({ estmod: 'Publicado' }) });
    for (const respuesta of [crear, publicar]) {
      assert.equal(respuesta.status, 400);
      assert.deepEqual(await respuesta.json(), { ok: false, message: 'El modelo no tiene la información requerida para publicarse' });
    }
  });
});

test('HU-012: errores de RPC se traducen sin exponer detalles internos', async () => {
  await entorno(async () => ({ data: null, error: { code: 'XX000', message: 'password interno', details: 'SQL privado', hint: 'secreto' } }), async base => {
    const respuesta = await fetch(`${base}/admin`, { headers: { Authorization: 'Bearer token-Gerente' } });
    assert.equal(respuesta.status, 500);
    assert.deepEqual(await respuesta.json(), { ok: false, message: 'Error interno al procesar el modelo' });
  });
  await entorno(async () => ({ data: null, error: { code: 'PT404', message: 'modelo interno' } }), async base => {
    const respuesta = await fetch(`${base}/9`, { method: 'PUT', headers: {
      Authorization: 'Bearer token-Gerente', 'Content-Type': 'application/json'
    }, body: JSON.stringify({ nommod: 'Cambio' }) });
    assert.equal(respuesta.status, 404);
    assert.deepEqual(await respuesta.json(), { ok: false, message: 'El modelo no existe' });
  });
});
