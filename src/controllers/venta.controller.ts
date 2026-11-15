import type { RequestHandler } from 'express';
import * as servicio from '../services/venta.service';
import { ErrorHttp } from '../utils/errores';
import { validarIdCompra } from '../utils/compra.validacion';
import {
  obtenerClaveIdempotenciaVenta, validarCrearVenta, validarGuardarTechoVenta,
  validarGuardarComprobanteVenta, validarConsultaVentas
} from '../utils/venta.validacion';
import { esErrorVentaNoControlado, responderErrorVenta } from '../utils/venta.errores';
import { ventaDeUnidad } from '../services/venta.consulta.service';
import { verificarBytesEvidencia } from '../utils/separacion.apoyo.validacion';

export const crearVenta: RequestHandler = async (req, res) => {
  let datos: ReturnType<typeof validarCrearVenta> | undefined;
  try {
    datos = validarCrearVenta(req.params.coduni, req.body, obtenerClaveIdempotenciaVenta(req.rawHeaders));
    const data = await servicio.crearVenta(res.locals.db, datos);
    res.status(data.reutilizada ? 200 : 201).json({ ok: true, data });
  } catch (error) {
    // CP-006-12: si dos personas venden la misma moto a la vez y la base responde algo no previsto, se revisa cómo quedó
    // la moto antes de responder. Si ya tiene una venta registrada de otra solicitud, es un conflicto (409), no un 500.
    if (datos && esErrorVentaNoControlado(error)) {
      const venta = await ventaDeUnidad(res.locals.db, String(datos.p_coduni)).catch(() => null);
      if (venta && (venta as { estado?: string }).estado !== 'Cancelada')
        return void res.status(409).json({ ok: false, message: 'La unidad ya tiene una venta o su estado comercial no permite venderla' });
    }
    responderErrorVenta(res, error);
  }
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
