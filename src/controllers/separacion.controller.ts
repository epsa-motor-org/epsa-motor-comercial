import type { RequestHandler } from 'express';
import * as servicio from '../services/separacion.service';
import { obtenerClaveIdempotencia, validarCrearSeparacion } from '../utils/separacion.validacion';
import { responderErrorSeparacion } from '../utils/separacion.errores';

export const crearSeparacion: RequestHandler = async (req, res) => {
  try {
    const datos = validarCrearSeparacion(
      req.params.coduni,
      req.body,
      obtenerClaveIdempotencia(req.rawHeaders)
    );
    const data = await servicio.crearSeparacion(res.locals.db, datos);
    res.status(data.reutilizada ? 200 : 201).json({ ok: true, data });
  } catch (error) { responderErrorSeparacion(res, error); }
};
