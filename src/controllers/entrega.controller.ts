import type { RequestHandler } from 'express';
import * as servicio from '../services/entrega.service';
import { obtenerClaveIdempotenciaEntrega, validarConsultaEntrega, validarRegistrarEntrega } from '../utils/entrega.validacion';
import { responderErrorEntrega } from '../utils/entrega.errores';

export const consultarEntrega: RequestHandler = async (req, res) => {
  try {
    const codven = validarConsultaEntrega(req.params.codven);
    const data = await servicio.consultarEntrega(res.locals.db, codven);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorEntrega(res, error); }
};

export const registrarEntrega: RequestHandler = async (req, res) => {
  try {
    const datos = validarRegistrarEntrega(
      req.params.codven, req.body, obtenerClaveIdempotenciaEntrega(req.rawHeaders)
    );
    const data = await servicio.registrarEntrega(res.locals.db, datos);
    res.status(data.conflicto ? 409 : data.reutilizada ? 200 : 201).json({ ok: !data.conflicto, data });
  } catch (error) { responderErrorEntrega(res, error); }
};
