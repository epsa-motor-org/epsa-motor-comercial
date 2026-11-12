import type { RequestHandler } from 'express';
import * as servicio from '../services/venta.service';
import { ErrorHttp } from '../utils/errores';
import { validarIdCompra } from '../utils/compra.validacion';
import {
  obtenerClaveIdempotenciaVenta, validarCrearVenta, validarGuardarTechoVenta,
  validarGuardarComprobanteVenta, validarConsultaVentas
} from '../utils/venta.validacion';
import { responderErrorVenta } from '../utils/venta.errores';
import { verificarBytesEvidencia } from '../utils/separacion.apoyo.validacion';

export const crearVenta: RequestHandler = async (req, res) => {
  try {
    const datos = validarCrearVenta(req.params.coduni, req.body, obtenerClaveIdempotenciaVenta(req.rawHeaders));
    const data = await servicio.crearVenta(res.locals.db, datos);
    res.status(data.reutilizada ? 200 : 201).json({ ok: true, data });
  } catch (error) { responderErrorVenta(res, error); }
};

export const guardarTechoVenta: RequestHandler = async (req, res) => {
  try {
    const datos = validarGuardarTechoVenta(req.params.codven, req.body);
    const data = await servicio.guardarTechoVenta(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorVenta(res, error); }
};

export const guardarComprobanteVenta: RequestHandler = async (req, res) => {
  try {
    const datos = validarGuardarComprobanteVenta(req.params.codven, req.body);
    const data = await servicio.guardarComprobanteVenta(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorVenta(res, error); }
};

export const consultarVentas: RequestHandler = async (req, res) => {
  try {
    const filtros = validarConsultaVentas(req.query);
    const data = await servicio.consultarVentas(res.locals.db, filtros);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorVenta(res, error); }
};

export const subirEvidenciaVenta: RequestHandler = async (req, res) => {
  try {
    const coduni = validarIdCompra(req.params.coduni, 'coduni');
    if (!req.file) throw new ErrorHttp(400, 'Adjunta la evidencia de pago en el campo archivo');
    const formato = verificarBytesEvidencia(req.file.buffer);
    const data = await servicio.subirEvidenciaVenta(res.locals.db, coduni, req.file.buffer, formato);
    res.status(201).json({ ok: true, data });
  } catch (error) { responderErrorVenta(res, error); }
};
