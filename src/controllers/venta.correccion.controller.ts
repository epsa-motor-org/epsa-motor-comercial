import type { RequestHandler } from 'express';
import * as servicio from '../services/venta.correccion.service';
import { validarIdCompra } from '../utils/compra.validacion';
import {
  validarConsultaIntercambio, validarCorreccionRelacionVenta, validarIntercambioRelacionVentas
} from '../utils/venta.correccion.validacion';
import { responderErrorCorreccionVenta } from '../utils/venta.errores';

export const previsualizarCorreccionVenta: RequestHandler = async (req, res) => {
  try {
    const codven = validarIdCompra(req.params.codven, 'codven');
    const data = await servicio.previsualizarCorreccionVenta(res.locals.db, codven);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCorreccionVenta(res, error); }
};

export const corregirRelacionVenta: RequestHandler = async (req, res) => {
  try {
    const datos = validarCorreccionRelacionVenta(req.params.codven, req.body, req.rawHeaders);
    const data = await servicio.corregirRelacionVenta(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCorreccionVenta(res, error); }
};

export const previsualizarIntercambioVentas: RequestHandler = async (req, res) => {
  try {
    const datos = validarConsultaIntercambio(req.query);
    const data = await servicio.previsualizarIntercambioVentas(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCorreccionVenta(res, error); }
};

export const intercambiarRelacionVentas: RequestHandler = async (req, res) => {
  try {
    const datos = validarIntercambioRelacionVentas(req.body, req.rawHeaders);
    const data = await servicio.intercambiarRelacionVentas(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCorreccionVenta(res, error); }
};

export const consultarHistorialCorreccionVenta: RequestHandler = async (req, res) => {
  try {
    const codven = validarIdCompra(req.params.codven, 'codven');
    const data = await servicio.consultarHistorialCorreccionVenta(res.locals.db, codven);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorCorreccionVenta(res, error); }
};
