import type { RequestHandler } from 'express';
import { crearClientePublicoSupabase } from '../config/supabase';
import { listarTiposTechoPublicos } from '../services/techo.publico.service';
import type { FabricaClientePublicoTechos } from '../types/techo.publico.types';

// GET /api/techos · Tipos de techo activos con su adicional referencial (web pública y panel)
export function crearObtenerTiposTechoPublicos(
  crearCliente: FabricaClientePublicoTechos = crearClientePublicoSupabase
): RequestHandler {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).length > 0) {
      res.status(400).json({ ok: false, message: 'La consulta pública de techos no admite parámetros' });
      return;
    }
    try {
      const data = await listarTiposTechoPublicos(crearCliente());
      res.json({ ok: true, data });
    } catch {
      // Nunca propagar message/details/hint ni el error crudo de Supabase.
      res.status(500).json({ ok: false, message: 'Error al consultar los tipos de techo' });
    }
  };
}
