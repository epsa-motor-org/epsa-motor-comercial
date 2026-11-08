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
}
interface Operativo { codubi: number | null; codepr: number | null; codtte: number | null; codpro: number | null; estcomuni: string }

const migracionHu026 = readFileSync('supabase/migrations/202610030001_hu026_ubicaciones.sql', 'utf8');
const migracionHu034 = readFileSync('supabase/migrations/202610040001_hu034_compra_pendiente.sql', 'utf8');
const migracionHu002 = readFileSync('supabase/migrations/202610060001_hu002_identificacion_unidades.sql', 'utf8');
const migracionHu007 = readFileSync('supabase/migrations/202610070001_hu007_permisos_rol.sql', 'utf8');
const migracionHu005 = readFileSync('supabase/migrations/202611050001_hu005_separacion_moto.sql', 'utf8');
const migracionHu005Confirmador = readFileSync('supabase/migrations/202611060001_hu005_confirmador_transferencia.sql', 'utf8');

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
      clave?: string;
    } = {}
  ): Promise<SeparacionResultado> {
    return escalar<SeparacionResultado>(
      'SELECT public.hu005_crear_separacion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r',
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
        opciones.clave ?? randomUUID()
      ]
    );
  }
  async function operativo(coduni: string): Promise<Operativo> {
    return administrativo(() => escalar<Operativo>(
      "SELECT jsonb_build_object('codubi',codubi,'codepr',codepr,'codtte',codtte,"
        + "'codpro',codpro,'estcomuni',estcomuni) r FROM public.unidad WHERE coduni=$1",
      [coduni]
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
    await db.exec("ALTER TABLE public.separacion ENABLE ROW LEVEL SECURITY; "
      + "ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY; "
      + "GRANT ALL ON public.separacion,public.venta TO authenticated; "
      + "GRANT USAGE,SELECT ON SEQUENCE public.separacion_codsep_seq TO authenticated;");
    await db.exec(migracionHu005);
    await db.exec(migracionHu005Confirmador);

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
      + "INSERT INTO public.modelo(codtmo,nommod,desmod,carmod) VALUES (1,'Modelo QA','Descripción','Características'); "
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
          + "'public.hu005_crear_separacion(bigint,bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)')::text r"
      )));
      assert.equal(await administrativo(() => escalar<string | null>(
        "SELECT pg_catalog.to_regprocedure("
          + "'public.hu005_crear_separacion(bigint,bigint,bigint,numeric,date,text,text,text,text,boolean,uuid)')::text r"
      )), null);

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
