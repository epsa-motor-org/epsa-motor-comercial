import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

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

test('HU-006 PostgreSQL: venta, pagos, conversión, techo, idempotencia y seguridad', async t => {
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
  const guardarComprobante = (codven: string, referencia: string, fecha = '2026-11-10') =>
    escalar<{ codven: string; comprobanteExterno: { referencia: string; fecha: string }; guardado: boolean; reutilizada: boolean }>(
      'SELECT public.hu006_guardar_comprobante_venta($1,$2,$3::date) r', [codven, referencia, fecha]);
  const crearSeparacion = async (coduni: string, codcli = 1, decision: 'Por definir' | 'Sin techo' | 'Con techo' = 'Por definir', codtte: number | null = null) => {
    const separacion = await escalar<{ codsep: string }>(
      'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [coduni, codcli, 3, null, 200, '2026-11-09', 'Efectivo', null, null, 'Recepción en caja', true, claveNueva(), decision, codtte]);
    if (decision !== 'Por definir')
      await escalar('SELECT public.hu005_guardar_techo_separacion($1,$2,$3) r', [separacion.codsep, decision, codtte]);
    return separacion.codsep;
  };
  const asegurarEvidenciaVenta = (coduni: string, ruta: string) => propietario(() => db.query(
    "INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('ventas-evidencia',$1,auth.uid())", [ruta]));

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

  await t.test('Venta directa crea venta y no exige pagos para Crédito ni Contado', async () => {
    await login(3);
    const credit = await crearVenta(codunis[0]!, { importe: 2000, clave: claveNueva() });
    assert.equal(credit.codsep, null);
    assert.equal(credit.estado, 'Registrada');
    assert.equal(credit.modalidad, 'Crédito');
    assert.equal(credit.saldo, 2000);
    assert.equal(credit.techo.decision, 'Por definir');
    const cashSale = await crearVenta(codunis[1]!, { modalidad: 'Contado', importe: 1000, clave: claveNueva() });
    assert.equal(cashSale.modalidad, 'Contado');
    assert.equal(cashSale.saldo, 1000, 'no se impone una regla de saldo cero para Contado');
  });

  await t.test('Venta convierte una separación del mismo comprador y no duplica el adelanto', async () => {
    const unidad = codunis[2]!;
    await login(3);
    const codsep = await crearSeparacion(unidad, 1, 'Sin techo');
    const r = await crearVenta(unidad, { importe: 1500, pagos: [
      { monto: 300, fecha: '2026-11-09', medioPago: 'Efectivo', referencia: null,
        rutaEvidencia: null, observacion: 'Caja', ingresoConfirmado: true, codusuConfirmador: null }
    ], techo: null, clave: claveNueva() });
    assert.equal(r.codsep, codsep);
    assert.equal(r.totalRecibido, 500);
    assert.equal(r.saldo, 1000);
    assert.equal(r.pagos.length, 1);
    const estado = await propietario(() => escalar<{ unidad: string; separacion: string; pagos: number; montoAdelanto: number }>(
      `SELECT jsonb_build_object('unidad',u.estcomuni,'separacion',s.estsep,'pagos',(SELECT count(*)::int FROM pagoventa p WHERE p.codven=v.codven),
       'montoAdelanto',s.monadesep) r FROM venta v JOIN unidad u ON u.coduni=v.coduni JOIN separacion s ON s.codsep=v.codsep WHERE v.codsep=$1`, [codsep]));
    assert.deepEqual(estado, { unidad: 'Vendida', separacion: 'Convertida', pagos: 1, montoAdelanto: 200 });
  });

  await t.test('Separación de otro comprador rechaza sin cambiar separación ni unidad', async () => {
    const unidad = codunis[3]!;
    await login(3);
    const codsep = await crearSeparacion(unidad, 1);
    await assert.rejects(crearVenta(unidad, { codcli: 2, clave: claveNueva() }), error('PT605'));
    const estado = await propietario(() => escalar<{ estcomuni: string; estsep: string; codcli: string }>(
      'SELECT jsonb_build_object(\'estcomuni\',u.estcomuni,\'estsep\',s.estsep,\'codcli\',s.codcli::text) r FROM unidad u JOIN separacion s ON s.coduni=u.coduni WHERE s.codsep=$1', [codsep]));
    assert.deepEqual(estado, { estcomuni: 'Separada', estsep: 'Activa', codcli: '1' });
  });

  await t.test('Transferencia valida gerente, referencia y evidencia; pago y adelanto se suman una sola vez', async () => {
    const unidad = codunis[4]!;
    const ruta = `ventas/${unidad}/transferencia.pdf`;
    await asegurarEvidenciaVenta(unidad, ruta);
    await login(3);
    const r = await crearVenta(unidad, { importe: 1500, pagos: [{ monto: 250, fecha: '2026-11-09',
      medioPago: 'Transferencia', referencia: 'OP-HU006-01', rutaEvidencia: ruta,
      observacion: 'Confirmada por llamada', ingresoConfirmado: true, codusuConfirmador: 1 }], clave: claveNueva() });
    assert.equal(r.totalRecibido, 250);
    assert.equal(r.pagos[0]!.confirmadoPor, '1');
    assert.equal(r.pagos[0]!.rutaEvidencia, ruta);
    assert.equal(r.saldo, 1250);
  });

  await t.test('Transferencia sin confirmación, gerente o evidencia se rechaza sin escritura', async () => {
    const sinConfirmacion = codunis[5]!;
    await login(3);
    await assert.rejects(crearVenta(sinConfirmacion, { pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Transferencia',
      referencia: 'OP-1', rutaEvidencia: `ventas/${sinConfirmacion}/a.pdf`, observacion: null,
      ingresoConfirmado: false, codusuConfirmador: 1 }], clave: claveNueva() }), error('PT609'));
    const sinGerente = codunis[6]!;
    await assert.rejects(crearVenta(sinGerente, { pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Transferencia',
      referencia: 'OP-2', rutaEvidencia: `ventas/${sinGerente}/a.pdf`, observacion: null,
      ingresoConfirmado: true, codusuConfirmador: 3 }], clave: claveNueva() }), error('PT617'));
    const sinEvidencia = codunis[7]!;
    await assert.rejects(crearVenta(sinEvidencia, { pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Transferencia',
      referencia: 'OP-3', rutaEvidencia: `ventas/${sinEvidencia}/missing.pdf`, observacion: null,
      ingresoConfirmado: true, codusuConfirmador: 1 }], clave: claveNueva() }), error('PT615'));
    const rollback = await propietario(() => escalar<{ ventas: number; pagos: number; estado: string }>(
      `SELECT jsonb_build_object('ventas',(SELECT count(*)::int FROM venta WHERE coduni=u.coduni),
        'pagos',(SELECT count(*)::int FROM pagoventa p JOIN venta v USING(codven) WHERE v.coduni=u.coduni),
        'estado',u.estcomuni) r FROM unidad u WHERE u.coduni=$1`, [sinEvidencia]));
    assert.deepEqual(rollback, { ventas: 0, pagos: 0, estado: 'Disponible' });
  });

  await t.test('Efectivo registra confirmador autenticado y requiere observación', async () => {
    await login(3);
    const unidad = codunis[8]!;
    const r = await crearVenta(unidad, { pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Efectivo',
      referencia: null, rutaEvidencia: null, observacion: 'Recibido en caja', ingresoConfirmado: true, codusuConfirmador: null }], clave: claveNueva() });
    assert.equal(r.totalRecibido, 100);
    assert.equal(r.pagos[0]!.confirmadoPor, '3');
    await assert.rejects(crearVenta(codunis[9]!, { pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Efectivo',
      referencia: null, rutaEvidencia: null, observacion: null, ingresoConfirmado: true, codusuConfirmador: null }], clave: claveNueva() }), error('PT609'));
  });

  await t.test('Comprobante externo se conserva si existe y permanece nulo si no existe', async () => {
    await login(2);
    const con = await crearVenta(codunis[10]!, { refcomp: 'F001-889', feccomp: '2026-11-09', clave: claveNueva() });
    const sin = await crearVenta(codunis[11]!, { clave: claveNueva() });
    assert.deepEqual(con.comprobanteExterno, { referencia: 'F001-889', fecha: '2026-11-09' });
    assert.equal(sin.comprobanteExterno, null);
    await assert.rejects(crearVenta(codunis[12]!, { refcomp: 'F001-890', feccomp: null, clave: claveNueva() }), error('PT616'));

    await login(3);
    const comprobante = await guardarComprobante(sin.codven, ' F001-001234 ');
    assert.deepEqual(comprobante, { codven: sin.codven,
      comprobanteExterno: { referencia: 'F001-001234', fecha: '2026-11-10' }, guardado: true, reutilizada: false });
    const replay = await guardarComprobante(sin.codven, 'F001-001234');
    assert.equal(replay.reutilizada, true);
    await assert.rejects(guardarComprobante(sin.codven, 'F001-009999'), error('PT618'));
    await assert.rejects(guardarComprobante(sin.codven, 'F001-001234', '2026-11-11'), error('PT618'));
    await assert.rejects(guardarComprobante('999999', 'F001-001234'), error('PT601'));
    await assert.rejects(guardarComprobante(sin.codven, '   '), error('PT600'));
    const persistido = await propietario(() => escalar<{ refcompven: string; feccompven: string; estado: string;
      coduni: string; modalidad: string; importe: number }>(
      `SELECT jsonb_build_object('refcompven',v.refcompven,'feccompven',v.feccompven,
        'estado',v.estven,'coduni',v.coduni::text,'modalidad',v.modcomven,'importe',v.impven) r
      FROM venta v WHERE v.codven=$1`, [sin.codven]));
    assert.deepEqual(persistido, { refcompven: 'F001-001234', feccompven: '2026-11-10',
      estado: 'Registrada', coduni: codunis[11], modalidad: 'Crédito', importe: 1000 });
    assert.equal((await guardarComprobante(con.codven, 'F001-889', '2026-11-09')).reutilizada, true);
    await assert.rejects(guardarComprobante(con.codven, 'F001-otro'), error('PT618'));
  });

  await t.test('Importe y techo: permite Por definir, Sin techo, Con techo compatible; bloquea techo instalado incompatible', async () => {
    await login(3);
    const lona = Number(tipos);
    const sin = await crearVenta(codunis[13]!, { techo: { decision: 'Sin techo' }, clave: claveNueva() });
    const con = await crearVenta(codunis[14]!, { techo: { decision: 'Con techo', codtte: lona }, clave: claveNueva() });
    assert.equal(sin.techo.decision, 'Sin techo');
    assert.equal(con.techo.decision, 'Con techo');
    assert.equal(con.techo.codtte, String(lona));
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, codunis[15]]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [codunis[15]]);
    });
    await login(3);
    const compatible = await crearVenta(codunis[15]!, { techo: { decision: 'Con techo', codtte: lona }, clave: claveNueva() });
    assert.equal(compatible.techo.decision, 'Con techo');
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, codunis[16]]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [codunis[16]]);
    });
    await login(3);
    await assert.rejects(crearVenta(codunis[16]!, { techo: { decision: 'Sin techo' }, clave: claveNueva() }), error('PT613'));
    await assert.rejects(crearVenta(codunis[17]!, { importe: -1, clave: claveNueva() }), error('PT600'));
  });

  await t.test('Por definir se resuelve en venta y una elección final distinta es inmutable', async () => {
    await login(3);
    const inicial = await crearVenta(codunis[18]!, { techo: { decision: 'Por definir' }, clave: claveNueva() });
    const guardado = await escalar<{ decision: string; guardado: boolean; reutilizada: boolean }>(
      "SELECT public.hu006_guardar_techo_venta($1,'Sin techo',NULL) r", [inicial.codven]);
    assert.equal(guardado.decision, 'Sin techo');
    assert.equal(guardado.guardado, true);
    const repetido = await escalar<{ reutilizada: boolean }>(
      "SELECT public.hu006_guardar_techo_venta($1,'Sin techo',NULL) r", [inicial.codven]);
    assert.equal(repetido.reutilizada, true);
    await assert.rejects(escalar("SELECT public.hu006_guardar_techo_venta($1,'Por definir',NULL) r", [inicial.codven]), error('PT614'));
  });

  await t.test('Idempotencia replay no duplica venta ni pagos; payload distinto devuelve conflicto', async () => {
    await login(3);
    const unidad = codunis[19]!;
    const clave = claveNueva();
    const opts = { importe: 1000, pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Efectivo', referencia: null,
      rutaEvidencia: null, observacion: 'Caja', ingresoConfirmado: true, codusuConfirmador: null }], clave };
    const primera = await crearVenta(unidad, opts);
    const replay = await crearVenta(unidad, opts);
    assert.equal(replay.codven, primera.codven);
    assert.equal(replay.reutilizada, true);
    assert.equal(await propietario(() => escalar<number>('SELECT count(*)::int r FROM venta WHERE coduni=$1', [unidad])), 1);
    assert.equal(await propietario(() => escalar<number>('SELECT count(*)::int r FROM pagoventa WHERE codven=$1', [primera.codven])), 1);
    await assert.rejects(crearVenta(unidad, { ...opts, importe: 1100 }), error('PT611'));
    await assert.rejects(crearVenta(unidad, { ...opts, pagos: [{ ...opts.pagos[0], monto: 101 }] }), error('PT611'));
  });

  await t.test('Pago que excede el importe y operación fallida no dejan venta ni cambian la unidad', async () => {
    await login(3);
    const unidad = codunis[20]!;
    await assert.rejects(crearVenta(unidad, { importe: 100, pagos: [{ monto: 101, fecha: '2026-11-09',
      medioPago: 'Efectivo', referencia: null, rutaEvidencia: null, observacion: 'Caja',
      ingresoConfirmado: true, codusuConfirmador: null }], clave: claveNueva() }), error('PT612'));
    const estado = await propietario(() => escalar<{ ventas: number; estado: string }>(
      `SELECT jsonb_build_object('ventas',(SELECT count(*)::int FROM venta WHERE coduni=u.coduni),
        'estado',u.estcomuni) r FROM unidad u WHERE u.coduni=$1`, [unidad]));
    assert.deepEqual(estado, { ventas: 0, estado: 'Disponible' });
  });

  await t.test('Vender en Ancón y tránsito conserva ubicación, movimiento, preparación y techo', async () => {
    const unidad = codunis[21]!;
    const codubiAncon = await propietario(() => escalar<string>(
      "SELECT codubi::text r FROM ubicacion WHERE nomubi='Ancón HU006'"));
    const lona = Number(tipos);
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codubi=$1, codtte=$2, codpro=1, dettecuni=$3 WHERE coduni=$4',
        [codubiAncon, lona, 'Configuración comercial y física ya asignada', unidad]);
      await db.query("UPDATE preparacionunidad SET estarmado='Terminado', esttecho='En proceso' WHERE coduni=$1", [unidad]);
      await db.query(`INSERT INTO movimientoubicacion(coduni,codubiori,codubides,codusu,estmub)
        VALUES ($1,1,$2,1,'En transito')`, [unidad, codubiAncon]);
    });
    await login(3);
    const antes = await propietario(() => escalar<{ ubicacion: string; estadoMovimiento: string;
      armado: string; techoFisico: string; codtte: string; proveedor: string; detalle: string }>(
      `SELECT jsonb_build_object('ubicacion',u.codubi::text,'estadoMovimiento',m.estmub,
        'armado',p.estarmado,'techoFisico',p.esttecho,'codtte',u.codtte::text,
        'proveedor',u.codpro::text,'detalle',u.dettecuni) r
      FROM unidad u JOIN preparacionunidad p USING(coduni)
      JOIN movimientoubicacion m USING(coduni) WHERE u.coduni=$1`, [unidad]));
    const venta = await crearVenta(unidad, { techo: { decision: 'Con techo', codtte: lona }, clave: claveNueva() });
    assert.equal(venta.estado, 'Registrada');
    const despues = await propietario(() => escalar<typeof antes & { comercial: string }>(
      `SELECT jsonb_build_object('ubicacion',u.codubi::text,'estadoMovimiento',m.estmub,
        'armado',p.estarmado,'techoFisico',p.esttecho,'codtte',u.codtte::text,
        'proveedor',u.codpro::text,'detalle',u.dettecuni,'comercial',u.estcomuni) r
      FROM unidad u JOIN preparacionunidad p USING(coduni)
      JOIN movimientoubicacion m USING(coduni) WHERE u.coduni=$1`, [unidad]));
    assert.deepEqual({ ubicacion: despues.ubicacion, estadoMovimiento: despues.estadoMovimiento,
      armado: despues.armado, techoFisico: despues.techoFisico, codtte: despues.codtte,
      proveedor: despues.proveedor, detalle: despues.detalle }, antes);
    assert.equal(despues.comercial, 'Vendida');
  });

  await t.test('La conversión también aplica compatibilidad con un techo instalado después de separar', async () => {
    const unidad = codunis[22]!;
    await login(3);
    await crearSeparacion(unidad, 1, 'Sin techo');
    await login(1);
    const lona = Number(tipos);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, unidad]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [unidad]);
    });
    await login(3);
    await assert.rejects(crearVenta(unidad, { techo: null, clave: claveNueva() }), error('PT613'));
    const estado = await propietario(() => escalar<{ venta: number; separacion: string; comercial: string }>(
      `SELECT jsonb_build_object('venta',(SELECT count(*)::int FROM venta WHERE coduni=u.coduni),
        'separacion',s.estsep,'comercial',u.estcomuni) r FROM unidad u
      JOIN separacion s USING(coduni) WHERE u.coduni=$1`, [unidad]));
    assert.deepEqual(estado, { venta: 0, separacion: 'Activa', comercial: 'Separada' });
  });

  await t.test('Perfiles comerciales permitidos; rol ajeno rechazado y acceso directo a tablas bloqueado', async () => {
    await login(1);
    const gerente = await crearVenta(codunis[20]!, { responsable: 6, clave: claveNueva() });
    assert.equal(gerente.autor.codusu, '1');
    assert.equal(gerente.responsable.codusu, '6', 'un responsable comercial no se rechaza solo por usar el dominio interno');
    await login(4);
    await assert.rejects(escalar("SELECT public.hu006_guardar_techo_venta($1,'Sin techo',NULL) r", [gerente.codven]), error('42501'));
    await assert.rejects(guardarComprobante(gerente.codven, 'F001-AUXILIAR'), error('42501'));
    await assert.rejects(crearVenta(codunis[21]!, { clave: claveNueva() }), error('42501'));
    await login(3);
    await assert.rejects(crearVenta(codunis[24]!, { responsable: 5, clave: claveNueva() }), error('PT607'),
      'la cuenta técnica concreta no debe asignarse como responsable comercial');
    const responsableInternoValido = await crearVenta(codunis[24]!, { responsable: 6, clave: claveNueva() });
    assert.equal(responsableInternoValido.responsable.codusu, '6');
    await assert.rejects(db.query('SELECT * FROM public.venta'), error('42501'));
    await assert.rejects(db.query('SELECT * FROM public.pagoventa'), error('42501'));
    await assert.rejects(db.query(`INSERT INTO public.venta(coduni,codcli,codusu,fecven,modcomven,estven)
      VALUES ($1,1,3,CURRENT_TIMESTAMP,'Contado','Registrada')`, [codunis[22]]), error('42501'));
  });

  await t.test('Dos solicitudes simultáneas con claves distintas no generan dos ventas efectivas', async () => {
    await login(3);
    const unidad = codunis[23]!;
    // PGlite comparte una conexión: verifica el resultado de negocio concurrente, no el lock entre sesiones independientes.
    const resultados = await Promise.allSettled([
      crearVenta(unidad, { clave: claveNueva() }),
      crearVenta(unidad, { clave: claveNueva() })
    ]);
    assert.equal(resultados.filter(resultado => resultado.status === 'fulfilled').length, 1);
    const rechazo = resultados.find(resultado => resultado.status === 'rejected') as PromiseRejectedResult;
    assert.ok(['PT604', '23505'].includes((rechazo.reason as ErrorSQL).code ?? ''));
    assert.equal(await propietario(() => escalar<number>('SELECT count(*)::int r FROM venta WHERE coduni=$1', [unidad])), 1);
  });
});
