import { Router } from 'express';
import { autenticar, exigirRoles } from '../middleware/autenticacion';
import type { FabricaCliente } from '../middleware/autenticacion';
import { buscarComprador, obtenerFormulario, registrarComprador } from '../controllers/separacion.apoyo.controller';

const ROLES_SEPARACION = ['Gerente', 'Administradora', 'Vendedor'] as const;

// HU-005 · Datos que el panel necesita para separar: responsables, gerentes, tipos de documento y comprador
export function crearRutasSeparacionApoyo(fabrica?: FabricaCliente) {
  const router = Router();
  router.use(autenticar(fabrica), exigirRoles(...ROLES_SEPARACION));
  router.get('/formulario', obtenerFormulario);
  router.get('/compradores', buscarComprador);
  router.post('/compradores', registrarComprador);
  return router;
}
