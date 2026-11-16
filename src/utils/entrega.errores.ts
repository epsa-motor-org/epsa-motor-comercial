import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorEntregaBD } from '../types/entrega.types';

export function responderErrorEntrega(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });
  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para consultar o registrar esta entrega'],
    PT694: [400, 'Los datos de entrega no son válidos'],
    PT695: [404, 'No se encontró la venta solicitada'],
    PT696: [409, 'La venta o unidad no cumple las condiciones actuales para registrar la entrega'],
    PT697: [403, 'Solo el responsable comercial vigente puede confirmar esta entrega'],
    PT698: [409, 'Idempotency-Key ya fue usada con otra solicitud de entrega'],
    PT700: [409, 'La operación ya tiene una entrega efectiva y no puede corregirse'],
    '23505': [409, 'La venta o unidad ya tiene una entrega efectiva'],
    '23503': [409, 'La relación de venta o unidad cambió durante la operación'],
    '22P02': [400, 'Uno de los identificadores tiene un formato inválido'],
    '40001': [409, 'La operación cambió durante el registro; consulta e inténtalo de nuevo'],
    '40P01': [409, 'Otra operación está modificando la venta o unidad; inténtalo de nuevo'],
    PGRST202: [503, 'El servicio de entregas no está disponible; vuelve a intentarlo más tarde']
  };
  const [status, message] = errores[(error as ErrorEntregaBD | null)?.code ?? '']
    ?? [500, 'Error interno al procesar la entrega'];
  return res.status(status).json({ ok: false, message });
}
