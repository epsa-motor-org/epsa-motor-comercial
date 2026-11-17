// Prueba opt-in: crea PostgreSQL/PostgREST efímeros en Docker y solo datos locales.
// No utiliza configuración ni claves de proyectos. GoTrue se sustituye solo en esta fábrica;
// JWT, perfil, permisos SQL, RPC, transacciones y HTTP sí atraviesan PostgREST real.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as esperar } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crearApp } from '../src/app';

const sufijo = randomBytes(4).toString('hex');
const red = `epsa-hu006-qa-${sufijo}`, db = `${red}-db`, rest = `${red}-rest`;
const clave = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('hex');
const uuids = [1, 2, 3, 4].map(n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`);
let servidor: Server | undefined;
const recursos: string[] = [];
let tieneRed = false;
const docker = (...args: string[]) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw Error(`Docker ${args[0]}: ${r.stderr.slice(0,300)}`);
  return r.stdout.trim();
};
const sql = (texto: string, database = 'epsa_qa') => {
  const r = spawnSync('docker', ['exec','-i',db,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],
    { input: texto, encoding:'utf8', windowsHide:true });
  if (r.status !== 0) throw Error(`SQL local: ${r.stderr.slice(-1800)}`);
  return r.stdout.trim();
};
const literal = (v: string) => `'${v.replace(/'/g,"''")}'`;
const token = (sub: string) => {
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',clave).update(`${h}.${p}`).digest('base64url')}`;
};
const migrations = [
  '202610030001_hu026_ubicaciones.sql','202610040001_hu034_compra_pendiente.sql',
  '202610060001_hu002_identificacion_unidades.sql','202610070001_hu007_permisos_rol.sql',
  '202610070002_hu012_modelos_publicados.sql','202610080001_hu004_configuracion_techo.sql',
  '202610080002_hu009_ficha_modelo.sql','202610190001_hu003_movimientos_ubicacion.sql',
  '202610210001_hu001_consulta_inventario.sql','202610280003_hu033_preparacion_unidad.sql',
  '202610100003_hu012_admin_modelos.sql','202610280004_hu001_preparacion_operativa.sql',
  '202611050001_hu005_separacion_moto.sql','202611060001_hu005_confirmador_transferencia.sql',
  '202611070001_hu005_comprador_evidencia.sql','202611080001_hu005_techo_y_venta.sql',
  '202611080002_hu005_decision_techo_y_tope.sql','202611080003_hu005_comprador_sin_documento.sql',
  '202611090001_hu005_decision_techo_y_precio_integracion.sql','202611090002_hu005_buscar_leads.sql',
  '202611090003_hu005_compatibilidad_techo_instalado.sql',
  '202611100001_hu006_venta_cliente_unidad.sql','202611100002_hu005_hu006_adelanto_minimo_y_venta_de_unidad.sql',
  '202611120001_hu006_desglose_precio_techo.sql','202611120002_hu006_listar_ventas.sql',
  '202611120003_hu005_adelanto_minimo.sql','202611120004_hu021_cancelaciones.sql',
  '202611130001_hu005_hu006_techo_configurado_y_catalogo.sql',
  '202611130002_hu022_correccion_relacion_venta.sql','202611130003_hu022_estado_unidad_movimiento_activo.sql',
  '202611140001_hu005_techo_solo_instalado.sql','202611140002_hu006_descuento_comercial.sql',
  '202611140003_hu021_cancelacion_estado_e_inmutabilidad.sql',
  '202611140004_hu022_techo_instalado_e_historial.sql','202611140005_movimiento_situacion_fisica_comercial.sql',
  '202611150002_hu005_hu006_reglas_po.sql'
];
const adaptacion = 'supabase/migrations/20261117072549_hu006_errores_http_controlados.sql';
const hoy = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date());
async function main() {
  docker('network','create',red); tieneRed = true;
  docker('run','-d','--name',db,'--network',red,'-e',`POSTGRES_PASSWORD=${password}`,
    '--tmpfs','/var/lib/postgresql/data','public.ecr.aws/supabase/postgres:17.11.0.018'); recursos.push(db);
  let listo = false;
  for (let i=0;i<40;i++) {
    const r=spawnSync('docker',['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres'],{windowsHide:true});
    if(r.status===0){listo=true;break;} await esperar(500);
  }
  assert.ok(listo,'PostgreSQL debe iniciar');
  sql('CREATE DATABASE epsa_qa; GRANT authenticated,anon TO postgres WITH SET TRUE;','postgres');
  sql(`CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
         nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,
      file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL,owner uuid,UNIQUE(bucket_id,name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
      $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
    GRANT SELECT,INSERT ON storage.objects TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  sql(readFileSync('tests/fixtures/esquema-base.sql','utf8'));
  for(const m of migrations) sql(readFileSync(`supabase/migrations/${m}`,'utf8'));
  sql(readFileSync(adaptacion,'utf8')); sql(readFileSync(adaptacion,'utf8')); // Reaplicación segura.
  sql(`INSERT INTO auth.users(id) VALUES ${uuids.map(x=>`(${literal(x)})`).join(',')};
    INSERT INTO rol(nomrol) VALUES ('Gerente'),('Administradora'),('Vendedor');
    INSERT INTO usuario(uuidusu,codrol,nomusu,apepatusu,corusu) VALUES
      ('${uuids[0]}',1,'PRUEBA QA CODEX','Gerente','gerente@example.test'),
      ('${uuids[1]}',2,'PRUEBA QA CODEX','Admin','admin@example.test'),
      ('${uuids[2]}',3,'PRUEBA QA CODEX','Vendedor Uno','vendedor1@example.test'),
      ('${uuids[3]}',3,'PRUEBA QA CODEX','Vendedor Dos','vendedor2@example.test');
    INSERT INTO tipomotocar(nomtmo) VALUES ('EPSA-TEST');
    INSERT INTO modelo(codtmo,nommod,desmod,carmod,premod) VALUES (1,'EPSA-TEST','PRUEBA QA CODEX','PRUEBA QA CODEX',18335);
    INSERT INTO cliente(nomcli) VALUES ('PRUEBA QA CODEX Comprador');
    INSERT INTO ubicacion(nomubi,tipubi) VALUES ('Comas EPSA-TEST','Sede');
    INSERT INTO sede(codubi) SELECT codubi FROM ubicacion WHERE nomubi='Comas EPSA-TEST';
    INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES (1,1,'Azul',8);
    INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu)
      VALUES (1,'QA','EPSA-TEST-FACTURA','${hoy}',8,1);
    INSERT INTO unidad(codcom,codmod,nummotuni,chauni,coluni)
      SELECT 1,1,'EPSA-TEST-MOT-'||i,'EPSA-TEST-VIN-'||i,'Azul' FROM generate_series(1,8) i;`);
  docker('run','-d','--name',rest,'--network',red,'-p','127.0.0.1::3000',
    '-e',`PGRST_DB_URI=postgresql://postgres:${password}@${db}:5432/epsa_qa`,
    '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${clave}`,
    'public.ecr.aws/supabase/postgrest:v16.5'); recursos.push(rest);
  const port=Number(docker('port',rest,'3000').split(':').pop());
  assert.ok(port>0); const restUrl=`http://127.0.0.1:${port}`;
  const clientes = new Map<string,SupabaseClient>();
  const tokens=uuids.map(token);
  const fabrica = (bearer:string) => {
    assert.ok(tokens.includes(bearer),'solo identidades sintéticas de esta ejecución');
    if(clientes.has(bearer))return clientes.get(bearer)!;
    const c=createClient(restUrl,'local-qa-placeholder',{auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:`Bearer ${bearer}`},
        fetch:(u,o)=>fetch(String(u).replace('/rest/v1/','/'),o)}});
    c.auth.getUser=async()=>({data:{user:{id:uuids[tokens.indexOf(bearer)]} as never},error:null});
    clientes.set(bearer,c); return c;
  };
  // Espera a disponibilidad real; las RPC de perfil también pasan por PostgREST.
  let perfil;
  for(let i=0;i<40;i++){perfil=await fabrica(tokens[2]!).rpc('hu007_usuario_actual');if(!perfil.error)break;await esperar(250);}
  assert.equal(perfil?.error,null,JSON.stringify(perfil?.error));
  servidor=crearApp(fabrica).listen(0,'127.0.0.1');
  await new Promise<void>(r=>servidor!.once('listening',r));
  const api=`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const datos=(responsable=3)=>({codcli:1,codusuResponsable:responsable,codsedAtencion:1,fechaVenta:hoy,
    modalidad:'Crédito',pagos:[],techo:{decision:'Por definir'},observacion:'PRUEBA QA CODEX local'});
  const request=async(path:string,rol=2,method='GET',body?:unknown,key=randomUUID())=>{
    const r=await fetch(api+path,{method,headers:{Authorization:`Bearer ${tokens[rol]}`,
      'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  // No hay mocks de RPC ni serialización PGlite: dos peticiones y conexiones reales.
  const carrera=await Promise.all([request('/api/unidades/1/ventas',2,'POST',datos(3)),
    request('/api/unidades/1/ventas',3,'POST',datos(4))]);
  assert.deepEqual(carrera.map(x=>x.status).sort(),[201,409]);
  assert.equal(sql('SELECT count(*) FROM venta WHERE coduni=1'),'1');
  assert.match(carrera.find(x=>x.status===409)!.body.message,/venta|estado comercial/);
  console.log('APROBADO: dos vendedores simultáneos → 201/409; una sola venta persistida');
  const legado=await fabrica(tokens[2]!).rpc('hu006_crear_venta',{
    p_coduni:1,p_codcli:1,p_codusuresp:3,p_codsedatencion:1,p_fecven:hoy,p_modcomven:'Crédito',
    p_adicionalacordado:null,p_codsedentregaprevista:null,p_pagos:[],p_techo:{decision:'Por definir'},
    p_refcompven:null,p_feccompven:null,p_obsven:'PRUEBA QA CODEX',p_idempotenciaven:randomUUID(),
    p_descuento:0,p_motivodescuento:null,p_codusuautorizadesc:null,p_conftelefonicadesc:false});
  assert.equal(legado.status,604);assert.equal(legado.error?.code,'PT604');
  console.log('APROBADO: reproducción del transporte legado PT604 → HTTP604');
  const manipulado=await request('/api/unidades/2/ventas',2,'POST',datos(4));
  assert.equal(manipulado.status,403);assert.equal(sql('SELECT count(*) FROM venta WHERE coduni=2'),'0');
  console.log('APROBADO: responsable manipulado → 403; ninguna venta creada');
  const claveReplay=randomUUID();
  const nueva=await request('/api/unidades/2/ventas',2,'POST',datos(3),claveReplay);
  assert.equal(nueva.status,201,JSON.stringify(nueva));
  const replay=await request('/api/unidades/2/ventas',2,'POST',datos(3),claveReplay);
  assert.equal(replay.status,200);assert.equal(replay.body.data.codven,nueva.body.data.codven);
  assert.equal(sql('SELECT count(*) FROM venta WHERE coduni=2'),'1');
  console.log('APROBADO: reintento idempotente → misma venta 200 sin duplicación');
  const idsLona=sql("SELECT codtte FROM tipotecho WHERE nomtte='Lona'");
  const login=`SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${uuids[2]}"}',false);`;
  sql(`${login} SELECT hu005_crear_separacion(3,1,3,NULL,100,'${hoy}','Efectivo',NULL,NULL,
    'PRUEBA QA CODEX recepción ficticia',true,'${randomUUID()}'::uuid,'Por definir',NULL);`);
  const conversion=await request('/api/unidades/3/ventas',2,'POST',{...datos(3),
    techo:{decision:'Con techo',codtte:Number(idsLona)},adicionalTechoAcordado:200,
    descuento:300,motivoDescuento:'PRUEBA QA CODEX descuento autorizado',codusuAutorizadorDescuento:1,
    confirmacionTelefonicaRecibida:true});
  assert.equal(conversion.status,201,JSON.stringify(conversion));
  const v=conversion.body.data;
  assert.equal(v.importe,18235); assert.equal(v.totalRecibido,100);assert.equal(v.saldo,18135);
  const ficha=await request('/api/unidades/3/venta'); assert.equal(ficha.status,200);
  assert.equal(ficha.body.data.importe,18235);assert.equal(ficha.body.data.totalRecibido,100);
  assert.equal(ficha.body.data.saldo,18135);
  assert.equal(sql('SELECT count(*) FROM venta WHERE coduni=3'),'1');
  console.log('APROBADO: conversión, techo200, descuento300 y adelanto100 → total18235/saldo18135 persistidos');
  const roof=await request(`/api/ventas/${v.codven}/techo`,2,'PUT',{decision:'Sin techo'});
  assert.equal(roof.status,409,JSON.stringify(roof));
  console.log('APROBADO: decisión final distinta → conflicto409');
  const listado=await request('/api/ventas?limite=10');assert.equal(listado.status,200);
  const comprobante=await request(`/api/ventas/${v.codven}/comprobante`,2,'PUT',{referencia:'B001-123456',fecha:hoy});
  assert.equal(comprobante.status,200,JSON.stringify(comprobante));
  console.log('APROBADO: listado y referencia de comprobante externos por adaptadores reales');
  const anon=await fetch(`${restUrl}/rpc/hu006_venta_de_unidad_http`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"p_coduni":3}'});
  assert.ok([401,403].includes(anon.status));
  assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hu006%http' AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE'))"),'0');
  console.log('APROBADO: adaptadores SECURITY INVOKER y acceso anónimo denegado');
  console.log('Todas las comprobaciones finalizaron. Solo datos sintéticos en Docker efímero; no producción.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(servidor){servidor.closeAllConnections();await new Promise<void>(r=>servidor!.close(()=>r()));}
  for(const recurso of recursos.reverse())docker('rm','-f',recurso);
  if(tieneRed)docker('network','rm',red);
});
