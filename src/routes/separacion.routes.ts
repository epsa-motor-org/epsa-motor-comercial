import { Router } from 'express';
import { autenticar, exigirRoles } from '../middleware/autenticacion';
import type { FabricaCliente } from '../middleware/autenticacion';
import { crearSeparacion } from '../controllers/separacion.controller';

const ROLES_SEPARACION = ['Gerente', 'Administradora', 'Vendedor'] as const;

export function crearRutasSeparacion(fabrica?: FabricaCliente) {
  const router = Router();
  router.post('/:coduni/separaciones', autenticar(fabrica), exigirRoles(...ROLES_SEPARACION), crearSeparacion);
  return router;
}
