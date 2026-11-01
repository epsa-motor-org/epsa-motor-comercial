import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const hu026 = readFileSync('supabase/migrations/202610030001_hu026_ubicaciones.sql', 'utf8');
const hu007 = readFileSync('supabase/migrations/202610070001_hu007_permisos_rol.sql', 'utf8');
const hu014 = readFileSync('supabase/migrations/202610090001_hu014_registro_lead_manual.sql', 'utf8');
const hu014Correccion = readFileSync('supabase/migrations/202610100001_hu014_modelo_publicado.sql', 'utf8');
const hu015 = readFileSync('supabase/migrations/202610220001_hu015_asignacion_leads.sql', 'utf8');
const sinHttp407 = readFileSync('supabase/migrations/202610310001_hu015_responsable_sin_http_407.sql', 'utf8');

test('HU015 PostgreSQL: seguridad, visibilidad por rol, asignación transaccional e idempotencia', async t => {
  const db = new PGlite();
  const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const login = async (n = 1) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uuid(n)}',false); SET ROLE authenticated;`);
  const salir = async () => db.exec('RESET ROLE');
  const fallo = async (sql: string, code: string) => assert.rejects(db.exec(sql), (e: any) => e.code === code);
  const asignar = async (lead: number, nuevo: number, esperado: number | null, motivo: string | null) =>
    (await db.query<any>(`SELECT public.hu015_asignar_responsable_lead($1::bigint,$2::bigint,$3::bigint,$4::text) AS data`,
      [lead, nuevo, esperado, motivo])).rows[0].data;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
    await db.exec(readFileSync('tests/fixtures/esquema-base.sql', 'utf8'));
    await db.exec(hu026);
    await db.exec(hu007);
    await db.exec(`INSERT INTO auth.users(id) VALUES ('${uuid(1)}'),('${uuid(2)}'),('${uuid(3)}'),('${uuid(4)}'),('${uuid(5)}');
      INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor'),('Supervisor');
      INSERT INTO usuario(codusu,uuidusu,codrol,nomusu,apepatusu,apematusu,corusu,estusu) VALUES
        (1,'${uuid(1)}',1,'Gerente','Uno','QA','gerente@test.local',true),
        (2,'${uuid(2)}',2,'Admin','Dos','QA','admin@test.local',true),
        (3,'${uuid(3)}',3,'Vendedor','Tres','QA','vendedor@test.local',true),
        (4,'${uuid(4)}',3,'Inactivo','Cuatro','QA','inactivo@test.local',false),
        (5,'${uuid(5)}',4,'Supervisor','Cinco','QA','supervisor@test.local',true);
      INSERT INTO tipomotocar(nomtmo) VALUES ('Tipo QA');
      INSERT INTO modelo(codtmo,nommod,desmod,carmod,estmod) VALUES (1,'Modelo QA','Descripción QA','Datos QA','Publicado');
      INSERT INTO canalwhatsapp(nomcwa,numcwa,enlcwa) VALUES ('Canal QA','999111222','https://wa.me/999111222');
      INSERT INTO sede(codubi) SELECT codubi FROM ubicacion WHERE nomubi='Comas';`);
    await db.exec(hu014);
    await db.exec(hu014Correccion);
    await db.exec(`INSERT INTO lead(codlea,codmod,codusu,codcwa,nomlea,tellea,orilea,canlea,obslea,estlea,codsed,collea,
        tipreglea,codcli,codcrelea)
      VALUES
        (1,1,NULL,NULL,'Lead inicial','987654321','Web','Llamada','Consulta inicial','Nuevo',1,'Azul','Manual',NULL,1),
        (2,1,3,1,'Lead vendedor','987654322','Web','WhatsApp','Consulta vendedor','En seguimiento',1,'Rojo','Manual',NULL,2),
        (3,1,1,1,'Lead cerrado','987654323','Web','WhatsApp','Cerrado','Cerrado',1,'Verde','Manual',NULL,1),
        (4,1,NULL,1,'Lead inicial admin','987654324','Web','Llamada','Asignación pendiente','Nuevo',1,'Negro','Manual',NULL,2);
      SELECT pg_catalog.setval(pg_get_serial_sequence('public.lead','codlea'), 4, true);
      INSERT INTO seguimientolead(codlea,codusu,fecinisle,horsle,tipsle,dessle,fecprosle)
        VALUES (2,2,'2026-01-04T10:00:00Z','10:00:00','Llamada','Actividad original','2030-01-05T12:00:00Z');`);
    await db.exec(hu015);
    await db.exec(sinHttp407);

    await t.test('migración crea historial append-only, índices y RPCs con permisos limitados', async () => {
      const rls = (await db.query<any>(`SELECT relrowsecurity FROM pg_class WHERE oid='public.asignacionlead'::regclass`)).rows[0].relrowsecurity;
      assert.equal(rls, true);
      for (const f of [
        'public.hu015_asignar_responsable_lead(bigint,bigint,bigint,text)',
        'public.hu015_listar_leads(integer,integer)',
        'public.hu015_listar_responsables()'
      ]) {
        assert.equal((await db.query<any>(`SELECT has_function_privilege('authenticated','${f}','EXECUTE') AS permitido`)).rows[0].permitido, true);
        assert.equal((await db.query<any>(`SELECT has_function_privilege('anon','${f}','EXECUTE') AS permitido`)).rows[0].permitido, false);
      }
      for (const tabla of ['lead','seguimientolead','asignacionlead']) {
        for (const permiso of ['SELECT','INSERT','UPDATE','DELETE']) {
          assert.equal((await db.query<any>(`SELECT has_table_privilege('authenticated','public.${tabla}','${permiso}') AS permitido`)).rows[0].permitido,
            false, `${tabla} ${permiso}`);
        }
      }
      const indices = (await db.query<any>(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map((r: any) => r.indexname);
      assert.ok(indices.includes('idx_hu015_lead_codusu'));
      assert.ok(indices.includes('idx_hu015_asignacionlead_codlea_fecale'));
    });

    await t.test('listado manager/admin amplio; vendedor queda limitado al responsable resuelto por auth.uid', async () => {
      await login(1);
      const todos = (await db.query<any>('SELECT public.hu015_listar_leads(100,0) AS data')).rows[0].data;
      assert.equal(todos.length, 4);
      assert.ok(todos.every((l: any) => typeof l.codlea === 'string'));
      assert.ok(!JSON.stringify(todos).match(/uuidusu|codcrelea|codcli|corusu|codusuaut/));
      assert.ok(todos.every((l: any) => 'responsable' in l && 'nommod' in l && 'receptorWhatsapp' in l));
      const conCanalWhatsApp = todos.find((l: any) => l.codlea === '4');
      assert.equal(conCanalWhatsApp.canlea, 'Llamada');
      assert.equal(conCanalWhatsApp.receptorWhatsapp, '999111222');
      const sinCanalWhatsApp = todos.find((l: any) => l.codlea === '1');
      assert.equal(sinCanalWhatsApp.codcwa, null);
      assert.equal(sinCanalWhatsApp.receptorWhatsapp, null);

      await login(2);
      assert.equal((await db.query<any>('SELECT public.hu015_listar_leads(100,0) AS data')).rows[0].data.length, 4);
      const receptores = (await db.query<any>('SELECT public.hu015_listar_responsables() AS data')).rows[0].data;
      assert.deepEqual(receptores.map((u: any) => u.rol), ['Administradora','Gerente','Vendedor']);
      assert.ok(!JSON.stringify(receptores).includes('uuidusu'));
      await login(3);
      const propios = (await db.query<any>('SELECT public.hu015_listar_leads(100,0) AS data')).rows[0].data;
      assert.deepEqual(propios.map((l: any) => l.codlea), ['2']);
      await fallo('SELECT public.hu015_listar_responsables()', '42501');
      await login(5);
      await fallo('SELECT public.hu015_listar_leads(50,0)', '42501');
      await login(1);
      await fallo('SELECT public.hu015_listar_leads(101,0)', 'PT400');
    });

    await t.test('Administradora hace asignación inicial y Gerente transfiere sin perder seguimientos', async () => {
      await login(2);
      const inicial = await asignar(4, 3, null, null);
      assert.deepEqual(inicial, { codlea: '4', responsableAnterior: null, responsableActual: '3', cambioRealizado: true });
      await salir();
      const eventoInicial = (await db.query<any>(`SELECT codusuant::text,codusunue::text,codusuaut::text,
        fecale IS NOT NULL AS fecha, motale FROM asignacionlead WHERE codlea=4`)).rows[0];
      assert.deepEqual(eventoInicial, { codusuant: null, codusunue: '3', codusuaut: '2', fecha: true, motale: null });
      await login(1);
      const transferencia = await asignar(4, 1, 3, 'Cobertura de cartera');
      assert.deepEqual(transferencia, { codlea: '4', responsableAnterior: '3', responsableActual: '1', cambioRealizado: true });
      await salir();
      assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM lead')).rows[0].n, 4);

      const leadAntes = (await db.query<any>(`SELECT nomlea,tellea,codmod,collea,canlea,orilea,codcwa,codsed,estlea,
        obslea,tipreglea,codcli,codcrelea,fecreglea FROM lead WHERE codlea=2`)).rows[0];
      const actividadAntes = (await db.query<any>(`SELECT codsle::text,codusu::text,fecinisle,horsle,tipsle,dessle,fecprosle
        FROM seguimientolead WHERE codlea=2`)).rows[0];
      const whatsappAntes = (await db.query<any>('SELECT numcwa FROM canalwhatsapp WHERE codcwa=1')).rows[0].numcwa;
      await login(2);
      const cambio = await asignar(2, 2, 3, 'Redistribución de carga');
      assert.equal(cambio.cambioRealizado, true);
      await salir();
      const leadDespues = (await db.query<any>(`SELECT nomlea,tellea,codmod,collea,canlea,orilea,codcwa,codsed,estlea,
        obslea,tipreglea,codcli,codcrelea,fecreglea FROM lead WHERE codlea=2`)).rows[0];
      const actividadDespues = (await db.query<any>(`SELECT codsle::text,codusu::text,fecinisle,horsle,tipsle,dessle,fecprosle
        FROM seguimientolead WHERE codlea=2`)).rows[0];
      assert.deepEqual(leadDespues, leadAntes);
      assert.deepEqual(actividadDespues, actividadAntes);
      assert.equal((await db.query<any>('SELECT numcwa FROM canalwhatsapp WHERE codcwa=1')).rows[0].numcwa, whatsappAntes);
      assert.equal((await db.query<any>('SELECT codusu::text FROM lead WHERE codlea=2')).rows[0].codusu, '2');
    });

    await t.test('asignación inicial, reintento idempotente y transferencia conservan los demás datos', async () => {
      await login(1);
      const inicial = await asignar(1, 3, null, null);
      assert.deepEqual(inicial, { codlea: '1', responsableAnterior: null, responsableActual: '3', cambioRealizado: true });
      await salir();
      const cuentaInicial = (await db.query<any>('SELECT count(*)::int AS n FROM asignacionlead WHERE codlea=1')).rows[0].n;
      assert.equal(cuentaInicial, 1);

      // Mismo destinatario tiene éxito incluso con expected desactualizado y no duplica evento.
      await login(1);
      const repetida = await asignar(1, 3, 1, 'Reintento');
      assert.deepEqual(repetida, { codlea: '1', responsableAnterior: '3', responsableActual: '3', cambioRealizado: false });
      await salir();
      assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM asignacionlead WHERE codlea=1')).rows[0].n, 1);

      const antes = (await db.query<any>(`SELECT nomlea,tellea,codmod,codcwa,canlea,orilea,obslea,estlea,codsed,collea,
        tipreglea,codcli,codcrelea FROM lead WHERE codlea=1`)).rows[0];
      await login(2);
      const transferencia = await asignar(1, 2, 3, '  Reorganización de cartera  ');
      assert.deepEqual(transferencia, { codlea: '1', responsableAnterior: '3', responsableActual: '2', cambioRealizado: true });
      await salir();
      const despues = (await db.query<any>(`SELECT nomlea,tellea,codmod,codcwa,canlea,orilea,obslea,estlea,codsed,collea,
        tipreglea,codcli,codcrelea,codusu::text FROM lead WHERE codlea=1`)).rows[0];
      assert.equal(despues.codusu, '2');
      delete despues.codusu;
      assert.deepEqual(despues, antes);
      const eventos = (await db.query<any>('SELECT codusuant::text,codusunue::text,codusuaut::text,motale FROM asignacionlead WHERE codlea=1 ORDER BY codale')).rows;
      assert.deepEqual(eventos, [
        { codusuant: null, codusunue: '3', codusuaut: '1', motale: null },
        { codusuant: '3', codusunue: '2', codusuaut: '2', motale: 'Reorganización de cartera' }
      ]);
      assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM seguimientolead WHERE codlea=1')).rows[0].n, 0);
    });

    await t.test('rechaza transferencia obsoleta, responsable inactivo/rol inválido y actor vendedor', async () => {
      await login(1);
      await assert.rejects(asignar(1, 1, 3, 'Motivo'), (e: any) => e.code === 'PT416');
      await assert.rejects(asignar(1, 4, 2, 'Motivo'), (e: any) => e.code === 'PT422');
      await assert.rejects(asignar(1, 5, 2, 'Motivo'), (e: any) => e.code === 'PT422');
      await assert.rejects(asignar(999, 3, null, null), (e: any) => e.code === 'PT404');
      await assert.rejects(asignar(3, 3, 1, null), (e: any) => e.code === 'PT400' || e.code === 'PT416');
      await salir();
      await db.exec("UPDATE rol SET estrol=false WHERE nomrol='Vendedor'");
      await login(1);
      await assert.rejects(asignar(1, 3, 2, 'Motivo'), (e: any) => e.code === 'PT422');
      await salir();
      await db.exec("UPDATE rol SET estrol=true WHERE nomrol='Vendedor'");
      await login(3);
      await assert.rejects(asignar(2, 1, 3, 'Motivo'), (e: any) => e.code === '42501');
    });

    await t.test('lead Cerrado sigue asignable sin alterar actividad ni reglas de estado', async () => {
      await salir();
      const seguimientosAntes = (await db.query<any>('SELECT count(*)::int AS n FROM seguimientolead WHERE codlea=3')).rows[0].n;
      await login(1);
      const r = await asignar(3, 3, 1, 'Reasignación de atención');
      assert.equal(r.cambioRealizado, true);
      await salir();
      assert.equal((await db.query<any>('SELECT estlea FROM lead WHERE codlea=3')).rows[0].estlea, 'Cerrado');
      const seguimientosDespues = (await db.query<any>('SELECT count(*)::int AS n FROM seguimientolead WHERE codlea=3')).rows[0].n;
      assert.equal(seguimientosDespues, seguimientosAntes);
    });

    await t.test('fallo al insertar historial revierte el cambio de responsable', async () => {
      await salir();
      const eventosAntes = (await db.query<any>('SELECT count(*)::int AS n FROM asignacionlead WHERE codlea=4')).rows[0].n;
      await db.exec(`CREATE FUNCTION public.hu015_test_fallar_historial() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='fallo de prueba'; END $$;
        CREATE TRIGGER hu015_test_fallar_historial BEFORE INSERT ON public.asignacionlead
        FOR EACH ROW EXECUTE FUNCTION public.hu015_test_fallar_historial();`);
      await login(1);
      await assert.rejects(asignar(4, 2, 1, 'Motivo'), (e: any) => e.code === 'P0001');
      await salir();
      assert.equal((await db.query<any>('SELECT codusu::text FROM lead WHERE codlea=4')).rows[0].codusu, '1');
      assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM asignacionlead WHERE codlea=4')).rows[0].n, eventosAntes);
    });

    await t.test('authenticated no puede hacer CRUD directo y anon no puede ejecutar RPCs', async () => {
      await login(3);
      await fallo(`INSERT INTO public.asignacionlead(codlea,codusunue,codusuaut) VALUES (2,1,3)`, '42501');
      await fallo(`UPDATE public.lead SET codusu=1 WHERE codlea=2`, '42501');
      await fallo(`DELETE FROM public.seguimientolead WHERE codlea=2`, '42501');
      await salir();
      await db.exec('SET ROLE anon');
      await fallo('SELECT public.hu015_listar_leads(50,0)', '42501');
      await fallo('SELECT public.hu015_listar_responsables()', '42501');
      await fallo('SELECT public.hu015_asignar_responsable_lead(1,2,NULL,NULL)', '42501');
      await salir();
    });
  } finally {
    await db.close();
  }
});
