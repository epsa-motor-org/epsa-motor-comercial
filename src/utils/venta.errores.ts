import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorVentaBD } from '../types/venta.types';

export function responderErrorVenta(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });

  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para registrar ventas'],
    PT600: [400, 'Los datos de la venta no son válidos'],
    PT601: [404, 'No se encontró la unidad, el comprador o la venta'],
    PT603: [422, 'La unidad todavía no está identificada o disponible'],
    PT604: [409, 'La unidad ya tiene una venta o su estado comercial no permite venderla'],
    PT605: [409, 'La unidad está separada para otro comprador'],
    PT606: [422, 'El comprador está inactivo'],
    PT607: [422, 'El responsable no existe, está inactivo o no está autorizado'],
    PT608: [404, 'La sede no existe o está inactiva'],
    PT609: [422, 'Los datos del pago no son válidos o el ingreso no está confirmado'],
    PT610: [422, 'El tipo de techo no existe, está inactivo o no es válido'],
    PT611: [409, 'Idempotency-Key ya fue usada con otra solicitud de venta'],
    PT612: [422, 'Los pagos y el adelanto superan el importe de la venta'],
    PT613: [409, 'La elección de techo no coincide o es incompatible con la unidad'],
    PT614: [409, 'La decisión final de techo de la venta no se puede modificar'],
    PT615: [422, 'La evidencia de pago no está guardada o no corresponde a esta unidad'],
    PT616: [400, 'Referencia y fecha del comprobante externo deben informarse juntas'],
    PT617: [422, 'El confirmador del pago no existe, está inactivo o no es gerente'],
    PT618: [409, 'La venta ya tiene un comprobante externo diferente'],
    PT619: [422, 'No se pudo determinar el precio base o adicional referencial de la venta'],
    PT620: [422, 'El adicional acordado del techo no es válido'],
    PT621: [422, 'Los pagos recibidos superan el total recalculado de la venta'],
    PT622: [400, 'Los parámetros de búsqueda de ventas no son válidos'],
    PT623: [409, 'La venta está cancelada y ya no se puede modificar'],
    '23503': [404, 'No se encontró una unidad, comprador, responsable o sede'],
    '23505': [409, 'La unidad o la solicitud ya fue registrada'],
    '23514': [422, 'Los datos de venta o pago no cumplen las reglas permitidas'],
    '22P02': [400, 'Uno de los identificadores o datos numéricos tiene un formato inválido'],
    '22003': [422, 'Uno de los importes o identificadores excede el rango permitido'],
    '40001': [409, 'La unidad cambió durante la operación; consulta e inténtalo de nuevo'],
    '40P01': [409, 'Otra operación está modificando la unidad; consulta e inténtalo de nuevo'],
    PGRST202: [503, 'El servicio de ventas no está disponible; vuelve a intentarlo más tarde']
  };
  const codigo = (error as ErrorVentaBD | null)?.code ?? '';
  const [status, message] = errores[codigo] ?? [500, 'Error interno al procesar la venta'];
  return res.status(status).json({ ok: false, message });
}
