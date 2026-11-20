import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basePedido, IDENTIDADES_PEDIDO, MIGRACION_PEDIDO } from './helpers/pedido.fixture';

test('HU-031: persistencia, catálogo, permisos e idempotencia sin inventario ficticio', async t => {
  const db = await basePedido();
  const login = async (i:number) => db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${IDENTIDADES_PEDIDO[i]}',false);`);
  const val = async <T=any>(sql:string,args:unknown[]=[]) => (await db.query<{r:T}>(sql,args)).rows[0]!.r;
  const crear = (datos:Record<string,unknown>,key=randomUUID()) => val('SELECT public.hu031_crear_pedido($1::jsonb,$2::uuid) r',[JSON.stringify(datos),key]);
  const datos = () => ({codcli:1,codmod:1,codusuResponsable:3,codsedAtencion:1,techo:{decision:'Por definir'}});
  const falla = (code:string) => (e:unknown) => (e as {code:string}).code === code;
  try {
    await login(0);
    await t.test('pedido sin unidad, sin pagos, sin stock y consulta persistida', async () => {
      const r = await crear(datos());
      assert.equal(r.pedido.estado,'Pendiente de unidad'); assert.equal(r.pedido.coduniPropuesta,null);
      assert.equal(r.pedido.techo.decision,'Por definir');assert.equal(r.pedido.precioReferencia.total,18335);
      const leido=await val('SELECT public.hu031_consultar_pedidos($1) r',[r.pedido.codped]);
      assert.equal(leido.codped,r.pedido.codped);assert.equal(leido.historial.length,1);
      await db.exec('RESET ROLE');
      for(const tabla of ['unidad','separacion','venta','pagoventa']) assert.equal(await val(`SELECT count(*)::int r FROM ${tabla}`),0);
      await login(0);
    });
    await t.test('reintento conserva un pedido; misma clave con otro cuerpo da409',async()=>{
      const k=randomUUID();const a=await crear(datos(),k);const b=await crear(datos(),k);
      assert.equal(b.reutilizada,true);assert.equal(a.pedido.codped,b.pedido.codped);assert.equal(b.pedido.historial.length,1);
      await assert.rejects(()=>crear({...datos(),color:'Rojo'},k),falla('PT409'));
    });
    await t.test('dos pedidos legítimos del mismo comprador no se fusionan',async()=>{
      const a=await crear(datos());const b=await crear(datos());assert.notEqual(a.pedido.codped,b.pedido.codped);
    });
    await t.test('buscar comprador permite selección explícita, sin exponer documento ni crear otro',async()=>{
      await login(0);const c=await val('SELECT public.hu031_buscar_compradores($1) r',['987654323']);
      assert.equal(c.length,1);assert.equal(c[0].codcli,'1');assert.equal(c[0].nombres,'PRUEBA QA CODEX');
      assert.equal(c[0].numdoccli,undefined);
      await assert.rejects(()=>val('SELECT public.hu031_buscar_compradores($1) r',['%']),falla('PT400'));
      assert.deepEqual(await val('SELECT public.hu031_buscar_compradores($1) r',['%%']),[]);
    });
    await t.test('catálogo y adicional no dependen de stock disponible',async()=>{
      const f=await val('SELECT public.hu031_formulario() r');assert.equal(f.modelos[0].codmod,'1');assert.equal(f.sedes.length,1);
      const lona=f.tiposTecho.find((x:any)=>x.nombre==='Lona');assert.ok(lona);
      const r=await crear({...datos(),techo:{decision:'Con techo',codtte:Number(lona.codtte)}});
      assert.equal(r.pedido.precioReferencia.adicional,200);assert.equal(r.pedido.precioReferencia.total,18535);
    });
    await t.test('vendedor no puede crear a nombre de otro responsable',async()=>{
      await login(2);await assert.rejects(()=>crear({...datos(),codusuResponsable:4}),falla('PT403'));
      const r=await crear(datos());assert.equal(r.pedido.responsable.codusu,'3');
    });
    await t.test('consulta limitada al responsable vigente; gestión ve ambos',async()=>{
      await login(3);const propio=await crear({...datos(),codusuResponsable:4});
      await login(2);await assert.rejects(()=>val('SELECT public.hu031_consultar_pedidos($1) r',[propio.pedido.codped]),falla('PT404'));
      const lista=await val('SELECT public.hu031_consultar_pedidos() r');assert.ok(lista.items.every((x:any)=>x.responsable.codusu==='3'));
      await login(1);assert.equal((await val('SELECT public.hu031_consultar_pedidos($1) r',[propio.pedido.codped])).codped,propio.pedido.codped);
    });
    await t.test('referencias inválidas y campos inyectados no crean un pedido',async()=>{
      await login(0);
      for(const d of [{...datos(),codcli:99999},{...datos(),codsedAtencion:99999},{...datos(),codmod:99999}])await assert.rejects(()=>crear(d),falla('PT422'));
      await assert.rejects(()=>crear({...datos(),coduni:888}),falla('PT400'));
      await assert.rejects(()=>crear({...datos(),techo:{decision:'Con techo',codtte:99999}}),falla('PT422'));
    });
    await t.test('RLS y privilegios impiden modificar tablas o invocar como anónimo',async()=>{
      await assert.rejects(()=>db.query('SELECT * FROM public.pedidocliente'),falla('42501'));
      await assert.rejects(()=>db.query("INSERT INTO public.pedidocliente DEFAULT VALUES"),falla('42501'));
      await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(()=>val('SELECT public.hu031_formulario() r'),falla('42501'));
      await login(0);
    });
    await t.test('usuario desactivado pierde permiso también dentro de RPC',async()=>{
      await db.exec('RESET ROLE; UPDATE usuario SET estusu=false WHERE codusu=4');await login(3);
      await assert.rejects(()=>val('SELECT public.hu031_consultar_pedidos() r'),falla('42501'));
      await db.exec('RESET ROLE; UPDATE usuario SET estusu=true WHERE codusu=4');await login(0);
    });
    await t.test('reaplicar migración conserva pedidos, RLS y firmas privadas',async()=>{
      await db.exec('RESET ROLE');const antes=await val('SELECT count(*)::int r FROM public.pedidocliente');
      await db.exec(readFileSync(`supabase/migrations/${MIGRACION_PEDIDO}`,'utf8'));
      await db.exec(readFileSync('supabase/migrations/20261120031744_hu031_adelantos_y_continuidad.sql','utf8'));
      assert.equal(await val('SELECT count(*)::int r FROM public.pedidocliente'),antes);
      assert.equal(await val("SELECT count(*)::int r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hu031%' AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE'))"),0);
      await login(0);
    });
  } finally {await db.close();}
});
