import { Router } from 'express';
import { autenticar, exigirRoles } from '../middleware/autenticacion';
import type { FabricaCliente } from '../middleware/autenticacion';
import { crearSeparacion } from '../controllers/separacion.controller';
import { obtenerSeparacionActiva, subirEvidencia } from '../controllers/separacion.apoyo.controller';
import { recibirEvidencia } from '../middleware/separacion.evidencia';

const ROLES_SEPARACION = ['Gerente', 'Administradora', 'Vendedor'] as const;

export function crearRutasSeparacion(fabrica?: FabricaCliente) {
  const router = Router();
  router.get('/:coduni/separacion', autenticar(fabrica), exigirRoles(...ROLES_SEPARACION), obtenerSeparacionActiva);
  router.post('/:coduni/separaciones', autenticar(fabrica), exigirRoles(...ROLES_SEPARACION), crearSeparacion);
  router.post('/:coduni/separaciones/evidencia', autenticar(fabrica), exigirRoles(...ROLES_SEPARACION), recibirEvidencia, subirEvidencia);
  return router;
}
