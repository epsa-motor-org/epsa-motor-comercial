import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorRetornoBD } from '../types/retorno.types';

export function responderErrorRetorno(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });
  const errores: Record<string, [number, string]> = {
    '42501': [403, 'Solo Gerente puede registrar el retorno físico'],
    PT701: [400, 'Los datos del retorno no son válidos o la ubicación no es un lugar EPSA activo para unidades'],
    PT702: [404, 'No se encontró la venta o su unidad'],
    PT703: [409, 'La venta no está cancelada con una entrega efectiva compatible'],
    PT704: [409, 'Idempotency-Key ya fue usada con otra solicitud de retorno'],
    PT705: [409, 'El retorno físico de esta venta ya fue registrado'],
    '23505': [409, 'El retorno físico ya fue registrado'],
    '23503': [409, 'La venta, unidad, entrega o ubicación cambió durante la operación'],
    '22P02': [400, 'Uno de los identificadores tiene un formato inválido'],
    '40001': [409, 'La operación cambió durante el registro; consulta e inténtalo de nuevo'],
    '40P01': [409, 'Otra operación está modificando la venta o unidad; inténtalo de nuevo'],
    PGRST202: [503, 'El servicio de retornos no está disponible; vuelve a intentarlo más tarde']
  };
  const [status, message] = errores[(error as ErrorRetornoBD | null)?.code ?? '']
    ?? [500, 'Error interno al registrar el retorno físico'];
  return res.status(status).json({ ok: false, message });
}
