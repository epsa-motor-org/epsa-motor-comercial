import { Router } from 'express';
import { autenticar, exigirRoles } from '../middleware/autenticacion';
import type { FabricaCliente } from '../middleware/autenticacion';
import { obtenerFormulario, registrarComprador } from '../controllers/separacion.apoyo.controller';

const ROLES_SEPARACION = ['Gerente', 'Administradora', 'Vendedor'] as const;

// HU-005 · Datos que el panel necesita para separar: responsables, gerentes, techos, precios y comprador.
// El comprador se registra sin documento (nombres, apellidos y celular); ya no se busca por DNI.
export function crearRutasSeparacionApoyo(fabrica?: FabricaCliente) {
  const router = Router();
  router.use(autenticar(fabrica), exigirRoles(...ROLES_SEPARACION));
  router.get('/formulario', obtenerFormulario);
  router.post('/compradores', registrarComprador);
  return router;
}
