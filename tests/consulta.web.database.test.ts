import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { baseConsultaWeb, MIGRACION_WEB } from './helpers/consulta.web.fixture';

test('HU011 PostgreSQL: consulta pública, idempotencia, asignación y aislamiento', async t => {
  const db = await baseConsultaWeb();
  const owner = () => db.exec('RESET ROLE');
  const anon = () => db.exec('RESET ROLE; SET ROLE anon');
  const login = (n: number) => db.exec(`RESET ROLE; SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000${n}',false)`);
  const enviar = async (c: Record<string, unknown> = {}) => {
    const d = { nombre:'PRUEBA QA CODEX', telefono:'987654321', modelo:null, color:null, sede:1,
      mensaje:'¿Horario?', tipo:'Consulta general', clave:randomUUID(), acepta:true, version:'2026-10', contexto:null, ...c };
    await anon();
    return (await db.query<{ r: { codigo: string; repetido: boolean } }>(
      'SELECT public.web_registrar_interesado($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10,$11) r',
      [d.nombre,d.telefono,d.modelo,d.color,d.sede,d.mensaje,d.tipo,d.clave,d.acepta,d.version,d.contexto])).rows[0]!.r;
  };
  const cuenta = async () => { await owner(); return (await db.query<{ n:number }>('SELECT count(*)::int n FROM lead')).rows[0]!.n; };
  const invalido = async (c: Record<string, unknown>, code='PT400') => {
    const antes=await cuenta();
    await assert.rejects(enviar(c),(e:any)=>e.code===code);
    assert.equal(await cuenta(),antes,'no deja un lead parcial');
  };
  try {
    await t.test('consulta sin modelo persiste Web/Nuevo/Sin asignar y no inventa seguimiento o venta', async()=>{
      const r=await enviar(); assert.match(r.codigo,/^W-[0-9a-f-]{36}$/); assert.equal(r.repetido,false);
      assert.deepEqual(Object.keys(r).sort(),['codigo','repetido']);
      await owner(); const l=(await db.query<any>('SELECT * FROM lead')).rows[0];
      assert.equal(l.codmod,null); assert.equal(l.codusu,null); assert.equal(l.codcli,null);
      assert.equal(l.orilea,'Web'); assert.equal(l.estlea,'Nuevo'); assert.equal(l.codsed,1);
      assert.match(l.obslea,/Consulta general: ¿Horario\?/);
      for(const tabla of ['seguimientolead','venta','separacion','unidad']) assert.equal((await db.query<any>(`SELECT count(*)::int n FROM ${tabla}`)).rows[0].n,0);
    });
    await t.test('cotización exige modelo publicado, admite cero stock y comentario vacío',async()=>{
      await enviar({tipo:'Cotización',modelo:1,mensaje:'',contexto:'Techo por definir'});
      for(const modelo of [null,2,999]) await invalido({tipo:'Cotización',modelo});
      await invalido({tipo:'Consulta general',modelo:2});
      await invalido({tipo:'Inventado'}); await invalido({tipo:null});
    });
    await t.test('500 caracteres aceptados, 501 rechazados y general vacío inválido',async()=>{
      for(const tipo of ['Cotización','Consulta general']) {
        await enviar({tipo,modelo:tipo==='Cotización'?1:null,mensaje:'a'.repeat(500)});
        await invalido({tipo,modelo:1,mensaje:'a'.repeat(501)});
      }
      await invalido({mensaje:'  \n '}); await enviar({mensaje:'¿'});
    });
    await t.test('nombres reales, extremos 2/150, control y solo números',async()=>{
      for(const nombre of ['Ál','Á'.repeat(150),"Ana-María O'Neill",'José D’Ávila','  José   Pérez  ']) await enviar({nombre});
      for(const nombre of ['A','A'.repeat(151),'1234','<script>','Ana\nPérez','  ']) await invalido({nombre});
    });
    await t.test('móvil peruano y prefijos sin truncamiento',async()=>{
      for(const telefono of ['987654321','+51 (987) 654-321','51 987.654.321']) {
        const r=await enviar({telefono}); await owner();
        const l=(await db.query<any>('SELECT l.tellea FROM lead l JOIN hu011_envio_web e USING(codlea) WHERE e.id=$1',[r.codigo.slice(2)])).rows[0];
        assert.equal(l.tellea,'987654321');
      }
      for(const telefono of ['+987654321','+52 987654321','519876543210','987abc321','123456789','0987654321','']) await invalido({telefono});
    });
    await t.test('sede requerida, activa y comercial; Ancón y fibrera rechazados',async()=>{
      for(const sede of [null,0,999,4,5]) await invalido({sede});
      await owner(); await db.exec('UPDATE sede SET estsed=false WHERE codsed=2');
      await invalido({sede:2}); await owner(); await db.exec('UPDATE sede SET estsed=true WHERE codsed=2');
      await enviar({sede:2}); await enviar({sede:3});
    });
    await t.test('consentimiento expreso y versión conocida, sin aceptar valores administrativos',async()=>{
      for(const c of [{acepta:false},{acepta:null},{version:'inventada'},{clave:null}]) await invalido(c);
      await owner();
      const args=(await db.query<any>(`SELECT proargnames FROM pg_proc WHERE oid='public.web_registrar_interesado(text,text,bigint,text,bigint,text,text,uuid,boolean,text,text)'::regprocedure`)).rows[0].proargnames;
      for(const a of ['p_codusu','p_estado','p_rol']) assert.equal(args.includes(a),false);
    });
    await t.test('reintento recupera acuse, cambio de payload no sobrescribe',async()=>{
      const clave=randomUUID(); const a=await enviar({clave}); const n=await cuenta();
      const b=await enviar({clave,telefono:'+51 987 654 321'});
      assert.equal(a.codigo,b.codigo); assert.equal(b.repetido,true); assert.equal(await cuenta(),n);
      await invalido({clave,mensaje:'Otra consulta'},'PT409');
      await enviar({telefono:'987654321',mensaje:'Otra solicitud legítima',sede:3});
      assert.equal(await cuenta(),n+1);
    });
    await t.test('dos solicitudes del mismo envío guardan una fila (PGlite: una conexión)',async()=>{
      const clave=randomUUID(); await anon();
      const args=['PRUEBA QA CODEX','987654321',null,null,1,'Prueba','Consulta general',clave,true,'2026-10',null];
      const q='SELECT public.web_registrar_interesado($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10,$11) r';
      const r=await Promise.all([db.query<any>(q,args),db.query<any>(q,args)]);
      assert.equal(r[0].rows[0].r.codigo,r[1].rows[0].r.codigo);
      assert.deepEqual(r.map(x=>x.rows[0].r.repetido).sort(),[false,true]);
    });
    await t.test('anon no lee ni escribe tablas ni usa firma pública antigua',async()=>{
      await anon(); for(const sql of ['SELECT * FROM lead','SELECT * FROM hu011_envio_web',"UPDATE lead SET nomlea='Manipulado'","SELECT public.web_registrar_interesado('X','987654321',1,null,1,'x','Cotización')"])
        await assert.rejects(db.exec(sql),(e:any)=>e.code==='42501');
    });
    await t.test('gerencia ve consulta sin modelo; asignación manual conserva sede e identidad',async()=>{
      const r=await enviar({sede:3}); await owner();
      const id=(await db.query<any>('SELECT codlea::text id FROM hu011_envio_web WHERE id=$1',[r.codigo.slice(2)])).rows[0].id;
      await login(1); let lista=(await db.query<any>('SELECT public.hu015_listar_leads(100,0) r')).rows[0].r;
      assert.ok(lista.some((x:any)=>x.codlea===id&&x.codmod===null&&x.codusu===null&&x.nomsed==='Ventanilla'));
      await db.query('SELECT public.hu015_asignar_responsable_lead($1,3,NULL,NULL)',[id]);
      await login(3); lista=(await db.query<any>('SELECT public.hu015_listar_leads(100,0) r')).rows[0].r;
      assert.ok(lista.some((x:any)=>x.codlea===id&&x.codusu==='3'&&x.nomsed==='Ventanilla'));
    });
    await t.test('migración reaplicable y replay posterior a retirar modelo no crea otro lead',async()=>{
      const clave=randomUUID(); const r=await enviar({clave,tipo:'Cotización',modelo:1}); const n=await cuenta();
      await db.exec(readFileSync(MIGRACION_WEB,'utf8')); await db.exec("UPDATE modelo SET estmod='No publicado' WHERE codmod=1");
      assert.equal((await enviar({clave,tipo:'Cotización',modelo:1})).codigo,r.codigo); assert.equal(await cuenta(),n);
      await owner(); await db.exec("UPDATE modelo SET estmod='Publicado' WHERE codmod=1");
    });
    await t.test('alta manual conserva autenticación, modelo, responsable y seguimiento',async()=>{
      const q="SELECT public.hu014_registrar_lead_manual('PRUEBA QA CODEX MANUAL','988111222',$1,'Llamada','Nuevo',$2,CURRENT_TIMESTAMP+interval '1 day')";
      await anon(); await assert.rejects(db.query(q,[1,3]),(e:any)=>e.code==='42501');
      await login(1); await assert.rejects(db.query(q,[null,3]),(e:any)=>e.code==='PT400');
      await assert.rejects(db.query(q,[1,null]),(e:any)=>e.code==='PT400');
      await db.query(q,[1,3]);
    });
    await t.test('fallo después del INSERT revierte lead y acuse juntos',async()=>{
      await owner(); await db.exec(`CREATE FUNCTION hu011_fallo_qa() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRUEBA QA CODEX fallo de persistencia'; END $$;
        CREATE TRIGGER hu011_fallo_qa BEFORE INSERT ON hu011_envio_web FOR EACH ROW EXECUTE FUNCTION hu011_fallo_qa()`);
      await invalido({mensaje:'Rollback'},'P0001'); await owner(); await db.exec('DROP TRIGGER hu011_fallo_qa ON hu011_envio_web');
    });
    await t.test('freno servidor permite replay aunque la ventana esté completa',async()=>{
      await owner(); await db.exec("UPDATE hu011_envio_web SET aceptado_en=CURRENT_TIMESTAMP-interval '11 minutes'");
      const clave=randomUUID(); await enviar({clave});
      for(let i=1;i<40;i++) await enviar({mensaje:`PRUEBA QA CODEX ${i}`});
      await invalido({mensaje:'Sobre el límite'},'PT429');
      assert.equal((await enviar({clave})).repetido,true);
    });
  } finally { await db.close(); }
});
