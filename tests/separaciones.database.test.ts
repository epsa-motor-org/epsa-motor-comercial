import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface SeparacionResultado {
  codsep: string;
  coduni: string;
  codcli: string;
  codusuAutor: string;
  codusuResponsable: string;
  monto: number;
  fechaPago: string;
  medioPago: string;
  referencia: string | null;
  rutaEvidencia: string | null;
  observacion: string | null;
  ingresoConfirmado: boolean;
  confirmadoPor: string;
  fechaConfirmacion: string;
  fechaRegistro: string;
  estado: string;
  reutilizada: boolean;
  techo: { decision: string; codtte: string | null; guardado: boolean };
}
interface Operativo { codubi: number | null; codepr: number | null; codtte: number | null; codpro: number | null; estcomuni: string }
interface Preparacion { estarmado: string; esttecho: string; version: number }
interface SeparacionCompleta {
  codsep: string; coduni: string; codcli: string; autor: string; responsable: string;
  monto: number; medio: string; referencia: string | null; evidencia: string | null;
  confirmador: string; fechaConfirmacion: string; estado: string; idempotencia: string;
  decisionSolicitada: string | null; tipoSolicitado: string | null;
  decision: string | null; tipo: string | null;
}

const migracionHu026 = readFileSync('supabase/migrations/202610030001_hu026_ubicaciones.sql', 'utf8');
const migracionHu034 = readFileSync('supabase/migrations/202610040001_hu034_compra_pendiente.sql', 'utf8');
const migracionHu002 = readFileSync('supabase/migrations/202610060001_hu002_identificacion_unidades.sql', 'utf8');
const migracionHu007 = readFileSync('supabase/migrations/202610070001_hu007_permisos_rol.sql', 'utf8');
const migracionHu012Catalogo = readFileSync('supabase/migrations/202610070002_hu012_modelos_publicados.sql', 'utf8');
const migracionHu004 = readFileSync('supabase/migrations/202610080001_hu004_configuracion_techo.sql', 'utf8');
const migracionHu009 = readFileSync('supabase/migrations/202610080002_hu009_ficha_modelo.sql', 'utf8');
const migracionHu033 = readFileSync('supabase/migrations/202610280003_hu033_preparacion_unidad.sql', 'utf8');
const migracionHu012 = readFileSync('supabase/migrations/202610100003_hu012_admin_modelos.sql', 'utf8');
const migracionHu005 = readFileSync('supabase/migrations/202611050001_hu005_separacion_moto.sql', 'utf8');
const migracionHu005Confirmador = readFileSync('supabase/migrations/202611060001_hu005_confirmador_transferencia.sql', 'utf8');
const migracionHu005TechoPrecio = readFileSync('supabase/migrations/202611080001_hu005_decision_techo_y_precio.sql', 'utf8');
const migracionHu005CompatibilidadTecho = readFileSync(
  'supabase/migrations/202611090002_hu005_compatibilidad_techo_instalado.sql', 'utf8'
);

test('HU-005: compatibilidad de techo vive en la migration incremental posterior', () => {
  assert.doesNotMatch(migracionHu005TechoPrecio, /PT438|hu005_validar_compatibilidad_techo_instalado/);
  assert.match(migracionHu005CompatibilidadTecho, /PT438/);
  assert.doesNotMatch(migracionHu005CompatibilidadTecho, /RENAME\s+TO\s+hu005_crear_separacion_base/i);
  assert.doesNotMatch(migracionHu005CompatibilidadTecho, /ADD COLUMN/i);
});

