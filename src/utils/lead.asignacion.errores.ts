import type { Response } from 'express';
import { ErrorHttp } from './errores';

export function responderErrorAsignacionLead(res: Response, error: unknown) {
  if (error instanceof ErrorHttp) return res.status(error.status).json({ ok: false, message: error.message });
  const codigo = (error as { code?: string } | null)?.code;
  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para esta operación de leads'],
    PT400: [400, 'Revisa los datos enviados para la asignación'],
    PT404: [404, 'El lead no existe'],
    PT407: [404, 'El responsable no existe o no está habilitado'],
    // Código vigente (migración 202610310001): PT407 hacía que PostgREST respondiera HTTP 407 y la API daba 500
    PT422: [404, 'El responsable no existe o no está habilitado'],
    PT416: [409, 'El responsable del lead cambió. Actualiza la lista e inténtalo nuevamente']
  };
  const [status, message] = errores[codigo ?? ''] ?? [500, 'Error interno al procesar leads'];
  return res.status(status).json({ ok: false, message });
}
