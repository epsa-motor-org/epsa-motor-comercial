import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Migración 202611130001 sobre HU-005, la HU-006 de Michelle (202611120001 a 202611120003) y su HU-021 (202611120004):
// techo configurado, catálogo único con adicional referencial, decisión comercial por moto, desglose en la ficha,
// configuración que respeta lo vendido (PT423), conversión simultánea como conflicto (PT604) y, con las cancelaciones
// de HU-021, permisos por responsable vigente, venta cancelada inmutable (PT623), venta sin responsable visible,
// historial de cancelaciones de la moto y reventa de la misma moto.

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface TipoPublico { codtte: string; nombre: string; adicionalReferencial: number; sinTecho: boolean }

const leer = (ruta: string) => readFileSync(ruta, 'utf8');
const UUIDS = [1, 2, 3, 4].map(n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
const migraciones = [
  '202610030001_hu026_ubicaciones.sql',
  '202610040001_hu034_compra_pendiente.sql',
  '202610060001_hu002_identificacion_unidades.sql',
  '202610070001_hu007_permisos_rol.sql',
  '202610070002_hu012_modelos_publicados.sql',
  '202610080001_hu004_configuracion_techo.sql',
  '202610080002_hu009_ficha_modelo.sql',
  '202610190001_hu003_movimientos_ubicacion.sql',
  '202610210001_hu001_consulta_inventario.sql',
  '202610280003_hu033_preparacion_unidad.sql',
  '202610100003_hu012_admin_modelos.sql',
  '202610280004_hu001_preparacion_operativa.sql',
  '202611050001_hu005_separacion_moto.sql',
  '202611060001_hu005_confirmador_transferencia.sql',
  '202611070001_hu005_comprador_evidencia.sql',
  '202611080001_hu005_techo_y_venta.sql',
  '202611080002_hu005_decision_techo_y_tope.sql',
  '202611080003_hu005_comprador_sin_documento.sql',
  '202611090001_hu005_decision_techo_y_precio_integracion.sql',
  '202611090002_hu005_buscar_leads.sql',
  '202611090003_hu005_compatibilidad_techo_instalado.sql'
];

test('HU-005/HU-006 PostgreSQL: techo configurado, catálogo único y configuración que respeta lo vendido', async t => {
  const db = new PGlite();
  let usuarioActual = 1;
  const login = async (numero = usuarioActual) => {
    usuarioActual = numero;
    await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${UUIDS[numero - 1]}',false)`);
  };
  const propietario = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec('RESET ROLE');
    try { return await fn(); } finally { await login(usuarioActual); }
  };
  const escalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await db.query<Valor<T>>(sql, params)).rows[0]!.r;
  const error = (codigo: string) => (e: unknown) => (e as ErrorSQL).code === codigo;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const venta = (coduni: string, techo: unknown, adicional: number | null = null, clave = randomUUID()) =>
    escalar<Record<string, unknown>>('SELECT public.hu006_crear_venta($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::uuid) r',
      [coduni, 1, 3, 1, hoy, 'Crédito', adicional, null, '[]', techo === null ? null : JSON.stringify(techo), null, null, null, clave]);
  // Como la API: la separación y, si el comprador ya decidió, el guardado de su techo
  const separar = async (coduni: string, decision: string, codtte: number | null = null) => {
    const s = await escalar<{ codsep: string }>('SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [coduni, 1, 3, null, 100, hoy, 'Efectivo', null, null, 'Recepción en caja', true, randomUUID(), decision, codtte]);
    if (decision !== 'Por definir') await escalar('SELECT public.hu005_guardar_techo_separacion($1,$2,$3) r', [s.codsep, decision, codtte]);
    return s;
  };
  const cancelarVenta = (codven: string, motivo: string, obs: string | null = null, clave = randomUUID()) =>
    escalar<Record<string, unknown>>('SELECT public.hu021_cancelar_venta($1,$2,$3,$4::uuid) r', [codven, motivo, obs, clave]);
  const cancelarSeparacion = (codsep: string, motivo: string, obs: string | null = 'Adelanto en caja', clave = randomUUID()) =>
    escalar<Record<string, unknown>>('SELECT public.hu021_cancelar_separacion($1,$2,$3,$4::uuid) r', [codsep, motivo, obs, clave]);
  const estadoUnidad = (coduni: string) => propietario(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [coduni]));
  const configurar = (coduni: string, codtte: string) =>
    escalar('SELECT public.hu004_actualizar_configuracion_techo($1,$2,$3,$4) r', [coduni, codtte, null, null]);

  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL, owner uuid, UNIQUE(bucket_id,name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
      $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
    GRANT SELECT,INSERT ON storage.objects TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await db.exec(leer('tests/fixtures/esquema-base.sql'));
  for (const migration of migraciones) await db.exec(leer(`supabase/migrations/${migration}`));
  await db.exec('ALTER TABLE public.separacion ENABLE ROW LEVEL SECURITY; ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.separacion,public.venta TO authenticated; GRANT USAGE,SELECT ON SEQUENCE public.separacion_codsep_seq TO authenticated;');
  for (const migration of [
    '202611100001_hu006_venta_cliente_unidad.sql',
    '202611100002_hu005_hu006_adelanto_minimo_y_venta_de_unidad.sql',
    '202611120001_hu006_desglose_precio_techo.sql',
    '202611120002_hu006_listar_ventas.sql',
    '202611120003_hu005_adelanto_minimo.sql',
    '202611120004_hu021_cancelaciones.sql',
    '202611130001_hu005_hu006_techo_configurado_y_catalogo.sql',
    // Se puede volver a ejecutar
    '202611130001_hu005_hu006_techo_configurado_y_catalogo.sql'
  ]) await db.exec(leer(`supabase/migrations/${migration}`));
  await db.exec(`INSERT INTO auth.users(id) VALUES ${UUIDS.map(id => `('${id}')`).join(',')};
    INSERT INTO public.rol(nomrol,estrol) VALUES ('Gerente',true),('Administradora',true),('Vendedor',true);
    INSERT INTO public.usuario(uuidusu,codrol,nomusu,apepatusu,corusu,estusu)
      VALUES ('${UUIDS[0]}',1,'Gerente','QA','gerente@qa.test',true),
             ('${UUIDS[1]}',2,'Admin','QA','admin@qa.test',true),
             ('${UUIDS[2]}',3,'Vendedor','QA','vendedor@qa.test',true),
             ('${UUIDS[3]}',3,'Vendedora','Dos','vendedora2@qa.test',true);
    INSERT INTO public.tipomotocar(nomtmo) VALUES ('Motocar QA');
    INSERT INTO public.modelo(codtmo,nommod,desmod,carmod,premod) VALUES (1,'Torito QA','Modelo sintético','Características',18335);
    INSERT INTO public.cliente(nomcli,estcli) VALUES ('Comprador Uno',true);
    UPDATE public.tipotecho SET reqinsttte = (nomtte <> 'Sin techo'), esttte = true;
    INSERT INTO public.estadopreparacion(nomepr) VALUES ('Preparación QA');
    INSERT INTO public.ubicacion(nomubi,tipubi) VALUES ('Comas HU006','Sede');
    INSERT INTO public.sede(codubi,telsed,horsed,estsed) VALUES (1,'999999999','9-6',true);
  `);
  const unidades = Array.from({ length: 16 }, (_, i) => ({ nummotuni: `TC-M-${i + 1}`, chauni: `TC-C-${i + 1}`, codmod: '1', coluni: 'Azul' }));
  const compra = await propietario(async () => {
    const r = await db.query<{ codcom: string }>("INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',16) RETURNING codcom::text");
    await db.query("INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) VALUES ($1,'QA','TC-FAC','2026-11-12',16,1)", [r.rows[0]!.codcom]);
    return r.rows[0]!.codcom;
  });
  await login(1);
  await escalar('SELECT public.hu002_identificar_unidades($1,$2::jsonb) r', [compra, JSON.stringify(unidades)]);
  const u = await propietario(async () => (await db.query<{ coduni: string }>(
    "SELECT coduni::text FROM public.unidad WHERE nummotuni LIKE 'TC-M-%' ORDER BY coduni")).rows.map(r => r.coduni));
  const tipo = await propietario(async () => Object.fromEntries((await db.query<{ nomtte: string; codtte: string }>(
    'SELECT nomtte,codtte::text FROM public.tipotecho')).rows.map(f => [f.nomtte, f.codtte])));
  await t.after(() => db.close());

  await t.test('Catálogo único: público (anon) y en el formulario del panel, con el adicional referencial y en orden', async () => {
    await db.exec('RESET ROLE; SET ROLE anon');
    const publico = await escalar<TipoPublico[]>('SELECT public.hu006_tipos_techo_publicos() r');
    assert.deepEqual(publico.map(x => [x.nombre, Number(x.adicionalReferencial), x.sinTecho]), [
      ['Sin techo', 0, true], ['Lona', 200, false], ['Techo clásico de fibra', 1700, false],
      ['Fibra clásica equipada', 3200, false], ['Techo de fibra deportiva', 4000, false]
    ]);
    await assert.rejects(db.query('SELECT public.hu006_techo_comercial_unidades()'), error('42501'));
    await login(3);
    const formulario = await escalar<{ tiposTecho: TipoPublico[] }>('SELECT public.hu005_formulario_separacion() r');
    assert.deepEqual(formulario.tiposTecho.map(x => [x.nombre, Number(x.adicionalReferencial)]), publico.map(x => [x.nombre, Number(x.adicionalReferencial)]));
  });

  await t.test('CP-006-07/11: con un techo configurado (no instalado) solo se vende o separa con ese techo o por definir', async () => {
    await login(1);
    await configurar(u[0]!, tipo['Lona']!);
    await login(3);
    await assert.rejects(venta(u[0]!, { decision: 'Sin techo' }), error('PT613'));
    await assert.rejects(venta(u[0]!, { decision: 'Con techo', codtte: tipo['Techo clásico de fibra'] }, 1700), error('PT613'));
    await assert.rejects(separar(u[0]!, 'Sin techo'), error('PT438'));
    await assert.rejects(separar(u[0]!, 'Con techo', Number(tipo['Techo clásico de fibra'])), error('PT438'));
    const v = await venta(u[0]!, { decision: 'Con techo', codtte: tipo['Lona'] }, 200);
    assert.equal(Number(v.importe), 18535);
  });

  await t.test('Una moto configurada «Sin techo» no queda comprometida: se vende con cualquier techo', async () => {
    await login(1);
    await configurar(u[1]!, tipo['Sin techo']!);
    await login(3);
    const v = await venta(u[1]!, { decision: 'Con techo', codtte: tipo['Fibra clásica equipada'] }, 3200);
    assert.equal(Number(v.importe), 21535);
  });

  await t.test('PT423: la configuración de techo debe coincidir con lo que eligió el comprador', async () => {
    await login(3);
    await venta(u[2]!, { decision: 'Con techo', codtte: tipo['Techo clásico de fibra'] }, 1700);
    await venta(u[3]!, { decision: 'Sin techo' });
    await separar(u[4]!, 'Con techo', Number(tipo['Lona']));
    await separar(u[5]!, 'Por definir');
    await login(1);
    await assert.rejects(configurar(u[2]!, tipo['Lona']!), error('PT423'));
    await configurar(u[2]!, tipo['Techo clásico de fibra']!);
    await assert.rejects(configurar(u[3]!, tipo['Lona']!), error('PT423'));
    await configurar(u[3]!, tipo['Sin techo']!);
    await assert.rejects(configurar(u[4]!, tipo['Techo clásico de fibra']!), error('PT423'));
    await configurar(u[5]!, tipo['Lona']!);
    const fisica = await propietario(() => escalar<string>('SELECT string_agg(coalesce(codtte::text,\'-\'), \',\' ORDER BY coduni) r FROM public.unidad WHERE coduni = ANY($1::bigint[])', [[u[2], u[3], u[4], u[5]]]));
    assert.equal(fisica, [tipo['Techo clásico de fibra'], tipo['Sin techo'], '-', tipo['Lona']].join(','));
  });

  await t.test('Decisión comercial por moto (separación activa o venta) y desglose en la ficha', async () => {
    await login(2);
    const lista = await escalar<Array<{ coduni: string; origen: string; decision: string; nombre: string | null }>>('SELECT public.hu006_techo_comercial_unidades() r');
    const de = (c: string) => lista.find(x => x.coduni === c);
    assert.deepEqual([de(u[2]!)?.origen, de(u[2]!)?.decision, de(u[2]!)?.nombre], ['Venta', 'Con techo', 'Techo clásico de fibra']);
    assert.deepEqual([de(u[4]!)?.origen, de(u[4]!)?.decision, de(u[4]!)?.nombre], ['Separación', 'Con techo', 'Lona']);
    assert.equal(de(u[5]!)?.decision, 'Por definir');
    assert.equal(de(u[6]!), undefined);
    const ficha = await escalar<Record<string, unknown>>('SELECT public.hu006_venta_de_unidad($1) r', [u[2]]);
    assert.deepEqual([ficha.precioBaseAcordado, ficha.adicionalTechoReferencial, ficha.adicionalTechoAcordado, ficha.importe].map(Number), [18335, 1700, 1700, 20035]);
  });

  await t.test('CP-006-12: una segunda conversión de la misma separación responde conflicto (PT604), no datos inválidos', async () => {
    await login(3);
    await separar(u[6]!, 'Por definir');
    const primera = await venta(u[6]!, null);
    assert.equal(Number(primera.totalRecibido), 100);
    await assert.rejects(venta(u[6]!, null), error('PT604'));
    const n = await propietario(() => escalar<number>('SELECT count(*)::int r FROM public.venta WHERE coduni=$1', [u[6]]));
    assert.equal(n, 1);
  });

  await t.test('HU-021: una venta cancelada no cambia su techo ni su comprobante (PT623) y la moto se vuelve a vender', async () => {
    await login(3);
    const claveVenta = randomUUID();
    const v = await venta(u[7]!, { decision: 'Por definir' }, null, claveVenta);
    await login(1);
    const c = await cancelarVenta(String(v.codven), 'El comprador desistió');
    assert.deepEqual([c.estado, c.estadoComercialUnidad, c.unidadLiberada], ['Cancelada', 'Disponible', true]);
    await assert.rejects(escalar('SELECT public.hu006_guardar_techo_venta($1,$2,$3,$4) r', [v.codven, 'Con techo', tipo['Lona'], 200]), error('PT623'));
    await assert.rejects(escalar('SELECT public.hu006_guardar_comprobante_venta($1,$2,$3) r', [v.codven, 'B001-99', hoy]), error('PT623'));
    const guardada = await propietario(() => escalar<string>("SELECT concat_ws('|',estven,dectechoven,impven,refcompven) r FROM public.venta WHERE codven=$1", [v.codven]));
    assert.equal(guardada, 'Cancelada|Por definir|18335.00');
    assert.equal(await escalar('SELECT public.hu006_venta_de_unidad($1) r', [u[7]]), null);
    const lista = await escalar<Array<{ coduni: string }>>('SELECT public.hu006_techo_comercial_unidades() r');
    assert.equal(lista.find(x => x.coduni === u[7]), undefined);
    // El reintento de la venta ya cancelada (misma clave) no la revive ni la presenta como vigente
    await login(3);
    await assert.rejects(venta(u[7]!, { decision: 'Por definir' }, null, claveVenta), error('PT623'));
    // Reventa de la misma moto
    const nueva = await venta(u[7]!, { decision: 'Sin techo' });
    assert.notEqual(nueva.codven, v.codven);
    assert.equal(await estadoUnidad(u[7]!), 'Vendida');
    const ficha = await escalar<Record<string, unknown>>('SELECT public.hu006_venta_de_unidad($1) r', [u[7]]);
    assert.equal(ficha.codven, nueva.codven);
    const ventas = await escalar<{ items: Array<{ estado: string; unidad: { coduni: string } }> }>('SELECT public.hu006_listar_ventas($1,$2,$3) r', [null, 100, 0]);
    assert.deepEqual(ventas.items.filter(x => x.unidad.coduni === u[7]).map(x => x.estado).sort(), ['Cancelada', 'Registrada']);
  });

  await t.test('HU-021: el vendedor cancela solo como responsable vigente; la reasignación le quita el permiso', async () => {
    await login(2);
    const s = await separar(u[8]!, 'Por definir');
    await login(4);
    await assert.rejects(cancelarSeparacion(s.codsep, 'No es mía'), error('PT652'));
    await propietario(() => db.query('UPDATE public.separacion SET codusuresp = 4 WHERE codsep = $1', [s.codsep]));
    await login(3);
    await assert.rejects(cancelarSeparacion(s.codsep, 'Pantalla vieja'), error('PT652'));
    assert.equal(await estadoUnidad(u[8]!), 'Separada');
    await assert.rejects(escalar('SELECT public.hu021_consultar_cancelacion_separacion($1) r', [s.codsep]), error('42501'));
    await login(4);
    await assert.rejects(cancelarSeparacion(s.codsep, 'Sin dinero', null), error('PT656'));
    await assert.rejects(cancelarSeparacion(s.codsep, '   '), error('PT655'));
    const clave = randomUUID();
    const c = await cancelarSeparacion(s.codsep, 'El comprador  desistió', 'Adelanto en caja', clave);
    assert.equal(c.motivo, 'El comprador desistió');
    const otra = await cancelarSeparacion(s.codsep, 'El comprador desistió', 'Adelanto en caja', clave);
    assert.equal(otra.reutilizada, true);
    await assert.rejects(cancelarSeparacion(s.codsep, 'Otro motivo', 'Adelanto en caja', clave), error('PT658'));
    await assert.rejects(cancelarSeparacion(s.codsep, 'Otra vez'), error('PT659'));
    assert.equal(await estadoUnidad(u[8]!), 'Disponible');
    // La venta que convertía esa separación (sin techo: se heredaba) llega tarde: conflicto, no datos inválidos
    await assert.rejects(venta(u[8]!, null), error('PT604'));
    const n = await propietario(() => escalar<number>('SELECT count(*)::int r FROM public.historialcancelacion WHERE codsep=$1', [s.codsep]));
    assert.equal(n, 1);
    // Se vuelve a separar la misma moto
    await login(3);
    await separar(u[8]!, 'Sin techo');
    assert.equal(await estadoUnidad(u[8]!), 'Separada');
  });

  await t.test('HU-021: separación convertida (PT653) y venta que la convirtió: la moto queda libre y la separación no revive', async () => {
    await login(3);
    const s = await separar(u[9]!, 'Sin techo');
    const v = await venta(u[9]!, null);
    await assert.rejects(cancelarSeparacion(s.codsep, 'Liberar la moto'), error('PT653'));
    await assert.rejects(cancelarVenta(String(v.codven), 'Desistió'), error('PT656'));
    const c = await cancelarVenta(String(v.codven), 'Desistió', 'Adelanto de S/ 100 en caja, sin devolución registrada');
    assert.equal((c.finanzasConservadas as Record<string, unknown>).estadoSeparacionVinculada, 'Convertida');
    assert.equal(Number((c.finanzasConservadas as Record<string, unknown>).totalRecibido), 100);
    assert.equal(await estadoUnidad(u[9]!), 'Disponible');
    assert.equal(await escalar('SELECT public.hu005_separacion_activa($1) r', [u[9]]), null);
  });

  await t.test('HU-021 escenario 11: venta sin responsable visible; solo gerente o administradora la cancelan', async () => {
    await login(3);
    const v = await venta(u[10]!, { decision: 'Sin techo' });
    // Venta histórica (importada, sin clave de reintento) que quedó sin responsable: solo se logra por SQL
    await propietario(() => db.query('UPDATE public.venta SET codusuresp = NULL, idempotenciaven = NULL, payloadidempotenciaven = NULL WHERE codven = $1', [v.codven]));
    const ficha = await escalar<{ responsable: { codusu: string | null } }>('SELECT public.hu006_venta_de_unidad($1) r', [u[10]]);
    assert.equal(ficha.responsable.codusu, null);
    const ventas = await escalar<{ items: Array<{ codven: string; responsable: { codusu: string | null } }> }>('SELECT public.hu006_listar_ventas($1,$2,$3) r', [null, 100, 0]);
    assert.equal(ventas.items.find(x => x.codven === v.codven)?.responsable.codusu, null);
    await assert.rejects(cancelarVenta(String(v.codven), 'Soy el creador'), error('PT652'));
    await login(2);
    const c = await cancelarVenta(String(v.codven), 'Venta registrada por error');
    assert.equal(c.estadoComercialUnidad, 'Disponible');
  });

  await t.test('HU-021: historial de cancelaciones de la moto (gerente ve todas; vendedor, solo las suyas)', async () => {
    await login(1);
    const todas = await escalar<Array<{ tipoOperacion: string; motivo: string; actor: { nombre: string } }>>('SELECT public.hu021_cancelaciones_unidad($1) r', [u[8]]);
    assert.deepEqual(todas.map(x => [x.tipoOperacion, x.motivo]), [['Separacion', 'El comprador desistió']]);
    assert.equal(todas[0]?.actor.nombre, 'Vendedora Dos');
    await login(3);
    assert.deepEqual(await escalar('SELECT public.hu021_cancelaciones_unidad($1) r', [u[8]]), []);
    const propias = await escalar<Array<{ tipoOperacion: string }>>('SELECT public.hu021_cancelaciones_unidad($1) r', [u[9]]);
    assert.deepEqual(propias.map(x => x.tipoOperacion), ['Venta']);
    await assert.rejects(escalar('SELECT public.hu021_cancelaciones_unidad($1) r', [0]), error('PT650'));
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query('SELECT public.hu021_cancelaciones_unidad(1)'), error('42501'));
  });
});
