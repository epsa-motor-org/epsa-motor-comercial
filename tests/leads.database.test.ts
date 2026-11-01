import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migracion = readFileSync('supabase/migrations/202610090001_hu014_registro_lead_manual.sql', 'utf8');
const correccion = readFileSync('supabase/migrations/202610100001_hu014_modelo_publicado.sql', 'utf8');
const sinHttp407 = readFileSync('supabase/migrations/202610310001_hu015_responsable_sin_http_407.sql', 'utf8');
test('HU014 PostgreSQL: migración, reglas comerciales, atomicidad y seguridad', async t => {
  const db = new PGlite();
  let consecutivo = 0;
  const telefono = () => String(900000000 + ++consecutivo);
  const login = async (n = 1) => db.exec(`RESET ROLE; SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000${n}',false)`);
  const fallo = async (sql: string, code: string) => assert.rejects(db.exec(sql), (e: any) => e.code === code);
  const crear = async (cambios: Record<string, unknown> = {}) => {
    const d = { nomlea: 'Persona QA', tellea: telefono(), codmod: '1', canlea: 'Llamada', estlea: 'Nuevo',
      codusu: '2', fecprosle: new Date(Date.now() + 86400000).toISOString(), collea: null,
      orilea: null, codsed: null, codcwa: null, obslea: null, nueva_oportunidad: false, ...cambios };
    return (await db.query<any>(`SELECT public.hu014_registrar_lead_manual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS r`,
      [d.nomlea,d.tellea,d.codmod,d.canlea,d.estlea,d.codusu,d.fecprosle,d.collea,d.orilea,d.codsed,d.codcwa,d.obslea,d.nueva_oportunidad])).rows[0].r;
  };
  const rechaza = async (datos: Record<string, unknown>, code: string) =>
    assert.rejects(crear(datos), (e: any) => e.code === code);
  const historico = async (tel: string, estado = 'Nuevo', edad = "interval '1 day'") => {
    await db.exec('RESET ROLE');
    const r = (await db.query<any>(`INSERT INTO lead(nomlea,tellea,orilea,canlea,estlea,codmod,fecreglea)
      VALUES ('Histórico QA',$1,'QA','Llamada',$2,1,CURRENT_TIMESTAMP-${edad}) RETURNING codlea::text AS id`, [tel,estado])).rows[0].id;
    await login(); return r;
  };
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
    await db.exec(readFileSync('tests/fixtures/esquema-base.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610030001_hu026_ubicaciones.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610070001_hu007_permisos_rol.sql', 'utf8'));
    await db.exec(`INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
      INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor'),('Otro QA');
      INSERT INTO usuario(uuidusu,codrol,nomusu,apepatusu,corusu)
        SELECT id,row_number() OVER (ORDER BY id),'Persona','QA',id::text||'@test.local' FROM auth.users;
      INSERT INTO tipomotocar(nomtmo) VALUES ('Tipo QA');
      INSERT INTO modelo(codtmo,nommod,desmod,carmod,estmod) VALUES
        (1,'Modelo publicado QA','Descripción QA','Características QA','Publicado'),
        (1,'Modelo no publicado QA','Descripción QA','Características QA','No publicado'),
        (1,'Modelo borrador QA','Descripción QA','Características QA','Borrador');
      INSERT INTO canalwhatsapp(nomcwa,numcwa,enlcwa) VALUES ('Canal QA','999000001','https://example.com/qa');
      INSERT INTO ubicacion(nomubi,tipubi) VALUES ('Ubicación QA','Sede');
      INSERT INTO sede(codubi) SELECT codubi FROM ubicacion WHERE nomubi='Ubicación QA';
      INSERT INTO lead(nomlea,orilea,canlea,estlea) VALUES ('Histórico previo QA','Manual','Anterior QA','Estado anterior QA');
      GRANT ALL ON lead,seguimientolead TO anon,authenticated;
      GRANT ALL ON SEQUENCE lead_codlea_seq,seguimientolead_codsle_seq TO anon,authenticated;
      CREATE POLICY anterior_lead ON lead FOR ALL TO PUBLIC USING(true) WITH CHECK(true);`);
    await db.exec(migracion);
    await db.exec(correccion);
    await t.test('migración reaplicable preserva históricos, sin NOT NULL global ni teléfono UNIQUE', async () => {
      await db.exec(migracion);
      const aclAnterior = (await db.query<any>(`SELECT proacl::text AS acl FROM pg_proc
        WHERE oid='public.hu014_registrar_lead_manual(text,text,bigint,text,text,bigint,timestamptz,text,text,bigint,bigint,text,boolean)'::regprocedure`)).rows[0].acl;
      await db.exec(correccion);
      await db.exec(correccion);
      // Responsable inexistente: PT422 en vez de PT407 (reaplicable y sin cambiar permisos)
      await db.exec(sinHttp407);
      await db.exec(sinHttp407);
      assert.equal((await db.query<any>(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosrc LIKE '%''PT407''%'`)).rows[0].n, 0);
      const aclActual = (await db.query<any>(`SELECT proacl::text AS acl FROM pg_proc
        WHERE oid='public.hu014_registrar_lead_manual(text,text,bigint,text,text,bigint,timestamptz,text,text,bigint,bigint,text,boolean)'::regprocedure`)).rows[0].acl;
      assert.equal(aclActual, aclAnterior);
      const r = (await db.query<any>('SELECT * FROM lead WHERE codlea=1')).rows[0];
      assert.equal(r.estlea, 'Estado anterior QA'); assert.equal(r.orilea, 'Manual');
      for (const campo of ['tellea','codmod','codusu','codsed','collea','tipreglea','codcli','codcrelea']) assert.equal(r[campo], null);
      const columnas = (await db.query<any>(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='lead'`)).rows;
      for (const campo of ['tellea','codmod','orilea']) assert.equal(columnas.find(c => c.column_name===campo).is_nullable, 'YES');
      assert.equal((await db.query<any>(`SELECT count(*)::int AS n FROM pg_constraint
        WHERE conrelid='public.lead'::regclass AND contype='u'`)).rows[0].n, 0);
    });
    await t.test('los tres roles crean; creador autenticado separado del responsable', async () => {
      for (const n of [1,2,3]) {
        await login(n);
        const r = await crear({ nomlea: '  Persona   QA ', tellea: `+51 (${telefono()})`, obslea: '  Consulta  QA ' });
        assert.equal(r.codcrelea, String(n)); assert.equal(r.codusu, '2'); assert.equal(r.codmod, '1');
        assert.equal(typeof r.codlea, 'string'); assert.equal(r.nomlea, 'Persona QA');
        assert.equal(r.orilea, null); assert.equal(r.collea, null); assert.equal(r.codcli, null); assert.equal(r.tipreglea, 'Manual');
        assert.match(r.tellea, /^51\d{9}$/);
        await db.exec('RESET ROLE');
        const seguimiento = (await db.query<any>('SELECT codusu::text,tipsle,fecprosle,dessle FROM seguimientolead WHERE codlea=$1',[r.codlea])).rows;
        assert.equal(seguimiento.length, 1); assert.equal(seguimiento[0].codusu, String(n));
        assert.equal(seguimiento[0].tipsle, 'Registro manual'); assert.ok(seguimiento[0].fecprosle);
        assert.equal(seguimiento[0].dessle, 'Consulta QA');
      }
      await login();
    });
    await t.test('modelo Publicado permite registrar lead', async () => {
      const r = await crear({ codmod: '1' });
      assert.equal(r.codmod, '1');
    });
    for (const [codmod, estado] of [['2','No publicado'],['3','Borrador'],['999','inexistente']]) {
      await t.test(`modelo ${estado} se rechaza con PT404 sin crear lead ni seguimiento`, async () => {
        await db.exec('RESET ROLE');
        const antes = (await db.query<any>(`SELECT (SELECT count(*) FROM lead)::int AS leads,
          (SELECT count(*) FROM seguimientolead)::int AS seguimientos`)).rows[0];
        await login();
        await assert.rejects(crear({ codmod }), (e: any) => {
          assert.equal(e.code, 'PT404');
          assert.equal(e.message, 'Modelo inexistente o no publicado');
          return true;
        });
        await db.exec('RESET ROLE');
        const despues = (await db.query<any>(`SELECT (SELECT count(*) FROM lead)::int AS leads,
          (SELECT count(*) FROM seguimientolead)::int AS seguimientos`)).rows[0];
        assert.deepEqual(despues, antes);
        await login();
      });
    }
    await t.test('RPC valida mínimos y reglas aun sin Express', async () => {
      for (const d of [{ nomlea: null },{ nomlea: ' ' },{ nomlea: 'a'.repeat(151) },{ tellea: null },
        { tellea: 'abc' },{ tellea: '123' },{ codmod: null },{ codmod: 0 },{ canlea: ' ' },
        { estlea: null },{ estlea: 'Inventado' },{ estlea: 'Convertido' },{ codusu: null },{ codusu: 0 },
        { fecprosle: null },{ fecprosle: '2020-01-01T00:00:00Z' },{ fecprosle: 'infinity' },
        { orilea: 'Manual' },{ orilea: 'a'.repeat(31) },{ collea: 'Morado' },{ nueva_oportunidad: null },
        { canlea: 'Presencial', codsed: null },{ canlea: 'WhatsApp', codcwa: null }]) await rechaza(d, 'PT400');
    });
    await t.test('modelo, sede, canal receptor y responsable requieren referencias válidas', async () => {
      await rechaza({ codmod: 999 }, 'PT404');
      await rechaza({ canlea: 'Presencial', codsed: 999 }, 'PT405');
      await rechaza({ canlea: 'WhatsApp', codcwa: 999 }, 'PT406');
      await rechaza({ codusu: 999 }, 'PT422');
      await rechaza({ codusu: 4 }, 'PT422');
      const sed = await crear({ canlea: ' presencial ', codsed: 1 }); assert.equal(sed.codsed, '1'); assert.equal(sed.canlea, 'Presencial');
      const wa = await crear({ canlea: ' WHATSAPP ', codcwa: 1, orilea: ' Facebook ' });
      assert.equal(wa.codcwa, '1'); assert.equal(wa.canlea, 'WhatsApp'); assert.equal(wa.orilea, 'Facebook');
    });
    await t.test('colores case-insensitive, origen y color opcionales', async () => {
      for (const color of ['Rojo','Azul','Amarillo','Verde','Negro'])
        assert.equal((await crear({ collea: ` ${color.toUpperCase()} ` })).collea, color);
      const r = await crear({ collea: null, orilea: null }); assert.equal(r.collea, null); assert.equal(r.orilea, null);
    });
    await t.test('activos requieren próximo contacto; Cerrado exige NULL y registra actividad inicial', async () => {
      for (const estlea of ['Nuevo','Contactado','En seguimiento']) {
        assert.equal((await crear({ estlea })).estlea, estlea); await rechaza({ estlea, fecprosle: null }, 'PT400');
      }
      const r = await crear({ estlea: 'Cerrado', fecprosle: null }); assert.equal(r.fecprosle, null);
      await rechaza({ estlea: 'Cerrado' }, 'PT400');
      await db.exec('RESET ROLE');
      const s = (await db.query<any>('SELECT fecprosle FROM seguimientolead WHERE codlea=$1',[r.codlea])).rows;
      assert.equal(s.length, 1); assert.equal(s[0].fecprosle, null); await login();
    });
    await t.test('misma persona activa reciente genera conflicto mínimo; nueva oportunidad es explícita', async () => {
      const tel = telefono(); const anterior = await crear({ tellea: tel });
      await assert.rejects(crear({ tellea: `(${tel})` }), (e: any) => {
        assert.equal(e.code, 'PT409');
        assert.deepEqual(JSON.parse(e.detail), { codlea: anterior.codlea, codmod: '1', estlea: 'Nuevo' }); return true;
      });
      const nuevo = await crear({ tellea: tel, nueva_oportunidad: true }); assert.notEqual(nuevo.codlea, anterior.codlea);
    });
    await t.test('Cerrado y Convertido recientes permiten otro lead', async () => {
      for (const estado of ['Cerrado','Convertido']) {
        const tel = telefono(); const id = await historico(tel, estado);
        assert.notEqual((await crear({ tellea: tel })).codlea, id);
      }
    });
    await t.test('14 días exactos y mayor antigüedad permiten otra oportunidad', async () => {
      for (const dias of [14,15]) {
        await db.exec('RESET ROLE; BEGIN');
        const tel = telefono(); const id = await historico(tel, 'Nuevo', `interval '${dias} days'`);
        assert.notEqual((await crear({ tellea: tel })).codlea, id);
        await db.exec('COMMIT');
      }
    });
    await t.test('lead antiguo con seguimiento reciente sigue siendo coincidencia', async () => {
      const tel = telefono(); const id = await historico(tel, 'En seguimiento', "interval '30 days'");
      await db.exec('RESET ROLE');
      await db.query(`INSERT INTO seguimientolead(codlea,codusu,fecinisle) VALUES($1,1,CURRENT_TIMESTAMP-interval '1 day')`,[id]);
      await login(); await rechaza({ tellea: tel }, 'PT409');
    });
    await t.test('última actividad utiliza también horsle en America/Lima', async () => {
      const tel = telefono(); const id = await historico(tel, 'Nuevo', "interval '30 days'");
      await db.exec('RESET ROLE');
      // La fecha de inicio supera 14 días, pero la hora registrada en ese día sigue en la ventana.
      await db.query(`INSERT INTO seguimientolead(codlea,codusu,fecinisle,horsle)
        VALUES($1,1,((CURRENT_TIMESTAMP-interval '14 days') AT TIME ZONE 'America/Lima')::date
          AT TIME ZONE 'America/Lima','23:59:59.999999')`,[id]);
      await login(); await rechaza({ tellea: tel }, 'PT409');
    });
    await t.test('peticiones competidoras no crean silenciosamente dos oportunidades', async () => {
      const tel = telefono();
      const resultados = await Promise.allSettled([crear({ tellea: tel }),crear({ tellea: tel })]);
      assert.equal(resultados.filter(r => r.status==='fulfilled').length, 1);
      const error = resultados.find(r => r.status==='rejected') as PromiseRejectedResult;
      assert.equal(error.reason.code, 'PT409');
      // PGlite serializa su conexión; además comprobar la retención del lock hasta COMMIT.
      await db.exec('BEGIN');
      await crear();
      await db.exec('RESET ROLE');
      assert.ok((await db.query<any>("SELECT * FROM pg_locks WHERE locktype='advisory' AND granted")).rows.length > 0);
      await db.exec('COMMIT'); await login();
    });
    await t.test('un próximo seguimiento futuro no se considera actividad realizada', async () => {
      const tel = telefono(); const id = await historico(tel, 'Nuevo', "interval '30 days'");
      await db.exec('RESET ROLE');
      await db.query(`INSERT INTO seguimientolead(codlea,codusu,fecinisle,fecprosle)
        VALUES($1,1,CURRENT_TIMESTAMP-interval '20 days',CURRENT_TIMESTAMP+interval '2 days')`,[id]);
      await login(); assert.notEqual((await crear({ tellea: tel })).codlea, id);
    });
    await t.test('fallo del seguimiento revierte el INSERT del lead', async () => {
      await db.exec(`RESET ROLE;
        CREATE FUNCTION public.qa_fallar_seguimiento() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Fallo QA'; END $$;
        CREATE TRIGGER qa_fallo BEFORE INSERT ON seguimientolead FOR EACH ROW EXECUTE FUNCTION public.qa_fallar_seguimiento();`);
      const tel = telefono(); await login(); await rechaza({ tellea: tel }, 'P0001');
      await db.exec('RESET ROLE');
      assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM lead WHERE tellea=$1',[tel])).rows[0].n, 0);
      await db.exec('DROP TRIGGER qa_fallo ON seguimientolead; DROP FUNCTION public.qa_fallar_seguimiento();'); await login();
    });
    await t.test('FK a cliente preparada pero registrar no crea ni vincula clientes', async () => {
      const r = await crear(); assert.equal(r.codcli, null); await db.exec('RESET ROLE');
      assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM cliente')).rows[0].n, 0);
      await fallo(`UPDATE lead SET codcli=999 WHERE codlea=${r.codlea}`, '23503'); await login();
    });
    await t.test('ausencia está cerrada y no se activa con parámetros del cliente', async () => {
      // Con cita válida, un responsable NULL sigue siendo rechazado por la propia RPC.
      await rechaza({ codusu: null }, 'PT400');
      await rechaza({ codusu: null, fecprosle: null, estlea: 'Nuevo' }, 'PT400');
      await fallo('SELECT public.hu014_modo_ausencia_activo()', '42501');
      await db.exec('RESET ROLE');
      assert.equal((await db.query<any>('SELECT hu014_modo_ausencia_activo() AS r')).rows[0].r, false); await login();
    });
    await t.test('fuente server-side de ausencia activa permite NULL y fuerza Nuevo sin cita', async () => {
      // Simulación privada solo en PGlite, revertida al finalizar: no cambia la migración.
      await db.exec(`RESET ROLE; BEGIN;
        CREATE OR REPLACE FUNCTION public.hu014_modo_ausencia_activo()
        RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT true $$;`);
      try {
        await login();
        const r = await crear({ codusu: null, estlea: 'Contactado' });
        assert.equal(r.codusu, null); assert.equal(r.estlea, 'Nuevo'); assert.equal(r.fecprosle, null);
        const sinCita = await crear({ codusu: null, fecprosle: null });
        assert.equal(sinCita.codusu, null); assert.equal(sinCita.estlea, 'Nuevo'); assert.equal(sinCita.fecprosle, null);
        await db.exec('RESET ROLE');
        assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM seguimientolead WHERE codlea IN ($1,$2)',
          [r.codlea, sinCita.codlea])).rows[0].n, 0);
      } finally { await db.exec('ROLLBACK; RESET ROLE'); }
      assert.equal((await db.query<any>('SELECT hu014_modo_ausencia_activo() AS r')).rows[0].r, false);
      await login();
    });
    await t.test('BIGINT mayor que Number.MAX_SAFE_INTEGER se devuelve intacto como texto', async () => {
      await db.exec(`RESET ROLE; SELECT setval('lead_codlea_seq',9007199254740992,true)`); await login();
      assert.equal((await crear()).codlea, '9007199254740993');
    });
    await t.test('no hay escritura/lectura directa, helper público ni acceso anónimo a RPC', async () => {
      for (const sql of ['SELECT * FROM lead','SELECT * FROM seguimientolead',
        "INSERT INTO lead(nomlea,orilea,canlea) VALUES('QA','QA','QA')", 'UPDATE lead SET estlea=\'Convertido\'',
        "SELECT hu014_normalizar_movil('987654321')"]) await fallo(sql, '42501');
      await db.exec('RESET ROLE; SET ROLE anon');
      await rechaza({}, '42501');
      await login(4); await rechaza({}, '42501');
      await db.exec("RESET ROLE; UPDATE usuario SET estusu=false WHERE codusu=1"); await login(); await rechaza({}, '42501');
      await db.exec("RESET ROLE; UPDATE usuario SET estusu=true WHERE codusu=1; UPDATE rol SET estrol=false WHERE codrol=1");
      await login(); await rechaza({}, '42501');
    });
  } finally { await db.close(); }
});
