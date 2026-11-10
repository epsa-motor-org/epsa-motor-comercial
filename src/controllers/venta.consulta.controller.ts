import type { RequestHandler } from 'express';
import * as servicio from '../services/venta.consulta.service';
import { validarIdCompra } from '../utils/compra.validacion';
import { responderErrorVenta } from '../utils/venta.errores';

// GET /api/unidades/:coduni/venta · Venta registrada de la moto (null si no tiene)
export const obtenerVentaDeUnidad: RequestHandler = async (req, res) => {
  try {
    const coduni = validarIdCompra(req.params.coduni, 'coduni');
    const data = await servicio.ventaDeUnidad(res.locals.db, coduni);
    res.status(200).json({ ok: true, data });
  } catch (error) { responderErrorVenta(res, error); }
};
