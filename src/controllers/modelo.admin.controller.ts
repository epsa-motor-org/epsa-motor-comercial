import type { RequestHandler, Response } from 'express';
import { ErrorHttp } from '../utils/errores';
import * as servicio from '../services/modelo.admin.service';
import { validarActualizarImagenModelo, validarCambiosModelo, validarCrearImagenModelo, validarCrearModelo, validarEstadoImagenModelo, validarEstadoModelo, validarIdImagenModelo, validarIdModeloAdmin } from '../utils/modelo.admin.validacion';
import { verificarUrlImagen } from '../utils/imagen.contenido';

function responderErrorModeloAdmin(res: Response, error: unknown) {
  if (error instanceof ErrorHttp) return res.status(error.status).json({ ok: false, message: error.message });
  const code = (error as { code?: string } | null)?.code;
  const mensajeSql = (error as { message?: string } | null)?.message;
  const errores: Record<string, [number, string]> = {
    '42501': [403, 'No tienes permisos para administrar modelos'],
    PT400: [400, 'Los datos del modelo no son válidos'],
    PT404: [404, 'El modelo no existe'],
    PT405: [404, 'El tipo de motocar no existe'],
    PT409: [409, 'El color ya está registrado para este modelo'],
    PT422: [400, 'El modelo no tiene la información requerida para publicarse'],
    '23514': [400, 'Los datos del modelo no son válidos'],
    '23503': [404, 'El modelo o tipo de motocar no existe'],
    '23505': [409, 'El color ya está registrado para este modelo'],
    '22P02': [400, 'Los datos del modelo no son válidos'],
    '22003': [400, 'Los datos del modelo no son válidos']
  };
  if (code === 'PT404' && mensajeSql === 'Imagen inexistente para el modelo')
    return res.status(404).json({ ok: false, message: 'La imagen no existe para el modelo' });
  const [status, message] = errores[code ?? ''] ?? [500, 'Error interno al procesar el modelo'];
  return res.status(status).json({ ok: false, message });
}

function rechazarQuery(req: Parameters<RequestHandler>[0], res: Response): boolean {
  if (Object.keys(req.query).length === 0) return false;
  res.status(400).json({ ok: false, message: 'La consulta administrativa de modelos no admite parámetros' });
  return true;
}

export const crearListarModelosAdmin: RequestHandler = async (req, res) => {
  if (rechazarQuery(req, res)) return;
  try {
    const data = await servicio.listarModelosAdmin(res.locals.db);
    res.set('Cache-Control', 'no-store').json({ ok: true, data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};

export const crearObtenerModeloAdmin: RequestHandler = async (req, res) => {
  try {
    const datos = validarCrearModelo(req.body);
    const data = await servicio.crearModelo(res.locals.db, datos);
    res.status(201).json({ ok: true, message: 'Modelo registrado correctamente', data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};

export const crearActualizarModelo: RequestHandler = async (req, res) => {
  try {
    const codmod = validarIdModeloAdmin(req.params.id);
    const cambios = validarCambiosModelo(req.body);
    const data = await servicio.actualizarModelo(res.locals.db, codmod, cambios);
    res.json({ ok: true, message: 'Modelo actualizado correctamente', data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};

export const crearCambiarEstadoModelo: RequestHandler = async (req, res) => {
  try {
    const codmod = validarIdModeloAdmin(req.params.id);
    const body = validarEstadoModelo(req.body);
    const data = await servicio.cambiarEstadoModelo(res.locals.db, codmod, body);
    res.json({ ok: true, message: 'Estado del modelo actualizado correctamente', data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};

export const crearAgregarImagenModelo: RequestHandler = async (req, res) => {
  try {
    const codmod = validarIdModeloAdmin(req.params.id);
    const imagen = validarCrearImagenModelo(req.body);
    // HU-036: el archivo debe ser una imagen legible antes de registrarlo (también si se llama sin el panel)
    await verificarUrlImagen(imagen.urlimo);
    const data = await servicio.agregarImagenModelo(res.locals.db, codmod, imagen);
    res.status(201).json({ ok: true, message: 'Imagen registrada correctamente', data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};

export const crearActualizarImagenModelo: RequestHandler = async (req, res) => {
  try {
    const codmod = validarIdModeloAdmin(req.params.id);
    const codimo = validarIdImagenModelo(req.params.codimo);
    const imagen = validarActualizarImagenModelo(req.body);
    // HU-036: si el archivo nuevo está dañado, se rechaza y la foto anterior queda como estaba
    await verificarUrlImagen(imagen.urlimo);
    const data = await servicio.actualizarImagenModelo(res.locals.db, codmod, codimo, imagen);
    res.json({ ok: true, message: 'Imagen actualizada correctamente', data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};

export const crearCambiarEstadoImagenModelo: RequestHandler = async (req, res) => {
  try {
    const codmod = validarIdModeloAdmin(req.params.id);
    const codimo = validarIdImagenModelo(req.params.codimo);
    const body = validarEstadoImagenModelo(req.body);
    const data = await servicio.cambiarEstadoImagenModelo(res.locals.db, codmod, codimo, body);
    res.json({ ok: true, message: 'Estado de imagen actualizado correctamente', data });
  } catch (error) { responderErrorModeloAdmin(res, error); }
};
