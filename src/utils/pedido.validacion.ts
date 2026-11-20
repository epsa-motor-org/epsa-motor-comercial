import { ErrorHttp } from './errores';
import { obtenerClaveIdempotenciaVenta } from './venta.validacion';

export const clavePedido = obtenerClaveIdempotenciaVenta;
export function idPedido(v: unknown, campo = 'codped'): number {
  const n = typeof v === 'string' && /^[1-9]\d*$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0)
    throw new ErrorHttp(400, `${campo} debe ser un entero positivo`);
  return n;
}
function objeto(v: unknown, campo: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorHttp(400, `${campo} debe ser un objeto`);
  return v as Record<string, unknown>;
}
function texto(v: unknown, campo: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || /[\u0000-\u001f\u007f]/.test(v)) throw new ErrorHttp(400, `${campo} no es válido`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length > max) throw new ErrorHttp(400, `${campo} admite hasta ${max} caracteres`);
  return t || null;
}
export function validarPedido(body: unknown): Record<string, unknown> {
  const d = objeto(body, 'Pedido');
  const permitidos = ['codcli','codmod','codusuResponsable','codsedAtencion','codsedEntregaPrevista','color','techo','fechaEntregaPrevista','observacion'];
  if (Object.keys(d).some(k => !permitidos.includes(k))) throw new ErrorHttp(400, 'El pedido contiene campos no permitidos');
  const t = objeto(d.techo, 'techo');
  if (Object.keys(t).some(k => !['decision','codtte'].includes(k)) || !['Por definir','Sin techo','Con techo'].includes(String(t.decision)))
    throw new ErrorHttp(400, 'Elección de techo inválida');
  if (t.decision !== 'Con techo' && t.codtte !== undefined) throw new ErrorHttp(400, 'El tipo solo corresponde a Con techo');
  let fecha: string | null = null;
  if (d.fechaEntregaPrevista !== undefined && d.fechaEntregaPrevista !== null && d.fechaEntregaPrevista !== '') {
    if (typeof d.fechaEntregaPrevista !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.fechaEntregaPrevista)
      || !Number.isFinite(Date.parse(d.fechaEntregaPrevista)) || new Date(d.fechaEntregaPrevista).toISOString().slice(0,10) !== d.fechaEntregaPrevista)
      throw new ErrorHttp(400, 'La fecha prevista no es válida');
    fecha = d.fechaEntregaPrevista;
  }
  return {
    codcli:idPedido(d.codcli,'codcli'),codmod:idPedido(d.codmod,'codmod'),
    codusuResponsable:idPedido(d.codusuResponsable,'codusuResponsable'),codsedAtencion:idPedido(d.codsedAtencion,'codsedAtencion'),
    codsedEntregaPrevista:d.codsedEntregaPrevista == null ? null : idPedido(d.codsedEntregaPrevista,'codsedEntregaPrevista'),
    color:texto(d.color,'color',50),techo:t.decision === 'Con techo' ? {decision:t.decision,codtte:idPedido(t.codtte,'codtte')} : {decision:t.decision},
    fechaEntregaPrevista:fecha,observacion:texto(d.observacion,'observacion',2000)
  };
}
export function filtrosPedido(query: Record<string, unknown>) {
  if (Object.keys(query).some(k => !['q','limite','offset'].includes(k))) throw new ErrorHttp(400, 'Filtros no permitidos');
  const limite = query.limite === undefined ? 25 : idPedido(query.limite,'limite');
  if (limite > 50) throw new ErrorHttp(400, 'El límite máximo es 50');
  const offset = query.offset === undefined ? 0 : typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ErrorHttp(400, 'Offset inválido');
  return {p_codped:null,p_limite:limite,p_offset:offset,p_buscar:texto(query.q,'q',100)};
}

export const ACCIONES_PEDIDO = ['adelanto','acuerdo','proponer','continuar','cancelar'] as const;
export function validarAccionPedido(accion:string, body:unknown): Record<string,unknown> {
  const d=objeto(body,'Solicitud');
  const campos:Record<string,string[]>={
    adelanto:['monto','fecha','medioPago','referencia','rutaEvidencia','observacion','ingresoConfirmado','codusuConfirmador'],
    acuerdo:['codmod','color','techo','motivo','adicionalTechoAcordado'],proponer:['coduni','adecuacionAceptada'],
    continuar:['destino','modalidad','adecuacionAceptada','descuento','motivoDescuento','codusuAutorizadorDescuento','confirmacionTelefonicaRecibida'],
    cancelar:['motivo','observacionDinero']
  };
  if(!campos[accion] || Object.keys(d).some(k=>k!=='versionEsperada'&&!campos[accion]!.includes(k)))throw new ErrorHttp(400,'Campos no permitidos en el pedido');
  const out:Record<string,unknown>={...d,versionEsperada:idPedido(d.versionEsperada,'versionEsperada')};
  for(const k of ['coduni','codmod','codusuConfirmador','codusuAutorizadorDescuento'])if(d[k]!=null)out[k]=idPedido(d[k],k);
  for(const k of ['adecuacionAceptada','ingresoConfirmado','confirmacionTelefonicaRecibida'])if(d[k]!==undefined&&typeof d[k]!=='boolean')throw new ErrorHttp(400,`${k} debe ser booleano`);
  for(const k of ['monto','descuento','adicionalTechoAcordado'])if(d[k]!==undefined){const v=d[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>99999999.99||v!==Number(v.toFixed(2)))throw new ErrorHttp(400,`${k} debe ser un importe válido con dos decimales`);}
  for(const k of ['motivo','motivoDescuento','observacion','observacionDinero','referencia','rutaEvidencia','color'])if(d[k]!==undefined)out[k]=texto(d[k],k,k==='color'?50:k==='referencia'?200:k==='motivo'||k==='motivoDescuento'?500:2048);
  if(accion==='adelanto'){
    if(typeof d.fecha!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)||!Number.isFinite(Date.parse(d.fecha))||new Date(d.fecha).toISOString().slice(0,10)!==d.fecha)throw new ErrorHttp(400,'Fecha del adelanto inválida');
    if(!['Efectivo','Transferencia'].includes(String(d.medioPago))||d.ingresoConfirmado!==true||!d.monto)throw new ErrorHttp(422,'Confirma el ingreso y los datos del adelanto');
  }
  if(accion==='acuerdo'){
    const t=validarPedido({codcli:1,codmod:d.codmod,codusuResponsable:1,codsedAtencion:1,techo:d.techo});out.techo=t.techo;
    if(!out.motivo)throw new ErrorHttp(422,'Registra el motivo del nuevo acuerdo');
  }
  if(accion==='proponer')out.coduni=idPedido(d.coduni,'coduni');
  if(accion==='continuar'&&!['Separacion','Venta'].includes(String(d.destino)))throw new ErrorHttp(400,'Elige separación o venta');
  return out;
}
