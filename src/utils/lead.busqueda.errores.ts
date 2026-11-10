import type { Response } from 'express';
import { ErrorHttp } from './errores';

export function responderErrorBusquedaLead(res: Response, error: unknown) {
  if (error instanceof ErrorHttp) return res.status(error.status).json({ ok: false, message: error.message });
  const codigo = (error as { code?: string } | null)?.code;
  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para buscar leads'],
    PT400: [400, 'Revisa el texto de búsqueda'],
    PT409: [409, 'No se pudo completar la búsqueda; vuelve a intentarlo']
  };
  const [status, message] = errores[codigo ?? ''] ?? [500, 'Error interno al buscar leads'];
  return res.status(status).json({ ok: false, message });
}
