import type { RequestHandler, Response } from 'express';
import * as servicio from '../services/separacion.apoyo.service';
import { ErrorHttp } from '../utils/errores';
import { validarIdCompra } from '../utils/compra.validacion';
import {
  validarNumeroDocumento, validarRegistrarComprador, verificarBytesEvidencia
} from '../utils/separacion.apoyo.validacion';

// Mensajes de la base escritos para el usuario (PT400); nada interno sale en la respuesta.
const MENSAJES_COMPRADOR = new Set([
  'Tipo de documento inválido', 'El número no corresponde al tipo de documento', 'Número de documento inválido',
  'Nombre o razón social inválido', 'Apellido paterno inválido', 'Apellido materno inválido',
  'Teléfono inválido', 'Correo inválido'
]);

function responderErrorApoyo(res: Response, error: unknown) {
  if (error instanceof ErrorHttp) return res.status(error.status).json({ ok: false, message: error.message });
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === '42501') return res.status(403).json({ ok: false, message: 'No tienes permisos para separar motos' });
  if (code === 'PT400') {
    return res.status(400).json({
      ok: false, message: MENSAJES_COMPRADOR.has(message ?? '') ? message : 'Los datos del comprador no son válidos'
    });
  }
  return res.status(500).json({ ok: false, message: 'Error interno al preparar la separación' });
}

export const obtenerFormulario: RequestHandler = async (_req, res) => {
  try { res.json({ ok: true, data: await servicio.obtenerFormulario(res.locals.db) }); }
  catch (error) { responderErrorApoyo(res, error); }
};

export const buscarComprador: RequestHandler = async (req, res) => {
  try {
    const numero = validarNumeroDocumento(req.query.numero);
    res.json({ ok: true, data: await servicio.buscarComprador(res.locals.db, numero) });
  } catch (error) { responderErrorApoyo(res, error); }
};

export const registrarComprador: RequestHandler = async (req, res) => {
  try {
    const data = await servicio.registrarComprador(res.locals.db, validarRegistrarComprador(req.body));
    res.status(data.existente ? 200 : 201).json({ ok: true, data });
  } catch (error) { responderErrorApoyo(res, error); }
};

export const subirEvidencia: RequestHandler = async (req, res) => {
  try {
    const coduni = validarIdCompra(req.params.coduni, 'coduni');
    if (!req.file) throw new ErrorHttp(400, 'Adjunta la captura de la transferencia en el campo archivo');
    const formato = verificarBytesEvidencia(req.file.buffer);
    const data = await servicio.subirEvidencia(res.locals.db, coduni, req.file.buffer, formato);
    res.status(201).json({ ok: true, data });
  } catch (error) { responderErrorApoyo(res, error); }
};

export const obtenerSeparacionActiva: RequestHandler = async (req, res) => {
  try {
    const coduni = validarIdCompra(req.params.coduni, 'coduni');
    res.json({ ok: true, data: await servicio.obtenerSeparacionActiva(res.locals.db, coduni) });
  } catch (error) { responderErrorApoyo(res, error); }
};
