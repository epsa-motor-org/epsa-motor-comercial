import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorSeparacionBD } from '../types/separacion.types';

export function responderErrorSeparacion(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });

  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para realizar esta operación de separación'],
    PT400: [400, 'Los datos de la separación no son válidos'],
    PT404: [404, 'No se encontró la unidad o el comprador'],
    PT407: [422, 'El responsable no existe, está inactivo o no está autorizado'],
    PT426: [422, 'El comprador está inactivo'],
    PT427: [422, 'Confirma el ingreso del adelanto antes de separar'],
    PT428: [422, 'El efectivo requiere una observación de recepción'],
    PT429: [409, 'La unidad ya tiene una separación activa'],
    PT430: [409, 'La unidad ya está comprometida por una venta'],
    PT431: [409, 'Idempotency-Key ya fue utilizada con otros datos'],
    PT432: [422, 'La unidad todavía no está identificada'],
    PT433: [422, 'El confirmador del ingreso no existe, está inactivo o no es gerente'],
    PT434: [422, 'La captura de la transferencia no está guardada o no corresponde a esta moto'],
    '23503': [404, 'No se encontró la unidad, el comprador o el responsable'],
    '23505': [409, 'La unidad ya tiene una separación activa'],
    '23514': [400, 'Los datos no cumplen las restricciones de separación'],
    '40001': [409, 'La unidad cambió durante la operación; consulta e inténtalo de nuevo'],
    '40P01': [409, 'Otra operación está modificando la unidad; consulta e inténtalo de nuevo']
  };
  const codigo = (error as ErrorSeparacionBD | null)?.code ?? '';
  const [status, message] = errores[codigo] ?? [500, 'Error interno al procesar la separación'];
  return res.status(status).json({ ok: false, message });
}
