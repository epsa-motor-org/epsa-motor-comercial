import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { basePedido, IDENTIDADES_PEDIDO } from './helpers/pedido.fixture';

test('HU-031: adelantos, propuesta, continuidad atómica, cancelación y techo físico',async t=>{
 const db=await basePedido();
 const login=async(i=0)=>db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${IDENTIDADES_PEDIDO[i]}',false)`);
 const val=async<T=any>(sql:string,args:unknown[]=[]) => (await db.query<{r:T}>(sql,args)).rows[0]!.r;
 const own=async<T>(fn:()=>Promise<T>)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await login();}};
 const datos=()=>({codcli:1,codmod:1,codusuResponsable:3,codsedAtencion:1,color:'Rojo',techo:{decision:'Por definir'}});
 const crear=async(extra:Record<string,unknown>={})=>(await val('SELECT public.hu031_crear_pedido($1::jsonb,$2::uuid) r',[JSON.stringify({...datos(),...extra}),randomUUID()])).pedido;
 const act=async(p:any,accion:string,d:Record<string,unknown>,key=randomUUID())=>(await val('SELECT public.hu031_actualizar_pedido($1,$2,$3::jsonb,$4::uuid) r',[p.codped,accion,JSON.stringify({versionEsperada:p.version,...d}),key]));
 const pago=(monto=100)=>({monto,fecha:'2026-11-19',medioPago:'Efectivo',observacion:'PRUEBA QA CODEX recibido en caja',ingresoConfirmado:true});
 const error=(code:string)=>(e:unknown)=>(e as {code:string}).code===code;
 let unidad=0;
 const nuevaUnidad=async()=>own(async()=>{
   const n=++unidad;
   const c=await val("INSERT INTO compra(codmod,codusu,colcom,cancom) VALUES(1,1,'Rojo',1) RETURNING codcom::text r");
   await db.query("INSERT INTO factura_compra(codcom,emisor,numero,fecha_emision,cantidad_motos,codusu)VALUES($1,'QA',$2,'2026-11-19',1,1)",[c,`EPSA-TEST-FACTURA-${n}`]);
   return val("INSERT INTO unidad(codcom,codmod,nummotuni,chauni,coluni)VALUES($1,1,$2,$3,'Rojo')RETURNING coduni::text r",[c,`EPSA-TEST-MOT-${n}`,`EPSA-TEST-VIN-${n}`]);
 });
 try{
  await login();
  await t.test('adelanto sin unidad queda una vez; reintento no duplica',async()=>{
    const p=await crear();const k=randomUUID();const a=await act(p,'adelanto',pago(),k);const b=await act(p,'adelanto',pago(),k);
    assert.equal(a.pedido.totalRecibido,100);assert.equal(b.reutilizada,true);assert.equal(b.pedido.pagos.length,1);assert.equal(b.pedido.coduniPropuesta,null);
  });
  await t.test('99.99, cero, negativo, exceso y futuro se rechazan sin recibo parcial',async()=>{
    const p=await crear();for(const d of [pago(99.99),pago(0),pago(-1),pago(999999),{...pago(),fecha:'2999-01-01'}])await assert.rejects(()=>act(p,'adelanto',d),error('PT422'));
    assert.equal((await val('SELECT public.hu031_consultar_pedidos($1) r',[p.codped])).totalRecibido,0);
  });
  await t.test('transferencia exige evidencia propia del pedido y gerente activo',async()=>{
    const p=await crear();const ruta=`pedidos/${p.codped}/${randomUUID()}.pdf`;
    const d={...pago(),medioPago:'Transferencia',referencia:'EPSA-TEST-OP',rutaEvidencia:ruta,codusuConfirmador:1};
    await assert.rejects(()=>act(p,'adelanto',d),error('PT422'));
    await own(()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner)VALUES('pedidos-evidencia',$1,$2)",[ruta,IDENTIDADES_PEDIDO[0]]));
    const a=await act(p,'adelanto',d);assert.equal(a.pedido.pagos[0].rutaEvidencia,ruta);assert.equal(a.pedido.pagos[0].confirmadoPor,'1');
    const otro=await crear();await assert.rejects(()=>act(otro,'adelanto',d),error('PT422'));
  });
  await t.test('propuesta sin adelanto conserva stock libre; tercero puede vender',async()=>{
    const p=await crear();const u=await nuevaUnidad();const x=(await act(p,'proponer',{coduni:u})).pedido;
    assert.equal(x.estado,'Unidad propuesta');assert.equal(await own(()=>val('SELECT estcomuni r FROM unidad WHERE coduni=$1',[u])),'Disponible');
    await own(()=>db.query("INSERT INTO venta(coduni,codcli,codusu,modcomven)VALUES($1,1,1,'Crédito')",[u]));
    await assert.rejects(()=>act(x,'continuar',{destino:'Venta',modalidad:'Crédito'}),error('PT409'));
    assert.equal((await val('SELECT public.hu031_consultar_pedidos($1) r',[p.codped])).estado,'Unidad propuesta');
  });
  await t.test('sin adelanto no crea separación ni pago cero',async()=>{
    const p=await crear();const u=await nuevaUnidad();const x=(await act(p,'proponer',{coduni:u})).pedido;
    await assert.rejects(()=>act(x,'continuar',{destino:'Separacion'}),error('PT422'));
    assert.equal(await own(()=>val('SELECT count(*)::int r FROM separacion WHERE coduni=$1',[u])),0);
  });
  await t.test('venta a crédito sin adelanto constituye compromiso legítimo',async()=>{
    const p=await crear();const u=await nuevaUnidad();const x=(await act(p,'proponer',{coduni:u})).pedido;
    const y=(await act(x,'continuar',{destino:'Venta',modalidad:'Crédito'})).pedido;
    assert.equal(y.estado,'Vinculado');assert.ok(y.codven);assert.equal(y.codsep,null);assert.equal(y.totalRecibido,0);
    assert.equal(await own(()=>val('SELECT estcomuni r FROM unidad WHERE coduni=$1',[u])),'Vendida');
  });
  await t.test('varios recibos originales se conservan en separación sin duplicar pagoventa',async()=>{
    let p=await crear();p=(await act(p,'adelanto',pago(100))).pedido;p=(await act(p,'adelanto',pago(50))).pedido;
    const u=await nuevaUnidad();p=(await act(p,'proponer',{coduni:u})).pedido;const k=randomUUID();const x=await act(p,'continuar',{destino:'Separacion'},k);
    assert.equal(x.pedido.totalRecibido,150);assert.equal(x.pedido.pagos.length,2);assert.ok(x.pedido.codsep);
    const s=await own(()=>val('SELECT row_to_json(s) r FROM separacion s WHERE codsep=$1',[x.pedido.codsep]));assert.equal(s.monadesep,150);assert.equal(String(s.codpedorigen),p.codped);assert.equal(s.metpagsep,'Adelanto de pedido');
    assert.equal(await own(()=>val('SELECT count(*)::int r FROM pagoventa')),0);
    const replay=await act(p,'continuar',{destino:'Separacion'},k);assert.equal(replay.reutilizada,true);assert.equal(replay.pedido.codsep,x.pedido.codsep);
  });
  await t.test('venta con descuento y techo distinto conserva dinero y físico; sin doble cobro',async()=>{
    const cat=await val('SELECT public.hu031_formulario() r');const lona=cat.tiposTecho.find((x:any)=>x.nombre==='Lona');
    const clasico=cat.tiposTecho.find((x:any)=>x.nombre==='Techo clásico de fibra');
    let p=await crear({techo:{decision:'Con techo',codtte:Number(lona.codtte)}});p=(await act(p,'adelanto',pago(100))).pedido;
    const u=await nuevaUnidad();await own(()=>db.query('UPDATE unidad SET codtte=$1 WHERE coduni=$2',[clasico.codtte,u]));
    await own(()=>db.query("UPDATE preparacionunidad SET esttecho='Instalado' WHERE coduni=$1",[u]));
    await assert.rejects(()=>act(p,'proponer',{coduni:u}),error('PT422'));
    p=(await act(p,'proponer',{coduni:u,adecuacionAceptada:true})).pedido;
    assert.equal(p.unidadPropuesta.techoFisico,'Techo clásico de fibra');
    const x=(await act(p,'continuar',{destino:'Venta',modalidad:'Crédito',adecuacionAceptada:true,descuento:300,motivoDescuento:'PRUEBA QA CODEX autorizado',codusuAutorizadorDescuento:1,confirmacionTelefonicaRecibida:true})).pedido;
    const v=await val('SELECT public.hu006_venta_de_unidad_http($1) r',[u]);
    assert.equal(v.importe,18235);assert.equal(v.totalRecibido,100);assert.equal(v.saldo,18135);assert.equal(x.pagos.length,1);
    const recargado=await val('SELECT public.hu031_consultar_pedidos($1) r',[x.codped]);
    assert.equal(recargado.operacion.venta.total,18235);assert.equal(recargado.operacion.venta.saldo,18135);
    assert.equal(recargado.operacion.venta.descuento,300);assert.equal(recargado.operacion.coduni,u);
    assert.equal(await own(()=>val('SELECT codtte::text r FROM unidad WHERE coduni=$1',[u])),clasico.codtte);
    assert.equal(await own(()=>val('SELECT count(*)::int r FROM pagoventa WHERE codven=$1',[x.codven])),0);
  });
  await t.test('separación originada en pedido continúa por HU006 y corrige moto por HU022 sin perder dinero',async()=>{
    let p=await crear();p=(await act(p,'adelanto',pago())).pedido;
    const u=await nuevaUnidad();p=(await act(p,'proponer',{coduni:u})).pedido;
    p=(await act(p,'continuar',{destino:'Separacion'})).pedido;
    const v=await val(`SELECT public.hu006_crear_venta_http($1,1,3,1,'2026-11-19','Crédito',0,null,'[]'::jsonb,
      '{"decision":"Por definir"}'::jsonb,null,null,'PRUEBA QA CODEX',$2::uuid,0,null,null,false) r`,[u,randomUUID()]);
    assert.equal(v.totalRecibido,100);assert.equal(v.saldo,18235);
    const otra=await nuevaUnidad();
    await val('SELECT public.hu022_corregir_venta($1,null,$2,1,$3,$4::uuid) r',[v.codven,otra,'PRUEBA QA CODEX corrección legítima',randomUUID()]);
    const x=await val('SELECT public.hu031_consultar_pedidos($1) r',[p.codped]);
    assert.equal(x.operacion.codven,v.codven);assert.equal(x.operacion.coduni,otra);assert.equal(x.totalRecibido,100);
    assert.equal(x.operacion.venta.recibido,100);assert.equal(x.pagos.length,1);
    assert.equal(await own(()=>val('SELECT codpedorigen::text r FROM separacion WHERE codsep=$1',[p.codsep])),p.codped);
    assert.equal(await own(()=>val('SELECT count(*)::int r FROM pagoventa WHERE codven=$1',[v.codven])),0);
  });
  await t.test('recibos históricos y techo no se falsean al proyectar un pedido pagado completo',async()=>{
    const cat=await val('SELECT public.hu031_formulario() r');const lona=cat.tiposTecho.find((x:any)=>x.nombre==='Lona');
    let p=await crear({techo:{decision:'Con techo',codtte:Number(lona.codtte)}});
    p=(await act(p,'adelanto',pago(18535))).pedido;
    // Fixture de envejecimiento: simula el paso de 45 días sin cobrar otra vez.
    await own(()=>db.query("UPDATE pagopedidocliente SET fecha=(now() AT TIME ZONE 'America/Lima')::date-45 WHERE codped=$1",[p.codped]));
    const u=await nuevaUnidad();p=(await act(p,'proponer',{coduni:u})).pedido;
    const x=(await act(p,'continuar',{destino:'Venta',modalidad:'Contado'})).pedido;
    assert.equal(x.operacion.venta.total,18535);assert.equal(x.operacion.venta.recibido,18535);assert.equal(x.operacion.venta.saldo,0);
    assert.equal(await own(()=>val('SELECT (fecpagsep=(now() AT TIME ZONE \'America/Lima\')::date-45) r FROM separacion WHERE codsep=$1',[x.codsep])),true);
    assert.equal(await own(()=>val('SELECT count(*)::int r FROM pagoventa WHERE codven=$1',[x.codven])),0);
  });
  await t.test('fallo de venta revierte separación temporal y propuesta sin cambios parciales',async()=>{
    let p=await crear();p=(await act(p,'adelanto',pago())).pedido;const u=await nuevaUnidad();p=(await act(p,'proponer',{coduni:u})).pedido;
    await assert.rejects(()=>act(p,'continuar',{destino:'Venta',modalidad:'Crédito',descuento:999999}));
    assert.equal(await own(()=>val('SELECT count(*)::int r FROM separacion WHERE coduni=$1',[u])),0);
    assert.equal(await own(()=>val('SELECT estcomuni r FROM unidad WHERE coduni=$1',[u])),'Disponible');
    assert.equal((await val('SELECT public.hu031_consultar_pedidos($1) r',[p.codped])).totalRecibido,100);
  });
  await t.test('cambio explícito de acuerdo conserva recibos y retira propuesta anterior',async()=>{
    let p=await crear();p=(await act(p,'adelanto',pago())).pedido;const u=await nuevaUnidad();p=(await act(p,'proponer',{coduni:u})).pedido;
    const x=(await act(p,'acuerdo',{codmod:1,color:'Azul',techo:{decision:'Sin techo'},motivo:'PRUEBA QA CODEX acuerdo del cliente'})).pedido;
    assert.equal(x.color,'Azul');assert.equal(x.coduniPropuesta,null);assert.equal(x.totalRecibido,100);assert.equal(x.estado,'Pendiente de unidad');
  });
  await t.test('cancelación con adelanto conserva recibos y exige tratamiento, sin reembolso',async()=>{
    let p=await crear();p=(await act(p,'adelanto',pago())).pedido;
    await assert.rejects(()=>act(p,'cancelar',{motivo:'PRUEBA QA CODEX cancelación'}),error('PT422'));
    const x=(await act(p,'cancelar',{motivo:'PRUEBA QA CODEX cancelación',observacionDinero:'Pendiente de coordinación externa; no reembolsado'})).pedido;
    assert.equal(x.estado,'Cancelado');assert.equal(x.totalRecibido,100);assert.equal(x.pagos.length,1);
    await assert.rejects(()=>act(x,'adelanto',pago()),error('PT409'));
  });
  await t.test('versión desactualizada devuelve409 y vendedor ajeno no accede a mutaciones',async()=>{
    const p=await crear();await act(p,'adelanto',pago());await assert.rejects(()=>act(p,'adelanto',pago()),error('PT409'));
    await login(3);await assert.rejects(()=>act(p,'cancelar',{motivo:'PRUEBA QA CODEX'}),error('PT404'));await login();
  });
 }finally{await db.close();}
});