test('HU-005 PostgreSQL: separación confirmada, idempotencia, concurrencia y seguridad', async t => {
  const db = new PGlite();
  const uuids = [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000006'
  ];
  let usuarioActual = 1;

  async function login(numero = usuarioActual) {
    usuarioActual = numero;
    const uuid = uuids[numero - 1];
    await db.exec('RESET ROLE; SET ROLE authenticated; SELECT set_config('
      + "'request.jwt.claim.sub','" + uuid + "',false)");
  }
  async function administrativo<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec('RESET ROLE');
    try { return await fn(); } finally { await login(usuarioActual); }
  }
  async function escalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    return (await db.query<Valor<T>>(sql, params)).rows[0].r;
  }
  async function crearUnidad(etiqueta: string, situacion = 'No disponible'): Promise<string> {
    return administrativo(async () => {
      const compra = (await db.query<{ codcom: string }>(
        "INSERT INTO public.compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',1) RETURNING codcom::text"
      )).rows[0].codcom;
      await db.query(
        "INSERT INTO public.factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu) "
          + "VALUES ($1,'QA','FAC-" + etiqueta + "','2026-11-01',1,1)",
        [compra]
      );
      const unidad = (await db.query<{ coduni: string }>(
        "INSERT INTO public.unidad(codcom,codmod,codubi,codtte,codpro,codepr,nummotuni,chauni,coluni,estcomuni) "
          + "VALUES ($1,1,1,1,1,1,$2,$3,'Azul',$4) RETURNING coduni::text",
        [compra, 'MOTOR-' + etiqueta, 'CHASIS-' + etiqueta, situacion]
      )).rows[0].coduni;
      return unidad;
    });
  }
  async function crearSeparacion(
    coduni: string,
    opciones: {
      codcli?: number;
      responsable?: number;
      confirmador?: number | null;
      monto?: number;
      fecha?: string;
      medio?: string;
      referencia?: string | null;
      evidencia?: string | null;
      observacion?: string | null;
      confirmado?: boolean | null;
      decisionTecho?: 'Por definir' | 'Sin techo' | 'Con techo';
      codtte?: number | null;
      clave?: string;
    } = {}
  ): Promise<SeparacionResultado> {
    const resultado = await escalar<SeparacionResultado>(
      'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [
        coduni,
        opciones.codcli ?? 1,
        opciones.responsable ?? 3,
        opciones.confirmador === undefined
          ? (opciones.medio ?? 'Transferencia') === 'Transferencia' ? 1 : null
          : opciones.confirmador,
        opciones.monto ?? 250.00,
        opciones.fecha ?? '2026-11-04',
        opciones.medio ?? 'Transferencia',
        opciones.referencia === undefined ? 'OP-QA-1234' : opciones.referencia,
        opciones.evidencia === undefined
          ? (opciones.medio ?? 'Transferencia') === 'Transferencia' ? 'hu005/evidencias/OP-QA-1234.pdf' : null
          : opciones.evidencia,
        opciones.observacion === undefined ? 'Ingreso verificado en cuenta' : opciones.observacion,
        opciones.confirmado === undefined ? true : opciones.confirmado,
        opciones.clave ?? randomUUID(),
        opciones.decisionTecho ?? 'Por definir',
        opciones.codtte ?? null
      ]
    );
    const decisionTecho = opciones.decisionTecho ?? 'Por definir';
    if (decisionTecho === 'Por definir') return resultado;
    const techo = await guardarTecho(resultado.codsep, decisionTecho, opciones.codtte ?? null);
    return { ...resultado, techo: { decision: techo.decision, codtte: techo.codtte, guardado: true } };
  }
  async function crearSeparacionSinGuardarTecho(
    coduni: string,
    opciones: {
      decisionTecho?: 'Por definir' | 'Sin techo' | 'Con techo';
      codtte?: number | null;
      clave?: string;
    } = {}
  ): Promise<SeparacionResultado> {
    return escalar<SeparacionResultado>(
      'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) r',
      [
        coduni, 1, 3, 1, 250.00, '2026-11-04', 'Transferencia', 'OP-QA-1234',
        'hu005/evidencias/OP-QA-1234.pdf', 'Ingreso verificado en cuenta', true,
        opciones.clave ?? randomUUID(), opciones.decisionTecho ?? 'Por definir', opciones.codtte ?? null
      ]
    );
  }
  async function guardarTecho(
    codsep: string,
    decision: 'Por definir' | 'Sin techo' | 'Con techo',
    codtte: number | null
  ): Promise<{ codsep: string; decision: string; codtte: string | null; guardado: boolean; reutilizada: boolean }> {
    return escalar(
      'SELECT public.hu005_guardar_techo_separacion($1,$2,$3) r', [codsep, decision, codtte]
    );
  }
  async function operativo(coduni: string): Promise<Operativo> {
    return administrativo(() => escalar<Operativo>(
      "SELECT jsonb_build_object('codubi',codubi,'codepr',codepr,'codtte',codtte,"
        + "'codpro',codpro,'estcomuni',estcomuni) r FROM public.unidad WHERE coduni=$1",
      [coduni]
    ));
  }
  async function preparacion(coduni: string): Promise<Preparacion> {
    return administrativo(() => escalar<Preparacion>(
      'SELECT jsonb_build_object(\'estarmado\',estarmado,\'esttecho\',esttecho,\'version\',versionprep) r '
        + 'FROM public.preparacionunidad WHERE coduni=$1', [coduni]
    ));
  }
  async function resumenSeparacion(codsep: string): Promise<SeparacionCompleta> {
    return administrativo(() => escalar<SeparacionCompleta>(
      "SELECT jsonb_build_object('codsep',codsep::text,'coduni',coduni::text,'codcli',codcli::text,"
        + "'autor',codusu::text,'responsable',codusuresp::text,'monto',monadesep,'medio',metpagsep,"
        + "'referencia',refsep,'evidencia',rutavouchersep,'confirmador',codusuconfsep::text,"
        + "'fechaConfirmacion',fecconfsep,'estado',estsep,'idempotencia',idempotenciasep::text,"
        + "'decisionSolicitada',decisiontecho_solicitada,'tipoSolicitado',codtte_solicitado::text,"
        + "'decision',decisiontecho,'tipo',codttecomsep::text) r FROM public.separacion WHERE codsep=$1",
      [codsep]
    ));
  }
  const error = (codigo: string) => (e: unknown) => (e as ErrorSQL).code === codigo;
  let unidadConSeparacion = '';
  let unidadParaVenta = '';
  let unidadConcurrencia = '';

  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; "
      + "CREATE TABLE auth.users(id uuid PRIMARY KEY); "
      + "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS "
      + "$$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; "
      + "GRANT USAGE ON SCHEMA public,auth TO anon,authenticated; "
      + "GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;");
    await db.exec(readFileSync('tests/fixtures/esquema-base.sql', 'utf8'));
    await db.exec(migracionHu026);
    await db.exec(migracionHu034);
    await db.exec(migracionHu002);
    await db.exec(migracionHu007);
    await db.exec(migracionHu012Catalogo);
    await db.exec(migracionHu004);
    await db.exec(migracionHu009);
    await db.exec(migracionHu033);
    await db.exec(migracionHu012);
    await db.exec("ALTER TABLE public.separacion ENABLE ROW LEVEL SECURITY; "
      + "ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY; "
      + "GRANT ALL ON public.separacion,public.venta TO authenticated; "
      + "GRANT USAGE,SELECT ON SEQUENCE public.separacion_codsep_seq TO authenticated;");
    await db.exec(migracionHu005);
    await db.exec(migracionHu005Confirmador);
    await db.exec(migracionHu005TechoPrecio);
    await db.exec(migracionHu005CompatibilidadTecho);

    const authRows = uuids.map(id => "('" + id + "')").join(',');
    await db.exec("INSERT INTO auth.users(id) VALUES " + authRows + "; "
      + "INSERT INTO public.rol(nomrol,estrol) VALUES "
      + "('Gerente',true),('Administradora',true),('Vendedor',true),('Auxiliar',true); "
      + "INSERT INTO public.usuario(uuidusu,codrol,nomusu,apepatusu,corusu,estusu) "
      + "SELECT u.id,r.codrol,'Usuario QA','Prueba',u.id::text || '@qa.test',u.id <> '"
      + uuids[3] + "' FROM auth.users u JOIN public.rol r ON r.nomrol=CASE "
      + "WHEN u.id='" + uuids[0] + "' THEN 'Gerente' "
      + "WHEN u.id='" + uuids[1] + "' THEN 'Administradora' "
      + "WHEN u.id='" + uuids[2] + "' OR u.id='" + uuids[3] + "' THEN 'Vendedor' "
      + "WHEN u.id='" + uuids[4] + "' THEN 'Gerente' ELSE 'Auxiliar' END; "
      + "INSERT INTO public.tipomotocar(nomtmo) VALUES ('Modelo QA'); "
      + "INSERT INTO public.modelo(codtmo,nommod,desmod,carmod,premod) VALUES (1,'Modelo QA','Descripción','Características',15000); "
      + "INSERT INTO public.tipodocumento(nomtdo) VALUES ('DNI QA'); "
      + "INSERT INTO public.cliente(codtdo,numdoccli,nomcli,estcli) "
      + "VALUES (1,'CLI-ACTIVO','Cliente activo QA',true),(1,'CLI-INACTIVO','Cliente inactivo QA',false); "
      + "INSERT INTO public.tipotecho(nomtte) VALUES ('Techo QA'); "
      + "INSERT INTO public.proveedor(nompro) VALUES ('Proveedor QA'); "
      + "INSERT INTO public.estadopreparacion(nomepr) VALUES ('Preparación QA');");

    await t.test('Vendedor y Administradora registran transferencias confirmadas por Gerente; gerente puede confirmar la suya', async () => {
      for (const numero of [3, 2, 1]) {
        const unidad = await crearUnidad('ROL-' + numero);
        await login(numero);
        const antes = await operativo(unidad);
        const r = await crearSeparacion(unidad, { confirmador: 1, clave: randomUUID() });
        const despues = await operativo(unidad);
        assert.equal(r.estado, 'Activa');
        assert.equal(r.ingresoConfirmado, true);
        assert.equal(r.codusuAutor, String(numero));
        assert.equal(r.confirmadoPor, '1');
        assert.equal(r.codusuResponsable, '3');
        assert.equal(despues.estcomuni, 'Separada');
        assert.equal(despues.codubi, antes.codubi);
        assert.equal(despues.codepr, antes.codepr);
        assert.equal(despues.codtte, antes.codtte);
        assert.equal(despues.codpro, antes.codpro);
      }
    });

    await t.test('Efectivo de Vendedor deriva confirmador del autor sin referencia ni voucher', async () => {
      const unidad = await crearUnidad('EFECTIVO');
      await login(3);
      const r = await crearSeparacion(unidad, {
        medio: 'Efectivo', referencia: null, evidencia: null,
        observacion: 'Efectivo recibido y recibo entregado'
      });
      assert.equal(r.medioPago, 'Efectivo');
      assert.equal(r.referencia, null);
      assert.equal(r.rutaEvidencia, null);
      assert.equal(r.ingresoConfirmado, true);
      assert.equal(r.codusuAutor, '3');
      assert.equal(r.confirmadoPor, '3');
      assert.equal((await operativo(unidad)).estcomuni, 'Separada');

      const otra = await crearUnidad('EFECTIVO-SIN-OBS');
      await assert.rejects(crearSeparacion(otra, {
        medio: 'Efectivo', referencia: null, evidencia: null, observacion: '   '
      }), error('PT428'));
      assert.equal((await operativo(otra)).estcomuni, 'No disponible');
    });

    await t.test('Transferencia rechaza confirmador ausente, vendedor, inexistente o inactivo', async () => {
      const unidad = await crearUnidad('CONFIRMADOR-INVALIDO');
      await login(3);
      for (const confirmador of [null, 3, 4, 999999]) {
        await assert.rejects(crearSeparacion(unidad, { confirmador }), error('PT433'));
      }
      assert.equal((await operativo(unidad)).estcomuni, 'No disponible');
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      )), 0);

      await administrativo(() => db.query("UPDATE public.rol SET estrol=false WHERE nomrol='Gerente'"));
      await login(3);
      await assert.rejects(crearSeparacion(unidad, { confirmador: 5 }), error('PT433'));
      await administrativo(() => db.query("UPDATE public.rol SET estrol=true WHERE nomrol='Gerente'"));
      assert.equal((await operativo(unidad)).estcomuni, 'No disponible');
    });

    await t.test('Transferencia requiere referencia, evidencia y confirmación antes de escribir', async () => {
      await login(1);
      const sinEvidencia = await crearUnidad('SIN-EVIDENCIA');
      const antesSinEvidencia = await operativo(sinEvidencia);
      await assert.rejects(crearSeparacion(sinEvidencia, { evidencia: null }), error('PT400'));
      assert.deepEqual(await operativo(sinEvidencia), antesSinEvidencia);

      const sinReferencia = await crearUnidad('SIN-REFERENCIA');
      const antesSinReferencia = await operativo(sinReferencia);
      await assert.rejects(crearSeparacion(sinReferencia, { referencia: null }), error('PT400'));
      assert.deepEqual(await operativo(sinReferencia), antesSinReferencia);

      const sinConfirmacion = await crearUnidad('SIN-CONFIRMAR');
      const antesSinConfirmacion = await operativo(sinConfirmacion);
      await assert.rejects(crearSeparacion(sinConfirmacion, { confirmado: false }), error('PT427'));
      assert.deepEqual(await operativo(sinConfirmacion), antesSinConfirmacion);
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni IN ($1,$2,$3)',
        [sinEvidencia, sinReferencia, sinConfirmacion]
      )), 0);

      const valida = await crearUnidad('TRANSFERENCIA-VALIDA');
      const resultado = await crearSeparacion(valida, {
        referencia: '  OP-QA-1234  ', evidencia: '  hu005/evidencias/OP-QA-1234.pdf  ', confirmado: true
      });
      assert.equal(resultado.referencia, 'OP-QA-1234');
      assert.equal(resultado.rutaEvidencia, 'hu005/evidencias/OP-QA-1234.pdf');
      assert.equal(resultado.ingresoConfirmado, true);
    });

    await t.test('las tres decisiones comerciales de techo se persisten separadas de la configuración física', async () => {
      await login(1);
      const porDefinirUnidad = await crearUnidad('TECHO-POR-DEFINIR');
      const porDefinir = await crearSeparacion(porDefinirUnidad, { decisionTecho: 'Por definir' });
      assert.deepEqual(porDefinir.techo, { decision: 'Por definir', codtte: null, guardado: true });
      const mismoPorDefinir = await guardarTecho(porDefinir.codsep, 'Por definir', null);
      assert.equal(mismoPorDefinir.guardado, true);
      assert.equal(mismoPorDefinir.reutilizada, true);

      const sinTechoUnidad = await crearUnidad('TECHO-SIN-TECHO');
      await administrativo(() => db.query(
        "UPDATE public.preparacionunidad SET estarmado='Pendiente',esttecho='Pendiente' WHERE coduni=$1",
        [sinTechoUnidad]
      ));
      const unidadAntes = await operativo(sinTechoUnidad);
      const preparacionAntes = await preparacion(sinTechoUnidad);
      const sinTecho = await crearSeparacion(sinTechoUnidad, { decisionTecho: 'Sin techo' });
      assert.deepEqual(sinTecho.techo, { decision: 'Sin techo', codtte: null, guardado: true });
      assert.notEqual(sinTecho.techo.decision, porDefinir.techo.decision);
      const unidadDespues = await operativo(sinTechoUnidad);
      assert.deepEqual({ ...unidadDespues, estcomuni: unidadAntes.estcomuni }, unidadAntes);
      assert.deepEqual(await preparacion(sinTechoUnidad), preparacionAntes,
        'la elección comercial Sin techo no convierte la preparación en lista');

      const conTechoUnidad = await crearUnidad('TECHO-CON-TECHO');
      const conTecho = await crearSeparacion(conTechoUnidad, { decisionTecho: 'Con techo', codtte: 5 });
      assert.deepEqual(conTecho.techo, { decision: 'Con techo', codtte: '5', guardado: true });
      assert.equal((await operativo(conTechoUnidad)).codtte, 1,
        'el tipo comercial elegido no cambia unidad.codtte físico');
    });

    await t.test('Por definir se guarda como estado resoluble y permite decidir Sin techo o Con techo', async () => {
      await login(1);
      const unidadSin = await crearUnidad('RESOLVER-SIN-TECHO');
      await administrativo(() => db.query(
        "UPDATE public.preparacionunidad SET estarmado='Pendiente',esttecho='Pendiente' WHERE coduni=$1", [unidadSin]
      ));
      const unidadSinAntes = await operativo(unidadSin);
      const preparacionSinAntes = await preparacion(unidadSin);
      const separacionSin = await crearSeparacion(unidadSin, { decisionTecho: 'Por definir' });
      assert.equal(separacionSin.estado, 'Activa');
      assert.deepEqual(separacionSin.techo, { decision: 'Por definir', codtte: null, guardado: true });
      const antesSin = await resumenSeparacion(separacionSin.codsep);
      const guardadoSin = await guardarTecho(separacionSin.codsep, 'Sin techo', null);
      assert.equal(guardadoSin.guardado, true);
      assert.equal(guardadoSin.reutilizada, false);
      const despuesSin = await resumenSeparacion(separacionSin.codsep);
      assert.equal(despuesSin.decisionSolicitada, 'Por definir');
      assert.equal(despuesSin.tipoSolicitado, null);
      assert.equal(despuesSin.decision, 'Sin techo');
      assert.equal(despuesSin.tipo, null);
      assert.equal(despuesSin.codsep, antesSin.codsep);
      assert.equal(despuesSin.monto, antesSin.monto);
      assert.equal(despuesSin.autor, antesSin.autor);
      assert.equal(despuesSin.confirmador, antesSin.confirmador);
      assert.equal(despuesSin.decisionSolicitada, antesSin.decisionSolicitada,
        'la decisión original del POST se conserva para los replays idempotentes');
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidadSin]
      )), 1);
      assert.equal((await operativo(unidadSin)).codtte, unidadSinAntes.codtte);
      assert.equal((await operativo(unidadSin)).codubi, unidadSinAntes.codubi);
      assert.equal((await operativo(unidadSin)).estcomuni, 'Separada');
      assert.deepEqual(await preparacion(unidadSin), preparacionSinAntes);

      const unidadCon = await crearUnidad('RESOLVER-CON-TECHO');
      const separacionCon = await crearSeparacion(unidadCon, { decisionTecho: 'Por definir' });
      const antesCon = await resumenSeparacion(separacionCon.codsep);
      const guardadoCon = await guardarTecho(separacionCon.codsep, 'Con techo', 5);
      assert.equal(guardadoCon.guardado, true);
      assert.equal(guardadoCon.reutilizada, false);
      const despuesCon = await resumenSeparacion(separacionCon.codsep);
      assert.equal(despuesCon.decisionSolicitada, 'Por definir');
      assert.equal(despuesCon.tipoSolicitado, null);
      assert.equal(despuesCon.decision, 'Con techo');
      assert.equal(despuesCon.tipo, '5');
      assert.equal(despuesCon.monto, antesCon.monto);
      assert.equal(despuesCon.estado, antesCon.estado);
      assert.equal(despuesCon.autor, antesCon.autor);
      assert.equal(despuesCon.confirmador, antesCon.confirmador);
      assert.equal(despuesCon.fechaConfirmacion, antesCon.fechaConfirmacion);
      assert.equal(despuesCon.codsep, antesCon.codsep);
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidadCon]
      )), 1);
      assert.equal((await operativo(unidadCon)).codtte, 1,
        'resolver la decisión no cambia unidad.codtte');
    });

    await t.test('repetir el POST original Por definir tras resolver el techo recupera la separación existente', async () => {
      await login(1);
      for (const [etiqueta, decision, codtte] of [
        ['REPLAY-POR-DEFINIR-SIN', 'Sin techo', null],
        ['REPLAY-POR-DEFINIR-CON', 'Con techo', 5]
      ] as const) {
        const unidad = await crearUnidad(etiqueta);
        const clave = randomUUID();
        const inicial = await crearSeparacion(unidad, { decisionTecho: 'Por definir', clave });
        assert.equal(inicial.techo.decision, 'Por definir');
        const inicialDb = await resumenSeparacion(inicial.codsep);
        assert.equal(inicialDb.decisionSolicitada, 'Por definir');
        assert.equal(inicialDb.tipoSolicitado, null);

        await guardarTecho(inicial.codsep, decision, codtte);
        const replay = await crearSeparacion(unidad, { decisionTecho: 'Por definir', clave });
        assert.equal(replay.codsep, inicial.codsep);
        assert.equal(replay.reutilizada, true);
        assert.deepEqual(replay.techo, { decision, codtte: codtte === null ? null : String(codtte), guardado: true });

        const finalDb = await resumenSeparacion(inicial.codsep);
        assert.equal(finalDb.decisionSolicitada, 'Por definir');
        assert.equal(finalDb.tipoSolicitado, null);
        assert.equal(finalDb.decision, decision);
        assert.equal(finalDb.tipo, codtte === null ? null : String(codtte));
        assert.equal(finalDb.monto, 250);
        assert.equal(await administrativo(() => escalar<number>(
          'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
        )), 1, 'el replay no crea otra separación ni otro registro del adelanto');
        assert.equal(await administrativo(() => escalar<number>(
          'SELECT count(*)::int r FROM public.separacion WHERE idempotenciasep=$1', [clave]
        )), 1);
      }
    });

    await t.test('ausencia de preparación no se interpreta como evidencia de techo instalado', async () => {
      await login(1);
      const tipoB = await administrativo(() => escalar<number>(
        "INSERT INTO public.tipotecho(nomtte) VALUES ('Techo QA sin preparación') RETURNING codtte r"
      ));

      const unidadSinCodtte = await crearUnidad('SIN-CODTTE-SIN-PREPARACION');
      await administrativo(async () => {
        await db.query('UPDATE public.unidad SET codtte=NULL WHERE coduni=$1', [unidadSinCodtte]);
        await db.query('DELETE FROM public.preparacionunidad WHERE coduni=$1', [unidadSinCodtte]);
      });
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.preparacionunidad WHERE coduni=$1', [unidadSinCodtte]
      )), 0);
      await assert.doesNotReject(crearSeparacion(unidadSinCodtte, { decisionTecho: 'Sin techo' }));

      const unidadSinFila = await crearUnidad('CON-CODTTE-SIN-PREPARACION');
      await administrativo(() => db.query(
        'DELETE FROM public.preparacionunidad WHERE coduni=$1', [unidadSinFila]
      ));
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.preparacionunidad WHERE coduni=$1', [unidadSinFila]
      )), 0);
      await assert.doesNotReject(crearSeparacion(unidadSinFila, { decisionTecho: 'Con techo', codtte: tipoB }));

      const unidadPorDefinirSinFila = await crearUnidad('POR-DEFINIR-SIN-PREPARACION');
      await administrativo(() => db.query(
        'DELETE FROM public.preparacionunidad WHERE coduni=$1', [unidadPorDefinirSinFila]
      ));
      await assert.doesNotReject(crearSeparacion(unidadPorDefinirSinFila, { decisionTecho: 'Por definir' }));
    });

    await t.test('techo físicamente instalado impone compatibilidad en POST y en la resolución PUT', async () => {
      await login(1);
      const tipoB = await administrativo(() => escalar<number>(
        "INSERT INTO public.tipotecho(nomtte) VALUES ('Techo QA tipo B') RETURNING codtte r"
      ));
      const instalarTechoA = async (etiqueta: string) => {
        const unidad = await crearUnidad(etiqueta);
        await administrativo(() => db.query(
          "UPDATE public.preparacionunidad SET esttecho='Instalado' WHERE coduni=$1", [unidad]
        ));
        return unidad;
      };

      const unidadPorDefinir = await instalarTechoA('INSTALADO-POR-DEFINIR');
      const techoPorDefinir = await crearSeparacion(unidadPorDefinir, { decisionTecho: 'Por definir' });
      assert.equal(techoPorDefinir.techo.decision, 'Por definir');

      const unidadTipoA = await instalarTechoA('INSTALADO-MISMO-TIPO');
      const techoTipoA = await crearSeparacion(unidadTipoA, { decisionTecho: 'Con techo', codtte: 1 });
      assert.deepEqual(techoTipoA.techo, { decision: 'Con techo', codtte: '1', guardado: true });

      for (const [etiqueta, decisionTecho, codtte] of [
        ['INSTALADO-OTRO-TIPO-POST', 'Con techo', tipoB],
        ['INSTALADO-SIN-TECHO-POST', 'Sin techo', null]
      ] as const) {
        const unidad = await instalarTechoA(etiqueta);
        const unidadAntes = await operativo(unidad);
        const prepAntes = await preparacion(unidad);
        await assert.rejects(crearSeparacion(unidad, { decisionTecho, codtte }), error('PT438'));
        assert.deepEqual(await operativo(unidad), unidadAntes);
        assert.deepEqual(await preparacion(unidad), prepAntes);
        assert.equal(await administrativo(() => escalar<number>(
          'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
        )), 0, 'rechazar una decisión incompatible revierte separación y adelanto');
        assert.equal(await administrativo(() => escalar<number>(
          'SELECT count(*)::int r FROM public.unidad WHERE coduni=$1', [unidad]
        )), 1, 'la operación no cambia automáticamente a otra unidad');
      }

      for (const [etiqueta, decision, codtte] of [
        ['INSTALADO-OTRO-TIPO-PUT', 'Con techo', tipoB],
        ['INSTALADO-SIN-TECHO-PUT', 'Sin techo', null]
      ] as const) {
        const unidad = await instalarTechoA(etiqueta);
        const unidadAntes = await operativo(unidad);
        const prepAntes = await preparacion(unidad);
        const separacion = await crearSeparacion(unidad, { decisionTecho: 'Por definir' });
        const cuentaAntes = await administrativo(() => escalar<{ cantidad: number; adelanto: number }>(
          'SELECT jsonb_build_object(\'cantidad\',count(*)::int,\'adelanto\',coalesce(sum(monadesep),0)) r '
            + 'FROM public.separacion WHERE coduni=$1', [unidad]
        ));
        await assert.rejects(guardarTecho(separacion.codsep, decision, codtte), error('PT438'));
        const cuentaDespues = await administrativo(() => escalar<{ cantidad: number; adelanto: number }>(
          'SELECT jsonb_build_object(\'cantidad\',count(*)::int,\'adelanto\',coalesce(sum(monadesep),0)) r '
            + 'FROM public.separacion WHERE coduni=$1', [unidad]
        ));
        assert.deepEqual(cuentaDespues, cuentaAntes, 'el PUT rechazado no duplica separación ni adelanto');
        assert.deepEqual(await operativo(unidad), { ...unidadAntes, estcomuni: 'Separada' });
        assert.deepEqual(await preparacion(unidad), prepAntes);
        const actual = await resumenSeparacion(separacion.codsep);
        assert.equal(actual.decision, 'Por definir', 'la decisión inicial permanece resoluble tras el rechazo');
        assert.equal(actual.tipo, null);
      }
    });

    await t.test('resolver Por definir con tipo inválido/inactivo falla y deja la elección sin resolver', async () => {
      await login(1);
      const unidad = await crearUnidad('RESOLVER-TECHO-INVALIDO');
      const separacion = await crearSeparacion(unidad, { decisionTecho: 'Por definir' });
      await administrativo(() => db.query("INSERT INTO public.tipotecho(nomtte,esttte) VALUES ('Tipo inactivo al resolver QA',false)"));
      const tipoInactivo = await administrativo(() => escalar<number>(
        "SELECT codtte r FROM public.tipotecho WHERE nomtte='Tipo inactivo al resolver QA'"
      ));
      await assert.rejects(guardarTecho(separacion.codsep, 'Con techo', 999), error('PT435'));
      await assert.rejects(guardarTecho(separacion.codsep, 'Con techo', tipoInactivo), error('PT435'));
      const actual = await resumenSeparacion(separacion.codsep);
      assert.equal(actual.decision, 'Por definir');
      assert.equal(actual.tipo, null);
      assert.equal(actual.decisionSolicitada, 'Por definir');
      assert.equal((await operativo(unidad)).estcomuni, 'Separada');
    });

    await t.test('una decisión final de techo es inmutable y repetirla es idempotente', async () => {
      await login(1);
      const unidadSin = await crearUnidad('FINAL-SIN-TECHO');
      const separacionSin = await crearSeparacion(unidadSin, { decisionTecho: 'Sin techo' });
      await assert.rejects(guardarTecho(separacionSin.codsep, 'Con techo', 5), error('PT437'));
      await assert.rejects(guardarTecho(separacionSin.codsep, 'Por definir', null), error('PT437'));
      const igualSin = await guardarTecho(separacionSin.codsep, 'Sin techo', null);
      assert.equal(igualSin.guardado, true);
      assert.equal(igualSin.reutilizada, true);

      const unidadCon = await crearUnidad('FINAL-CON-TECHO');
      const separacionCon = await crearSeparacion(unidadCon, { decisionTecho: 'Con techo', codtte: 5 });
      await assert.rejects(guardarTecho(separacionCon.codsep, 'Con techo', 4), error('PT437'));
      await assert.rejects(guardarTecho(separacionCon.codsep, 'Sin techo', null), error('PT437'));
      await assert.rejects(guardarTecho(separacionCon.codsep, 'Por definir', null), error('PT437'));
      const igualCon = await guardarTecho(separacionCon.codsep, 'Con techo', 5);
      assert.equal(igualCon.guardado, true);
      assert.equal(igualCon.reutilizada, true);
    });

    await t.test('tipo inexistente/inactivo y decisiones contradictorias se rechazan sin crear la separación', async () => {
      await login(1);
      const unidad = await crearUnidad('TECHO-INVALIDO');
      await assert.rejects(crearSeparacion(unidad, { decisionTecho: 'Con techo', codtte: 999 }), error('PT435'));
      await administrativo(() => db.query("INSERT INTO public.tipotecho(nomtte,esttte) VALUES ('Techo inactivo QA',false)"));
      const tipoInactivo = await administrativo(() => escalar<number>(
        "SELECT codtte r FROM public.tipotecho WHERE nomtte='Techo inactivo QA'"
      ));
      await assert.rejects(crearSeparacion(unidad, { decisionTecho: 'Con techo', codtte: tipoInactivo }), error('PT435'));
      await assert.rejects(crearSeparacion(unidad, { decisionTecho: 'Con techo' }), error('PT400'));
      await assert.rejects(crearSeparacion(unidad, { decisionTecho: 'Sin techo', codtte: 5 }), error('PT400'));
      await assert.rejects(crearSeparacion(unidad, { decisionTecho: 'Decisión inválida' as 'Sin techo' }), error('PT400'));
      assert.equal((await operativo(unidad)).estcomuni, 'No disponible');
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      )), 0);
    });

    await t.test('si falla el segundo paso, la separación queda activa y el reintento solo guarda el techo', async () => {
      await login(1);
      const unidad = await crearUnidad('TECHO-REINTENTO');
      const unidadAntes = await operativo(unidad);
      const prepAntes = await preparacion(unidad);
      const separacion = await crearSeparacionSinGuardarTecho(unidad, { decisionTecho: 'Con techo', codtte: 5 });
      assert.equal(separacion.techo?.guardado, false);
      assert.equal((await operativo(unidad)).estcomuni, 'Separada');

      await administrativo(() => db.exec("CREATE FUNCTION public.hu005_test_falla_guardar_techo() "
        + "RETURNS trigger LANGUAGE plpgsql AS $$ "
        + "BEGIN RAISE EXCEPTION USING ERRCODE='PT499', MESSAGE='Fallo inducido por test'; END $$; "
        + "CREATE TRIGGER hu005_test_falla_guardar_techo BEFORE UPDATE OF decisiontecho ON public.separacion "
        + "FOR EACH ROW EXECUTE FUNCTION public.hu005_test_falla_guardar_techo();"));
      await assert.rejects(guardarTecho(separacion.codsep, 'Con techo', 5), error('PT499'));
      await administrativo(() => db.exec('DROP TRIGGER hu005_test_falla_guardar_techo ON public.separacion; '
        + 'DROP FUNCTION public.hu005_test_falla_guardar_techo();'));

      const pendiente = await administrativo(() => escalar<{ estsep: string; decisiontecho: string | null; codttecomsep: string | null }>(
        "SELECT jsonb_build_object('estsep',estsep,'decisiontecho',decisiontecho,'codttecomsep',codttecomsep::text) r "
          + 'FROM public.separacion WHERE codsep=$1', [separacion.codsep]
      ));
      assert.deepEqual(pendiente, { estsep: 'Activa', decisiontecho: null, codttecomsep: null });
      await assert.rejects(guardarTecho(separacion.codsep, 'Sin techo', null), error('PT431'),
        'el reintento de una elección definitiva pendiente debe conservar el payload original');
      const totalAntesReintento = await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      ));
      const guardado = await guardarTecho(separacion.codsep, 'Con techo', 5);
      assert.equal(guardado.guardado, true);
      assert.equal(guardado.reutilizada, false);
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      )), totalAntesReintento);
      assert.deepEqual(await operativo(unidad), { ...unidadAntes, estcomuni: 'Separada' });
      assert.deepEqual(await preparacion(unidad), prepAntes);
      assert.equal((await guardarTecho(separacion.codsep, 'Con techo', 5)).reutilizada, true);
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      )), 1, 'repetir el guardado no duplica separación ni adelanto');
      await assert.rejects(guardarTecho(separacion.codsep, 'Sin techo', null), error('PT437'));
    });

    await t.test('el monto igual al precio de lista se acepta; uno mayor revierte separación y unidad', async () => {
      await login(1);
      await administrativo(() => db.query('UPDATE public.modelo SET premod=250 WHERE codmod=1'));
      const unidadMaxima = await crearUnidad('MONTO-IGUAL');
      const valida = await crearSeparacion(unidadMaxima, { monto: 250 });
      assert.equal(valida.monto, 250);

      const unidadExcedida = await crearUnidad('MONTO-SUPERIOR');
      const antes = await operativo(unidadExcedida);
      await assert.rejects(crearSeparacion(unidadExcedida, { monto: 250.01 }), error('PT434'));
      assert.deepEqual(await operativo(unidadExcedida), antes);
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidadExcedida]
      )), 0);

      await administrativo(() => db.query('UPDATE public.modelo SET premod=NULL WHERE codmod=1'));
      const unidadSinPrecio = await crearUnidad('MONTO-SIN-PRECIO');
      await assert.rejects(crearSeparacion(unidadSinPrecio), error('PT436'));
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidadSinPrecio]
      )), 0);
      await administrativo(() => db.query('UPDATE public.modelo SET premod=15000 WHERE codmod=1'));
    });

    await t.test('monto, fecha, medio y referencia inválidos se rechazan antes de escribir', async () => {
      const unidad = await crearUnidad('VALIDACION');
      await login(1);
      for (const opciones of [
        { monto: 0 }, { monto: -1 }, { monto: 10.123 },
        { fecha: '2999-12-31' }, { medio: 'Cheque' }, { medio: 'Yape / Plin' },
        { medio: 'Depósito' }, { medio: 'Tarjeta' }, { referencia: '   ' },
        { evidencia: 'hu005/\nmal/ruta.pdf' }, { evidencia: 'x'.repeat(2049) }
      ]) {
        await assert.rejects(crearSeparacion(unidad, opciones), error('PT400'));
      }
      assert.equal((await operativo(unidad)).estcomuni, 'No disponible');
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      )), 0);
    });

    await t.test('unidad, comprador y responsable se validan; usuario inactivo y rol no permitido se rechazan', async () => {
      const unidad = await crearUnidad('REFERENCIAS');
      await login(1);
      await assert.rejects(crearSeparacion('999999'), error('PT404'));
      await assert.rejects(crearSeparacion(unidad, { codcli: 999999 }), error('PT404'));
      await assert.rejects(crearSeparacion(unidad, { codcli: 2 }), error('PT426'));
      await assert.rejects(crearSeparacion(unidad, { responsable: 999999 }), error('PT407'));
      await assert.rejects(crearSeparacion(unidad, { responsable: 4 }), error('PT407'));
      await login(4);
      await assert.rejects(crearSeparacion(unidad), error('42501'));
      await login(6);
      await assert.rejects(crearSeparacion(unidad), error('42501'));
      assert.equal((await operativo(unidad)).estcomuni, 'No disponible');
    });

    await t.test('una separación activa o un estado Separada/Vendida impiden otro compromiso', async () => {
      unidadConSeparacion = await crearUnidad('ACTIVA');
      await login(1);
      const primera = await crearSeparacion(unidadConSeparacion);
      assert.equal(primera.estado, 'Activa');
      await assert.rejects(crearSeparacion(unidadConSeparacion), error('PT429'));

      const unidadVendida = await crearUnidad('VENTA-ESTADO', 'Vendida');
      await assert.rejects(crearSeparacion(unidadVendida), error('PT430'));
      const unidadSeparadaSinFila = await crearUnidad('SEPARADA-ESTADO', 'Separada');
      await assert.rejects(crearSeparacion(unidadSeparadaSinFila), error('PT429'));

      await assert.rejects(administrativo(() => db.query(
        "INSERT INTO public.separacion(coduni,codcli,codusu,codusuresp,monadesep,fecpagsep,metpagsep,"
          + "refsep,rutavouchersep,obssep,ingconfsep,codusuconfsep,fecconfsep,idempotenciasep,estsep) "
          + "VALUES ($1,1,1,3,20,'2026-11-04','Transferencia','OP-DUP','hu005/evidencias/duplicado.pdf',"
          + "'QA',true,1,now(),$2,'Activa')",
        [unidadConSeparacion, randomUUID()]
      )), error('23505'));
    });

    await t.test('cualquier venta registrada o situación Vendida bloquea la separación', async () => {
      unidadParaVenta = await crearUnidad('VENTA-REGISTRADA');
      await login(1);
      await administrativo(() => db.query(
        "INSERT INTO public.venta(coduni,codcli,codusu,modcomven,estven) "
          + "VALUES ($1,1,1,'Contado','Registrada')", [unidadParaVenta]
      ));
      await assert.rejects(crearSeparacion(unidadParaVenta), error('PT430'));
      assert.equal((await operativo(unidadParaVenta)).estcomuni, 'No disponible');
    });

    await t.test('misma clave compara evidencia y confirmador; cambiar payload, confirmador o autor da conflicto', async () => {
      const unidad = await crearUnidad('IDEMPOTENCIA');
      await login(1);
      const clave = randomUUID();
      const primera = await crearSeparacion(unidad, { clave });
      const repetida = await crearSeparacion(unidad, { clave });
      assert.equal(repetida.codsep, primera.codsep);
      assert.equal(repetida.rutaEvidencia, primera.rutaEvidencia);
      assert.equal(repetida.confirmadoPor, primera.confirmadoPor);
      assert.equal(repetida.reutilizada, true);
      await assert.rejects(crearSeparacion(unidad, { clave, monto: 251 }), error('PT431'));
      await assert.rejects(crearSeparacion(unidad, { clave, evidencia: 'hu005/evidencias/otra.pdf' }), error('PT431'));
      await assert.rejects(crearSeparacion(unidad, { clave, confirmador: 5 }), error('PT431'));
      await assert.rejects(crearSeparacion(unidad, { clave, decisionTecho: 'Sin techo' }), error('PT431'));
      await assert.rejects(crearSeparacion(unidad, { clave, decisionTecho: 'Con techo', codtte: 5 }), error('PT431'));
      await login(2);
      await assert.rejects(crearSeparacion(unidad, { clave }), error('PT431'));
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE idempotenciasep=$1', [clave]
      )), 1);
    });

    // PGlite usa una sola conexión/sesión en esta prueba; comprueba el resultado
    // de negocio, pero no sustituye una prueba futura con dos sesiones PostgreSQL independientes.
    await t.test('dos llamadas simultáneas sobre la misma unidad solo permiten una separación', async () => {
      unidadConcurrencia = await crearUnidad('CONCURRENCIA');
      await login(1);
      const resultados = await Promise.allSettled([
        crearSeparacion(unidadConcurrencia, { clave: randomUUID(), referencia: 'OP-CONC-0001' }),
        crearSeparacion(unidadConcurrencia, { clave: randomUUID(), referencia: 'OP-CONC-0002' })
      ]);
      assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
      const rechazado = resultados.find(r => r.status === 'rejected');
      assert.ok(rechazado && rechazado.status === 'rejected');
      assert.equal((rechazado.reason as ErrorSQL).code, 'PT429');
      assert.equal(await administrativo(() => escalar<number>(
        "SELECT count(*)::int r FROM public.separacion WHERE coduni=$1 AND estsep='Activa'",
        [unidadConcurrencia]
      )), 1);
    });

    await t.test('un fallo al insertar la separación revierte también el cambio comercial', async () => {
      const unidad = await crearUnidad('ROLLBACK');
      await login(1);
      const antes = await operativo(unidad);
      await administrativo(() => db.exec("CREATE FUNCTION public.hu005_test_falla_insertar_separacion() "
        + "RETURNS trigger LANGUAGE plpgsql AS $$ "
        + "BEGIN RAISE EXCEPTION USING ERRCODE='PT499', MESSAGE='Fallo inducido por test'; END $$; "
        + "CREATE TRIGGER hu005_test_falla_insertar_separacion BEFORE INSERT ON public.separacion "
        + "FOR EACH ROW EXECUTE FUNCTION public.hu005_test_falla_insertar_separacion();"));
      await assert.rejects(crearSeparacion(unidad), error('PT499'));
      await administrativo(() => db.exec("DROP TRIGGER hu005_test_falla_insertar_separacion ON public.separacion; "
        + "DROP FUNCTION public.hu005_test_falla_insertar_separacion();"));
      assert.deepEqual(await operativo(unidad), antes);
      assert.equal(await administrativo(() => escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      )), 0);
    });

    await t.test('RLS, grants y firma de la RPC impiden omitirla o enviar un autor', async () => {
      assert.equal(await administrativo(() => escalar<boolean>(
        "SELECT has_table_privilege('authenticated','public.separacion','INSERT') "
          + "OR has_table_privilege('authenticated','public.separacion','UPDATE') "
          + "OR has_table_privilege('authenticated','public.separacion','DELETE') r"
      )), false);
      assert.equal(await administrativo(() => escalar<boolean>(
        "SELECT has_table_privilege('authenticated','public.separacion','SELECT') r"
      )), true);
      assert.ok(await administrativo(() => escalar<string | null>(
        "SELECT pg_catalog.to_regprocedure("
          + "'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid,text,bigint)')::text r"
      )));
      assert.equal(await administrativo(() => escalar<string | null>(
        "SELECT pg_catalog.to_regprocedure("
          + "'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)')::text r"
      )), null);
      assert.ok(await administrativo(() => escalar<string | null>(
        "SELECT pg_catalog.to_regprocedure("
          + "'public.hu005_guardar_techo_separacion(bigint,text,bigint)')::text r"
      )));
      assert.equal(await administrativo(() => escalar<boolean>(
        "SELECT has_function_privilege('authenticated',"
          + "'public.hu005_crear_separacion_base(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)',"
          + "'EXECUTE') r"
      )), false);
      assert.equal(await administrativo(() => escalar<boolean>(
        "SELECT has_function_privilege('authenticated',"
          + "'public.hu005_validar_compatibilidad_techo_instalado(bigint,text,bigint)','EXECUTE') r"
      )), false);

      const unidad = await crearUnidad('DIRECTO');
      await login(1);
      await assert.rejects(db.query(
        "INSERT INTO public.separacion(coduni,codcli,codusu,metpagsep,monadesep) "
          + "VALUES ($1,1,1,'Efectivo',10)", [unidad]
      ), error('42501'));
      const directa = await escalar<number>(
        'SELECT count(*)::int r FROM public.separacion WHERE coduni=$1', [unidad]
      );
      assert.equal(directa, 0);
    });
  } finally {
    await db.close();
  }
});
