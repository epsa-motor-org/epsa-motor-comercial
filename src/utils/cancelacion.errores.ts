import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorCancelacionBD } from '../types/cancelacion.types';

export function responderErrorCancelacion(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });

  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para consultar o cancelar esta operación'],
    PT650: [400, 'La solicitud de cancelación no es válida'],
    PT651: [404, 'No se encontró la separación o venta'],
    PT652: [403, 'El vendedor no es el responsable comercial vigente de esta operación'],
    PT653: [409, 'La separación convertida no puede cancelarse por separado'],
    PT654: [409, 'La operación ya no está en un estado cancelable'],
    PT655: [422, 'El motivo es obligatorio y admite hasta 250 caracteres'],
    PT656: [422, 'Registra una observación sobre el dinero conservado'],
    PT657: [409, 'La unidad mantiene otro compromiso comercial vigente'],
    PT658: [409, 'Idempotency-Key ya fue utilizada con otros datos'],
    PT659: [409, 'La operación cambió de estado; actualiza la información e inténtalo de nuevo'],
    '23505': [409, 'La operación ya fue cancelada o la solicitud entró en conflicto'],
    '23503': [404, 'No se encontró la operación o el usuario'],
    '23514': [422, 'Los datos de cancelación no cumplen las reglas permitidas'],
    '22P02': [400, 'Un identificador o valor tiene un formato inválido'],
    '22003': [422, 'Un valor excede el rango permitido'],
    '40001': [409, 'La unidad cambió durante la cancelación; actualiza e inténtalo de nuevo'],
    '40P01': [409, 'Otra operación está modificando la unidad; actualiza e inténtalo de nuevo'],
    PGRST202: [503, 'El servicio de cancelaciones no está disponible; falta actualizar la base de datos']
  };
  const codigo = (error as ErrorCancelacionBD | null)?.code ?? '';
  const [status, message] = errores[codigo] ?? [500, 'Error interno al cancelar la operación'];
  return res.status(status).json({ ok: false, message });
}
