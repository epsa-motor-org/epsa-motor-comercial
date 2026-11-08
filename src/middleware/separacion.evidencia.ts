import type { RequestHandler } from 'express';
import multer from 'multer';
import { MAX_BYTES_EVIDENCIA } from '../utils/separacion.apoyo.validacion';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const recibir = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES_EVIDENCIA, files: 1, fields: 0, parts: 2 },
  fileFilter: (_req, archivo, callback) => {
    if (!TIPOS.includes(archivo.mimetype)) callback(new Error('tipo'));
    else callback(null, true);
  }
}).single('archivo');

// HU-005 · Recibe la captura de la transferencia (un archivo en el campo «archivo»)
export const recibirEvidencia: RequestHandler = (req, res, next) => {
  recibir(req, res, error => {
    if (error) {
      const mensaje = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? 'La captura pesa más de 5 MB. Sube una más liviana.'
        : error instanceof Error && error.message === 'tipo'
          ? 'La captura debe ser una imagen PNG, JPG o WEBP, o un PDF.'
          : 'Envía un único archivo en el campo archivo mediante multipart/form-data';
      res.status(400).json({ ok: false, message: mensaje });
      return;
    }
    next();
  });
};
