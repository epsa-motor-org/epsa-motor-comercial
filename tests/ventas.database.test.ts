import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface VentaSQL {
  codven: string; coduni: string; codcli: string; codsep: string | null; importe: number;
  precioBaseAcordado: number | null; adicionalTechoReferencial: number | null; adicionalTechoAcordado: number | null;
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
    adicional: number | null; entrega: number | null; pagos: unknown[]; techo: unknown;
    refcomp: string | null; feccomp: string | null; observacion: string | null; clave: string;
  }> = {}) => [
    coduni, opciones.codcli ?? 1, opciones.responsable ?? 3, opciones.sede ?? 1,
    opciones.fecha ?? '2026-11-09', opciones.modalidad ?? 'Crédito', opciones.adicional ?? null,
    opciones.entrega ?? null, JSON.stringify(opciones.pagos ?? []),
    opciones.techo === undefined ? JSON.stringify({ decision: 'Por definir' })
      : opciones.techo === null ? null : JSON.stringify(opciones.techo),
    opciones.refcomp ?? null, opciones.feccomp ?? null, opciones.observacion ?? null,
    opciones.clave ?? claveNueva()
  ];
  const crearVenta = (coduni: string, opciones: Parameters<typeof ventaParams>[1] = {}) =>
    escalar<VentaSQL>('SELECT public.hu006_crear_venta($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::uuid) r',
      ventaParams(coduni, opciones));
  const crearVentaHistorica = (
    coduni: string, decision: 'Por definir' | 'Sin techo' | 'Con techo', codtte: number | null = null, heredarTecho = false
  ) =>
    escalar<{ codven: string }>(
      'SELECT public.hu006_crear_venta($1,1,3,1,$2,\'Crédito\',$3,NULL,\'[]\'::jsonb,$4::jsonb,NULL,NULL,NULL,$5::uuid) r',
      [coduni, '2026-11-09', 18335,
        heredarTecho ? null : JSON.stringify(decision === 'Con techo' ? { decision, codtte } : { decision }), claveNueva()]);
  const guardarTechoVenta = (codven: string, decision: string, codtte: number | null, adicional: number | null = null) =>
    escalar<{ codven: string; decision: string; codtte: string | null; precioBaseAcordado: number;
      adicionalTechoReferencial: number; adicionalTechoAcordado: number; importe: number;
      totalRecibido?: number; saldo?: number; guardado: boolean; reutilizada: boolean }>(
      'SELECT public.hu006_guardar_techo_venta($1,$2,$3,$4) r', [codven, decision, codtte, adicional]);
  const guardarComprobante = (codven: string, referencia: string, fecha = '2026-11-10') =>
    escalar<{ codven: string; comprobanteExterno: { referencia: string; fecha: string }; guardado: boolean; reutilizada: boolean }>(
      'SELECT public.hu006_guardar_comprobante_venta($1,$2,$3::date) r', [codven, referencia, fecha]);
  const crearSeparacion = async (
    coduni: string, codcli = 1, decision: 'Por definir' | 'Sin techo' | 'Con techo' = 'Por definir',
    codtte: number | null = null, monto = 200
  ) => {
    const separacion = await escalar<{ codsep: string }>(
      'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [coduni, codcli, 3, null, monto, '2026-11-09', 'Efectivo', null, null, 'Recepción en caja', true, claveNueva(), decision, codtte]);
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
      VALUES ('Sin techo QA',false,false,true),('Lona QA',true,true,true),
        ('Techo inactivo QA',true,true,false),('Fibra distinta QA',false,true,true);
    INSERT INTO public.proveedor(nompro) VALUES ('Proveedor QA');
    INSERT INTO public.estadopreparacion(nomepr) VALUES ('Preparación QA');
    INSERT INTO public.ubicacion(nomubi,tipubi) VALUES ('Comas HU006','Sede'),('Ventanilla HU006','Sede'),('Ancón HU006','Almacen');
    INSERT INTO public.sede(codubi,telsed,horsed,estsed) VALUES (1,'999999999','9-6',true),(2,'999999998','9-6',true);
  `);

  const unidades = Array.from({ length: 42 }, (_, i) => ({
    nummotuni: `HU006-M-${i + 1}`, chauni: `HU006-C-${i + 1}`, codmod: '1', coluni: 'Azul'
  }));
  const compra = await propietario(async () => {
    const r = await db.query<{ codcom: string }>("INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',42) RETURNING codcom::text");
    await db.query("INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) VALUES ($1,'QA','HU006-FAC','2026-11-09',42,1)", [r.rows[0]!.codcom]);
    return r.rows[0]!.codcom;
  });
  await login(1);
  await escalar('SELECT public.hu002_identificar_unidades($1,$2::jsonb) r', [compra, JSON.stringify(unidades)]);
  const codunis = await propietario(async () => (await db.query<{ coduni: string }>(
    "SELECT coduni::text FROM public.unidad WHERE nummotuni LIKE 'HU006-M-%' ORDER BY coduni"
  )).rows.map(r => r.coduni));
  const tiposHistoricos = await propietario(async () => Object.fromEntries((await db.query<{
    nomtte: string; codtte: string
  }>("SELECT nomtte,codtte::text FROM public.tipotecho WHERE nomtte IN ('Sin techo','Lona','Techo clásico de fibra')"))
    .rows.map(fila => [fila.nomtte, fila.codtte])));

  // Se crean antes de HU-006 desglose para probar el backfill sobre importes viejos.
  await propietario(() => db.query(
    "INSERT INTO public.tipotecho(nomtte,reqprotte,reqinsttte,esttte) VALUES ('Techo histórico incompleto QA',false,true,true)"));
  const tipoIncompleto = await propietario(() => escalar<string>(
    "SELECT codtte::text r FROM public.tipotecho WHERE nomtte='Techo histórico incompleto QA'"));
  await login(3);
  const separacionHistoricaFibra = await crearSeparacion(
    codunis[40]!, 1, 'Con techo', Number(tiposHistoricos['Techo clásico de fibra']), 100);
  const ventasHistoricas = {
    porDefinir: await crearVentaHistorica(codunis[37]!, 'Por definir'),
    sinTecho: await crearVentaHistorica(codunis[38]!, 'Sin techo'),
    lona: await crearVentaHistorica(codunis[39]!, 'Con techo', Number(tiposHistoricos.Lona)),
    fibra: await crearVentaHistorica(codunis[40]!, 'Con techo', Number(tiposHistoricos['Techo clásico de fibra']), true),
    incompleta: await crearVentaHistorica(codunis[41]!, 'Con techo', Number(tipoIncompleto))
  };

  const migrationDesglose = leer('supabase/migrations/202611120001_hu006_desglose_precio_techo.sql');
  await db.exec('RESET ROLE');
  let errorMigration: ErrorSQL | null = null;
  try { await db.exec(migrationDesglose); } catch (e) { errorMigration = e as ErrorSQL; }
  await db.exec('ROLLBACK');
  await login(3);
  assert.equal(errorMigration?.code, 'PT623',
    `debe fallar controladamente si una venta Con techo no tiene adicional referencial; error recibido: ${JSON.stringify(errorMigration)}`);
  const migracionFallida = await propietario(() => escalar<{ columnas: number; importe: number }>(
    `SELECT jsonb_build_object(
      'columnas',(SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name='venta' AND column_name IN ('prebaseven','adicionalrefven','adicionalacordadoven')),
      'importe',(SELECT impven FROM public.venta WHERE codven=$1)) r`, [ventasHistoricas.incompleta.codven]));
  assert.deepEqual(migracionFallida, { columnas: 0, importe: 18335 },
    'el fallo revierte la migration completa y no altera la venta histórica');
  await propietario(async () => {
    await db.query('DELETE FROM public.venta WHERE codven=$1', [ventasHistoricas.incompleta.codven]);
    await db.query("UPDATE public.unidad SET estcomuni='Disponible' WHERE coduni=$1", [codunis[41]]);
  });
  await propietario(async () => {
    await db.exec(migrationDesglose);
    await db.query(`UPDATE public.tipotecho SET adicionalref=CASE nomtte
      WHEN 'Sin techo QA' THEN 0 WHEN 'Lona QA' THEN 200
      WHEN 'Techo inactivo QA' THEN 100 WHEN 'Fibra distinta QA' THEN 1700 END
      WHERE nomtte IN ('Sin techo QA','Lona QA','Techo inactivo QA','Fibra distinta QA')`);
    await db.exec(leer('supabase/migrations/202611120002_hu006_listar_ventas.sql'));
    await db.exec(leer('supabase/migrations/202611120003_hu005_adelanto_minimo.sql'));
  });

  const tipos = await propietario(async () => (await db.query<{ codtte: string }>(
    "SELECT codtte::text FROM public.tipotecho WHERE nomtte='Lona QA'"
  )).rows[0]!.codtte);
  const tiposCanonicos = await propietario(async () => Object.fromEntries((await db.query<{
    nomtte: string; codtte: string; adicionalref: number
  }>("SELECT nomtte,codtte::text,adicionalref FROM public.tipotecho WHERE nomtte IN "
    + "('Sin techo','Lona','Techo clásico de fibra','Fibra clásica equipada','Techo de fibra deportiva')"
  )).rows.map(fila => [fila.nomtte, { codtte: fila.codtte, adicionalref: Number(fila.adicionalref) }])));

  await t.after(() => db.close());

  await t.test('HU-006 concilia snapshots históricos usando el importe antiguo como base', async () => {
    await login(1);
    const casos = [
      { venta: ventasHistoricas.porDefinir, esperados: [18335, 0, 0, 18335, 0, 18335] },
      { venta: ventasHistoricas.sinTecho, esperados: [18335, 0, 0, 18335, 0, 18335] },
      { venta: ventasHistoricas.lona, esperados: [18335, 200, 200, 18535, 0, 18535] },
      { venta: ventasHistoricas.fibra, esperados: [18335, 1700, 1700, 20035, 100, 19935] }
    ] as const;
    for (const { venta, esperados } of casos) {
      const snapshot = await propietario(() => escalar<{
        precioBaseAcordado: number; adicionalTechoReferencial: number;
        adicionalTechoAcordado: number; importe: number;
      }>(`SELECT jsonb_build_object('precioBaseAcordado',prebaseven,
        'adicionalTechoReferencial',adicionalrefven,'adicionalTechoAcordado',adicionalacordadoven,
        'importe',impven) r FROM public.venta WHERE codven=$1`, [venta.codven]));
      assert.deepEqual([snapshot.precioBaseAcordado, snapshot.adicionalTechoReferencial,
        snapshot.adicionalTechoAcordado, snapshot.importe], esperados.slice(0, 4));

      const proyeccion = await propietario(() => escalar<{ importe: number; totalRecibido: number; saldo: number }>(
        'SELECT public.hu006_proyectar_venta($1) r', [venta.codven]));
      assert.deepEqual([proyeccion.importe, proyeccion.totalRecibido, proyeccion.saldo],
        [esperados[3], esperados[4], esperados[5]]);
    }
    const adelantoConservado = await propietario(() => escalar<{ codsep: string; monto: number; estado: string }>(
      `SELECT jsonb_build_object('codsep',v.codsep::text,'monto',s.monadesep,'estado',s.estsep) r
      FROM public.venta v JOIN public.separacion s USING(codsep) WHERE v.codven=$1`, [ventasHistoricas.fibra.codven]));
    assert.deepEqual(adelantoConservado, { codsep: separacionHistoricaFibra,
      monto: 100, estado: 'Convertida' });
  });

  await t.test('Venta directa crea venta y no exige pagos para Crédito ni Contado', async () => {
    await login(3);
    const credit = await crearVenta(codunis[0]!, { clave: claveNueva() });
    assert.equal(credit.codsep, null);
    assert.equal(credit.estado, 'Registrada');
    assert.equal(credit.modalidad, 'Crédito');
    assert.equal(credit.saldo, 10000);
    assert.equal(credit.techo.decision, 'Por definir');
    const cashSale = await crearVenta(codunis[1]!, { modalidad: 'Contado', clave: claveNueva() });
    assert.equal(cashSale.modalidad, 'Contado');
    assert.equal(cashSale.saldo, 10000, 'no se impone una regla de saldo cero para Contado');
  });

  await t.test('Venta convierte una separación del mismo comprador y no duplica el adelanto', async () => {
    const unidad = codunis[2]!;
    const lona = Number(tipos);
    await login(1);
    const codubi = await propietario(() => escalar<string>("SELECT codubi::text r FROM public.ubicacion WHERE nomubi='Comas HU006'"));
    await propietario(async () => {
      await db.query('UPDATE unidad SET codubi=$1,codtte=$2,codpro=1,dettecuni=$3 WHERE coduni=$4',
        [codubi, lona, 'Configuración previa a conversión', unidad]);
      await db.query("UPDATE preparacionunidad SET estarmado='Terminado',esttecho='En proceso' WHERE coduni=$1", [unidad]);
      await db.query("INSERT INTO movimientoubicacion(coduni,codubiori,codubides,codusu,estmub) VALUES ($1,2,$2,1,'En transito')", [unidad, codubi]);
    });
    await login(3);
    const codsep = await crearSeparacion(unidad, 1, 'Sin techo');
    const antes = await propietario(() => escalar<{ fisica: unknown; preparacion: unknown; movimiento: unknown }>(
      `SELECT jsonb_build_object(
        'fisica',jsonb_build_object('codubi',u.codubi::text,'codtte',u.codtte::text,'codpro',u.codpro::text,'detalle',u.dettecuni),
        'preparacion',(SELECT pg_catalog.to_jsonb(p)-'coduni' FROM public.preparacionunidad p WHERE p.coduni=u.coduni),
        'movimiento',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m)-'coduni' ORDER BY m.codmub)
          FROM public.movimientoubicacion m WHERE m.coduni=u.coduni)) r
      FROM public.unidad u WHERE u.coduni=$1`, [unidad]));
    const r = await crearVenta(unidad, { pagos: [
      { monto: 300, fecha: '2026-11-09', medioPago: 'Efectivo', referencia: null,
        rutaEvidencia: null, observacion: 'Caja', ingresoConfirmado: true, codusuConfirmador: null }
    ], techo: null, clave: claveNueva() });
    assert.equal(r.codsep, codsep);
    assert.equal(r.totalRecibido, 500);
    assert.equal(r.saldo, 9500);
    assert.equal(r.pagos.length, 1);
    const despues = await propietario(() => escalar<{ fisica: unknown; preparacion: unknown; movimiento: unknown;
      unidad: string; separacion: string; comprador: string; montoAdelanto: number; decisionSep: string; decisionVenta: string;
      venta: string; pagos: number }>(
      `SELECT jsonb_build_object(
        'fisica',jsonb_build_object('codubi',u.codubi::text,'codtte',u.codtte::text,'codpro',u.codpro::text,'detalle',u.dettecuni),
        'preparacion',(SELECT pg_catalog.to_jsonb(p)-'coduni' FROM public.preparacionunidad p WHERE p.coduni=u.coduni),
        'movimiento',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m)-'coduni' ORDER BY m.codmub)
          FROM public.movimientoubicacion m WHERE m.coduni=u.coduni),
        'unidad',u.estcomuni,'separacion',s.estsep,'comprador',s.codcli::text,'montoAdelanto',s.monadesep,
        'decisionSep',s.dectechosep,'decisionVenta',v.dectechoven,'venta',v.estven,
        'pagos',(SELECT count(*)::int FROM pagoventa p WHERE p.codven=v.codven)) r
      FROM venta v JOIN unidad u ON u.coduni=v.coduni JOIN separacion s ON s.codsep=v.codsep WHERE s.codsep=$1`, [codsep]));
    assert.deepEqual({ fisica: despues.fisica, preparacion: despues.preparacion, movimiento: despues.movimiento }, antes);
    assert.deepEqual({ unidad: despues.unidad, separacion: despues.separacion, comprador: despues.comprador,
      montoAdelanto: despues.montoAdelanto, decisionSep: despues.decisionSep, decisionVenta: despues.decisionVenta,
      venta: despues.venta, pagos: despues.pagos }, {
      unidad: 'Vendida', separacion: 'Convertida', comprador: '1', montoAdelanto: 200,
      decisionSep: 'Sin techo', decisionVenta: 'Sin techo', venta: 'Registrada', pagos: 1
    });
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
    const r = await crearVenta(unidad, { pagos: [{ monto: 250, fecha: '2026-11-09',
      medioPago: 'Transferencia', referencia: 'OP-HU006-01', rutaEvidencia: ruta,
      observacion: 'Confirmada por llamada', ingresoConfirmado: true, codusuConfirmador: 1 }], clave: claveNueva() });
    assert.equal(r.totalRecibido, 250);
    assert.equal(r.pagos[0]!.confirmadoPor, '1');
    assert.equal(r.pagos[0]!.rutaEvidencia, ruta);
    assert.equal(r.saldo, 9750);
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
      estado: 'Registrada', coduni: codunis[11], modalidad: 'Crédito', importe: 10000 });
    assert.equal((await guardarComprobante(con.codven, 'F001-889', '2026-11-09')).reutilizada, true);
    await assert.rejects(guardarComprobante(con.codven, 'F001-otro'), error('PT618'));
  });

  await t.test('HU-006 catálogo referencial: guarda snapshot separado del adicional acordado', async () => {
    await login(3);
    assert.deepEqual(Object.fromEntries(Object.entries(tiposCanonicos).map(([nombre, tipo]) => [nombre, tipo.adicionalref])), {
      'Sin techo': 0,
      'Lona': 200,
      'Techo clásico de fibra': 1700,
      'Fibra clásica equipada': 3200,
      'Techo de fibra deportiva': 4000
    });
    const nombres = ['Lona', 'Techo clásico de fibra', 'Fibra clásica equipada', 'Techo de fibra deportiva'];
    for (const [indice, nombre] of nombres.entries()) {
      const tipo = tiposCanonicos[nombre]!;
      const r = await crearVenta(codunis[25 + indice]!, {
        techo: { decision: 'Con techo', codtte: Number(tipo.codtte) },
        adicional: tipo.adicionalref,
        clave: claveNueva()
      });
      assert.equal(r.precioBaseAcordado, 10000);
      assert.equal(r.adicionalTechoReferencial, tipo.adicionalref);
      assert.equal(r.adicionalTechoAcordado, tipo.adicionalref);
      assert.equal(r.importe, 10000 + tipo.adicionalref);
    }
    const acordadoDistinto = await crearVenta(codunis[29]!, {
      techo: { decision: 'Con techo', codtte: Number(tiposCanonicos.Lona!.codtte) },
      adicional: 175,
      clave: claveNueva()
    });
    assert.equal(acordadoDistinto.adicionalTechoReferencial, 200);
    assert.equal(acordadoDistinto.adicionalTechoAcordado, 175);
    assert.equal(acordadoDistinto.importe, 10175);
    const sinTecho = await crearVenta(codunis[30]!, {
      techo: { decision: 'Sin techo' }, clave: claveNueva()
    });
    assert.equal(sinTecho.adicionalTechoReferencial, 0);
    assert.equal(sinTecho.adicionalTechoAcordado, 0);
    assert.equal(sinTecho.importe, 10000);
    const pendiente = await crearVenta(codunis[31]!, {
      techo: { decision: 'Por definir' }, clave: claveNueva()
    });
    assert.deepEqual([pendiente.adicionalTechoReferencial, pendiente.adicionalTechoAcordado, pendiente.importe], [0, 0, 10000]);
    await propietario(() => db.query('UPDATE public.modelo SET premod=11699 WHERE codmod=1'));
    const totalSobre130Porciento = await crearVenta(codunis[35]!, {
      techo: { decision: 'Con techo', codtte: Number(tiposCanonicos['Techo de fibra deportiva']!.codtte) },
      adicional: 4000,
      clave: claveNueva()
    });
    assert.equal(totalSobre130Porciento.precioBaseAcordado, 11699);
    assert.equal(totalSobre130Porciento.importe, 15699);
    await propietario(() => db.query('UPDATE public.modelo SET premod=10000 WHERE codmod=1'));
  });

  await t.test('HU-006 RPC de consulta devuelve ventas persistidas y busca por motor/comprobante', async () => {
    await login(2);
    const motorBuscado = await propietario(() => escalar<string>(
      'SELECT nummotuni r FROM public.unidad WHERE coduni=$1', [codunis[25]]));
    const chasisBuscado = await propietario(() => escalar<string>(
      'SELECT chauni r FROM public.unidad WHERE coduni=$1', [codunis[25]]));
    const porMotor = await escalar<{ items: Array<{
      unidad: { motor: string; chasis: string }; comprador: { nombre: string; celular: string | null };
      precioBaseAcordado: number; adicionalTechoReferencial: number; adicionalTechoAcordado: number;
      total: number; totalRecibido: number; saldo: number; estado: string;
    }>; total: number; limite: number; offset: number }>(
      'SELECT public.hu006_listar_ventas($1,10,0) r', [motorBuscado]);
    assert.deepEqual([porMotor.total, porMotor.limite, porMotor.offset], [1, 10, 0]);
    assert.deepEqual([porMotor.items[0]!.unidad.motor, porMotor.items[0]!.unidad.chasis,
      porMotor.items[0]!.comprador.nombre, porMotor.items[0]!.precioBaseAcordado,
      porMotor.items[0]!.adicionalTechoReferencial, porMotor.items[0]!.adicionalTechoAcordado,
      porMotor.items[0]!.total, porMotor.items[0]!.totalRecibido, porMotor.items[0]!.saldo,
      porMotor.items[0]!.estado],
    [motorBuscado, chasisBuscado, 'Comprador Uno', 10000, 200, 200, 10200, 0, 10200, 'Registrada']);
    const porComprobante = await escalar<{ items: Array<{ comprobanteExterno: { referencia: string; fecha: string } | null }>; total: number }>(
      "SELECT public.hu006_listar_ventas('F001-001234',10,0) r");
    assert.equal(porComprobante.total, 1);
    assert.deepEqual(porComprobante.items[0]!.comprobanteExterno, { referencia: 'F001-001234', fecha: '2026-11-10' });
    await assert.rejects(escalar("SELECT public.hu006_listar_ventas(NULL,101,0) r"), error('PT622'));
    await login(4);
    await assert.rejects(escalar("SELECT public.hu006_listar_ventas(NULL,50,0) r"), error('42501'));
  });

  await t.test('Importe y techo: permite Por definir, Sin techo, Con techo compatible; bloquea techo instalado incompatible', async () => {
    await login(3);
    const lona = Number(tipos);
    const sin = await crearVenta(codunis[13]!, { techo: { decision: 'Sin techo' }, clave: claveNueva() });
    const con = await crearVenta(codunis[14]!, { techo: { decision: 'Con techo', codtte: lona }, adicional: 200, clave: claveNueva() });
    assert.equal(sin.techo.decision, 'Sin techo');
    assert.equal(con.techo.decision, 'Con techo');
    assert.equal(con.techo.codtte, String(lona));
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, codunis[15]]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [codunis[15]]);
    });
    await login(3);
    const compatible = await crearVenta(codunis[15]!, { techo: { decision: 'Con techo', codtte: lona }, adicional: 200, clave: claveNueva() });
    assert.equal(compatible.techo.decision, 'Con techo');
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, codunis[16]]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [codunis[16]]);
    });
    await login(3);
    await assert.rejects(crearVenta(codunis[16]!, { techo: { decision: 'Sin techo' }, clave: claveNueva() }), error('PT613'));
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, codunis[17]]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [codunis[17]]);
    });
    await login(3);
    const pendienteConTechoInstalado = await crearVenta(codunis[17]!, { techo: { decision: 'Por definir' }, clave: claveNueva() });
    assert.equal(pendienteConTechoInstalado.techo.decision, 'Por definir');
    const incompatible = await propietario(() => escalar<string>(
      "SELECT codtte::text r FROM public.tipotecho WHERE nomtte='Fibra distinta QA'"));
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, codunis[32]]);
      await db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [codunis[32]]);
    });
    await login(3);
    await assert.rejects(crearVenta(codunis[32]!, {
      techo: { decision: 'Con techo', codtte: Number(incompatible) }, adicional: 1700, clave: claveNueva()
    }), error('PT613'));
    await assert.rejects(crearVenta(codunis[33]!, {
      techo: { decision: 'Con techo', codtte: lona }, adicional: -1, clave: claveNueva()
    }), error('PT620'));
  });

  await t.test('Por definir se resuelve en venta y una elección final distinta es inmutable', async () => {
    await login(3);
    const inicial = await crearVenta(codunis[18]!, { techo: { decision: 'Por definir' }, clave: claveNueva() });
    const guardado = await guardarTechoVenta(inicial.codven, 'Sin techo', null);
    assert.equal(guardado.decision, 'Sin techo');
    assert.equal(guardado.guardado, true);
    assert.equal(guardado.importe, 10000);
    const repetido = await guardarTechoVenta(inicial.codven, 'Sin techo', null);
    assert.equal(repetido.reutilizada, true);
    await assert.rejects(guardarTechoVenta(inicial.codven, 'Por definir', null), error('PT614'));

    const tipoLona = Number(tipos);
    const conTecho = await crearVenta(codunis[34]!, {
      techo: { decision: 'Por definir' },
      pagos: [{ monto: 500, fecha: '2026-11-09', medioPago: 'Efectivo', referencia: null,
        rutaEvidencia: null, observacion: 'Pago parcial', ingresoConfirmado: true, codusuConfirmador: null }],
      clave: claveNueva()
    });
    const resuelta = await guardarTechoVenta(conTecho.codven, 'Con techo', tipoLona, 175);
    assert.deepEqual([resuelta.decision, resuelta.codtte, resuelta.adicionalTechoReferencial,
      resuelta.adicionalTechoAcordado, resuelta.importe, resuelta.totalRecibido, resuelta.saldo],
    ['Con techo', String(tipoLona), 200, 175, 10175, 500, 9675]);
    const replay = await guardarTechoVenta(conTecho.codven, 'Con techo', tipoLona, 175);
    assert.equal(replay.reutilizada, true);
    await assert.rejects(guardarTechoVenta(conTecho.codven, 'Con techo', tipoLona, 176), error('PT614'));
    const pagos = await propietario(() => escalar<number>('SELECT count(*)::int r FROM pagoventa WHERE codven=$1', [conTecho.codven]));
    assert.equal(pagos, 1, 'resolver el techo conserva el pago existente sin duplicarlo');

    const sobrepago = await crearVenta(codunis[33]!, { techo: { decision: 'Por definir' }, clave: claveNueva() });
    await propietario(() => db.query(`INSERT INTO public.pagoventa(
      codven,nropagven,codusuautorpag,montopagven,fecpagven,metpagven,obspagven,ingconfpag,codusuconfpag,fecconfpag
    ) VALUES ($1,1,3,10001,'2026-11-09','Efectivo','Pago histórico de control',true,3,CURRENT_TIMESTAMP)`, [sobrepago.codven]));
    await assert.rejects(guardarTechoVenta(sobrepago.codven, 'Sin techo', null), error('PT621'));
    const techoTrasRechazo = await propietario(() => escalar<{ decision: string; total: number }>(
      `SELECT jsonb_build_object('decision',dectechoven,'total',impven) r FROM public.venta WHERE codven=$1`, [sobrepago.codven]));
    assert.deepEqual(techoTrasRechazo, { decision: 'Por definir', total: 10000 });
  });

  await t.test('HU-006 resolución de techo conserva el adelanto de una separación convertida', async () => {
    await login(3);
    const codsep = await crearSeparacion(codunis[36]!, 1, 'Por definir');
    const venta = await crearVenta(codunis[36]!, { techo: null, clave: claveNueva() });
    assert.equal(venta.codsep, codsep);
    assert.equal(venta.totalRecibido, 200);
    assert.equal(venta.importe, 10000);
    const resuelta = await guardarTechoVenta(venta.codven, 'Con techo', Number(tipos), 175);
    assert.deepEqual([resuelta.importe, resuelta.totalRecibido, resuelta.saldo], [10175, 200, 9975]);
    assert.equal(Number(await propietario(() => escalar<string>(
      "SELECT monadesep::text r FROM public.separacion WHERE codsep=$1", [codsep]))), 200);
    assert.equal(await propietario(() => escalar<string>(
      "SELECT estsep r FROM public.separacion WHERE codsep=$1", [codsep])), 'Convertida');
  });

  await t.test('La conversión de separación Con techo hereda el tipo y requiere adicionalTechoAcordado', async () => {
    const unidad = codunis[41]!;
    const codtte = Number(tipos);
    await login(3);
    const codsep = await crearSeparacion(unidad, 1, 'Con techo', codtte);
    const venta = await crearVenta(unidad, { techo: null, adicional: 175, clave: claveNueva() });
    assert.equal(venta.codsep, codsep);
    assert.deepEqual([venta.techo.decision, venta.techo.codtte, venta.precioBaseAcordado,
      venta.adicionalTechoReferencial, venta.adicionalTechoAcordado, venta.importe,
      venta.totalRecibido, venta.saldo],
    ['Con techo', String(codtte), 10000, 200, 175, 10175, 200, 9975]);
    const persistido = await propietario(() => escalar<{ decision: string; codtte: string;
      adicionalAcordado: number; separacion: string }>(
      `SELECT jsonb_build_object('decision',v.dectechoven,'codtte',v.codtteven::text,
        'adicionalAcordado',v.adicionalacordadoven,'separacion',s.estsep) r
      FROM public.venta v JOIN public.separacion s USING(codsep) WHERE v.codven=$1`, [venta.codven]));
    assert.deepEqual(persistido, { decision: 'Con techo', codtte: String(codtte),
      adicionalAcordado: 175, separacion: 'Convertida' });
  });

  await t.test('Idempotencia replay no duplica venta ni pagos; payload distinto devuelve conflicto', async () => {
    await login(3);
    const unidad = codunis[19]!;
    const clave = claveNueva();
    const opts = { adicional: 200, techo: { decision: 'Con techo', codtte: Number(tipos) },
      pagos: [{ monto: 100, fecha: '2026-11-09', medioPago: 'Efectivo', referencia: null,
        rutaEvidencia: null, observacion: 'Caja', ingresoConfirmado: true, codusuConfirmador: null }], clave };
    const primera = await crearVenta(unidad, opts);
    const replay = await crearVenta(unidad, opts);
    assert.equal(replay.codven, primera.codven);
    assert.equal(replay.reutilizada, true);
    assert.deepEqual([primera.adicionalTechoAcordado, replay.adicionalTechoAcordado, replay.importe], [200, 200, 10200]);
    assert.equal(await propietario(() => escalar<number>('SELECT count(*)::int r FROM venta WHERE coduni=$1', [unidad])), 1);
    assert.equal(await propietario(() => escalar<number>('SELECT count(*)::int r FROM pagoventa WHERE codven=$1', [primera.codven])), 1);
    await assert.rejects(crearVenta(unidad, { ...opts, adicional: 201 }), error('PT611'));
    await assert.rejects(crearVenta(unidad, { ...opts, pagos: [{ ...opts.pagos[0], monto: 101 }] }), error('PT611'));
  });

  await t.test('Pago que excede el importe y operación fallida no dejan venta ni cambian la unidad', async () => {
    await login(3);
    const unidad = codunis[20]!;
    await assert.rejects(crearVenta(unidad, { pagos: [{ monto: 10001, fecha: '2026-11-09',
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
    const venta = await crearVenta(unidad, {
      techo: { decision: 'Con techo', codtte: lona }, adicional: 200, clave: claveNueva()
    });
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
    await assert.rejects(escalar("SELECT public.hu006_guardar_techo_venta($1,'Sin techo',NULL,NULL) r", [gerente.codven]), error('42501'));
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
