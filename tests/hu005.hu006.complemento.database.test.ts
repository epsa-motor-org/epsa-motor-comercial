import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Migration 202611100002 (complemento del 10 de noviembre) sobre la cadena de HU-005 y la HU-006 de Michelle:
// adelanto mínimo de la separación y consulta de la venta de una moto para su ficha.

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface VentaSQL {
  codven: string; coduni: string; codcli: string; codsep: string | null; importe: number;
  totalRecibido: number; saldo: number; estado: string; reutilizada: boolean;
  modalidad: string; techo: { decision: string; codtte: string | null };
  pagos: Array<{ monto: number; medioPago: string; confirmadoPor: string; rutaEvidencia: string | null }>;
}

const leer = (ruta: string) => readFileSync(ruta, 'utf8');
const UUIDS = [1, 2, 3, 4, 5, 6].map(n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
const migracionesPrevias = [
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

test('HU-005/HU-006 PostgreSQL: adelanto mínimo y consulta de la venta de una moto', async t => {
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
  const claveNueva = () => randomUUID();
  const ventaParams = (coduni: string, opciones: Partial<{
    codcli: number; responsable: number; sede: number; fecha: string; modalidad: string;
    importe: number; entrega: number | null; pagos: unknown[]; techo: unknown;
    refcomp: string | null; feccomp: string | null; observacion: string | null; clave: string;
  }> = {}) => [
    coduni, opciones.codcli ?? 1, opciones.responsable ?? 3, opciones.sede ?? 1,
    opciones.fecha ?? '2026-11-09', opciones.modalidad ?? 'Crédito', opciones.importe ?? 1000,
    opciones.entrega ?? null, JSON.stringify(opciones.pagos ?? []),
    opciones.techo === undefined ? JSON.stringify({ decision: 'Por definir' })
      : opciones.techo === null ? null : JSON.stringify(opciones.techo),
    opciones.refcomp ?? null, opciones.feccomp ?? null, opciones.observacion ?? null,
    opciones.clave ?? claveNueva()
  ];
  const crearVenta = (coduni: string, opciones: Parameters<typeof ventaParams>[1] = {}) =>
    escalar<VentaSQL>('SELECT public.hu006_crear_venta($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::uuid) r',
      ventaParams(coduni, opciones));
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const crearSeparacion = async (coduni: string, codcli = 1, decision: 'Por definir' | 'Sin techo' | 'Con techo' = 'Por definir', codtte: number | null = null, monto = 100, clave = claveNueva()) => {
    const separacion = await escalar<{ codsep: string }>(
      'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [coduni, codcli, 3, null, monto, hoy, 'Efectivo', null, null, 'Recepción en caja', true, clave, decision, codtte]);
    if (decision !== 'Por definir')
      await escalar('SELECT public.hu005_guardar_techo_separacion($1,$2,$3) r', [separacion.codsep, decision, codtte]);
    return separacion.codsep;
  };

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
  for (const migration of migracionesPrevias) await db.exec(leer(`supabase/migrations/${migration}`));
  await db.exec('ALTER TABLE public.separacion ENABLE ROW LEVEL SECURITY; ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY; GRANT ALL ON public.separacion,public.venta TO authenticated; GRANT USAGE,SELECT ON SEQUENCE public.separacion_codsep_seq TO authenticated;');
  await db.exec(leer('supabase/migrations/202611100001_hu006_venta_cliente_unidad.sql'));
  await db.exec(leer('supabase/migrations/202611100002_hu005_hu006_adelanto_minimo_y_venta_de_unidad.sql'));
  // Se puede volver a ejecutar
  await db.exec(leer('supabase/migrations/202611100002_hu005_hu006_adelanto_minimo_y_venta_de_unidad.sql'));
  await db.exec(`INSERT INTO auth.users(id) VALUES ${UUIDS.map(id => `('${id}')`).join(',')};
    INSERT INTO public.rol(nomrol,estrol) VALUES ('Gerente',true),('Administradora',true),('Vendedor',true),('Auxiliar',true);
    INSERT INTO public.usuario(uuidusu,codrol,nomusu,apepatusu,corusu,estusu)
      VALUES ('${UUIDS[0]}',1,'Gerente','QA','gerente@qa.test',true),
             ('${UUIDS[1]}',2,'Admin','QA','admin@qa.test',true),
             ('${UUIDS[2]}',3,'Vendedor','QA','vendedor@qa.test',true),
             ('${UUIDS[3]}',4,'Auxiliar','QA','auxiliar@qa.test',true),
             ('${UUIDS[4]}',2,'Integracion','Facturas','integracion.facturas@epsa.internal',true),
             ('${UUIDS[5]}',3,'Vendedor','Interno','vendedor@epsa.internal',true);
    INSERT INTO public.tipomotocar(nomtmo) VALUES ('Motocar QA');
    INSERT INTO public.modelo(codtmo,nommod,desmod,carmod,premod) VALUES (1,'Torito QA','Modelo sintético','Características',10000);
    INSERT INTO public.tipodocumento(nomtdo) VALUES ('DNI QA');
    INSERT INTO public.cliente(nomcli,estcli) VALUES ('Comprador Uno',true),('Comprador Dos',true),('Comprador Inactivo',false);
    INSERT INTO public.tipotecho(nomtte,reqprotte,reqinsttte,esttte)
      VALUES ('Sin techo QA',false,false,true),('Lona QA',true,true,true),('Techo inactivo QA',true,true,false);
    INSERT INTO public.proveedor(nompro) VALUES ('Proveedor QA');
    INSERT INTO public.estadopreparacion(nomepr) VALUES ('Preparación QA');
    INSERT INTO public.ubicacion(nomubi,tipubi) VALUES ('Comas HU006','Sede'),('Ventanilla HU006','Sede'),('Ancón HU006','Almacen');
    INSERT INTO public.sede(codubi,telsed,horsed,estsed) VALUES (1,'999999999','9-6',true),(2,'999999998','9-6',true);
  `);

  const unidades = Array.from({ length: 25 }, (_, i) => ({
    nummotuni: `HU006-M-${i + 1}`, chauni: `HU006-C-${i + 1}`, codmod: '1', coluni: 'Azul'
  }));
  const compra = await propietario(async () => {
    const r = await db.query<{ codcom: string }>("INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',25) RETURNING codcom::text");
    await db.query("INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) VALUES ($1,'QA','HU006-FAC','2026-11-09',25,1)", [r.rows[0]!.codcom]);
    return r.rows[0]!.codcom;
  });
  await login(1);
  await escalar('SELECT public.hu002_identificar_unidades($1,$2::jsonb) r', [compra, JSON.stringify(unidades)]);
  const codunis = await propietario(async () => (await db.query<{ coduni: string }>(
    "SELECT coduni::text FROM public.unidad WHERE nummotuni LIKE 'HU006-M-%' ORDER BY coduni"
  )).rows.map(r => r.coduni));
  const tipos = await propietario(async () => (await db.query<{ codtte: string }>(
    "SELECT codtte::text FROM public.tipotecho WHERE nomtte='Lona QA'"
  )).rows[0]!.codtte);


  await t.after(() => db.close());
  const ventaDe = (coduni: string) => escalar<Record<string, unknown> | null>('SELECT public.hu006_venta_de_unidad($1) r', [coduni]);
  const separaciones = (coduni: string) => propietario(async () => Number((await db.query<{ n: string }>(
    'SELECT count(*)::text n FROM public.separacion WHERE coduni=$1', [coduni])).rows[0]!.n));

  await t.test('El adelanto mínimo es S/ 100.00 (PT442) y no deja registros parciales', async () => {
    await login(3);
    await assert.rejects(crearSeparacion(codunis[0]!, 1, 'Por definir', null, 99.99), error('PT442'));
    await assert.rejects(crearSeparacion(codunis[0]!, 1, 'Por definir', null, 0.5), error('PT442'));
    assert.equal(await separaciones(codunis[0]!), 0);
    const estado = await propietario(async () => (await db.query<{ e: string }>('SELECT estcomuni e FROM public.unidad WHERE coduni=$1', [codunis[0]])).rows[0]!.e);
    assert.equal(estado, 'Disponible');
  });

  await t.test('S/ 100.01 es aceptado, queda persistido exacto y el replay idempotente no duplica el adelanto', async () => {
    await login(3);
    const unidad = codunis[24]!;
    const clave = claveNueva();
    const primera = await crearSeparacion(unidad, 1, 'Por definir', null, 100.01, clave);
    const replay = await crearSeparacion(unidad, 1, 'Por definir', null, 100.01, clave);
    assert.equal(replay, primera, 'el replay recupera la misma separación');

    const persistido = await propietario(() => escalar<{ cantidad: number; monto: number; conClave: number }>(
      `SELECT jsonb_build_object('cantidad',count(*)::int,'monto',max(monadesep),
        'conClave',count(*) FILTER (WHERE idempotenciasep=$2)::int) r
       FROM public.separacion WHERE coduni=$1`, [unidad, clave]));
    assert.deepEqual(persistido, { cantidad: 1, monto: 100.01, conClave: 1 });
    assert.equal(await propietario(() => escalar<string>(
      'SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [unidad])), 'Separada');
  });

  await t.test('Desde S/ 100.00 hasta el precio de lista se separa; un céntimo más se rechaza (PT435)', async () => {
    await login(3);
    await crearSeparacion(codunis[0]!, 1, 'Por definir', null, 100);
    assert.equal(await separaciones(codunis[0]!), 1);
    await crearSeparacion(codunis[1]!, 1, 'Por definir', null, 10000);
    await assert.rejects(crearSeparacion(codunis[2]!, 1, 'Por definir', null, 10000.01), error('PT435'));
  });

  await t.test('La consulta de la venta devuelve null si la moto no tiene venta', async () => {
    await login(3);
    assert.equal(await ventaDe(codunis[3]!), null);
  });

  await t.test('La consulta de la venta incluye comprador, techo elegido y el adelanto de la separación convertida', async () => {
    await login(3);
    await crearSeparacion(codunis[4]!, 1, 'Con techo', Number(tipos), 3000);
    const vendida = await crearVenta(codunis[4]!, { modalidad: 'Contado', importe: 10000, techo: null,
      pagos: [{ monto: 7000, fecha: '2026-11-09', medioPago: 'Efectivo', observacion: 'Saldo en caja', ingresoConfirmado: true }] });
    const v = await ventaDe(codunis[4]!) as Record<string, any>;
    assert.equal(v.codven, vendida.codven);
    assert.equal(v.saldo, 0);
    assert.equal(v.totalRecibido, 10000);
    assert.equal(v.comprador.nombres, 'Comprador Uno');
    assert.equal(v.techoNombre, 'Lona QA');
    assert.equal(v.techo.decision, 'Con techo');
    assert.equal(v.adelantoSeparacion.monto, 3000);
    assert.equal(v.adelantoSeparacion.codsep, vendida.codsep);
    assert.equal(v.pagos.length, 1);
  });

  await t.test('La consulta de la venta es solo para los roles comerciales', async () => {
    await login(4);
    await assert.rejects(ventaDe(codunis[4]!), error('42501'));
    await login(1);
    assert.notEqual(await ventaDe(codunis[4]!), null);
    await login(2);
    assert.notEqual(await ventaDe(codunis[4]!), null);
  });

  await t.test('Identificador de moto inválido: PT600', async () => {
    await login(3);
    await assert.rejects(ventaDe('0'), error('PT600'));
  });
});
