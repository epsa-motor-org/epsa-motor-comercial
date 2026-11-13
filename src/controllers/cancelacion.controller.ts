import type { RequestHandler } from 'express';
import * as servicio from '../services/cancelacion.service';
import {
  obtenerClaveIdempotenciaCancelacion, validarCancelarSeparacion, validarCancelarVenta
} from '../utils/cancelacion.validacion';
import { validarIdCompra } from '../utils/compra.validacion';
import { responderErrorCancelacion } from '../utils/cancelacion.errores';

export const cancelarSeparacion: RequestHandler = async (req, res) => {
  try {
    const datos = validarCancelarSeparacion(
      req.params.codsep, req.body, obtenerClaveIdempotenciaCancelacion(req.rawHeaders)
    );
    const data = await servicio.cancelarSeparacion(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCancelacion(res, error); }
};

export const cancelarVenta: RequestHandler = async (req, res) => {
  try {
    const datos = validarCancelarVenta(
      req.params.codven, req.body, obtenerClaveIdempotenciaCancelacion(req.rawHeaders)
    );
    const data = await servicio.cancelarVenta(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCancelacion(res, error); }
};

export const consultarCancelacionSeparacion: RequestHandler = async (req, res) => {
  try {
    const codsep = validarIdCompra(req.params.codsep, 'codsep');
    const data = await servicio.consultarCancelacionSeparacion(res.locals.db, codsep);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCancelacion(res, error); }
};

export const consultarCancelacionVenta: RequestHandler = async (req, res) => {
  try {
    const codven = validarIdCompra(req.params.codven, 'codven');
    const data = await servicio.consultarCancelacionVenta(res.locals.db, codven);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCancelacion(res, error); }
};
