import type { RequestHandler } from 'express';
import * as servicio from '../services/separacion.service';
import {
  obtenerClaveIdempotencia, validarCrearSeparacion, validarGuardarTechoSeparacion
} from '../utils/separacion.validacion';
import { responderErrorSeparacion } from '../utils/separacion.errores';

export const crearSeparacion: RequestHandler = async (req, res) => {
  try {
    const datos = validarCrearSeparacion(
      req.params.coduni,
      req.body,
      obtenerClaveIdempotencia(req.rawHeaders)
    );
    const data = await servicio.crearSeparacion(res.locals.db, datos);
    if (!data.techo.guardado) {
      res.status(202).json({
        ok: true,
        data,
        warning: {
          code: 'TECHO_PENDIENTE_GUARDAR',
          message: 'La separación se registró, pero falta guardar la elección de techo'
        }
      });
      return;
    }
    res.status(data.reutilizada ? 200 : 201).json({ ok: true, data });
  } catch (error) { responderErrorSeparacion(res, error); }
};

export const reintentarTechoSeparacion: RequestHandler = async (req, res) => {
  try {
    const datos = validarGuardarTechoSeparacion(req.params.codsep, req.body);
    const data = await servicio.guardarTechoSeparacion(res.locals.db, datos);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorSeparacion(res, error); }
};
