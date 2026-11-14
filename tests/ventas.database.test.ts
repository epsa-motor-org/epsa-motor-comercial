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
  importeAntesDescuento: number | null; descuento: number | null; motivoDescuento: string | null;
  codusuAutorizadorDescuento: string | null; confirmacionTelefonicaRecibida: boolean | null;
  fechaConfirmacionTelefonica: string | null;
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
    descuento: number; motivoDescuento: string | null; codusuAutorizadorDescuento: number | null;
    confirmacionTelefonicaRecibida: boolean;
  }> = {}) => [
    coduni, opciones.codcli ?? 1, opciones.responsable ?? 3, opciones.sede ?? 1,
    opciones.fecha ?? '2026-11-09', opciones.modalidad ?? 'Crédito', opciones.adicional ?? null,
    opciones.entrega ?? null, JSON.stringify(opciones.pagos ?? []),
    opciones.techo === undefined ? JSON.stringify({ decision: 'Por definir' })
      : opciones.techo === null ? null : JSON.stringify(opciones.techo),
    opciones.refcomp ?? null, opciones.feccomp ?? null, opciones.observacion ?? null,
    opciones.clave ?? claveNueva(), opciones.descuento ?? 0, opciones.motivoDescuento ?? null,
    opciones.codusuAutorizadorDescuento ?? null, opciones.confirmacionTelefonicaRecibida ?? false
  ];
  const crearVenta = (coduni: string, opciones: Parameters<typeof ventaParams>[1] = {}) =>
    escalar<VentaSQL>('SELECT public.hu006_crear_venta($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::uuid,$15,$16,$17,$18) r',
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
  let correlativoUnidadHU021 = 0;
  const crearUnidadHU021 = async (): Promise<string> => propietario(async () => {
    const correlativo = ++correlativoUnidadHU021;
    const compraNueva = await escalar<string>(
      "INSERT INTO public.compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',1) RETURNING codcom::text r"
    );
    await db.query(`INSERT INTO public.factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu)
      VALUES ($1,'QA','HU021-FAC-${correlativo}','2026-11-12',1,1)`, [compraNueva]);
    return escalar<string>(`INSERT INTO public.unidad(codcom,codmod,nummotuni,chauni,coluni)
      VALUES ($1,1,$2,$3,'Azul') RETURNING coduni::text r`,
      [compraNueva, `HU021-MOTOR-${correlativo}`, `HU021-CHASIS-${correlativo}`]);
  });
  const cancelarSeparacion = (codsep: string, motivo: string, observacion: string | null, clave = claveNueva()) =>
    escalar<Record<string, unknown>>('SELECT public.hu021_cancelar_separacion($1,$2,$3,$4::uuid) r',
      [codsep, motivo, observacion, clave]);
  const cancelarVentaHU021 = (codven: string, motivo: string, observacion: string | null, clave = claveNueva()) =>
    escalar<Record<string, unknown>>('SELECT public.hu021_cancelar_venta($1,$2,$3,$4::uuid) r',
      [codven, motivo, observacion, clave]);
  const crearTransferenciaSeparacion = async (coduni: string, responsable = 3) => {
    const ruta = `separaciones/${coduni}/hu021-voucher.pdf`;
    await propietario(() => db.query(
      "INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('separaciones-evidencia',$1,$2)", [ruta, UUIDS[2]]));
    return escalar<{ codsep: string; estado: string }>(
      'SELECT public.hu005_crear_separacion($1,1,$2,1,100,\'2026-11-12\',\'Transferencia\',\'OP-HU021\',$3,\'Adelanto recibido\',true,$4::uuid,\'Por definir\',NULL) r',
      [coduni, responsable, ruta, claveNueva()]);
  };
  const crearSeparacionHU021 = async (coduni: string, responsable = 3) => {
    const resultado = await escalar<{ codsep: string }>(
      'SELECT public.hu005_crear_separacion($1,1,$2,NULL,100,\'2026-11-12\',\'Efectivo\',NULL,NULL,\'Recepción en caja\',true,$3::uuid,\'Por definir\',NULL) r',
      [coduni, responsable, claveNueva()]);
    return resultado.codsep;
  };
  const crearMovimientoActivoHU021 = async (coduni: string, estado: 'Pendiente' | 'En transito') => propietario(async () => {
    const codubi = await escalar<string>("SELECT codubi::text r FROM public.ubicacion WHERE nomubi='Comas HU006'");
    await db.query('UPDATE public.unidad SET codubi=$1 WHERE coduni=$2', [codubi, coduni]);
    await db.query(`INSERT INTO public.movimientoubicacion(coduni,codubiori,codubides,codusu,obsmub,estmub)
      VALUES ($1,2,$2,1,'Movimiento de prueba HU-021',$3)`, [coduni, codubi, estado]);
  });
  const snapshotFisicoMovimientoHU021 = (coduni: string) => propietario(() => escalar<Record<string, unknown>>(
    `SELECT jsonb_build_object(
      'ubicacion',u.codubi::text,'techo',u.codtte::text,'proveedor',u.codpro::text,
      'detalleTecho',u.dettecuni,
      'preparacion',(SELECT pg_catalog.to_jsonb(p)-'coduni' FROM public.preparacionunidad p WHERE p.coduni=u.coduni),
      'movimientos',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m)-'coduni' ORDER BY m.codmub)
        FROM public.movimientoubicacion m WHERE m.coduni=u.coduni),'[]'::jsonb)) r
     FROM public.unidad u WHERE u.coduni=$1`, [coduni]));

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
    await db.exec(leer('supabase/migrations/202611120004_hu021_cancelaciones.sql'));
    await db.exec(leer('supabase/migrations/202611130001_hu005_hu006_techo_configurado_y_catalogo.sql'));
    await db.exec(leer('supabase/migrations/202611140001_hu005_techo_solo_instalado.sql'));
    await db.exec(leer('supabase/migrations/202611140002_hu006_descuento_comercial.sql'));
    await db.exec(leer('supabase/migrations/202611140003_hu021_cancelacion_estado_e_inmutabilidad.sql'));
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
    const codsep = await crearSeparacion(unidad, 1, 'Sin techo');
    await login(1);
    const lona = Number(tipos);
    await assert.rejects(propietario(() => db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2', [lona, unidad])), error('PT423'),
      'no se configura físicamente un techo que contradice la decisión final Sin techo');
    await login(3);
    const convertida = await crearVenta(unidad, { techo: null, clave: claveNueva() });
    assert.equal(convertida.codsep, codsep);
    assert.equal(convertida.techo.decision, 'Sin techo');
    const estado = await propietario(() => escalar<{ ventas: number; separacion: string; comercial: string; codtte: string | null }>(
      `SELECT jsonb_build_object('ventas',(SELECT count(*)::int FROM venta WHERE coduni=u.coduni),
        'separacion',s.estsep,'comercial',u.estcomuni,'codtte',u.codtte::text) r FROM unidad u
      JOIN separacion s USING(coduni) WHERE u.coduni=$1`, [unidad]));
    assert.deepEqual(estado, { ventas: 1, separacion: 'Convertida', comercial: 'Vendida', codtte: null });
    assert.ok(lona > 0);
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

  await t.test('HU-021 Gerente/Administradora cancelan; vendedor solo si es responsable comercial actual', async () => {
    const gerenteUnidad = await crearUnidadHU021();
    await login(3);
    const sepGerente = await crearSeparacionHU021(gerenteUnidad);
    await login(1);
    const porGerente = await cancelarSeparacion(sepGerente, 'Comprador desistió', 'Adelanto se conserva');
    assert.equal(porGerente.estado, 'Cancelada');
    assert.equal(porGerente.cancelador, '1');

    const adminUnidad = await crearUnidadHU021();
    await login(3);
    const sepAdmin = await crearSeparacionHU021(adminUnidad);
    await login(2);
    assert.equal((await cancelarSeparacion(sepAdmin, 'Solicitud de anulación', 'Adelanto retenido')).estado, 'Cancelada');

    const autorUnidad = await crearUnidadHU021();
    await login(3);
    const sepAutor = await crearSeparacionHU021(autorUnidad, 3);
    await propietario(() => db.query('UPDATE public.separacion SET codusuresp=6 WHERE codsep=$1', [sepAutor]));
    await assert.rejects(cancelarSeparacion(sepAutor, 'Autor no vigente', 'No devolver hasta conciliar'), error('PT652'));
    await login(6);
    const claveSep = claveNueva();
    assert.equal((await cancelarSeparacion(sepAutor, 'Responsable reasignado', 'No devolver hasta conciliar', claveSep)).estado, 'Cancelada');
    await propietario(() => db.query('UPDATE public.separacion SET codusuresp=3 WHERE codsep=$1', [sepAutor]));
    await assert.rejects(cancelarSeparacion(sepAutor, 'Responsable reasignado', 'No devolver hasta conciliar', claveSep), error('PT652'),
      'el replay también verifica el responsable vigente después del lock');

    const responsableUnidad = await crearUnidadHU021();
    await login(1);
    const sepResponsable = await crearSeparacionHU021(responsableUnidad, 3);
    await login(3);
    assert.equal((await cancelarSeparacion(sepResponsable, 'Responsable asignado', 'Adelanto observado')).estado, 'Cancelada');
  });

  await t.test('HU-021 vendedor ajeno y auxiliar no cancelan; separación Convertida no se cancela aisladamente', async () => {
    const unidadAjena = await crearUnidadHU021();
    await login(1);
    const separacionAjena = await crearSeparacionHU021(unidadAjena, 2);
    await login(3);
    await assert.rejects(cancelarSeparacion(separacionAjena, 'Intento ajeno', 'Observación'), error('PT652'));
    const antes = await propietario(() => escalar<{ estado: string; comercial: string }>(
      `SELECT jsonb_build_object('estado',s.estsep,'comercial',u.estcomuni) r
       FROM public.separacion s JOIN public.unidad u USING(coduni) WHERE s.codsep=$1`, [separacionAjena]));
    assert.deepEqual(antes, { estado: 'Activa', comercial: 'Separada' });
    await login(4);
    await assert.rejects(cancelarSeparacion(separacionAjena, 'Sin permiso', 'Observación'), error('42501'));

    const unidadConvertida = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacionHU021(unidadConvertida);
    const venta = await crearVenta(unidadConvertida, { clave: claveNueva() });
    await assert.rejects(cancelarSeparacion(codsep, 'No aplica', 'Adelanto se mantiene'), error('PT653'));
    const estados = await propietario(() => escalar<{ sep: string; ven: string; eventos: number }>(
      `SELECT jsonb_build_object('sep',(SELECT estsep FROM public.separacion WHERE codsep=$1),
        'ven',(SELECT estven FROM public.venta WHERE codven=$2),
        'eventos',(SELECT count(*)::int FROM public.historialcancelacion WHERE codsep=$1)) r`, [codsep, venta.codven]));
    assert.deepEqual(estados, { sep: 'Convertida', ven: 'Registrada', eventos: 0 });
  });

  await t.test('HU-021 separación conserva adelanto/evidencia y no cambia ubicación, techo, preparación ni proveedor', async () => {
    const unidad = await crearUnidadHU021();
    const tipo = await propietario(() => escalar<string>(
      "SELECT codtte::text r FROM public.tipotecho WHERE nomtte='Lona QA'"));
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE public.unidad SET codubi=1,codtte=$1,codpro=1,dettecuni=$2 WHERE coduni=$3',
        [tipo, 'Configuración física preservada', unidad]);
      await db.query("UPDATE public.preparacionunidad SET estarmado='Terminado',esttecho='Instalado' WHERE coduni=$1", [unidad]);
    });
    await login(3);
    const separacion = await crearTransferenciaSeparacion(unidad);
    const fisicoAntes = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('codubi',u.codubi,'codtte',u.codtte,'codpro',u.codpro,
        'detalle',u.dettecuni,'armado',p.estarmado,'techo',p.esttecho,'version',p.versionprep) r
       FROM public.unidad u JOIN public.preparacionunidad p USING(coduni) WHERE u.coduni=$1`, [unidad]));
    await assert.rejects(cancelarSeparacion(separacion.codsep, 'Comprador desistió', null), error('PT656'));
    const salida = await cancelarSeparacion(separacion.codsep, 'Comprador desistió', 'Adelanto queda pendiente de conciliación');
    assert.equal((salida.finanzasConservadas as Record<string, unknown>).adelanto, 100);
    assert.equal((salida.finanzasConservadas as Record<string, unknown>).evidenciaConservada, true);
    const conservacion = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('físico',jsonb_build_object('codubi',u.codubi,'codtte',u.codtte,'codpro',u.codpro,
        'detalle',u.dettecuni,'armado',p.estarmado,'techo',p.esttecho,'version',p.versionprep),
        'estado',s.estsep,'monto',s.monadesep,'evidencia',s.rutavouchersep,'referencia',s.refsep,
        'medio',s.metpagsep,'observacion',s.obssep) r
       FROM public.unidad u JOIN public.preparacionunidad p USING(coduni)
       JOIN public.separacion s USING(coduni) WHERE u.coduni=$1 AND s.codsep=$2`, [unidad, separacion.codsep]));
    assert.deepEqual(conservacion.físico, fisicoAntes);
    assert.deepEqual([conservacion.estado, conservacion.monto, conservacion.evidencia,
      conservacion.referencia, conservacion.medio, conservacion.observacion],
      ['Cancelada', 100, `separaciones/${unidad}/hu021-voucher.pdf`, 'OP-HU021', 'Transferencia', 'Adelanto recibido']);
  });

  await t.test('HU-021 venta conserva pagos, adelanto y separación Convertida, exige observación financiera y no altera datos físicos', async () => {
    const unidad = await crearUnidadHU021();
    const codtte = await propietario(() => escalar<string>("SELECT codtte::text r FROM public.tipotecho WHERE nomtte='Lona QA'"));
    await login(1);
    await propietario(async () => {
      await db.query('UPDATE public.unidad SET codubi=2,codtte=$1,codpro=1,dettecuni=$2 WHERE coduni=$3',
        [codtte, 'Ajuste de techo conservado', unidad]);
      await db.query("UPDATE public.preparacionunidad SET estarmado='Terminado',esttecho='Instalado' WHERE coduni=$1", [unidad]);
    });
    await login(3);
    const codsep = await crearSeparacionHU021(unidad);
    const venta = await crearVenta(unidad, { pagos: [{ monto: 150, fecha: '2026-11-12', medioPago: 'Efectivo',
      referencia: null, rutaEvidencia: null, observacion: 'Pago en caja', ingresoConfirmado: true, codusuConfirmador: null }] });
    const fisicoAntes = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('codubi',u.codubi,'codtte',u.codtte,'codpro',u.codpro,
        'detalle',u.dettecuni,'armado',p.estarmado,'techo',p.esttecho,'version',p.versionprep) r
       FROM public.unidad u JOIN public.preparacionunidad p USING(coduni) WHERE u.coduni=$1`, [unidad]));
    await assert.rejects(cancelarVentaHU021(venta.codven, 'Comprador desistió', null), error('PT656'));
    const cancelada = await cancelarVentaHU021(venta.codven, 'Comprador desistió', 'Mantener saldo para conciliación');
    assert.equal(cancelada.estado, 'Cancelada');
    assert.equal(cancelada.estadoComercialUnidad, 'Disponible');
    assert.deepEqual(cancelada.finanzasConservadas, {
      importe: 10000, adelantoSeparacion: 100, pagosVenta: 150, cantidadPagos: 1,
      totalRecibido: 250, saldo: 9750, comprobanteExternoConservado: false,
      estadoSeparacionVinculada: 'Convertida'
    });
    const estado = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('venta',v.estven,'feccancelacion',v.feccanven IS NOT NULL,
        'motivo',v.motcanven,'cancelador',v.codusucanven::text,'obsdinero',v.obscancelaciondinero,
        'pagos',(SELECT count(*)::int FROM public.pagoventa p WHERE p.codven=v.codven),
        'separacion',s.estsep,'adelanto',s.monadesep,'comprobante',v.refcompven,
        'comercial',u.estcomuni,'físico',jsonb_build_object('codubi',u.codubi,'codtte',u.codtte,
          'codpro',u.codpro,'detalle',u.dettecuni,'armado',p.estarmado,'techo',p.esttecho,'version',p.versionprep)) r
       FROM public.venta v JOIN public.separacion s ON s.codsep=v.codsep
       JOIN public.unidad u ON u.coduni=v.coduni JOIN public.preparacionunidad p ON p.coduni=u.coduni
       WHERE v.codven=$1`, [venta.codven]));
    assert.deepEqual(estado.físico, fisicoAntes);
    assert.deepEqual([estado.venta, estado.feccancelacion, estado.motivo, estado.cancelador,
      estado.obsdinero, estado.pagos, estado.separacion, estado.adelanto, estado.comprobante, estado.comercial],
      ['Cancelada', true, 'Comprador desistió', '3', 'Mantener saldo para conciliación', 1,
        'Convertida', 100, null, 'Disponible']);
  });

  await t.test('HU-021 Gerente/Admin cancelan; vendedor autor requiere ser el responsable comercial actual', async () => {
    const autorUnidad = await crearUnidadHU021();
    await login(3);
    const ventaAutor = await crearVenta(autorUnidad, { responsable: 3, clave: claveNueva() });
    await propietario(() => db.query('UPDATE public.venta SET codusuresp=6 WHERE codven=$1', [ventaAutor.codven]));
    await assert.rejects(cancelarVentaHU021(ventaAutor.codven, 'Autor ya no asignado', null), error('PT652'));
    await login(6);
    const claveVenta = claveNueva();
    const canceladaPorResponsable = await cancelarVentaHU021(ventaAutor.codven, 'Responsable reasignado', null, claveVenta);
    assert.equal(canceladaPorResponsable.estado, 'Cancelada');
    const replayResponsable = await cancelarVentaHU021(ventaAutor.codven, 'Responsable reasignado', null, claveVenta);
    assert.equal(replayResponsable.reutilizada, true,
      'el replay autorizado por el responsable vigente recupera la cancelación sin reescribir una venta histórica');

    const responsableUnidad = await crearUnidadHU021();
    await login(1);
    const ventaResponsable = await crearVenta(responsableUnidad, { responsable: 3, clave: claveNueva() });
    await login(3);
    assert.equal((await cancelarVentaHU021(ventaResponsable.codven, 'Responsable asignado', null)).estado, 'Cancelada');

    const gerenteUnidad = await crearUnidadHU021();
    await login(3);
    const ventaGerente = await crearVenta(gerenteUnidad, { clave: claveNueva() });
    await login(1);
    assert.equal((await cancelarVentaHU021(ventaGerente.codven, 'Revisión de gerente', null)).cancelador, '1');

    const adminUnidad = await crearUnidadHU021();
    await login(3);
    const ventaAdmin = await crearVenta(adminUnidad, { clave: claveNueva() });
    await login(2);
    assert.equal((await cancelarVentaHU021(ventaAdmin.codven, 'Revisión administrativa', null)).cancelador, '2');

    const ajenaUnidad = await crearUnidadHU021();
    await login(1);
    const ventaAjena = await crearVenta(ajenaUnidad, { responsable: 2, clave: claveNueva() });
    await login(3);
    await assert.rejects(cancelarVentaHU021(ventaAjena.codven, 'Intento ajeno', null), error('PT652'));
    assert.equal(await propietario(() => escalar<string>('SELECT estven r FROM public.venta WHERE codven=$1', [ventaAjena.codven])), 'Registrada');
  });

  await t.test('HU-021 venta histórica sin codusuresp no autoriza vendedores; Gerente y Administradora conservan acceso', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const venta = await crearVenta(unidad, { responsable: 3, clave: claveNueva() });
    await propietario(() => db.query(`UPDATE public.venta SET codusuresp=NULL,
      idempotenciaven=NULL,payloadidempotenciaven=NULL WHERE codven=$1`, [venta.codven]));
    await assert.rejects(cancelarVentaHU021(venta.codven, 'Autor sin asignación vigente', null), error('PT652'));
    await login(6);
    await assert.rejects(cancelarVentaHU021(venta.codven, 'Otro vendedor sin asignación', null), error('PT652'));
    await login(1);
    assert.equal((await cancelarVentaHU021(venta.codven, 'Cancelación por gerente', null)).estado, 'Cancelada');

    const unidadAdmin = await crearUnidadHU021();
    await login(3);
    const ventaAdmin = await crearVenta(unidadAdmin, { responsable: 3, clave: claveNueva() });
    await propietario(() => db.query(`UPDATE public.venta SET codusuresp=NULL,
      idempotenciaven=NULL,payloadidempotenciaven=NULL WHERE codven=$1`, [ventaAdmin.codven]));
    await login(2);
    const cancelacionAdmin = await cancelarVentaHU021(ventaAdmin.codven, 'Cancelación por administradora', null);
    assert.equal(cancelacionAdmin.estado, 'Cancelada');
    assert.equal(cancelacionAdmin.cancelador, '2');

    const nulabilidad = await propietario(() => escalar<string>(
      `SELECT is_nullable r FROM information_schema.columns
       WHERE table_schema='public' AND table_name='separacion' AND column_name='codusuresp'`));
    assert.equal(nulabilidad, 'NO', 'separacion.codusuresp permanece NOT NULL según la migration HU-005 aplicada');
  });

  await t.test('HU-021 venta conserva pago con voucher, comprobante externo y comprobante financiero', async () => {
    const unidad = await crearUnidadHU021();
    const ruta = `ventas/${unidad}/hu021-transferencia.pdf`;
    await login(3);
    await asegurarEvidenciaVenta(unidad, ruta);
    const venta = await crearVenta(unidad, {
      pagos: [{ monto: 125, fecha: '2026-11-12', medioPago: 'Transferencia', referencia: 'OP-HU021-VENTA',
        rutaEvidencia: ruta, observacion: 'Ingreso confirmado por gerente', ingresoConfirmado: true, codusuConfirmador: 1 }],
      refcomp: 'F001-HU021', feccomp: '2026-11-12'
    });
    const resultado = await cancelarVentaHU021(venta.codven, 'Venta duplicada en sistema externo', 'Pago queda pendiente de conciliación');
    assert.equal((resultado.finanzasConservadas as Record<string, unknown>).comprobanteExternoConservado, true);
    const conservado = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('estado',v.estven,'referencia',v.refcompven,'fechaComprobante',v.feccompven,
        'pagos',(SELECT count(*)::int FROM public.pagoventa p WHERE p.codven=v.codven),
        'ruta',(SELECT p.rutavoucherven FROM public.pagoventa p WHERE p.codven=v.codven),
        'referenciaPago',(SELECT p.refpagven FROM public.pagoventa p WHERE p.codven=v.codven)) r
       FROM public.venta v WHERE v.codven=$1`, [venta.codven]));
    assert.deepEqual(conservado, { estado: 'Cancelada', referencia: 'F001-HU021', fechaComprobante: '2026-11-12',
      pagos: 1, ruta, referenciaPago: 'OP-HU021-VENTA' });
  });

  await t.test('HU-021 replay de venta con la misma key no agrega otro evento y una segunda cancelación entra en conflicto', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const venta = await crearVenta(unidad, { clave: claveNueva() });
    const key = claveNueva();
    const primera = await cancelarVentaHU021(venta.codven, 'Corrección comercial', null, key);
    assert.equal(primera.reutilizada, false);
    assert.equal((await cancelarVentaHU021(venta.codven, 'Corrección comercial', null, key)).reutilizada, true);
    await assert.rejects(cancelarVentaHU021(venta.codven, 'Motivo diferente', null, key), error('PT658'));
    await assert.rejects(cancelarVentaHU021(venta.codven, 'Corrección comercial', null, claveNueva()), error('PT654'));
    const lectura = await escalar<Record<string, unknown>>(
      'SELECT public.hu021_consultar_cancelacion_venta($1) r', [venta.codven]);
    assert.equal(lectura.tipoOperacion, 'Venta');
    assert.equal(lectura.codOperacion, venta.codven);
    assert.equal(lectura.estadoAnterior, 'Registrada');
    assert.equal(lectura.estadoResultante, 'Cancelada');
    assert.ok(!('payload' in lectura) && !('resultado' in lectura));
    assert.equal(await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.historialcancelacion WHERE codven=$1', [venta.codven])), 1);
  });

  await t.test('HU-021 replay con misma key no duplica log; payload distinto y segunda cancelación entran en conflicto', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacionHU021(unidad);
    const key = claveNueva();
    const argumentos = [codsep, 'Solicitud cancelada', 'Adelanto retenido', key] as const;
    const primera = await cancelarSeparacion(...argumentos);
    const replay = await cancelarSeparacion(...argumentos);
    assert.equal(primera.reutilizada, false);
    assert.equal(replay.reutilizada, true);
    await assert.rejects(cancelarSeparacion(codsep, 'Solicitud distinta', 'Adelanto retenido', key), error('PT658'));
    await assert.rejects(cancelarSeparacion(codsep, 'Solicitud cancelada', 'Adelanto retenido', claveNueva()), error('PT659'));
    const auditoria = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('cantidad',(SELECT count(*)::int FROM public.historialcancelacion WHERE codsep=$1),
        'tipo',h.tipoperacion,'accion',h.accion,'actor',h.codusu::text,'motivo',h.motivo,
        'observacion',h.observaciondinero,'anterior',h.estadoanterior,'resultado',h.estadoresultante,
        'comercial',h.estcomuniresultante,'fecha',h.fecaccion IS NOT NULL) r
       FROM public.historialcancelacion h WHERE h.codsep=$1`, [codsep]));
    assert.deepEqual(auditoria, { cantidad: 1, tipo: 'Separacion', accion: 'Cancelacion', actor: '3',
      motivo: 'Solicitud cancelada', observacion: 'Adelanto retenido', anterior: 'Activa',
      resultado: 'Cancelada', comercial: 'Disponible', fecha: true });
    const lectura = await escalar<Record<string, unknown>>(
      'SELECT public.hu021_consultar_cancelacion_separacion($1) r', [codsep]);
    assert.deepEqual(lectura, {
      tipoOperacion: 'Separacion', codOperacion: codsep, accion: 'Cancelacion',
      actor: { codusu: '3', nombre: 'Vendedor QA' },
      fecha: lectura.fecha, motivo: 'Solicitud cancelada', observacionFinanciera: 'Adelanto retenido',
      estadoAnterior: 'Activa', estadoResultante: 'Cancelada', estadoComercialResultante: 'Disponible'
    });
    assert.ok(!('payload' in lectura) && !('resultado' in lectura));
    await login(6);
    await assert.rejects(escalar('SELECT public.hu021_consultar_cancelacion_separacion($1) r', [codsep]), error('42501'));
    await login(3);
    await assert.rejects(db.query('SELECT * FROM public.historialcancelacion'), error('42501'));
  });

  await t.test('HU-021 doble solicitud local con la misma key genera una sola cancelación y un solo evento', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacionHU021(unidad);
    const key = claveNueva();
    // PGlite usa una conexión compartida; esto comprueba replay y resultado de negocio,
    // no reemplaza una prueba de bloqueo con dos sesiones PostgreSQL independientes.
    const resultados = await Promise.all([
      cancelarSeparacion(codsep, 'Prueba de doble solicitud', 'Adelanto conservado', key),
      cancelarSeparacion(codsep, 'Prueba de doble solicitud', 'Adelanto conservado', key)
    ]);
    assert.deepEqual(resultados.map(resultado => resultado.reutilizada).sort(), [false, true]);
    assert.equal(await propietario(() => escalar<number>(
      'SELECT count(*)::int r FROM public.historialcancelacion WHERE codsep=$1', [codsep])), 1);
  });

  await t.test('HU-021 un fallo al insertar auditoría revierte estado comercial y cancelación', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacionHU021(unidad);
    await propietario(() => db.exec(`CREATE FUNCTION public.hu021_test_rechazar_log() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo QA al escribir log'; END $$;
      CREATE TRIGGER hu021_test_rechazar_log BEFORE INSERT ON public.historialcancelacion
      FOR EACH ROW EXECUTE FUNCTION public.hu021_test_rechazar_log()`));
    await assert.rejects(cancelarSeparacion(codsep, 'Debe revertirse', 'Adelanto conservado'));
    await propietario(async () => {
      await db.exec('DROP TRIGGER hu021_test_rechazar_log ON public.historialcancelacion; DROP FUNCTION public.hu021_test_rechazar_log()');
      const estado = await escalar<{ sep: string; comercial: string; eventos: number }>(
        `SELECT jsonb_build_object('sep',s.estsep,'comercial',u.estcomuni,
          'eventos',(SELECT count(*)::int FROM public.historialcancelacion WHERE codsep=s.codsep)) r
         FROM public.separacion s JOIN public.unidad u USING(coduni) WHERE s.codsep=$1`, [codsep]);
      assert.deepEqual(estado, { sep: 'Activa', comercial: 'Separada', eventos: 0 });
    });
  });

  await t.test('HU-021 venta Cancelada deja liberar la unidad y crear una nueva venta; venta vigente sigue bloqueando', async () => {
    const unidadReventa = await crearUnidadHU021();
    await login(3);
    const ventaAnterior = await crearVenta(unidadReventa, { clave: claveNueva() });
    const cancelada = await cancelarVentaHU021(ventaAnterior.codven, 'Error de registro', null);
    assert.equal(cancelada.unidadLiberada, true);
    assert.equal(await escalar<unknown | null>('SELECT public.hu006_venta_de_unidad($1) r', [unidadReventa]), null,
      'si solo hay ventas canceladas, la consulta de venta vigente devuelve null');
    const ventaNueva = await crearVenta(unidadReventa, { clave: claveNueva() });
    assert.notEqual(ventaNueva.codven, ventaAnterior.codven);
    const ventaVigente = await escalar<{ codven: string; estado: string }>(
      `SELECT jsonb_build_object('codven',r->>'codven','estado',r->>'estado') r
       FROM (SELECT public.hu006_venta_de_unidad($1) r) consulta`, [unidadReventa]);
    assert.deepEqual(ventaVigente, { codven: ventaNueva.codven, estado: 'Registrada' },
      'con una venta cancelada anterior y otra registrada, solo se proyecta la actual');
    const filas = await propietario(() => escalar<{ cantidad: number; estados: string[] }>(
      `SELECT jsonb_build_object('cantidad',count(*)::int,'estados',array_agg(estven ORDER BY codven)) r
       FROM public.venta WHERE coduni=$1`, [unidadReventa]));
    assert.deepEqual(filas, { cantidad: 2, estados: ['Cancelada', 'Registrada'] });
    await assert.rejects(crearVenta(unidadReventa, { clave: claveNueva() }), error('PT604'));
    await assert.rejects(crearSeparacionHU021(unidadReventa), error('PT430'));

    const unidadSeparacion = await crearUnidadHU021();
    const venta = await crearVenta(unidadSeparacion, { clave: claveNueva() });
    await cancelarVentaHU021(venta.codven, 'Liberar para separar', null);
    const sep = await crearSeparacionHU021(unidadSeparacion);
    assert.ok(Number(sep) > 0);
    const estadoUnidad = await propietario(() => escalar<string>(
      'SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [unidadSeparacion]));
    assert.equal(estadoUnidad, 'Separada');
  });

  await t.test('HU-021 no libera la unidad si permanece otra separación activa', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacionHU021(unidad);
    const codven = await propietario(async () => {
      const resultado = await db.query<{ codven: string }>(`INSERT INTO public.venta(
        coduni,codcli,codusu,fecven,modcomven,estven
      ) VALUES ($1,1,1,CURRENT_TIMESTAMP,'Contado','Registrada') RETURNING codven::text`, [unidad]);
      await db.query("UPDATE public.unidad SET estcomuni='Vendida' WHERE coduni=$1", [unidad]);
      return resultado.rows[0]!.codven;
    });
    await login(1);
    const resultado = await cancelarVentaHU021(codven, 'Conflicto de datos conciliado', null);
    assert.equal(resultado.unidadLiberada, false);
    assert.equal(resultado.estadoComercialUnidad, 'Separada');
    const estado = await propietario(() => escalar<{ venta: string; separacion: string; unidad: string }>(
      `SELECT jsonb_build_object('venta',v.estven,'separacion',s.estsep,'unidad',u.estcomuni) r
       FROM public.venta v JOIN public.unidad u ON u.coduni=v.coduni
       JOIN public.separacion s ON s.coduni=u.coduni AND s.estsep='Activa' WHERE v.codven=$1`, [codven]));
    assert.deepEqual(estado, { venta: 'Cancelada', separacion: 'Activa', unidad: 'Separada' });
    assert.ok(Number(codsep) > 0);
  });

  await t.test('HU-006 descuento: cálculo neto, autorizador validado, replay y proyecciones', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const opciones = {
      descuento: 500, motivoDescuento: 'Campaña autorizada por llamada',
      codusuAutorizadorDescuento: 1, confirmacionTelefonicaRecibida: true, clave: claveNueva()
    };
    const creada = await crearVenta(unidad, opciones);
    assert.deepEqual([creada.autor.codusu, creada.codusuAutorizadorDescuento, creada.descuento,
      creada.importeAntesDescuento, creada.importe, creada.totalRecibido, creada.saldo],
    ['3', '1', 500, 10000, 9500, 0, 9500]);
    assert.equal(creada.confirmacionTelefonicaRecibida, true);
    assert.ok(creada.fechaConfirmacionTelefonica);
    const replay = await crearVenta(unidad, opciones);
    assert.deepEqual([replay.codven, replay.importe, replay.descuento, replay.reutilizada],
      [creada.codven, 9500, 500, true]);
    await assert.rejects(crearVenta(unidad, { ...opciones, descuento: 400 }), error('PT611'));
    await assert.rejects(crearVenta(unidad, { ...opciones, codusuAutorizadorDescuento: 2 }), error('PT611'));

    const datos = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('operador',codusu::text,'descuento',descuentoven,
        'motivo',motivodescuentoven,'autorizador',codusuautorizadesc::text,
        'confirmacion',conftelefonicadesc,'fecha',fecconftelefonicadesc IS NOT NULL,
        'base',prebaseven,'adicional',adicionalacordadoven,'total',impven) r
       FROM venta WHERE codven=$1`, [creada.codven]));
    assert.deepEqual(datos, { operador: '3', descuento: 500, motivo: opciones.motivoDescuento,
      autorizador: '1', confirmacion: true, fecha: true, base: 10000, adicional: 0, total: 9500 });

    const ficha = await escalar<Record<string, unknown>>('SELECT public.hu006_venta_de_unidad($1) r', [unidad]);
    assert.deepEqual([ficha.descuento, ficha.importeAntesDescuento, ficha.importe], [500, 10000, 9500]);
    const lista = await escalar<{ items: Array<Record<string, unknown>> }>('SELECT public.hu006_listar_ventas(NULL,100,0) r');
    const item = lista.items.find(fila => fila.codven === creada.codven)!;
    assert.deepEqual([item.descuento, item.importeAntesDescuento, item.total], [500, 10000, 9500]);
  });

  await t.test('HU-006 descuento: cero explícito; máximo permitido sin dinero recibido; validaciones PostgreSQL', async () => {
    await login(3);
    const unidadCero = await crearUnidadHU021();
    const sinDescuento = await crearVenta(unidadCero, { descuento: 0, clave: claveNueva() });
    assert.deepEqual([sinDescuento.descuento, sinDescuento.motivoDescuento,
      sinDescuento.codusuAutorizadorDescuento, sinDescuento.confirmacionTelefonicaRecibida,
      sinDescuento.fechaConfirmacionTelefonica], [0, null, null, false, null]);

    const unidadCeroTotal = await crearUnidadHU021();
    const totalCero = await crearVenta(unidadCeroTotal, { descuento: 10000,
      motivoDescuento: 'Descuento total declarado', codusuAutorizadorDescuento: 2,
      confirmacionTelefonicaRecibida: true, clave: claveNueva() });
    assert.deepEqual([totalCero.importeAntesDescuento, totalCero.importe, totalCero.totalRecibido, totalCero.saldo],
      [10000, 0, 0, 0]);

    const sinDinero = await crearUnidadHU021();
    await assert.rejects(crearVenta(sinDinero, { descuento: 10000.01,
      motivoDescuento: 'No superar el precio', codusuAutorizadorDescuento: 1,
      confirmacionTelefonicaRecibida: true, clave: claveNueva() }), error('PT624'));
    const conAdelanto = await crearUnidadHU021();
    const codsep = await crearSeparacionHU021(conAdelanto);
    await assert.rejects(crearVenta(conAdelanto, { techo: null, descuento: 10000,
      motivoDescuento: 'El total cero no cubre el adelanto', codusuAutorizadorDescuento: 1,
      confirmacionTelefonicaRecibida: true, clave: claveNueva() }), error('PT612'));
    const separacionIntacta = await propietario(() => escalar<{ ventas: number; estado: string; separacion: string }>(
      `SELECT jsonb_build_object('ventas',(SELECT count(*)::int FROM venta WHERE coduni=u.coduni),
        'estado',u.estcomuni,'separacion',s.estsep) r FROM unidad u JOIN separacion s USING(coduni) WHERE u.coduni=$1`, [conAdelanto]));
    assert.deepEqual(separacionIntacta, { ventas: 0, estado: 'Separada', separacion: 'Activa' });
    assert.ok(Number(codsep) > 0);
    const autorNoExiste = await crearUnidadHU021();
    await assert.rejects(crearVenta(autorNoExiste, { descuento: 1, motivoDescuento: 'Campaña',
      codusuAutorizadorDescuento: 9999, confirmacionTelefonicaRecibida: true, clave: claveNueva() }), error('PT625'));
    const autorVendedor = await crearUnidadHU021();
    await assert.rejects(crearVenta(autorVendedor, { descuento: 1, motivoDescuento: 'Campaña',
      codusuAutorizadorDescuento: 3, confirmacionTelefonicaRecibida: true, clave: claveNueva() }), error('PT625'));
    const autorInactivo = await crearUnidadHU021();
    await propietario(() => db.query('UPDATE public.usuario SET estusu=false WHERE codusu=2'));
    await assert.rejects(crearVenta(autorInactivo, { descuento: 1, motivoDescuento: 'Campaña',
      codusuAutorizadorDescuento: 2, confirmacionTelefonicaRecibida: true, clave: claveNueva() }), error('PT625'));
    await propietario(() => db.query('UPDATE public.usuario SET estusu=true WHERE codusu=2'));
    const rolInactivo = await crearUnidadHU021();
    await propietario(() => db.query("UPDATE public.rol SET estrol=false WHERE nomrol='Administradora'"));
    await assert.rejects(crearVenta(rolInactivo, { descuento: 1, motivoDescuento: 'Campaña',
      codusuAutorizadorDescuento: 2, confirmacionTelefonicaRecibida: true, clave: claveNueva() }), error('PT625'));
    await propietario(() => db.query("UPDATE public.rol SET estrol=true WHERE nomrol='Administradora'"));
    for (const unidad of [sinDinero, autorNoExiste, autorVendedor, autorInactivo, rolInactivo]) {
      assert.equal(await propietario(() => escalar<number>('SELECT count(*)::int r FROM public.venta WHERE coduni=$1', [unidad])), 0);
      assert.equal(await propietario(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [unidad])), 'Disponible');
    }
    assert.equal(await propietario(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [conAdelanto])), 'Separada');
  });

  await t.test('HU-006 descuento en conversión y resolución de Por definir conserva adelanto y acuerdo', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacion(unidad, 1, 'Por definir');
    const opciones = { techo: null, descuento: 500, motivoDescuento: 'Autorizado por llamada',
      codusuAutorizadorDescuento: 1, confirmacionTelefonicaRecibida: true, clave: claveNueva() };
    const venta = await crearVenta(unidad, opciones);
    assert.equal(venta.codsep, codsep);
    assert.deepEqual([venta.importeAntesDescuento, venta.descuento, venta.importe, venta.totalRecibido, venta.saldo],
      [10000, 500, 9500, 200, 9300]);
    const resuelta = await guardarTechoVenta(venta.codven, 'Con techo', Number(tipos), 175);
    assert.deepEqual([resuelta.importeAntesDescuento, resuelta.descuento, resuelta.importe,
      resuelta.totalRecibido, resuelta.saldo, resuelta.motivoDescuento,
      resuelta.codusuAutorizadorDescuento, resuelta.confirmacionTelefonicaRecibida],
    [10175, 500, 9675, 200, 9475, 'Autorizado por llamada', '1', true]);
    const repetida = await guardarTechoVenta(venta.codven, 'Con techo', Number(tipos), 175);
    assert.deepEqual([repetida.importe, repetida.descuento, repetida.totalRecibido, repetida.saldo], [9675, 500, 200, 9475]);
    const persistido = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('ventas',(SELECT count(*)::int FROM venta WHERE coduni=$1),
        'separacion',s.estsep,'adelanto',s.monadesep,'descuento',v.descuentoven,
        'autorizador',v.codusuautorizadesc::text,'confirmacion',v.conftelefonicadesc,
        'total',v.impven,'pagos',(SELECT count(*)::int FROM pagoventa WHERE codven=v.codven)) r
       FROM venta v JOIN separacion s ON s.codsep=v.codsep WHERE v.codven=$2`, [unidad, venta.codven]));
    assert.deepEqual(persistido, { ventas: 1, separacion: 'Convertida', adelanto: 200,
      descuento: 500, autorizador: '1', confirmacion: true, total: 9675, pagos: 0 });
  });

  await t.test('HU-021 cancela venta con descuento preservando total neto, adelanto, pagos y evidencia', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const codsep = await crearSeparacionHU021(unidad);
    const ruta = `ventas/${unidad}/hu021-descuento.pdf`;
    await asegurarEvidenciaVenta(unidad, ruta);
    const venta = await crearVenta(unidad, { descuento: 500, motivoDescuento: 'Autorizado por llamada',
      codusuAutorizadorDescuento: 1, confirmacionTelefonicaRecibida: true,
      techo: null,
      pagos: [{ monto: 150, fecha: '2026-11-12', medioPago: 'Transferencia', referencia: 'OP-HU021-DESC',
        rutaEvidencia: ruta, observacion: 'Pago conciliado', ingresoConfirmado: true, codusuConfirmador: 1 }],
      clave: claveNueva() });
    assert.equal(venta.codsep, codsep);
    const snapshotFinanciero = () => propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object(
        'base',v.prebaseven,'adicionalReferencial',v.adicionalrefven,'adicionalAcordado',v.adicionalacordadoven,
        'descuento',v.descuentoven,'motivoDescuento',v.motivodescuentoven,
        'autorizador',v.codusuautorizadesc::text,'confirmacion',v.conftelefonicadesc,
        'fechaConfirmacion',v.fecconftelefonicadesc,'total',v.impven,
        'adelanto',jsonb_build_object('monto',s.monadesep,'estado',s.estsep,'confirmado',s.ingconfsep),
        'pagos',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'monto',p.montopagven,'medio',p.metpagven,'referencia',p.refpagven,'evidencia',p.rutavoucherven,
          'observacion',p.obspagven,'ingresoConfirmado',p.ingconfpag,'autor',p.codusuautorpag::text,
          'confirmador',p.codusuconfpag::text,'fechaConfirmacion',p.fecconfpag) ORDER BY p.nropagven),'[]'::jsonb)
          FROM public.pagoventa p WHERE p.codven=v.codven)) r
       FROM public.venta v JOIN public.separacion s ON s.codsep=v.codsep WHERE v.codven=$1`, [venta.codven]));
    const antes = await snapshotFinanciero();
    const cancelada = await cancelarVentaHU021(venta.codven, 'Corrección de venta descontada',
      'Conservar lo cobrado para conciliación');
    assert.deepEqual(cancelada.finanzasConservadas, {
      importe: 9500, adelantoSeparacion: 100, pagosVenta: 150, cantidadPagos: 1,
      totalRecibido: 250, saldo: 9250, comprobanteExternoConservado: false,
      estadoSeparacionVinculada: 'Convertida'
    });
    assert.deepEqual(await snapshotFinanciero(), antes,
      'la cancelación conserva los snapshots financieros, adelanto, pago y evidencia exactamente');
    const lista = await escalar<{ items: Array<Record<string, unknown>> }>(
      'SELECT public.hu006_listar_ventas(NULL,100,0) r');
    const item = lista.items.find(fila => fila.codven === venta.codven)!;
    assert.deepEqual([
      item.precioBaseAcordado, item.adicionalTechoReferencial, item.adicionalTechoAcordado,
      item.importeAntesDescuento, item.descuento, item.motivoDescuento,
      item.codusuAutorizadorDescuento, item.confirmacionTelefonicaRecibida,
      item.fechaConfirmacionTelefonica, item.total, item.adelanto, item.totalRecibido, item.saldo, item.estado
    ], [10000, 0, 0, 10000, 500, 'Autorizado por llamada', '1', true,
      antes.fechaConfirmacion, 9500, 100, 250, 9250, 'Cancelada']);
  });

  await t.test('HU-021: el estado resultante conserva No disponible por movimiento HU-003 activo', async movementTest => {
    const casos = [
      { operacion: 'separación', movimiento: 'Pendiente' as const },
      { operacion: 'separación', movimiento: 'En transito' as const },
      { operacion: 'venta', movimiento: 'Pendiente' as const },
      { operacion: 'venta', movimiento: 'En transito' as const }
    ];
    for (const caso of casos) await movementTest.test(`${caso.operacion}, movimiento ${caso.movimiento}`, async () => {
      const unidad = await crearUnidadHU021();
      await login(3);
      let codsep: string | null = null;
      let codven: string | null = null;
      if (caso.operacion === 'separación') codsep = await crearSeparacionHU021(unidad);
      else codven = (await crearVenta(unidad, { clave: claveNueva() })).codven;
      await crearMovimientoActivoHU021(unidad, caso.movimiento);
      const antes = await snapshotFisicoMovimientoHU021(unidad);
      const resultado = codsep !== null
        ? await cancelarSeparacion(codsep, 'Prueba de movimiento activo', 'Adelanto conservado')
        : await cancelarVentaHU021(codven!, 'Prueba de movimiento activo', null);
      assert.equal(resultado.estadoComercialUnidad, 'No disponible');
      assert.equal(await propietario(() => escalar<string>(
        'SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [unidad])), 'No disponible');
      assert.deepEqual(await snapshotFisicoMovimientoHU021(unidad), antes,
        'ubicación, preparación y movimiento siguen intactos');
    });
  });

  await t.test('HU-021: sin otro compromiso ni movimiento activo la unidad vuelve a Disponible', async () => {
    const unidad = await crearUnidadHU021();
    await login(3);
    const venta = await crearVenta(unidad, { clave: claveNueva() });
    const resultado = await cancelarVentaHU021(venta.codven, 'Liberar unidad sin traslado', null);
    assert.equal(resultado.estadoComercialUnidad, 'Disponible');
    const compromisos = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('estado',u.estcomuni,
        'ventas',(SELECT count(*)::int FROM public.venta v WHERE v.coduni=u.coduni AND v.estven<>'Cancelada'),
        'separaciones',(SELECT count(*)::int FROM public.separacion s WHERE s.coduni=u.coduni AND s.estsep='Activa'),
        'movimientos',(SELECT count(*)::int FROM public.movimientoubicacion m
          WHERE m.coduni=u.coduni AND m.estmub IN ('Pendiente','En transito'))) r
       FROM public.unidad u WHERE u.coduni=$1`, [unidad]));
    assert.deepEqual(compromisos, { estado: 'Disponible', ventas: 0, separaciones: 0, movimientos: 0 });
  });

  await t.test('HU-021: cualquier cambio de techo o comprobante en venta cancelada devuelve PT623', async () => {
    const unidadConComprobante = await crearUnidadHU021();
    await login(3);
    const conComprobante = await crearVenta(unidadConComprobante, {
      techo: { decision: 'Sin techo' }, descuento: 500, motivoDescuento: 'Autorizado por llamada',
      codusuAutorizadorDescuento: 1, confirmacionTelefonicaRecibida: true, clave: claveNueva()
    });
    const comprobante = await guardarComprobante(conComprobante.codven, 'F001-HU021-623');
    assert.equal(comprobante.reutilizada, false);
    await cancelarVentaHU021(conComprobante.codven, 'Venta cancelada para PT623', null);
    const antes = await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('estado',estven,'decision',dectechoven,'codtte',codtteven::text,
        'importe',impven,'base',prebaseven,'adicionalRef',adicionalrefven,'adicionalAcordado',adicionalacordadoven,
        'descuento',descuentoven,'comprobante',refcompven,'fechaComprobante',feccompven) r
       FROM public.venta WHERE codven=$1`, [conComprobante.codven]));
    const codtte = Number(tipos);
    await assert.rejects(guardarTechoVenta(conComprobante.codven, 'Sin techo', null, 0), error('PT623'), 'mismo techo');
    await assert.rejects(guardarTechoVenta(conComprobante.codven, 'Con techo', codtte, 200), error('PT623'), 'otro techo');
    await assert.rejects(guardarTechoVenta(conComprobante.codven, 'Decisión inválida', null), error('PT623'),
      'venta cancelada antes de validar la decisión');
    await assert.rejects(guardarComprobante(conComprobante.codven, 'F001-HU021-623'), error('PT623'), 'mismo comprobante');
    await assert.rejects(guardarComprobante(conComprobante.codven, 'F001-HU021-OTRO'), error('PT623'), 'otro comprobante');
    await assert.rejects(guardarComprobante(conComprobante.codven, ' '), error('PT623'),
      'venta cancelada antes de validar la referencia');
    assert.deepEqual(await propietario(() => escalar<Record<string, unknown>>(
      `SELECT jsonb_build_object('estado',estven,'decision',dectechoven,'codtte',codtteven::text,
        'importe',impven,'base',prebaseven,'adicionalRef',adicionalrefven,'adicionalAcordado',adicionalacordadoven,
        'descuento',descuentoven,'comprobante',refcompven,'fechaComprobante',feccompven) r
       FROM public.venta WHERE codven=$1`, [conComprobante.codven])), antes);

    const unidadSinComprobante = await crearUnidadHU021();
    const sinComprobante = await crearVenta(unidadSinComprobante, { clave: claveNueva() });
    await cancelarVentaHU021(sinComprobante.codven, 'Venta cancelada sin comprobante', null);
    await assert.rejects(guardarComprobante(sinComprobante.codven, 'F001-HU021-NUEVO'), error('PT623'),
      'nuevo comprobante en venta cancelada sin comprobante previo');
    assert.equal(await propietario(() => escalar<string>(
      'SELECT refcompven r FROM public.venta WHERE codven=$1', [sinComprobante.codven])), null);
  });
});
