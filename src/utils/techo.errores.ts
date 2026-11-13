import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorTechoBD } from '../types/techo.types';

export function responderErrorTecho(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });

  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para realizar esta operación de techo'],
    PT400: [400, 'Revisa el tipo de techo, proveedor y detalle enviados'],
    PT404: [404, 'La unidad no existe'],
    PT420: [409, 'El tipo de techo no existe o está inactivo'],
    PT421: [400, 'Esta configuración requiere un proveedor externo activo'],
    PT422: [400, 'El proveedor no existe, está inactivo o no está habilitado para techos'],
    PT423: [409, 'La configuración de techo debe coincidir con el techo que eligió el comprador en su separación o venta']
  };
  const [status, message] = errores[(error as ErrorTechoBD | null)?.code ?? '']
    ?? [500, 'Error interno al procesar la configuración de techo'];
  return res.status(status).json({ ok: false, message });
}
