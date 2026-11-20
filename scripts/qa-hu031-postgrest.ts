// Opt-in: solo PostgreSQL/PostgREST efímeros en Docker. Nunca un proyecto alojado.
// GoTrue se sustituye en la fábrica; JWT, identidad SQL, RPC, RLS, transacciones y
// dos conexiones concurrentes son reales. Los tokens locales no se imprimen.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes,randomUUID,createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';
import { MIGRACIONES_PEDIDO,SQL_IDENTIDAD_PEDIDO,SQL_DATOS_PEDIDO,IDENTIDADES_PEDIDO } from '../tests/helpers/pedido.fixture';
const sufijo=randomBytes(4).toString('hex'),red=`epsa-hu031-qa-${sufijo}`,db=`${red}-db`,rest=`${red}-rest`;
const clave=randomBytes(32).toString('hex'),password=randomBytes(24).toString('hex');
let servidor:Server|undefined;let vista:{close:()=>Promise<void>}|undefined;let finalizarVista=()=>{};const recursos:string[]=[];let tieneRed=false;
const docker=(...args:string[])=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(`Docker ${args[0]}: ${r.stderr.slice(0,500)}`);return r.stdout.trim();};
const sql=(texto:string,database='epsa_qa')=>{const r=spawnSync('docker',['exec','-i',db,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],{input:texto,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(`SQL local: ${r.stderr.slice(-2200)}`);return r.stdout.trim();};
const token=(sub:string)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.${createHmac('sha256',clave).update(`${h}.${p}`).digest('base64url')}`;};
async function main(){
 docker('network','create',red);tieneRed=true;
 docker('run','-d','--name',db,'--network',red,'-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,'--tmpfs','/var/lib/postgresql/data','public.ecr.aws/supabase/postgres:17.11.0.018');recursos.push(db);
 let listo=false;for(let i=0;i<50;i++){if(spawnSync('docker',['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres'],{windowsHide:true}).status===0){listo=true;break;}await esperar(500);}assert.ok(listo);
 sql('CREATE DATABASE epsa_qa;GRANT authenticated,anon TO postgres WITH SET TRUE;','postgres');
 sql(SQL_IDENTIDAD_PEDIDO);sql(readFileSync('tests/fixtures/esquema-base.sql','utf8'));
 for(const n of MIGRACIONES_PEDIDO)sql(readFileSync(`supabase/migrations/${n}`,'utf8'));
 sql(SQL_DATOS_PEDIDO);
 // Reaplicación completa de ambas migraciones, sin resetear ni borrar datos.
 for(const n of MIGRACIONES_PEDIDO.slice(-2))sql(readFileSync(`supabase/migrations/${n}`,'utf8'));
 sql(`INSERT INTO compra(codmod,codusu,colcom,cancom)VALUES(1,1,'Rojo',6);
 INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu)VALUES(1,'QA','EPSA-TEST-FACTURA','2026-11-19',6,1);
 INSERT INTO unidad(codcom,codmod,nummotuni,chauni,coluni)SELECT 1,1,'EPSA-TEST-MOT-'||i,'EPSA-TEST-VIN-'||i,'Rojo' FROM generate_series(1,6)i;`);
 docker('run','-d','--name',rest,'--network',red,'-p','127.0.0.1::3000','-e',`PGRST_DB_URI=postgresql://postgres:${password}@${db}:5432/epsa_qa`,
 '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${clave}`,'public.ecr.aws/supabase/postgrest:v16.5');recursos.push(rest);
 const port=Number(docker('port',rest,'3000').split(':').pop());const restUrl=`http://127.0.0.1:${port}`;
 const tokens=IDENTIDADES_PEDIDO.map(token),clientes=new Map<string,SupabaseClient>();
 const fabrica=(bearer:string)=>{assert.ok(tokens.includes(bearer));if(clientes.has(bearer))return clientes.get(bearer)!;
 const c=createClient(restUrl,'local-qa-placeholder',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${bearer}`},fetch:(u,o)=>fetch(String(u).replace('/rest/v1/','/'),o)}});
 c.auth.getUser=async()=>({data:{user:{id:IDENTIDADES_PEDIDO[tokens.indexOf(bearer)]} as never},error:null});clientes.set(bearer,c);return c;};
 let perfil;for(let i=0;i<40;i++){perfil=await fabrica(tokens[0]!).rpc('hu007_usuario_actual');if(!perfil.error)break;await esperar(250);}assert.equal(perfil?.error,null,JSON.stringify(perfil?.error));
 servidor=crearApp(fabrica).listen(0,'127.0.0.1');await new Promise<void>(r=>servidor!.once('listening',r));const api=`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
 const request=async(path:string,role=0,method='GET',body?:unknown,key=randomUUID())=>{const r=await fetch(api+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 const datos=(resp=3)=>({codcli:1,codmod:1,codusuResponsable:resp,codsedAtencion:1,color:'Rojo',techo:{decision:'Por definir'}});
 const nuevo=async(resp=3)=>{const r=await request('/api/pedidos',0,'POST',datos(resp));assert.equal(r.status,201,JSON.stringify(r));return r.body.data.pedido;};
 const act=async(p:any,action:string,body:Record<string,unknown>,key=randomUUID())=>request(`/api/pedidos/${p.codped}/${action}`,0,'POST',{versionEsperada:p.version,...body},key);
 assert.equal((await request('/api/pedidos/formulario')).status,200);
 const compradores=await request('/api/pedidos/compradores?q=987654323');assert.equal(compradores.status,200);assert.equal(compradores.body.data[0].codcli,'1');
 assert.equal((await request('/api/pedidos/compradores?q=x')).status,400);
 const k=randomUUID(),a=await request('/api/pedidos',0,'POST',datos(),k),b=await request('/api/pedidos',0,'POST',datos(),k);
 assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(a.body.data.pedido.codped,b.body.data.pedido.codped);
 assert.equal((await request('/api/pedidos',2,'POST',datos(4))).status,403);
 assert.equal((await request(`/api/pedidos/${a.body.data.pedido.codped}`,3)).status,404);
 console.log('APROBADO: crear/listar/consultar por HTTP real, reintento200 y permisos403/404');
 const malformed=await request('/api/pedidos',0,'POST',{...datos(),techo:{decision:'Por definir',codtte:1}});assert.equal(malformed.status,400);
 assert.equal((await request('/api/pedidos?limite=999')).status,400);
 console.log('APROBADO: validación HTTP400 de techo/filtros sin pérdida de códigos PostgREST');
 let p=await nuevo();let r=await act(p,'adelanto',{monto:99.99,fecha:'2026-11-19',medioPago:'Efectivo',observacion:'PRUEBA QA CODEX',ingresoConfirmado:true});assert.equal(r.status,422,JSON.stringify(r));
 const pago={monto:100,fecha:'2026-11-19',medioPago:'Efectivo',observacion:'PRUEBA QA CODEX recibido',ingresoConfirmado:true};
 const kp=randomUUID();r=await act(p,'adelanto',pago,kp);assert.equal(r.status,200,JSON.stringify(r));assert.equal((await act(p,'adelanto',pago,kp)).body.data.pedido.pagos.length,1);
 assert.equal((await act(p,'adelanto',pago)).status,409);p=r.body.data.pedido;
 console.log('APROBADO: adelanto422 / válido200 / replay sin duplicación / versión antigua409 real');
 const cat=(await request('/api/pedidos/formulario')).body.data;const clasico=cat.tiposTecho.find((x:any)=>x.nombre==='Techo clásico de fibra');
 sql(`SELECT set_config('request.jwt.claim.sub','${IDENTIDADES_PEDIDO[0]}',false);UPDATE unidad SET codtte=${Number(clasico.codtte)} WHERE coduni=1;UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=1;`);
 assert.equal((await act(p,'proponer',{coduni:1})).status,422);
 r=await act(p,'proponer',{coduni:1,adecuacionAceptada:true});assert.equal(r.status,200,JSON.stringify(r));p=r.body.data.pedido;
 const kc=randomUUID();r=await act(p,'continuar',{destino:'Venta',modalidad:'Crédito',adecuacionAceptada:true,descuento:300,motivoDescuento:'PRUEBA QA CODEX autorizado',codusuAutorizadorDescuento:1,confirmacionTelefonicaRecibida:true},kc);
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.pedido.totalRecibido,100);assert.equal(r.body.data.pedido.techo.decision,'Por definir');
 assert.equal(r.body.data.pedido.operacion.venta.total,18035);assert.equal(r.body.data.pedido.operacion.venta.saldo,17935);
 const venta=await request('/api/unidades/1/venta');assert.equal(venta.status,200);assert.equal(venta.body.data.importe,18035);assert.equal(venta.body.data.totalRecibido,100);assert.equal(venta.body.data.saldo,17935);
 assert.equal(sql(`SELECT count(*) FROM pagoventa WHERE codven=${Number(r.body.data.pedido.codven)}`),'0');
 assert.equal(sql('SELECT codtte FROM unidad WHERE coduni=1'),String(clasico.codtte));
 console.log('APROBADO: pedido→venta con techo físico anterior, Por definir, descuento y adelanto una sola vez');
 let p1=await nuevo(),p2=await nuevo();p1=(await act(p1,'proponer',{coduni:2})).body.data.pedido;p2=(await act(p2,'proponer',{coduni:2})).body.data.pedido;
 assert.equal(sql('SELECT estcomuni FROM unidad WHERE coduni=2'),'Disponible');
 const carrera=await Promise.all([act(p1,'continuar',{destino:'Venta',modalidad:'Crédito'}),act(p2,'continuar',{destino:'Venta',modalidad:'Crédito'})]);
 assert.deepEqual(carrera.map(x=>x.status).sort(),[200,409],JSON.stringify(carrera));assert.equal(sql('SELECT count(*) FROM venta WHERE coduni=2'),'1');
 console.log('APROBADO: dos conexiones sobre unidad propuesta → 200/409, una venta, sin doble compromiso');
 const cancel=await request(`/api/pedidos/${p.codped}/cancelar`,0,'POST',{versionEsperada:r.body.data.pedido.version,motivo:'PRUEBA QA CODEX'});assert.equal(cancel.status,409);
 const an=await fetch(`${restUrl}/rpc/hu031_consultar_pedidos`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.ok([401,403].includes(an.status));
 assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hu031%' AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE'))"),'0');
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('pedidocliente','pagopedidocliente','pedidoclienteevento','pedidoclienteintento') AND (NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'INSERT'))"),'0');
 console.log('APROBADO: pedido vinculado no elude HU021; anónimo denegado; RLS y funciones privadas verificados');
 console.log('QA HU031 finalizado: solo datos sintéticos locales; ninguna operación de producción.');
 if(process.argv.includes('--serve')){
   // Arnés opt-in para inspeccionar la aplicación real en el navegador. Solo la
   // sesión inicial y GoTrue son sintéticos; API, JWT SQL y persistencia son reales.
   const {createServer}=await import(pathToFileURL(resolve('frontend/node_modules/vite/dist/node/index.js')).href);
   process.chdir(resolve('frontend'));
   const origin='http://127.0.0.1:5178';
   vista=await createServer({root:process.cwd(),configFile:resolve('vite.config.js'),
    define:{__EPSA_API_URL__:JSON.stringify(api),__EPSA_SUPABASE_URL__:JSON.stringify(origin),__EPSA_SUPABASE_ANON_KEY__:JSON.stringify('local-qa-placeholder')},
    server:{host:'127.0.0.1',port:5178,strictPort:true,proxy:{'/rest/v1':{target:restUrl,rewrite:(p:string)=>p.replace('/rest/v1','')}}},
    plugins:[{name:'hu031-qa-local',configureServer(v:any){v.middlewares.use(async(req:any,res:any,next:any)=>{
     if(req.url==='/qa-hu031/stop'){res.end('Finalizando QA local');setTimeout(()=>finalizarVista(),100);return;}
     if(!req.url?.startsWith('/qa-hu031'))return next();
     const role=new URL(req.url,origin).searchParams.get('rol')==='vendedor'?2:0;
     const user={v:4,nombre:role?'PRUEBA QA CODEX Vendedor Uno':'PRUEBA QA CODEX Gerente',rol:role?'vendedor':'gerente',codusu:String(role+1)};
     const html=await v.transformIndexHtml('/index.html',`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EPSA · QA local HU031</title></head><body><div id="root"></div><script>sessionStorage.setItem('epsa-user',${JSON.stringify(JSON.stringify(user))});sessionStorage.setItem('epsa-sesion',${JSON.stringify(JSON.stringify({access_token:tokens[role]}))});history.replaceState(null,'','/admin/pedidos');</script><script type="module" src="/src/main.jsx"></script></body></html>`);
     res.setHeader('Content-Type','text/html');res.end(html);
    });}}]});
   await (vista as any).listen();
   console.log('UI LOCAL: http://127.0.0.1:5178/qa-hu031 (gerente) o ?rol=vendedor; Ctrl+C finaliza y limpia los contenedores propios (máximo 20 minutos).');
   console.log('Puerto PostgreSQL local para advisors: '+docker('port',db,'5432').split(':').pop());
   await new Promise<void>(done=>{const fin=setTimeout(done,20*60*1000);finalizarVista=()=>{clearTimeout(fin);done();};process.once('SIGINT',finalizarVista);});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(vista)await vista.close();if(servidor){servidor.closeAllConnections();await new Promise<void>(r=>servidor!.close(()=>r()));}for(const n of recursos.reverse())docker('rm','-f',n);if(tieneRed)docker('network','rm',red);});
