import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { autenticar, exigirRoles, type FabricaCliente } from '../middleware/autenticacion';
import { ErrorHttp } from '../utils/errores';
import { clavePedido, filtrosPedido, idPedido, validarPedido, validarAccionPedido, ACCIONES_PEDIDO } from '../utils/pedido.validacion';
import { responderErrorVenta } from '../utils/venta.errores';
import { recibirEvidenciaVenta } from '../middleware/venta.evidencia';
import { verificarBytesEvidencia, TIPO_EVIDENCIA } from '../utils/separacion.apoyo.validacion';

// PT400/403/404/409/422 son estados HTTP válidos de PostgREST. Nunca PT6xx/PT7xx.
function errorPedido(res: Response, error: unknown) {
  if (error instanceof ErrorHttp) return res.status(error.status).json({ok:false,message:error.message});
  const e = error as {code?:string;message?:string};
  if (/^PT6\d{2}$/.test(e?.code || '')) return responderErrorVenta(res,error);
  if (['PT400','PT403','PT404','PT409','PT422'].includes(e?.code || ''))
    return res.status(Number(e.code!.slice(2))).json({ok:false,message:e.message || 'No se pudo procesar el pedido'});
  const known: Record<string,[number,string]> = {
    '42501':[403,'No tienes permiso para acceder a este pedido'],
    '23505':[409,'El pedido o intento ya existe; actualiza la información'],
    '23503':[422,'Una referencia del pedido ya no es válida'],
    '23514':[422,'Los datos no cumplen las reglas del pedido'],
    '40001':[409,'El pedido cambió; revisa los datos actualizados'],
    '40P01':[409,'Otra operación está modificando el pedido; actualiza la información'],
    PGRST202:[503,'El servicio de pedidos todavía no está disponible']
  };
  const [status,message] = known[e?.code || ''] || [500,'Error interno al procesar el pedido'];
  return res.status(status).json({ok:false,message});
}

export function crearRutasPedido(fabrica?: FabricaCliente) {
  const router = Router();
  router.use(autenticar(fabrica),exigirRoles('Gerente','Administradora','Vendedor'));
  router.get('/compradores',async(req,res)=>{
    try{
      const filtros=filtrosPedido(req.query);
      const {data,error}=await res.locals.db.rpc('hu031_buscar_compradores',{p_buscar:filtros.p_buscar});
      if(error)throw error;
      res.json({ok:true,data});
    }catch(error){errorPedido(res,error);}
  });
  router.get('/formulario',async (_req,res) => {
    try {
      const {data,error} = await res.locals.db.rpc('hu031_formulario');
      if(error) throw error;
      res.json({ok:true,data});
    } catch(error) { errorPedido(res,error); }
  });
  router.get('/',async (req,res) => {
    try {
      const {data,error} = await res.locals.db.rpc('hu031_consultar_pedidos',filtrosPedido(req.query));
      if(error) throw error;
      res.json({ok:true,data});
    } catch(error) { errorPedido(res,error); }
  });
  router.get('/:codped',async (req,res) => {
    try {
      const {data,error} = await res.locals.db.rpc('hu031_consultar_pedidos',{p_codped:idPedido(req.params.codped)});
      if(error) throw error;
      res.json({ok:true,data});
    } catch(error) { errorPedido(res,error); }
  });
  router.post('/',async (req,res) => {
    try {
      const datos = validarPedido(req.body);
      const clave = clavePedido(req.rawHeaders);
      const {data,error} = await res.locals.db.rpc('hu031_crear_pedido',{p_datos:datos,p_clave:clave});
      if(error) throw error;
      res.status(data.reutilizada ? 200 : 201).json({ok:true,data});
    } catch(error) { errorPedido(res,error); }
  });
  router.post('/:codped/evidencia',recibirEvidenciaVenta,async(req,res)=>{
    try{
      const id=idPedido(req.params.codped);
      const {data:pedido,error:consultaError}=await res.locals.db.rpc('hu031_consultar_pedidos',{p_codped:id});
      if(consultaError)throw consultaError;
      if(!['Pendiente de unidad','Unidad propuesta'].includes(pedido.estado))throw new ErrorHttp(409,'El pedido ya no admite adelantos');
      if(!req.file)throw new ErrorHttp(400,'Adjunta la evidencia del adelanto');
      const tipo=TIPO_EVIDENCIA[verificarBytesEvidencia(req.file.buffer)];
      const ruta=`pedidos/${id}/${randomUUID()}.${tipo.extension}`;
      const {error}=await res.locals.db.storage.from('pedidos-evidencia').upload(ruta,req.file.buffer,{contentType:tipo.contentType,upsert:false});
      if(error)throw new ErrorHttp(502,'No se pudo guardar la evidencia; el adelanto no fue registrado');
      res.status(201).json({ok:true,data:{rutaEvidencia:ruta}});
    }catch(error){errorPedido(res,error);}
  });
  for(const accion of ACCIONES_PEDIDO)router.post(`/:codped/${accion}`,async(req,res)=>{
    try{
      const id=idPedido(req.params.codped);const clave=clavePedido(req.rawHeaders);
      const datos=validarAccionPedido(accion,req.body);
      const {data,error}=await res.locals.db.rpc('hu031_actualizar_pedido',{p_codped:id,p_accion:accion,p_datos:datos,p_clave:clave});
      if(error)throw error;
      res.json({ok:true,data});
    }catch(error){errorPedido(res,error);}
  });
  return router;
}
