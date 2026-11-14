import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type {
  ConsultaVentasInput, CrearVentaInput, DecisionTechoVenta, ModalidadVenta, PagoVentaInput, TechoVentaRequest
} from '../types/venta.types';

const CAMPOS_VENTA = [
  'codcli', 'codusuResponsable', 'codsedAtencion', 'fechaVenta', 'modalidad', 'adicionalTechoAcordado',
  'descuento', 'motivoDescuento', 'codusuAutorizadorDescuento', 'confirmacionTelefonicaRecibida',
  'codsedEntregaPrevista', 'pagos', 'techo', 'comprobanteExterno', 'observacion'
] as const;
const CAMPOS_PAGO = [
  'monto', 'fecha', 'medioPago', 'referencia', 'rutaEvidencia', 'observacion',
  'ingresoConfirmado', 'codusuConfirmador'
] as const;
const DECISIONES_TECHO: readonly DecisionTechoVenta[] = ['Por definir', 'Sin techo', 'Con techo'];
const MODALIDADES: readonly ModalidadVenta[] = ['Contado', 'Crédito'];

function objeto(valor: unknown, nombre: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor))
    throw new ErrorHttp(400, `${nombre} debe ser un objeto JSON`);
  return valor as Record<string, unknown>;
}

function idPositivo(valor: unknown, campo: string): string {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0)
    throw new ErrorHttp(400, `${campo} debe ser un entero positivo`);
  return String(valor);
}

function fecha(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)
    || !Number.isFinite(Date.parse(valor)) || new Date(valor).toISOString().slice(0, 10) !== valor)
    throw new ErrorHttp(400, `${campo} debe ser una fecha válida YYYY-MM-DD`);
  return valor;
}

