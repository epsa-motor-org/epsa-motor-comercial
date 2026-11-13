import { Router } from 'express';
import { crearObtenerTiposTechoPublicos } from '../controllers/techo.publico.controller';
import type { FabricaClientePublicoTechos } from '../types/techo.publico.types';

export function crearRutasTechoPublico(fabrica?: FabricaClientePublicoTechos) {
  const router = Router();
  // Proyección pública de solo lectura: no requiere autenticar ni admite escritura.
  router.get('/', crearObtenerTiposTechoPublicos(fabrica));
  return router;
}
