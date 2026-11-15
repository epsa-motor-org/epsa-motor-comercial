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
  const venta = (coduni: string, techo: unknown, adicional: number | null = null, clave = randomUUID(), descuento?: {
    monto: number; motivo: string; autorizador: number; confirmacion: boolean;
  }) =>
    escalar<Record<string, unknown>>('SELECT public.hu006_crear_venta($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::uuid,$15,$16,$17,$18) r',
      [coduni, 1, 3, 1, hoy, 'Crédito', adicional, null, '[]', techo === null ? null : JSON.stringify(techo), null, null, null, clave,
        descuento?.monto ?? 0, descuento?.motivo ?? null, descuento?.autorizador ?? null, descuento?.confirmacion ?? false]);
  // Como la API: la separación y, si el comprador ya decidió, el guardado de su techo
  const separar = async (coduni: string, decision: string, codtte: number | null = null) => {
    const s = await escalar<{ codsep: string }>('SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [coduni, 1, 3, null, 100, hoy, 'Efectivo', null, null, 'Recepción en caja', true, randomUUID(), decision, codtte]);
    if (decision !== 'Por definir') await escalar('SELECT public.hu005_guardar_techo_separacion($1,$2,$3) r', [s.codsep, decision, codtte]);
    return s;
  };
  const cancelarVenta = (codven: string, motivo: string, obs: string | null = null, clave = randomUUID()) =>
    escalar<Record<string, unknown>>('SELECT public.hu021_cancelar_venta($1,$2,$3,$4::uuid) r', [codven, motivo, obs, clave]);
  const corregirRelacion = (codven: string, codcliNuevo: string | null, coduniNuevo: string | null,
    version: number, motivo = 'Corrección de prueba', clave = randomUUID()) =>
    escalar<Record<string, unknown>>('SELECT public.hu022_corregir_venta($1,$2,$3,$4,$5,$6::uuid) r',
      [codven, codcliNuevo, coduniNuevo, version, motivo, clave]);
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
  await db.exec(leer('supabase/migrations/202611130002_hu022_correccion_relacion_venta.sql'));
  await db.exec(leer('supabase/migrations/202611130003_hu022_estado_unidad_movimiento_activo.sql'));
  await db.exec(leer('supabase/migrations/202611140001_hu005_techo_solo_instalado.sql'));
  await db.exec(leer('supabase/migrations/202611140002_hu006_descuento_comercial.sql'));
  await db.exec(leer('supabase/migrations/202611140003_hu021_cancelacion_estado_e_inmutabilidad.sql'));
  // HU-022 con la regla del techo instalado e historial con nombres (se puede volver a ejecutar)
  await db.exec(leer('supabase/migrations/202611140004_hu022_techo_instalado_e_historial.sql'));
  await db.exec(leer('supabase/migrations/202611140004_hu022_techo_instalado_e_historial.sql'));
  await db.exec(leer('supabase/migrations/202611140005_movimiento_situacion_fisica_comercial.sql'));
  await db.exec(`INSERT INTO auth.users(id) VALUES ${UUIDS.map(id => `('${id}')`).join(',')};
    INSERT INTO public.rol(nomrol,estrol) VALUES ('Gerente',true),('Administradora',true),('Vendedor',true);
    INSERT INTO public.usuario(uuidusu,codrol,nomusu,apepatusu,corusu,estusu)
      VALUES ('${UUIDS[0]}',1,'Gerente','QA','gerente@qa.test',true),
             ('${UUIDS[1]}',2,'Admin','QA','admin@qa.test',true),
             ('${UUIDS[2]}',3,'Vendedor','QA','vendedor@qa.test',true),
             ('${UUIDS[3]}',3,'Vendedora','Dos','vendedora2@qa.test',true);
    INSERT INTO public.tipomotocar(nomtmo) VALUES ('Motocar QA');
    INSERT INTO public.modelo(codtmo,nommod,desmod,carmod,premod) VALUES (1,'Torito QA','Modelo sintético','Características',18335);
    INSERT INTO public.cliente(nomcli,estcli) VALUES ('Comprador Uno',true),('Comprador Dos',true),('Comprador Tres',true),('Comprador Inactivo',false);
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
  const compraHu022 = await propietario(async () => {
    const nuevo = await db.query<{ codcom: string }>(
      "INSERT INTO public.compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',25) RETURNING codcom::text");
    const codcomHu022 = nuevo.rows[0]!.codcom;
    await db.query("INSERT INTO public.factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) VALUES ($1,'QA','HU022-FAC-1','2026-11-13',25,1)", [codcomHu022]);
    await db.query(`INSERT INTO public.unidad(codcom,codmod,nummotuni,chauni,coluni,estcomuni)
      SELECT $1,1,'H022-M-' || n,'H022-C-' || n,'Azul','Disponible' FROM generate_series(1,25) n`, [codcomHu022]);
    return codcomHu022;
  });
  const unidadesHu022 = await propietario(async () => (await db.query<{ coduni: string }>(
    "SELECT coduni::text FROM public.unidad WHERE codcom=$1 ORDER BY coduni", [compraHu022])).rows.map(r => r.coduni));
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

  await t.test('CP-006: solo un techo instalado bloquea decisiones comerciales incompatibles', async () => {
    const unidadesPrueba = unidadesHu022;
    await login(1);
    await configurar(unidadesPrueba[12]!, tipo['Lona']!);
    await login(3);
    await propietario(async () => {
      await db.query("UPDATE public.unidad SET codubi=(SELECT codubi FROM public.ubicacion WHERE nomubi='Comas HU006') WHERE coduni=$1", [unidadesPrueba[12]]);
      await db.query("UPDATE public.preparacionunidad SET esttecho='Pendiente' WHERE coduni=$1", [unidadesPrueba[12]]);
    });
    const estadoFisicoAntes = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('codtte',u.codtte::text,'codubi',u.codubi::text,'codpro',u.codpro::text,
        'esttecho',p.esttecho,'estarmado',p.estarmado) r FROM public.unidad u
        LEFT JOIN public.preparacionunidad p USING(coduni) WHERE u.coduni=$1`, [unidadesPrueba[12]]));
    const pendiente = await venta(unidadesPrueba[12]!, { decision: 'Sin techo' });
    assert.equal(pendiente.techo.decision, 'Sin techo');
    const estadoFisicoDespues = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('codtte',u.codtte::text,'codubi',u.codubi::text,'codpro',u.codpro::text,
        'esttecho',p.esttecho,'estarmado',p.estarmado) r FROM public.unidad u
        LEFT JOIN public.preparacionunidad p USING(coduni) WHERE u.coduni=$1`, [unidadesPrueba[12]]));
    assert.deepEqual(estadoFisicoDespues, estadoFisicoAntes, 'la decisión comercial no modifica techo, proveedor, ubicación ni preparación');

    await login(1);
    await configurar(unidadesPrueba[13]!, tipo['Lona']!);
    await propietario(() => db.query("UPDATE public.preparacionunidad SET esttecho='En proceso' WHERE coduni=$1", [unidadesPrueba[13]]));
    await login(3);
    const enProceso = await venta(unidadesPrueba[13]!, { decision: 'Con techo', codtte: tipo['Techo clásico de fibra'] }, 1700);
    assert.equal(enProceso.techo.decision, 'Con techo');
    assert.equal(enProceso.techo.codtte, tipo['Techo clásico de fibra']);
    await login(1);
    await configurar(unidadesPrueba[14]!, tipo['Lona']!);
    await propietario(() => db.query("DELETE FROM public.preparacionunidad WHERE coduni=$1", [unidadesPrueba[14]]));
    await login(3);
    const sinFila = await venta(unidadesPrueba[14]!, { decision: 'Por definir' });
    assert.equal(sinFila.techo.decision, 'Por definir');

    for (const [indice, decision, esperado] of [
      [3, 'Sin techo', 'rechazar'],
      [4, 'Con techo', 'rechazar'],
      [5, 'Con techo', 'permitir'],
      [6, 'Por definir', 'permitir']
    ] as const) {
      await login(1);
      await configurar(unidadesPrueba[indice + 3]!, tipo['Lona']!);
      await propietario(() => db.query("UPDATE public.preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [unidadesPrueba[indice + 3]]));
      await login(3);
      const techo = decision === 'Con techo'
        ? { decision, codtte: esperado === 'permitir' ? tipo.Lona : tipo['Techo clásico de fibra'] }
        : { decision };
      const operacion = () => venta(unidadesPrueba[indice + 3]!, techo,
        decision === 'Con techo' && esperado === 'permitir' ? 200 : decision === 'Con techo' ? 1700 : null);
      if (esperado === 'rechazar') await assert.rejects(operacion(), error('PT613'));
      else assert.equal((await operacion()).techo.decision, decision);
    }

    await login(1);
    await configurar(unidadesPrueba[19]!, tipo['Lona']!);
    await propietario(() => db.query("UPDATE public.preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [unidadesPrueba[19]]));
    await login(3);
    await assert.rejects(separar(unidadesPrueba[19]!, 'Sin techo'), error('PT438'));
    const misma = await venta(unidadesPrueba[18]!, { decision: 'Con techo', codtte: tipo.Lona }, 200);
    assert.equal(misma.techo.codtte, tipo.Lona);
    const estadoFinal = await separar(unidadesPrueba[17]!, 'Sin techo');
    await assert.rejects(escalar('SELECT public.hu005_guardar_techo_separacion($1,$2,$3) r',
      [estadoFinal.codsep, 'Con techo', tipo.Lona]), error('PT440'));
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

  await t.test('HU-022: Admin corrige solo comprador; vendedor se rechaza; replay conserva un único evento y versión', async () => {
    await login(3);
    const ventaBase = await venta(u[11]!, { decision: 'Por definir' });
    await assert.rejects(corregirRelacion(String(ventaBase.codven), '2', null, 1), error('42501'));
    await login(2);
    const clave = randomUUID();
    const primera = await corregirRelacion(String(ventaBase.codven), '2', null, 1, 'Comprador capturado mal', clave);
    const op = (primera.operaciones as Array<Record<string, unknown>>)[0]!;
    assert.equal(op.codcliAnterior, '1');
    assert.equal(op.codcliNuevo, '2');
    assert.equal(op.coduniAnterior, u[11]);
    assert.equal(op.coduniNueva, u[11]);
    assert.equal(op.versionRelacion, 2);
    const replay = await corregirRelacion(String(ventaBase.codven), '2', null, 1, 'Comprador capturado mal', clave);
    assert.equal(replay.reutilizada, true);
    await assert.rejects(corregirRelacion(String(ventaBase.codven), '3', null, 1, 'Otro payload', clave), error('PT687'));
    await assert.rejects(corregirRelacion(String(ventaBase.codven), '3', null, 1), error('PT683'));
    const fila = await propietario(() => escalar<{ codcli: string; hu022_versionrelacion: number }>(
      "SELECT jsonb_build_object('codcli',codcli::text,'hu022_versionrelacion',hu022_versionrelacion) r FROM public.venta WHERE codven=$1", [ventaBase.codven]));
    assert.deepEqual(fila, { codcli: '2', hu022_versionrelacion: 2 });
    const eventos = await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.hu022_correccion_relacion_detalle WHERE codven=$1', [ventaBase.codven]));
    assert.equal(eventos, 1);
    const listado = await escalar<{ items: Array<{ codven: string; comprador: { codcli: string }; unidad: { coduni: string } }> }>(
      'SELECT public.hu006_listar_ventas(NULL,100,0) r');
    const filaLista = listado.items.find(x => x.codven === String(ventaBase.codven));
    assert.deepEqual([filaLista?.comprador.codcli,filaLista?.unidad.coduni], ['2',u[11]]);
  });

  await t.test('HU-022/HU-021: venta corregida sigue registrada y su responsable puede cancelarla sin tocar historiales ni finanzas', async () => {
    await login(3);
    await separar(u[12]!, 'Sin techo');
    const rutaEvidencia = `ventas/${u[12]}/hu022-hu021-pago.pdf`;
    await propietario(() => db.query(
      "INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('ventas-evidencia',$1,$2)", [rutaEvidencia, UUIDS[2]]));
    const ventaBase = await venta(u[12]!, null, null, randomUUID(), {
      monto: 500, motivo: 'Descuento autorizado por llamada', autorizador: 1, confirmacion: true
    });
    await propietario(() => db.query(`INSERT INTO public.pagoventa(
      codven,nropagven,codusuautorpag,montopagven,fecpagven,metpagven,refpagven,rutavoucherven,
      obspagven,ingconfpag,codusuconfpag,fecconfpag
    ) VALUES ($1,1,3,25,$2,'Transferencia','OP-HU022-HU021', $3,'Pago HU-022',true,1,now())`,
      [ventaBase.codven,hoy,rutaEvidencia]));
    const finanzasSnapshot = () => propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('impven',v.impven,'prebaseven',v.prebaseven,'adicionalrefven',v.adicionalrefven,
        'adicionalacordadoven',v.adicionalacordadoven,'descuento',v.descuentoven,'motivo',v.motivodescuentoven,
        'autorizador',v.codusuautorizadesc::text,'confirmacion',v.conftelefonicadesc,
        'fechaConfirmacion',v.fecconftelefonicadesc,
        'separacion',jsonb_build_object('codsep',s.codsep::text,'estado',s.estsep,'adelanto',s.monadesep,
          'confirmado',s.ingconfsep,'evidencia',s.rutavouchersep),
        'pagos',(SELECT COALESCE(jsonb_agg(pg_catalog.to_jsonb(p)-'codven' ORDER BY p.nropagven),'[]'::jsonb)
          FROM public.pagoventa p WHERE p.codven=v.codven)) r
       FROM public.venta v JOIN public.separacion s ON s.codsep=v.codsep WHERE v.codven=$1`, [ventaBase.codven]));
    const finanzasAntes = await finanzasSnapshot();
    assert.deepEqual([finanzasAntes.impven,finanzasAntes.prebaseven,finanzasAntes.adicionalrefven,
      finanzasAntes.adicionalacordadoven,finanzasAntes.descuento], [17835,18335,0,0,500]);
    const estadoAntes = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('estado',estven,'responsable',codusuresp::text,'unidad',coduni::text) r FROM public.venta WHERE codven=$1",
      [ventaBase.codven]));
    assert.deepEqual(estadoAntes, { estado: 'Registrada', responsable: '3', unidad: u[12] });
    const fisicoOrigenAntes = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codtte',codtte,'coluni',coluni,'codpro',codpro,'codepr',codepr,'codubi',codubi) r FROM public.unidad WHERE coduni=$1", [u[12]]));
    const fisicoDestinoAntes = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codtte',codtte,'coluni',coluni,'codpro',codpro,'codepr',codepr,'codubi',codubi) r FROM public.unidad WHERE coduni=$1", [u[13]]));
    await login(1);
    const corregida = await corregirRelacion(String(ventaBase.codven), null, u[13]!, 1);
    const operacion = (corregida.operaciones as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual([operacion.coduniAnterior, operacion.coduniNueva], [u[12], u[13]]);
    assert.equal(await estadoUnidad(u[12]!), 'Disponible');
    assert.equal(await estadoUnidad(u[13]!), 'Vendida');
    const finanzasDespues = await finanzasSnapshot();
    assert.deepEqual(finanzasDespues, finanzasAntes);
    const fisicoOrigenDespues = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codtte',codtte,'coluni',coluni,'codpro',codpro,'codepr',codepr,'codubi',codubi) r FROM public.unidad WHERE coduni=$1", [u[12]]));
    const fisicoDestinoDespues = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codtte',codtte,'coluni',coluni,'codpro',codpro,'codepr',codepr,'codubi',codubi) r FROM public.unidad WHERE coduni=$1", [u[13]]));
    assert.deepEqual(fisicoOrigenDespues, fisicoOrigenAntes);
    assert.deepEqual(fisicoDestinoDespues, fisicoDestinoAntes);
    const estadoDespuesCorreccion = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('estado',estven,'responsable',codusuresp::text,'unidad',coduni::text) r FROM public.venta WHERE codven=$1",
      [ventaBase.codven]));
    assert.deepEqual(estadoDespuesCorreccion, { estado: 'Registrada', responsable: '3', unidad: u[13] });
    const correccionesAntesCancelacion = await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.hu022_correccion_relacion_detalle WHERE codven=$1', [ventaBase.codven]));
    const cancelacionesAntesCancelacion = await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.historialcancelacion WHERE codven=$1', [ventaBase.codven]));
    assert.equal(correccionesAntesCancelacion, 1);
    assert.equal(cancelacionesAntesCancelacion, 0);

    await login(3);
    const resultadoCancelacion = await cancelarVenta(String(ventaBase.codven),
      'Prueba de cancelación posterior a HU-022', 'Conservar adelanto y pago para conciliación');
    assert.equal(resultadoCancelacion.cancelador, '3', 'el responsable vigente puede cancelar la venta corregida');
    assert.equal((await propietario(() => escalar<string>(
      'SELECT estven r FROM public.venta WHERE codven=$1', [ventaBase.codven]))), 'Cancelada');
    assert.deepEqual(await finanzasSnapshot(), finanzasAntes,
      'HU-021 conserva snapshots, adelanto, pago y evidencia de la venta ya corregida');
    assert.equal(await escalar('SELECT public.hu006_venta_de_unidad($1) r', [u[13]]), null);
    const cancelacionesDestino = await escalar<Array<{ codOperacion: string }>>('SELECT public.hu021_cancelaciones_unidad($1) r', [u[13]]);
    assert.equal(cancelacionesDestino.length, 1);
    assert.equal((await escalar('SELECT public.hu021_cancelaciones_unidad($1) r', [u[12]]) as unknown[]).length, 0);

    const versionActual = Number(operacion.versionRelacion);
    await login(1);
    await assert.rejects(corregirRelacion(String(ventaBase.codven), null, u[12]!, versionActual,
      'Intento posterior a cancelación'), error('PT689'));
    const correccionesDespues = await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.hu022_correccion_relacion_detalle WHERE codven=$1', [ventaBase.codven]));
    const cancelacionesDespues = await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.historialcancelacion WHERE codven=$1', [ventaBase.codven]));
    assert.deepEqual([correccionesDespues,cancelacionesDespues], [correccionesAntesCancelacion,1],
      'HU-021 no altera el historial HU-022 y una HU-022 rechazada no altera HU-021');

    await login(3);
    const ventaNueva = await venta(u[12]!, { decision: 'Por definir' });
    await login(2);
    const reasignada = await corregirRelacion(String(ventaNueva.codven), null, u[13]!, 1, 'El destino solo tenía una venta cancelada');
    assert.equal((reasignada.operaciones as Array<Record<string, unknown>>)[0]!.coduniNueva, u[13]);
  });

  await t.test('HU-022: Gerente confirma comprador + unidad con separación Convertida y conserva su adelanto histórico', async () => {
    const unidadConversion = unidadesHu022[24]!;
    await login(3);
    await separar(unidadConversion, 'Por definir');
    const ventaBase = await venta(unidadConversion, null);
    const separacion = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codsep',codsep::text,'codcli',codcli::text,'coduni',coduni::text,'estsep',estsep,'monadesep',monadesep) r FROM public.separacion WHERE coduni=$1", [unidadConversion]));
    await login(2);
    await assert.rejects(corregirRelacion(String(ventaBase.codven), '2', null, 1), error('PT686'));
    await login(1);
    const corregida = await corregirRelacion(String(ventaBase.codven), '2', null, 1, 'Cambio confirmado por gerente');
    assert.equal((corregida.operaciones as Array<Record<string, unknown>>)[0]!.codsepVinculada, separacion.codsep);
    const resultado = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codcli',codcli::text,'coduni',coduni::text,'codsep',codsep::text,'impven',impven) r FROM public.venta WHERE codven=$1", [ventaBase.codven]));
    assert.deepEqual([resultado.codcli,resultado.coduni,resultado.codsep], ['2',unidadConversion,separacion.codsep]);
    const separacionFinal = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('codcli',codcli::text,'coduni',coduni::text,'estsep',estsep,'monadesep',monadesep) r FROM public.separacion WHERE codsep=$1", [separacion.codsep]));
    assert.deepEqual(separacionFinal, { codcli: '1', coduni: unidadConversion, estsep: 'Convertida', monadesep: separacion.monadesep });
    assert.equal(Number((await escalar<Record<string, unknown>>('SELECT public.hu006_venta_de_unidad($1) r', [unidadConversion])).totalRecibido), 100);
  });

  await t.test('HU-022: cambio simultáneo de comprador y unidad conserva la venta y descarta compromisos cancelados', async () => {
    await login(3);
    const ventaBase = await venta(unidadesHu022[20]!, { decision: 'Sin techo' });
    await login(2);
    const corregida = await corregirRelacion(String(ventaBase.codven), '3', unidadesHu022[21]!, 1, 'Se cruzó comprador y moto');
    const operacion = (corregida.operaciones as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual([operacion.codcliAnterior,operacion.codcliNuevo,operacion.coduniAnterior,operacion.coduniNueva],
      ['1','3',unidadesHu022[20],unidadesHu022[21]]);
    assert.equal(await estadoUnidad(unidadesHu022[20]!), 'Disponible');
    assert.equal(await estadoUnidad(unidadesHu022[21]!), 'Vendida');
  });

  await t.test('HU-022: intercambio cruzado de dos ventas es atómico, comparte evento y no libera unidades', async () => {
    await login(3);
    const ventaA = await venta(u[14]!, { decision: 'Por definir' });
    const ventaB = await venta(u[15]!, { decision: 'Por definir' });
    await propietario(async () => {
      await db.query(`INSERT INTO public.pagoventa(codven,nropagven,codusuautorpag,montopagven,fecpagven,metpagven,
        obspagven,ingconfpag,codusuconfpag,fecconfpag) VALUES ($1,1,3,25,$2,'Efectivo','Recepción en caja',true,3,now())`, [ventaA.codven,hoy]);
      await db.query(`INSERT INTO public.pagoventa(codven,nropagven,codusuautorpag,montopagven,fecpagven,metpagven,
        obspagven,ingconfpag,codusuconfpag,fecconfpag) VALUES ($1,1,3,40,$2,'Efectivo','Recepción en caja',true,3,now())`, [ventaB.codven,hoy]);
    });
    await login(2);
    const previewA = await escalar<{ venta: { versionRelacion: number } }>(
      'SELECT public.hu022_preview_correccion_venta($1) r', [ventaA.codven]);
    const previewB = await escalar<{ venta: { versionRelacion: number } }>(
      'SELECT public.hu022_preview_correccion_venta($1) r', [ventaB.codven]);
    const clave = randomUUID();
    const intercambio = await escalar<Record<string, unknown>>(
      'SELECT public.hu022_intercambiar_ventas($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid) r',
      [ventaA.codven,null,u[15],previewA.venta.versionRelacion,ventaB.codven,null,u[14],previewB.venta.versionRelacion,'Intercambio validado',clave]);
    const ops = intercambio.operaciones as Array<Record<string, unknown>>;
    assert.equal(ops.length, 2);
    assert.deepEqual(ops.map(x => [x.coduniAnterior,x.coduniNueva]), [[u[14],u[15]],[u[15],u[14]]]);
    assert.equal(await estadoUnidad(u[14]!), 'Vendida');
    assert.equal(await estadoUnidad(u[15]!), 'Vendida');
    const pagos = await propietario(async () => (await db.query<{ codven: string; monto: number }>(
      'SELECT codven::text,montopagven::float8 monto FROM public.pagoventa WHERE codven=ANY($1::bigint[]) ORDER BY codven',
      [[ventaA.codven,ventaB.codven]])).rows);
    assert.deepEqual(pagos, [{ codven: String(ventaA.codven), monto: 25 }, { codven: String(ventaB.codven), monto: 40 }]);
    const replay = await escalar<Record<string, unknown>>(
      'SELECT public.hu022_intercambiar_ventas($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid) r',
      [ventaA.codven,null,u[15],previewA.venta.versionRelacion,ventaB.codven,null,u[14],previewB.venta.versionRelacion,'Intercambio validado',clave]);
    assert.equal(replay.reutilizada, true);
    await assert.rejects(escalar('SELECT public.hu022_intercambiar_ventas($1,NULL,$2,2,$3,NULL,$4,2,$5,$6::uuid) r',
      [ventaA.codven,u[15],ventaB.codven,u[14],'No es un intercambio cruzado',randomUUID()]), error('PT690'));
    const separacionTercera = await propietario(() => escalar<string>(
      `INSERT INTO public.separacion(coduni,codcli,codusu,metpagsep,monadesep,refsep,codusuresp,fecpagsep,
        ingconfsep,codusuconfsep,fecconfsep,idempotenciasep,obssep)
       VALUES ($1,1,3,'Efectivo',100,NULL,3,$2,true,3,now(),$3,'Separación sintética de conflicto') RETURNING codsep::text r`,
      [u[14],hoy,randomUUID()]));
    await assert.rejects(escalar('SELECT public.hu022_intercambiar_ventas($1,NULL,$2,2,$3,NULL,$4,2,$5,$6::uuid) r',
      [ventaA.codven,u[14],ventaB.codven,u[15],'Existe un tercer compromiso',randomUUID()]), error('PT685'));
    await propietario(() => db.query('DELETE FROM public.separacion WHERE codsep=$1', [separacionTercera]));
    const evento = await propietario(() => escalar<{ eventos: number; detalles: number }>(
      "SELECT jsonb_build_object('eventos',count(DISTINCT e.codcor)::int,'detalles',count(d.coddet)::int) r FROM public.hu022_correccion_relacion e JOIN public.hu022_correccion_relacion_detalle d USING(codcor) WHERE d.codven=ANY($1::bigint[])", [[ventaA.codven,ventaB.codven]]));
    assert.deepEqual(evento, { eventos: 1, detalles: 2 });
    const historialA = await escalar<Array<{ codcor: string; operaciones: unknown[] }>>('SELECT public.hu022_historial_venta($1) r', [ventaA.codven]);
    const historialB = await escalar<Array<{ codcor: string; operaciones: unknown[] }>>('SELECT public.hu022_historial_venta($1) r', [ventaB.codven]);
    assert.equal(historialA[0]?.codcor, historialB[0]?.codcor);
    assert.equal(historialA[0]?.operaciones.length, 2);
  });

  await t.test('HU-022: una falla de auditoría revierte relación, versión y estado comercial', async () => {
    await login(3);
    const ventaBase = await venta(unidadesHu022[22]!, { decision: 'Por definir' });
    await propietario(() => db.exec(`CREATE FUNCTION public.hu022_fallar_auditoria_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE='PT699', MESSAGE='Fallo sintético de auditoría'; END $$;
      CREATE TRIGGER hu022_fallar_auditoria_test BEFORE INSERT ON public.hu022_correccion_relacion
      FOR EACH ROW EXECUTE FUNCTION public.hu022_fallar_auditoria_test();`));
    await login(1);
    await assert.rejects(corregirRelacion(String(ventaBase.codven), '2', null, 1), error('PT699'));
    const fila = await propietario(() => escalar<{ codcli: string; version: number; estado: string }>(
      "SELECT jsonb_build_object('codcli',v.codcli::text,'version',v.hu022_versionrelacion,'estado',u.estcomuni) r FROM public.venta v JOIN public.unidad u USING(coduni) WHERE v.codven=$1", [ventaBase.codven]));
    assert.deepEqual(fila, { codcli: '1', version: 1, estado: 'Vendida' });
    const n = await propietario(() => escalar<number>('SELECT count(*)::int r FROM public.hu022_correccion_relacion_detalle WHERE codven=$1', [ventaBase.codven]));
    assert.equal(n, 0);
    await propietario(() => db.exec('DROP TRIGGER hu022_fallar_auditoria_test ON public.hu022_correccion_relacion; DROP FUNCTION public.hu022_fallar_auditoria_test()'));
  });

  await t.test('HU-022: rechaza venta destino, separación activa e incompatibilidad física', async () => {
    const extra = unidadesHu022;
    await login(3);
    const comprometida = await venta(extra[0]!, { decision: 'Por definir' });
    const fuenteVenta = await venta(extra[1]!, { decision: 'Por definir' });
    await login(1);
    await assert.rejects(corregirRelacion(String(fuenteVenta.codven), null, extra[0]!, 1), error('PT685'));
    await assert.rejects(corregirRelacion(String(fuenteVenta.codven), '99999', null, 1), error('PT682'));
    await assert.rejects(corregirRelacion(String(fuenteVenta.codven), '4', null, 1), error('PT682'));
    await assert.rejects(corregirRelacion(String(fuenteVenta.codven), '1', null, 1), error('PT684'));
    await cancelarVenta(String(comprometida.codven), 'Liberación de unidad de prueba');

    await login(3);
    await separar(extra[2]!, 'Por definir');
    const ventaConUnidadFuente = await venta(extra[3]!, { decision: 'Por definir' });
    await login(1);
    await assert.rejects(corregirRelacion(String(ventaConUnidadFuente.codven), null, extra[2]!, 1), error('PT685'));

    await propietario(async () => {
      await db.query('UPDATE public.unidad SET codtte=$2 WHERE coduni=$1', [extra[4], tipo['Lona']]);
      await db.query("UPDATE public.preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [extra[4]]);
    });
    await login(3);
    const ventaTecho = await venta(extra[5]!, { decision: 'Sin techo' });
    await login(1);
    // Techo instalado distinto del acuerdo: bloquea con el mismo código de separación y venta (202611140004)
    await assert.rejects(corregirRelacion(String(ventaTecho.codven), null, extra[4]!, 1), error('PT438'));
  });

  await t.test('HU-006: una venta anterior al descuento (NULL) resuelve su techo con descuento 0; cancelada responde PT623', async () => {
    const libre = await propietario(async () => {
      const c = (await db.query<{ codcom: string }>("INSERT INTO public.compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',1) RETURNING codcom::text")).rows[0]!.codcom;
      await db.query("INSERT INTO public.factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) VALUES ($1,'QA','HU006-HIST','2026-11-13',1,1)", [c]);
      return (await db.query<{ coduni: string }>(`INSERT INTO public.unidad(codcom,codmod,nummotuni,chauni,coluni,estcomuni)
        VALUES ($1,1,'H006-HIST-M','H006-HIST-C','Azul','Disponible') RETURNING coduni::text`, [c])).rows[0]!.coduni;
    });
    await login(3);
    const hist = await venta(libre, { decision: 'Por definir' });
    // Así quedaron las ventas registradas antes de 202611140002
    await propietario(() => db.query('UPDATE public.venta SET descuentoven=NULL, conftelefonicadesc=NULL WHERE codven=$1', [hist.codven]));
    const r = await escalar<Record<string, unknown>>('SELECT public.hu006_guardar_techo_venta($1,$2,$3,$4) r', [hist.codven, 'Con techo', tipo['Lona'], 200]);
    assert.equal(Number(r.importe), 18535);
    const fila = await propietario(async () => (await db.query<{ impven: string; descuentoven: string | null; dectechoven: string }>(
      'SELECT impven::text,descuentoven::text,dectechoven FROM public.venta WHERE codven=$1', [hist.codven])).rows[0]!);
    assert.deepEqual(fila, { impven: '18535.00', descuentoven: null, dectechoven: 'Con techo' });
    await login(1);
    await cancelarVenta(String(hist.codven), 'Prueba de venta cancelada');
    await assert.rejects(escalar('SELECT public.hu006_guardar_techo_venta($1,$2,$3,$4) r', [hist.codven, 'Con techo', tipo['Lona'], 200]), error('PT623'));
    await assert.rejects(escalar('SELECT public.hu006_guardar_techo_venta($1,$2,$3,$4) r', [hist.codven, 'Sin techo', null, null]), error('PT623'));
  });

  await t.test('HU-022: un techo solo configurado en la moto destino no bloquea y el historial trae nombres', async () => {
    const extra = unidadesHu022;
    await propietario(async () => {
      await db.query('UPDATE public.unidad SET codtte=$2 WHERE coduni=$1', [extra[16], tipo['Lona']]);
      await db.query("UPDATE public.preparacionunidad SET esttecho='Pendiente' WHERE coduni=$1", [extra[16]]);
    });
    await login(3);
    const ventaSin = await venta(extra[15]!, { decision: 'Sin techo' });
    await login(2);
    const r = await corregirRelacion(String(ventaSin.codven), null, extra[16]!, 1, 'Se registró la moto equivocada');
    assert.equal((r.operaciones as Array<Record<string, unknown>>)[0]!.coduniNueva, extra[16]);
    assert.equal(await estadoUnidad(extra[15]!), 'Disponible');
    assert.equal(await estadoUnidad(extra[16]!), 'Vendida');
    // La configuración de techo de la moto no cambia: la diferencia se corrige en la ficha
    assert.equal(await propietario(() => escalar<string>('SELECT codtte::text r FROM public.unidad WHERE coduni=$1', [extra[16]])), tipo['Lona']);

    type Evento = { actor: { nombre: string }; unidadAnterior: { motor: string; coduni: string }; unidadNueva: { motor: string; chasis: string };
      compradorAnterior: { nombre: string }; compradorNuevo: { nombre: string }; otrasVentas: string[]; tipo: string; motivo: string };
    const porVenta = await escalar<Evento[]>('SELECT public.hu022_correcciones_detalle($1, NULL) r', [ventaSin.codven]);
    assert.equal(porVenta.length, 1);
    assert.equal(porVenta[0]!.tipo, 'Individual');
    assert.equal(porVenta[0]!.motivo, 'Se registró la moto equivocada');
    assert.equal(porVenta[0]!.actor.nombre, 'Admin QA');
    assert.equal(porVenta[0]!.unidadAnterior.motor, 'H022-M-16');
    assert.deepEqual([porVenta[0]!.unidadNueva.motor, porVenta[0]!.unidadNueva.chasis], ['H022-M-17', 'H022-C-17']);
    assert.ok(porVenta[0]!.compradorAnterior.nombre);
    assert.equal(porVenta[0]!.compradorNuevo.nombre, porVenta[0]!.compradorAnterior.nombre);
    assert.deepEqual(porVenta[0]!.otrasVentas, []);
    // Por moto: la de origen y la de destino ven el mismo evento
    assert.equal((await escalar<Evento[]>('SELECT public.hu022_correcciones_detalle(NULL, $1) r', [extra[15]])).length, 1);
    assert.equal((await escalar<Evento[]>('SELECT public.hu022_correcciones_detalle(NULL, $1) r', [extra[16]])).length, 1);
    await assert.rejects(escalar('SELECT public.hu022_correcciones_detalle(NULL, NULL) r'), error('PT681'));
    await login(3);
    await assert.rejects(escalar('SELECT public.hu022_correcciones_detalle($1, NULL) r', [ventaSin.codven]), error('42501'));
    await login(1);
  });

  await t.test('HU-022: un destino configurado Sin techo sigue compatible con una venta Con techo', async () => {
    const extra = unidadesHu022;
    await propietario(async () => {
      // extra[8] se vendió en la primera matriz de HU-005; usar la unidad libre
      // 11 evita que el trigger de coherencia entre techo físico y venta previa
      // contamine este caso de compatibilidad para HU-022.
      await db.query('UPDATE public.unidad SET codtte=$2 WHERE coduni=$1', [extra[11], tipo['Sin techo']]);
      await db.query("UPDATE public.preparacionunidad SET esttecho='No requiere' WHERE coduni=$1", [extra[11]]);
    });
    await login(3);
    const ventaTecho = await venta(extra[10]!, { decision: 'Con techo', codtte: tipo['Lona'] }, 200);
    await login(1);
    const resultado = await corregirRelacion(String(ventaTecho.codven), null, extra[11]!, 1, 'Destino sin techo configurado');
    assert.equal((resultado.operaciones as Array<Record<string, unknown>>)[0]!.coduniNueva, extra[11]);
    assert.equal((await escalar<Record<string, unknown>>('SELECT public.hu006_venta_de_unidad($1) r', [extra[11]])).codven, String(ventaTecho.codven));
    assert.equal(await estadoUnidad(extra[10]!), 'Disponible');
  });

  await t.test('HU-022: falla en la segunda actualización del intercambio revierte ambas ventas y el evento', async () => {
    const extra = unidadesHu022;
    await login(3);
    const ventaA = await venta(extra[6]!, { decision: 'Por definir' });
    const ventaB = await venta(extra[7]!, { decision: 'Por definir' });
    await propietario(() => db.exec(`CREATE FUNCTION public.hu022_fallar_segunda_venta_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.codven = ${ventaB.codven} THEN RAISE EXCEPTION USING ERRCODE='PT699', MESSAGE='Fallo sintético de segunda operación'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER hu022_fallar_segunda_venta_test BEFORE UPDATE OF coduni ON public.venta
      FOR EACH ROW EXECUTE FUNCTION public.hu022_fallar_segunda_venta_test();`));
    await login(1);
    await assert.rejects(escalar('SELECT public.hu022_intercambiar_ventas($1,NULL,$2,1,$3,NULL,$4,1,$5,$6::uuid) r',
      [ventaA.codven,extra[7],ventaB.codven,extra[6],'Fallo segunda actualización',randomUUID()]), error('PT699'));
    const relaciones = await propietario(async () => (await db.query<{ codven: string; coduni: string }>(
      'SELECT codven::text,coduni::text FROM public.venta WHERE codven=ANY($1::bigint[]) ORDER BY codven', [[ventaA.codven,ventaB.codven]])).rows);
    assert.deepEqual(relaciones, [{ codven: String(ventaA.codven), coduni: extra[6] }, { codven: String(ventaB.codven), coduni: extra[7] }]);
    assert.equal(await estadoUnidad(extra[6]!), 'Vendida');
    assert.equal(await estadoUnidad(extra[7]!), 'Vendida');
    const eventos = await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.hu022_correccion_relacion_detalle WHERE codven=ANY($1::bigint[])', [[ventaA.codven,ventaB.codven]]));
    assert.equal(eventos, 0);
    await propietario(() => db.exec('DROP TRIGGER hu022_fallar_segunda_venta_test ON public.venta; DROP FUNCTION public.hu022_fallar_segunda_venta_test()'));
  });

  await t.test('HU-022: la unidad anterior queda Disponible con movimiento activo y sin otro compromiso', async () => {
    const extra = unidadesHu022;
    await login(3);
    const ventaBase = await venta(extra[10]!, { decision: 'Por definir' });
    const ubicacionesMovimiento = await propietario(async () => (await db.query<{ codubi: string; nomubi: string }>(
      "SELECT codubi::text,nomubi FROM public.ubicacion WHERE nomubi IN ('Comas','Ventanilla')")).rows);
    const codubiOrigen = ubicacionesMovimiento.find(x => x.nomubi === 'Comas')!.codubi;
    const codubiDestino = ubicacionesMovimiento.find(x => x.nomubi === 'Ventanilla')!.codubi;
    await propietario(() => db.query('UPDATE public.unidad SET codubi=$2 WHERE coduni=$1', [extra[10], codubiOrigen]));
    await login(1);
    const codmub = await escalar<string>(
      "SELECT (public.hu003_iniciar_movimiento($1,$2,$3,'Traslado vigente durante la corrección')->>'codmub') r",
      [extra[10], codubiOrigen, codubiDestino]);
    const movimientoAntes = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('coduni',coduni::text,'codubiori',codubiori::text,'codubides',codubides::text,'estado',estmub) r FROM public.movimientoubicacion WHERE codmub=$1",
      [codmub]));
    const fisicoAntes = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('ubicacion',u.codubi::text,'techo',u.codtte::text,'proveedor',u.codpro::text,
        'detalleTecho',u.dettecuni,'preparacion',pg_catalog.to_jsonb(p)-'coduni') r
       FROM public.unidad u LEFT JOIN public.preparacionunidad p USING(coduni) WHERE u.coduni=$1`, [extra[10]]));

    const corregida = await corregirRelacion(String(ventaBase.codven), null, extra[23]!, 1, 'La unidad anterior mantiene un traslado activo');
    const operacion = (corregida.operaciones as Array<Record<string, unknown>>)[0]!;
    assert.equal(operacion.estadoUnidadOrigenResultante, 'Disponible');
    assert.equal(await estadoUnidad(extra[10]!), 'Disponible');
    assert.equal(await estadoUnidad(extra[23]!), 'Vendida');
    const movimientoDespues = await propietario(() => escalar<Record<string, unknown>>(
      "SELECT jsonb_build_object('coduni',coduni::text,'codubiori',codubiori::text,'codubides',codubides::text,'estado',estmub) r FROM public.movimientoubicacion WHERE codmub=$1",
      [codmub]));
    assert.deepEqual(movimientoDespues, movimientoAntes);
    assert.equal(await propietario(() => escalar<string>('SELECT codubi::text r FROM public.unidad WHERE coduni=$1', [extra[10]])), codubiOrigen);
    assert.deepEqual(await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('ubicacion',u.codubi::text,'techo',u.codtte::text,'proveedor',u.codpro::text,
        'detalleTecho',u.dettecuni,'preparacion',pg_catalog.to_jsonb(p)-'coduni') r
       FROM public.unidad u LEFT JOIN public.preparacionunidad p USING(coduni) WHERE u.coduni=$1`, [extra[10]])), fisicoAntes);
  });
});
