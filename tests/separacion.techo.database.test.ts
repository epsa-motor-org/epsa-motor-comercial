import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// HU-005 · 202611080001: motos libres para vender, preparación solo por el techo elegido,
// techo elegido al separar (también por el vendedor) y comprador con celular y correo.
// 202611080002: decisión del techo guardada en la separación y tope del adelanto por precio de lista.
// 202611080003: comprador sin documento (nombres, apellidos y celular).

interface Valor<T> { r: T }
interface ErrorSQL { code?: string; message?: string }
interface Preparacion {
  armado: string;
  techo: { estado: string; codtte: string | null; configuracion: string | null; requiereInstalacion: boolean | null };
  version: string;
  preparacionCompleta: boolean;
  condicionesFaltantes: string[];
}

const UUIDS = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'];
const leer = (ruta: string) => readFileSync(ruta, 'utf8');

test('HU-005 PostgreSQL: venta sin techo, techo elegido al separar y comprador completo', async t => {
  const db = new PGlite();
  let usuario = 1;
  const login = async (n = usuario) => {
    usuario = n;
    await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${UUIDS[n - 1]}',false)`);
  };
  const propietario = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec('RESET ROLE');
    try { return await fn(); } finally { await login(usuario); }
  };
  const escalar = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<Valor<T>>(sql, params)).rows[0]!.r;
  const error = (codigo: string, mensaje?: RegExp) => (e: unknown) =>
    (e as ErrorSQL).code === codigo && (!mensaje || mensaje.test((e as ErrorSQL).message ?? ''));
  const preparacion = (coduni: string) => propietario(() =>
    escalar<Preparacion>('SELECT public.hu033_proyectar_preparacion_unidad($1) r', [coduni]));
  const elegir = (coduni: string, codtte: string) => escalar<{ techo: { nombre: string }; preparacion: Preparacion }>(
    'SELECT public.hu005_elegir_techo($1,$2) r', [coduni, codtte]);
  const registrar = (numero: string, telefono: string | null, correo: string | null) => escalar<{ codcli: string; telefono: string }>(
    'SELECT public.hu005_registrar_cliente(1,$1,$2,$3,NULL,$4,$5) r', [numero, 'Rosa', 'Quispe', telefono, correo]);
  const separar = (coduni: string, codcli: string, monto = 300) => escalar<{ estado: string }>(
    'SELECT public.hu005_crear_separacion($1,$2,3,NULL,$3,CURRENT_DATE,$4,NULL,NULL,$5,true,$6) r',
    [coduni, codcli, monto, 'Efectivo', 'Recibido en tienda', randomUUID()]);
  interface Activa { decisionTecho: { decision: string; nombre: string | null; por: string | null }; techo: { nombre: string; estado: string } }
  const activa = (coduni: string) => escalar<Activa>('SELECT public.hu005_separacion_activa($1) r', [coduni]);

  try {
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
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
    await db.exec(leer('tests/fixtures/esquema-base.sql'));
    await db.exec('ALTER TABLE modelo ADD COLUMN IF NOT EXISTS premod numeric(10,2)'); // precio de lista (HU-012)
    for (const m of ['202610030001_hu026_ubicaciones', '202610040001_hu034_compra_pendiente',
      '202610060001_hu002_identificacion_unidades', '202610070001_hu007_permisos_rol', '202610190001_hu003_movimientos_ubicacion'])
      await db.exec(leer(`supabase/migrations/${m}.sql`));
    await db.exec(`INSERT INTO auth.users VALUES ('${UUIDS[0]}'),('${UUIDS[1]}'),('${UUIDS[2]}');
      INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor');
      INSERT INTO usuario(uuidusu,codrol,nomusu,apepatusu,corusu)
        VALUES ('${UUIDS[0]}',1,'Flavio','QA','gerente-hu005@test.local'),
               ('${UUIDS[1]}',2,'Deysi','QA','admin-hu005@test.local'),
               ('${UUIDS[2]}',3,'Cesar','QA','vendedor-hu005@test.local');
      INSERT INTO tipomotocar(nomtmo) VALUES ('QA HU-005');
      INSERT INTO modelo(codtmo,nommod,desmod,carmod) VALUES (1,'Modelo QA HU-005','Descripción','Características');`);
    await db.exec(leer('supabase/migrations/202610080001_hu004_configuracion_techo.sql'));
    const codcom = (await db.query<{ codcom: string }>(
      `INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',4) RETURNING codcom::text codcom`)).rows[0]!.codcom;
    await login(1);
    await escalar('SELECT public.hu002_registrar_factura($1,$2,$3,$4,$5) r', [codcom, 'Proveedor QA', 'FACT-HU005-08', '2026-11-01', 4]);
    await escalar('SELECT public.hu002_identificar_unidades($1,$2::jsonb) r', [codcom, JSON.stringify(
      Array.from({ length: 3 }, (_, i) => ({ nummotuni: `HU005-M-${i + 1}`, chauni: `HU005-C-${i + 1}`, codmod: '1', coluni: 'Azul' })))]);
    await propietario(async () => {
      await db.exec(leer('supabase/migrations/202610280003_hu033_preparacion_unidad.sql'));
      await db.exec(`ALTER TABLE public.separacion ENABLE ROW LEVEL SECURITY; ALTER TABLE public.venta ENABLE ROW LEVEL SECURITY;
        GRANT ALL ON public.separacion,public.venta TO authenticated;
        GRANT USAGE,SELECT ON SEQUENCE public.separacion_codsep_seq TO authenticated;`);
      for (const m of ['202611050001_hu005_separacion_moto', '202611060001_hu005_confirmador_transferencia',
        '202611070001_hu005_comprador_evidencia'])
        await db.exec(leer(`supabase/migrations/${m}.sql`));
      return undefined;
    });
    const [moto1, moto2, moto3] = await propietario(async () =>
      (await db.query<{ coduni: string }>('SELECT coduni::text coduni FROM public.unidad ORDER BY coduni')).rows.map(r => r.coduni));
    const tipo = Object.fromEntries(await propietario(async () => (await db.query<{ codtte: string; nomtte: string }>(
      'SELECT codtte::text codtte, nomtte FROM public.tipotecho')).rows.map(r => [r.nomtte, r.codtte])));

    await t.test('Antes de la migración: la moto sin techo elegido figura con pendientes y «No disponible»', async () => {
      const p = await preparacion(moto1!);
      assert.equal(p.preparacionCompleta, false);
      assert.ok(p.condicionesFaltantes.includes('Configuración de techo pendiente'));
      assert.equal(await propietario(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [moto1])), 'No disponible');
    });

    await propietario(async () => {
      for (const m of ['202611080001_hu005_techo_y_venta', '202611080002_hu005_decision_techo_y_tope', '202611080003_hu005_comprador_sin_documento']) {
        const migracion = leer(`supabase/migrations/${m}.sql`);
        await db.exec(migracion);
        await db.exec(migracion); // se puede volver a ejecutar
      }
      await db.exec('UPDATE public.modelo SET premod = 18335 WHERE codmod = 1');
      return undefined;
    });

    await t.test('Toda moto identificada queda libre para vender, también las nuevas', async () => {
      const situaciones = await propietario(() => escalar<string[]>('SELECT array_agg(DISTINCT estcomuni) r FROM public.unidad'));
      assert.deepEqual(situaciones, ['Disponible']);
      await escalar('SELECT public.hu002_identificar_unidades($1,$2::jsonb) r', [codcom, JSON.stringify(
        [{ nummotuni: 'HU005-M-4', chauni: 'HU005-C-4', codmod: '1', coluni: 'Azul' }])]);
      assert.equal(await propietario(() => escalar<string>("SELECT estcomuni r FROM public.unidad WHERE nummotuni='HU005-M-4'")), 'Disponible');
    });

    await t.test('Sin techo elegido y con armado pendiente, la moto no tiene pendientes', async () => {
      const p = await preparacion(moto1!);
      assert.equal(p.armado, 'Pendiente');
      assert.equal(p.preparacionCompleta, true);
      assert.deepEqual(p.condicionesFaltantes, []);
    });

    await t.test('Comprador nuevo: celular de 9 dígitos que empieza con 9 y correo obligatorios', async () => {
      await login(3);
      await assert.rejects(registrar('45879601', null, 'rosa@correo.pe'), error('PT400', /Teléfono/));
      await assert.rejects(registrar('45879602', '512345678', 'rosa@correo.pe'), error('PT400', /Teléfono/));
      await assert.rejects(registrar('45879603', '98765432', 'rosa@correo.pe'), error('PT400', /Teléfono/));
      await assert.rejects(registrar('45879604', '9876543210', 'rosa@correo.pe'), error('PT400', /Teléfono/));
      await assert.rejects(registrar('45879605', '987654321', null), error('PT400', /Correo/));
      const ok = await registrar('45879606', '987 654-321', 'Rosa@Correo.pe');
      assert.equal(ok.telefono, '987654321');
    });

    await t.test('El techo solo se elige en una moto separada; el vendedor lo registra', async () => {
      await login(3);
      const codcli = (await registrar('45879607', '987654322', 'cliente@correo.pe')).codcli;
      await assert.rejects(elegir(moto2!, tipo['Lona']!), error('PT409', /separación activa/));
      assert.equal((await separar(moto2!, codcli)).estado, 'Activa');
      const pendiente = await activa(moto2!);
      assert.deepEqual([pendiente.decisionTecho.decision, pendiente.decisionTecho.nombre], ['Por definir', null]);
      const conLona = await elegir(moto2!, tipo['Lona']!);
      const decidida = await activa(moto2!);
      assert.deepEqual([decidida.decisionTecho.decision, decidida.decisionTecho.nombre, decidida.decisionTecho.por], ['Con techo', 'Lona', 'Cesar QA']);
      assert.equal(conLona.techo.nombre, 'Lona');
      assert.equal(conLona.preparacion.techo.estado, 'Pendiente');
      assert.equal(conLona.preparacion.preparacionCompleta, false);
      assert.deepEqual(conLona.preparacion.condicionesFaltantes, ['Instalación de techo pendiente']);
      const otraVez = await elegir(moto2!, tipo['Lona']!);
      assert.equal(otraVez.preparacion.version, conLona.preparacion.version); // mismo techo: no cambia nada
      const sinTecho = await elegir(moto2!, tipo['Sin techo']!);
      assert.equal(sinTecho.preparacion.techo.estado, 'No requiere');
      assert.equal(sinTecho.preparacion.preparacionCompleta, true);
      const historial = await propietario(() => escalar<string>(
        "SELECT u.nomusu || ':' || h.estadonuevo r FROM public.historialpreparacionunidad h JOIN public.usuario u ON u.codusu=h.codusu WHERE h.coduni=$1 AND h.etapaprep='Techo' ORDER BY h.codhprep DESC LIMIT 1", [moto2]));
      assert.equal(historial, 'Cesar:No requiere'); // el cambio queda auditado a nombre del vendedor
      await assert.rejects(elegir(moto2!, '999'), error('PT400', /techo/));
      const final = await activa(moto2!);
      assert.deepEqual([final.techo.nombre, final.techo.estado], ['Sin techo', 'No requiere']);
      assert.equal(final.decisionTecho.decision, 'Sin techo');
    });

    await t.test('El vendedor sigue sin poder cambiar techos por HU-004 ni en motos libres', async () => {
      await login(3);
      await assert.rejects(db.query('SELECT public.hu004_actualizar_configuracion_techo($1,$2,NULL,NULL)', [moto3, tipo['Sin techo']]), error('42501'));
      await assert.rejects(elegir(moto3!, tipo['Lona']!), error('PT409'));
      await login(1);
      await escalar('SELECT public.hu004_actualizar_configuracion_techo($1,$2,NULL,NULL) r', [moto3, tipo['Sin techo']]);
      assert.equal((await preparacion(moto3!)).techo.configuracion, 'Sin techo');
    });

    await t.test('Con techo elegido, queda lista cuando se registra instalado', async () => {
      await login(2);
      await elegir(moto2!, tipo['Lona']!);
      const antes = await preparacion(moto2!);
      assert.equal(antes.preparacionCompleta, false);
      const despues = await escalar<Preparacion>('SELECT public.hu033_actualizar_preparacion_unidad($1,$2,$3,$4,$5,$6,$7) r',
        [moto2, 'Techo', 'Instalado', Number(antes.version), 'Instalado en tienda', 'Interno', randomUUID()]);
      assert.equal(despues.preparacionCompleta, true);
    });

    await t.test('El adelanto no puede superar el precio de lista del modelo (DEF-S3-001)', async () => {
      const precio = (valor: string) => propietario(async () => { await db.exec(`UPDATE public.modelo SET premod = ${valor} WHERE codmod = 1`); return undefined; });
      await login(3);
      const codcli = (await registrar('45879608', '987654323', 'tope@correo.pe')).codcli;
      const moto4 = await propietario(() => escalar<string>("SELECT coduni::text r FROM public.unidad WHERE nummotuni='HU005-M-4'"));
      await precio('NULL'); // sin precio de lista no se puede comprobar el tope
      await assert.rejects(separar(moto4, codcli, 300), error('PT436', /precio de lista/));
      await precio('18335');
      await assert.rejects(separar(moto4, codcli, 5000000), error('PT435', /precio de lista/));
      await assert.rejects(separar(moto4, codcli, 18335.01), error('PT435'));
      assert.equal(await propietario(() => escalar<string>('SELECT estcomuni r FROM public.unidad WHERE coduni=$1', [moto4])), 'Disponible');
      const conFecha = (dias: number) => db.query('SELECT public.hu005_crear_separacion($1,$2,3,NULL,300,CURRENT_DATE - $3::int,$4,NULL,NULL,$5,true,$6) r',
        [moto4, codcli, dias, 'Efectivo', 'Recibido en tienda', randomUUID()]);
      await assert.rejects(conFecha(31), error('PT437', /30 días/)); // fecha del adelanto irreal
      assert.equal((await separar(moto4, codcli, 18335)).estado, 'Activa');
      const f = await escalar<{ preciosLista: Record<string, number> }>('SELECT public.hu005_formulario_separacion() r');
      assert.equal(Number(f.preciosLista['1']), 18335);
    });

    await t.test('El formulario trae los tipos de techo con «Sin techo» primero', async () => {
      await login(3);
      const f = await escalar<{ tiposTecho: { nombre: string; requiereInstalacion: boolean }[] }>('SELECT public.hu005_formulario_separacion() r');
      assert.equal(f.tiposTecho[0]!.nombre, 'Sin techo');
      assert.equal(f.tiposTecho[0]!.requiereInstalacion, false);
      assert.deepEqual(f.tiposTecho.map(x => (x as { sinTecho?: boolean }).sinTecho), [true, false, false, false]);
      assert.ok(f.tiposTecho.length >= 2);
    });

    await t.test('Gerencia cambia el techo de una moto separada: la decisión lo sigue; volver a ejecutar no cambia decisiones', async () => {
      await login(1);
      const moto4 = await propietario(() => escalar<string>("SELECT coduni::text r FROM public.unidad WHERE nummotuni='HU005-M-4'"));
      assert.equal((await activa(moto4)).decisionTecho.decision, 'Por definir');
      await escalar('SELECT public.hu004_actualizar_configuracion_techo($1,$2,NULL,NULL) r', [moto4, tipo['Lona']]);
      const cambiada = await activa(moto4);
      assert.deepEqual([cambiada.decisionTecho.decision, cambiada.decisionTecho.nombre, cambiada.decisionTecho.por], ['Con techo', 'Lona', 'Flavio QA']);
      const codcli = (await registrar('45879609', '987654324', 'otra@correo.pe')).codcli;
      assert.equal((await separar(moto3!, codcli)).estado, 'Activa'); // su moto ya tenía «Sin techo» configurado
      assert.equal((await activa(moto3!)).decisionTecho.decision, 'Por definir');
      await propietario(async () => { await db.exec(leer('supabase/migrations/202611080002_hu005_decision_techo_y_tope.sql')); return undefined; });
      assert.equal((await activa(moto3!)).decisionTecho.decision, 'Por definir');
      assert.equal((await activa(moto4)).decisionTecho.decision, 'Con techo');
      await assert.rejects(propietario(() => db.query("UPDATE public.separacion SET dectechosep='Con techo', codttesep=NULL WHERE coduni=$1", [moto3])), error('23514'));
    });

    await t.test('Comprador sin documento: nombres, apellidos y celular; el mismo comprador no se duplica', async () => {
      interface Comprador { codcli: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string | null; telefono: string;
        tipoDocumento: string | null; numeroDocumento: string | null; correo: string | null; existente: boolean }
      const reg = (n: string | null, p: string | null, m: string | null, tel: string | null) =>
        escalar<Comprador>('SELECT public.hu005_registrar_comprador($1,$2,$3,$4) r', [n, p, m, tel]);
      await login(3);
      const c = await reg('  Rosa   María ', 'Quispe', 'Huamán', '987 654-399');
      assert.deepEqual([c.nombres, c.apellidoPaterno, c.apellidoMaterno, c.telefono, c.tipoDocumento, c.numeroDocumento, c.correo, c.existente],
        ['Rosa María', 'Quispe', 'Huamán', '987654399', null, null, null, false]);
      const igual = await reg('ROSA MARIA', 'quispe', 'HUAMAN', '987654399');
      assert.deepEqual([igual.codcli, igual.existente], [c.codcli, true]);
      assert.notEqual((await reg('Rosa María', 'Quispe', 'Huamán', '987654398')).codcli, c.codcli); // otro celular
      assert.notEqual((await reg('Ana', 'Quispe', 'Huamán', '987654399')).codcli, c.codcli); // otro nombre, mismo celular
      const sinMaterno = await reg('Rosa María', 'Quispe', null, '987654399');
      assert.deepEqual([sinMaterno.apellidoMaterno, sinMaterno.existente], [null, false]);
      await assert.rejects(reg('R', 'Quispe', null, '987654399'), error('PT400', /Nombres inválidos/));
      await assert.rejects(reg('Rosa2', 'Quispe', null, '987654399'), error('PT400', /Nombres inválidos/));
      await assert.rejects(reg('Rosa', null, null, '987654399'), error('PT400', /Apellido paterno/));
      await assert.rejects(reg('Rosa', 'Quispe', 'H', '987654399'), error('PT400', /Apellido materno/));
      for (const malo of ['Rosa-María', "O'Brien", 'Rosa.', 'Rosa@', 'Ro$a', ' Rosa_', 'Rosa2'])
        await assert.rejects(reg('Ana', malo, null, '987654399'), error('PT400', /Apellido paterno/), malo);
      assert.equal((await reg('José Ñique', 'Müller Peña', 'De La Cruz', '987654397')).apellidoMaterno, 'De La Cruz');
      for (const tel of ['512345678', '98765432', '9876543210', '999999999', null])
        await assert.rejects(reg('Rosa', 'Quispe', null, tel), error('PT400', /Celular inválido/));
      // Se separa a su nombre y la separación activa lo muestra sin documento
      await propietario(async () => { await db.exec('UPDATE public.modelo SET premod = 18335 WHERE codmod = 1'); return undefined; });
      assert.equal((await separar(moto1!, c.codcli)).estado, 'Activa');
      const s = await escalar<{ comprador: Comprador }>('SELECT public.hu005_separacion_activa($1) r', [moto1]);
      assert.deepEqual([s.comprador.nombres, s.comprador.apellidoMaterno, s.comprador.numeroDocumento], ['Rosa María', 'Huamán', null]);
      // Solo los roles comerciales registran compradores
      await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',false)`);
      await assert.rejects(db.query("SELECT public.hu005_registrar_comprador('Rosa','Quispe',NULL,'987654399')"), error('42501'));
      await login(3);
    });
  } finally {
    await db.close();
  }
});
