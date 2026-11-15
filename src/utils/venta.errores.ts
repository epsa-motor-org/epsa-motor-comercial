import type { Response } from 'express';
import { ErrorHttp } from './errores';
import type { ErrorVentaBD } from '../types/venta.types';

const ERRORES_VENTA: Record<string, [number, string]> = {
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
  PT612: [422, 'Los pagos y el adelanto superan el importe neto de la venta'],
  PT613: [409, 'La elección de techo no coincide o es incompatible con la unidad'],
  PT614: [409, 'La decisión final de techo de la venta no se puede modificar'],
  PT615: [422, 'La evidencia de pago no está guardada o no corresponde a esta unidad'],
  PT616: [400, 'Referencia y fecha del comprobante externo deben informarse juntas'],
  PT617: [422, 'El confirmador del pago no existe, está inactivo o no es gerente'],
  PT618: [409, 'La venta ya tiene un comprobante externo diferente'],
  PT619: [422, 'La venta no tiene snapshots financieros suficientes para calcular el importe'],
  PT620: [422, 'El adicional acordado del techo no es válido'],
  PT621: [422, 'Los pagos recibidos superan el total recalculado de la venta'],
  PT622: [400, 'Los parámetros de búsqueda de ventas no son válidos'],
  PT623: [409, 'La venta está cancelada y ya no se puede modificar'],
  PT624: [422, 'Los datos del descuento comercial no son válidos o están incompletos'],
  PT625: [422, 'El autorizador del descuento no existe, está inactivo o no es Gerente o Administradora'],
  PT626: [403, 'Un vendedor solo puede ser responsable de sus propias ventas'],
  PT680: [404, 'No se encontró la venta solicitada'],
  PT681: [400, 'Los datos de la corrección no son válidos'],
  PT682: [422, 'El comprador destino no existe o está inactivo'],
  PT683: [409, 'La relación cambió desde la consulta; actualiza la información e inténtalo de nuevo'],
  PT684: [409, 'La corrección no cambia la relación actual'],
  PT685: [409, 'La unidad destino tiene un compromiso vigente o no está disponible'],
  PT686: [403, 'El cambio de comprador con dinero o comprobante requiere revisión y confirmación de Gerente'],
  PT687: [409, 'Idempotency-Key ya fue usada con otra corrección'],
  PT688: [409, 'La unidad destino no es compatible con el precio base pactado'],
  PT689: [409, 'Solo se pueden corregir ventas Registradas'],
  PT690: [409, 'El intercambio debe involucrar exactamente dos ventas y sus dos unidades'],
  PT691: [422, 'La unidad destino no tiene una identificación válida'],
  PT692: [409, 'La separación antecedente no está convertida y debe revisarse antes de corregir'],
  PT438: [409, 'La elección de techo no es compatible con el techo instalado en esta unidad'],
  PT693: [409, 'La configuración de techo de la unidad destino contradice el acuerdo de la venta'],
  '23503': [404, 'No se encontró una unidad, comprador, responsable o sede'],
  '23505': [409, 'La unidad o la solicitud ya fue registrada'],
  '23514': [422, 'Los datos de venta o pago no cumplen las reglas permitidas'],
  '22P02': [400, 'Uno de los identificadores o datos numéricos tiene un formato inválido'],
  '22003': [422, 'Uno de los importes o identificadores excede el rango permitido'],
  '40001': [409, 'La unidad cambió durante la operación; consulta e inténtalo de nuevo'],
  '40P01': [409, 'Otra operación está modificando la unidad; consulta e inténtalo de nuevo'],
  // Validación del techo instalado (helper de HU-005 que también usa la venta)
  PT400: [400, 'Los datos de la unidad no son válidos'],
  PT404: [404, 'No se encontró la unidad'],
  // CP-006-12: bloqueo o espera cortada por otra operación sobre la misma moto
  '55P03': [409, 'Otra operación está modificando la unidad; consulta e inténtalo de nuevo'],
  '57014': [409, 'Otra operación está modificando la unidad; consulta e inténtalo de nuevo'],
  PGRST202: [503, 'El servicio de ventas no está disponible; vuelve a intentarlo más tarde']
};

const codigoDe = (error: unknown) => (error as ErrorVentaBD | null)?.code ?? '';

// ¿El error no tiene una respuesta controlada (terminaría en 500)?
export const esErrorVentaNoControlado = (error: unknown) =>
  !(error instanceof ErrorHttp) && !ERRORES_VENTA[codigoDe(error)] && !/^40/.test(codigoDe(error));

export function responderErrorVenta(res: Response, error: unknown) {
  if (error instanceof ErrorHttp)
    return res.status(error.status).json({ ok: false, message: error.message });

  const codigo = codigoDe(error);
  // Clase 40 (transacción revertida por concurrencia): conflicto controlado, no error interno
  const respuesta = ERRORES_VENTA[codigo]
    ?? (/^40/.test(codigo) ? [409, 'La unidad cambió durante la operación; consulta e inténtalo de nuevo'] as [number, string] : undefined);
  if (!respuesta) {
    // Queda en el log del servidor (sin datos del cliente) para identificar la causa
    const e = error as { code?: string; message?: string };
    console.error('[ventas] error no controlado', e?.code ?? '(sin código)', String(e?.message ?? error).slice(0, 300));
  }
  const [status, message] = respuesta ?? [500, 'Error interno al procesar la venta'];
  return res.status(status).json({ ok: false, message });
}

export function responderErrorCorreccionVenta(res: Response, error: unknown) {
  const codigo = (error as ErrorVentaBD | null)?.code ?? '';
  if (codigo === '42501')
    return res.status(403).json({ ok: false, message: 'Solo gerente y administradora pueden corregir relaciones de venta' });
  if (codigo === 'PT438')
    return res.status(409).json({ ok: false, message: 'La unidad destino tiene un techo instalado incompatible con el acuerdo de la venta' });
  return responderErrorVenta(res, error);
}
