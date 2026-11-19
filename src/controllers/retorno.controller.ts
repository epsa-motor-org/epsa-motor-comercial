import type { RequestHandler } from 'express';
import * as servicio from '../services/retorno.service';
import { obtenerClaveIdempotenciaRetorno, validarRegistrarRetorno } from '../utils/retorno.validacion';
import { responderErrorRetorno } from '../utils/retorno.errores';

export const registrarRetorno: RequestHandler = async (req, res) => {
  try {
    const datos = validarRegistrarRetorno(
      req.params.codven, req.body, obtenerClaveIdempotenciaRetorno(req.rawHeaders)
    );
    const data = await servicio.registrarRetorno(res.locals.db, datos);
    res.status(data.reutilizada ? 200 : 201).json({ ok: true, data });
  } catch (error) { responderErrorRetorno(res, error); }
};