function texto(valor: unknown, campo: string, maximo: number): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} debe ser texto o null`);
  const normalizado = valor.replace(/\s+/g, ' ').trim();
  if (normalizado.length > maximo || /[\u0000-\u001f\u007f]/.test(normalizado))
    throw new ErrorHttp(400, `${campo} no tiene un formato válido`);
  return normalizado || null;
}

function validarImporte(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0
    || valor > 99999999.99 || Number(valor.toFixed(2)) !== valor)
    throw new ErrorHttp(400, `${campo} debe ser positivo y tener como máximo dos decimales`);
  return valor;
}

function validarAdicionalTecho(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0
    || valor > 99999999.99 || Number(valor.toFixed(2)) !== valor)
    throw new ErrorHttp(400, `${campo} debe ser un número no negativo con hasta dos decimales`);
  return valor;
}

function validarDescuento(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0
    || valor > 99999999.99 || Number(valor.toFixed(2)) !== valor)
    throw new ErrorHttp(400, 'descuento debe ser un importe no negativo con hasta dos decimales');
  return valor;
}

function validarTecho(valor: unknown): TechoVentaRequest | null {
  if (valor === undefined || valor === null) return null;
  const datos = objeto(valor, 'techo');
  const extra = Object.keys(datos).find(campo => campo !== 'decision' && campo !== 'codtte');
  if (extra) throw new ErrorHttp(400, `Campo de techo no permitido: ${extra}`);
  if (typeof datos.decision !== 'string' || !DECISIONES_TECHO.includes(datos.decision as DecisionTechoVenta))
    throw new ErrorHttp(400, 'techo.decision debe ser Por definir, Sin techo o Con techo');
  if (datos.decision === 'Con techo') {
    if (typeof datos.codtte !== 'number' || !Number.isSafeInteger(datos.codtte) || datos.codtte <= 0)
      throw new ErrorHttp(400, 'techo.codtte debe ser un entero positivo cuando la decisión es Con techo');
    return { decision: 'Con techo', codtte: datos.codtte };
  }
  if (Object.prototype.hasOwnProperty.call(datos, 'codtte'))
    throw new ErrorHttp(400, 'techo.codtte solo se admite cuando la decisión es Con techo');
  return { decision: datos.decision as 'Por definir' | 'Sin techo' };
}

function validarPagos(valor: unknown): PagoVentaInput[] {
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) throw new ErrorHttp(400, 'pagos debe ser una lista');
  return valor.map((pagoDesconocido, indice) => {
    const pago = objeto(pagoDesconocido, `pagos[${indice}]`);
    const extra = Object.keys(pago).find(campo => !CAMPOS_PAGO.includes(campo as typeof CAMPOS_PAGO[number]));
    if (extra) throw new ErrorHttp(400, `Campo no permitido en pagos[${indice}]: ${extra}`);
    const monto = validarImporte(pago.monto, `pagos[${indice}].monto`);
    const fecpag = fecha(pago.fecha, `pagos[${indice}].fecha`);
    if (pago.medioPago !== 'Efectivo' && pago.medioPago !== 'Transferencia')
      throw new ErrorHttp(422, 'El medio de pago debe ser Efectivo o Transferencia');
    if (typeof pago.ingresoConfirmado !== 'boolean')
      throw new ErrorHttp(400, `pagos[${indice}].ingresoConfirmado debe ser booleano`);
    if (!pago.ingresoConfirmado) throw new ErrorHttp(422, 'Confirma el ingreso antes de registrar el pago');
    const referencia = texto(pago.referencia, `pagos[${indice}].referencia`, 200);
    const rutaEvidencia = texto(pago.rutaEvidencia, `pagos[${indice}].rutaEvidencia`, 2048);
    const observacion = texto(pago.observacion, `pagos[${indice}].observacion`, 2000);
    if (pago.medioPago === 'Transferencia') {
      if (!referencia || !rutaEvidencia)
        throw new ErrorHttp(422, 'La transferencia requiere referencia y evidencia guardada');
      if (typeof pago.codusuConfirmador !== 'number' || !Number.isSafeInteger(pago.codusuConfirmador)
        || pago.codusuConfirmador <= 0)
        throw new ErrorHttp(422, 'La transferencia requiere un gerente confirmador válido');
      return {
        monto, fecha: fecpag, medioPago: 'Transferencia', referencia, rutaEvidencia,
        observacion, ingresoConfirmado: true,
        codusuConfirmador: pago.codusuConfirmador
      };
    }
    if (!observacion) throw new ErrorHttp(422, 'El efectivo requiere una observación de recepción');
    if (referencia || rutaEvidencia || (pago.codusuConfirmador !== undefined && pago.codusuConfirmador !== null))
      throw new ErrorHttp(422, 'El efectivo no requiere referencia, voucher ni confirmador separado');
    return { monto, fecha: fecpag, medioPago: 'Efectivo', referencia: null,
      rutaEvidencia: null, observacion, ingresoConfirmado: true, codusuConfirmador: null };
  });
}

function validarComprobante(valor: unknown): { referencia: string; fecha: string } | null {
  if (valor === undefined || valor === null) return null;
  const datos = objeto(valor, 'comprobanteExterno');
  const extra = Object.keys(datos).find(campo => campo !== 'referencia' && campo !== 'fecha');
  if (extra) throw new ErrorHttp(400, `Campo no permitido en comprobanteExterno: ${extra}`);
  const referencia = texto(datos.referencia, 'comprobanteExterno.referencia', 200);
  const fec = datos.fecha === null || datos.fecha === undefined
    ? null : fecha(datos.fecha, 'comprobanteExterno.fecha');
  if (!referencia && !fec) return null;
  if (!referencia || !fec)
    throw new ErrorHttp(400, 'Referencia y fecha del comprobante externo deben informarse juntas');
  return { referencia, fecha: fec };
}

function validarClaveIdempotencia(valor: unknown): string {
  if (typeof valor !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(valor.trim()))
    throw new ErrorHttp(400, 'Idempotency-Key es obligatorio y debe ser un UUID válido');
  return valor.trim().toLowerCase();
}

export function obtenerClaveIdempotenciaVenta(rawHeaders: readonly string[]): string {
  const valores: string[] = [];
  for (let indice = 0; indice < rawHeaders.length; indice += 2) {
    if (rawHeaders[indice]?.toLowerCase() === 'idempotency-key') valores.push(rawHeaders[indice + 1] ?? '');
  }
  if (valores.length !== 1)
    throw new ErrorHttp(400, 'El header Idempotency-Key es obligatorio y debe enviarse una sola vez');
  return validarClaveIdempotencia(valores[0]);
}

export function validarCrearVenta(coduni: unknown, body: unknown, clave: unknown): CrearVentaInput {
  const datos = objeto(body, 'El cuerpo');
  const extra = Object.keys(datos).find(campo => !CAMPOS_VENTA.includes(campo as typeof CAMPOS_VENTA[number]));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (typeof datos.modalidad !== 'string' || !MODALIDADES.includes(datos.modalidad as ModalidadVenta))
    throw new ErrorHttp(400, 'modalidad debe ser Contado o Crédito');
  const comprobante = validarComprobante(datos.comprobanteExterno);
  const obsven = texto(datos.observacion, 'observacion', 2000);
  const techo = validarTecho(datos.techo);
  const adicionalTechoAcordado = datos.adicionalTechoAcordado === undefined || datos.adicionalTechoAcordado === null
    ? null : validarAdicionalTecho(datos.adicionalTechoAcordado, 'adicionalTechoAcordado');
  const descuento = datos.descuento === undefined ? 0 : validarDescuento(datos.descuento);
  const motivoDescuento = texto(datos.motivoDescuento, 'motivoDescuento', 500);
  const codusuAutorizadorDescuento = datos.codusuAutorizadorDescuento === undefined
    || datos.codusuAutorizadorDescuento === null ? null
    : idPositivo(datos.codusuAutorizadorDescuento, 'codusuAutorizadorDescuento');
  const confirmacionTelefonicaRecibida = datos.confirmacionTelefonicaRecibida === undefined
    ? false : datos.confirmacionTelefonicaRecibida;
  if (typeof confirmacionTelefonicaRecibida !== 'boolean')
    throw new ErrorHttp(400, 'confirmacionTelefonicaRecibida debe ser booleano');
  if (descuento === 0 && (motivoDescuento !== null || codusuAutorizadorDescuento !== null || confirmacionTelefonicaRecibida))
    throw new ErrorHttp(400, 'Los datos de autorización solo se admiten con descuento mayor a cero');
  if (descuento > 0 && (!motivoDescuento || !codusuAutorizadorDescuento || !confirmacionTelefonicaRecibida))
    throw new ErrorHttp(400, 'Un descuento mayor a cero requiere motivo, autorizador y confirmación telefónica');
  if (techo?.decision === 'Con techo' && adicionalTechoAcordado === null)
    throw new ErrorHttp(400, 'adicionalTechoAcordado es obligatorio cuando la decisión es Con techo');
  if (techo && techo.decision !== 'Con techo' && adicionalTechoAcordado !== null && adicionalTechoAcordado !== 0)
    throw new ErrorHttp(400, 'adicionalTechoAcordado debe ser 0 si la decisión no es Con techo');
  const entrega = datos.codsedEntregaPrevista === undefined || datos.codsedEntregaPrevista === null
    ? null : idPositivo(datos.codsedEntregaPrevista, 'codsedEntregaPrevista');
  return {
    p_coduni: validarIdCompra(coduni, 'coduni'),
    p_codcli: idPositivo(datos.codcli, 'codcli'),
    p_codusuresp: idPositivo(datos.codusuResponsable, 'codusuResponsable'),
    p_codsedatencion: idPositivo(datos.codsedAtencion, 'codsedAtencion'),
    p_fecven: fecha(datos.fechaVenta, 'fechaVenta'),
    p_modcomven: datos.modalidad as ModalidadVenta,
    p_adicionalacordado: adicionalTechoAcordado,
    p_descuento: descuento,
    p_motivodescuento: motivoDescuento,
    p_codusuautorizadesc: codusuAutorizadorDescuento,
    p_conftelefonicadesc: confirmacionTelefonicaRecibida,
    p_codsedentregaprevista: entrega,
    p_pagos: validarPagos(datos.pagos),
    p_techo: techo,
    p_refcompven: comprobante?.referencia ?? null,
    p_feccompven: comprobante?.fecha ?? null,
    p_obsven: obsven,
    p_idempotenciaven: validarClaveIdempotencia(clave)
  };
}

export function validarGuardarTechoVenta(codven: unknown, body: unknown) {
  const datos = objeto(body, 'El cuerpo');
  const extra = Object.keys(datos).find(campo => !['decision', 'codtte', 'adicionalAcordado'].includes(campo));
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  if (typeof datos.decision !== 'string' || !DECISIONES_TECHO.includes(datos.decision as DecisionTechoVenta))
    throw new ErrorHttp(400, 'decision debe ser Por definir, Sin techo o Con techo');
  let codtte: string | null = null;
  let adicionalAcordado: number | null = null;
  if (datos.decision === 'Con techo') {
    codtte = idPositivo(datos.codtte, 'codtte');
    adicionalAcordado = validarAdicionalTecho(datos.adicionalAcordado, 'adicionalAcordado');
  } else if (Object.prototype.hasOwnProperty.call(datos, 'codtte')
    || Object.prototype.hasOwnProperty.call(datos, 'adicionalAcordado')) {
    throw new ErrorHttp(400, 'codtte y adicionalAcordado solo se admiten cuando la decisión es Con techo');
  }
  return { p_codven: validarIdCompra(codven, 'codven'),
    p_decisiontecho: datos.decision as DecisionTechoVenta, p_codtte: codtte,
    p_adicionalacordado: adicionalAcordado };
}

export function validarConsultaVentas(queryDesconocido: unknown): ConsultaVentasInput {
  if (!queryDesconocido || typeof queryDesconocido !== 'object' || Array.isArray(queryDesconocido))
    throw new ErrorHttp(400, 'Parámetros de consulta no válidos');
  const query = queryDesconocido as Record<string, unknown>;
  const extra = Object.keys(query).find(campo => !['q', 'limite', 'offset'].includes(campo));
  if (extra) throw new ErrorHttp(400, `Parámetro no permitido: ${extra}`);
  const valorTexto = (campo: string): string | undefined => {
    const valor = query[campo];
    if (valor === undefined) return undefined;
    if (typeof valor !== 'string') throw new ErrorHttp(400, `${campo} debe enviarse una sola vez como texto`);
    return valor;
  };
  const busqueda = valorTexto('q')?.trim().replace(/\s+/g, ' ') ?? '';
  if (busqueda.length > 200) throw new ErrorHttp(400, 'q admite hasta 200 caracteres');
  const entero = (campo: 'limite' | 'offset', defecto: number): number => {
    const valor = valorTexto(campo);
    if (valor === undefined) return defecto;
    if (!/^(0|[1-9]\d*)$/.test(valor)) throw new ErrorHttp(400, `${campo} debe ser un entero no negativo`);
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero)) throw new ErrorHttp(400, `${campo} excede el rango permitido`);
    if (campo === 'limite' && (numero < 1 || numero > 100)) throw new ErrorHttp(400, 'limite debe estar entre 1 y 100');
    if (campo === 'offset' && numero > 2147483647) throw new ErrorHttp(400, 'offset excede el rango permitido');
    return numero;
  };
  return { p_busqueda: busqueda || null, p_limite: entero('limite', 50), p_offset: entero('offset', 0) };
}

export function validarGuardarComprobanteVenta(codven: unknown, body: unknown) {
  const datos = objeto(body, 'El cuerpo');
  const extra = Object.keys(datos).find(campo => campo !== 'referencia' && campo !== 'fecha');
  if (extra) throw new ErrorHttp(400, `Campo no permitido: ${extra}`);
  const referencia = texto(datos.referencia, 'referencia', 200);
  if (!referencia) throw new ErrorHttp(400, 'referencia es obligatoria y no puede estar vacía');
  return {
    p_codven: validarIdCompra(codven, 'codven'),
    p_referencia: referencia,
    p_fecha: fecha(datos.fecha, 'fecha')
  };
}
