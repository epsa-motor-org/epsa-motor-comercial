import type { Response } from 'express';
import { ErrorHttp } from './errores';
import { validarIdCompra } from './compra.validacion';
import type { CoincidenciaLead } from '../types/lead.types';

function coincidenciaSegura(details: string | undefined): CoincidenciaLead | undefined {
  try {
    const valor = JSON.parse(details ?? '');
    if (!valor || !['Nuevo', 'Contactado', 'En seguimiento'].includes(valor.estlea) ||
      typeof valor.codlea !== 'string' || !(valor.codmod === null || typeof valor.codmod === 'string')) return;
    return { codlea: validarIdCompra(valor.codlea, 'codlea'),
      codmod: valor.codmod === null ? null : validarIdCompra(valor.codmod, 'codmod'), estlea: valor.estlea };
  } catch { return; }
}

export function responderErrorLead(res: Response, error: unknown) {
  if (error instanceof ErrorHttp) return res.status(error.status).json({ ok: false, message: error.message });
  const bd = error as { code?: string; details?: string } | null;
  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para registrar leads'],
    PT400: [400, 'Revisa los datos obligatorios y el próximo seguimiento del lead'],
    PT404: [404, 'El modelo no existe o no está publicado'],
    PT405: [404, 'La sede no existe'],
    PT406: [404, 'El canal WhatsApp no existe'],
    PT407: [404, 'El responsable no existe o no está habilitado'],
    // Código vigente (migración 202610310001): PT407 hacía que PostgREST respondiera HTTP 407 y la API daba 500
    PT422: [404, 'El responsable no existe o no está habilitado'],
    PT409: [409, 'Ya existe una oportunidad activa para este contacto'],
    '23514': [400, 'Los datos no cumplen las restricciones del lead']
  };
  const [status, message] = errores[bd?.code ?? ''] ?? [500, 'Error interno al registrar el lead'];
  const coincidencia = bd?.code === 'PT409' ? coincidenciaSegura(bd.details) : undefined;
  return res.status(status).json({ ok: false, message, ...(coincidencia ? { coincidencia } : {}) });
}
