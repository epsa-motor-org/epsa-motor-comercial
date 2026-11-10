import { Router } from 'express';
import { autenticar, exigirRoles } from '../middleware/autenticacion';
import type { FabricaCliente } from '../middleware/autenticacion';
import {
  crearVenta, guardarComprobanteVenta, guardarTechoVenta, subirEvidenciaVenta
} from '../controllers/venta.controller';
import { recibirEvidenciaVenta } from '../middleware/venta.evidencia';
import { obtenerVentaDeUnidad } from '../controllers/venta.consulta.controller';

const ROLES_VENTA = ['Gerente', 'Administradora', 'Vendedor'] as const;

export function crearRutasVenta(fabrica?: FabricaCliente) {
  const router = Router();
  router.post('/:coduni/ventas/evidencia', autenticar(fabrica), exigirRoles(...ROLES_VENTA), recibirEvidenciaVenta, subirEvidenciaVenta);
  router.post('/:coduni/ventas', autenticar(fabrica), exigirRoles(...ROLES_VENTA), crearVenta);
  router.get('/:coduni/venta', autenticar(fabrica), exigirRoles(...ROLES_VENTA), obtenerVentaDeUnidad);
  return router;
}

export function crearRutasTechoVenta(fabrica?: FabricaCliente) {
  const router = Router();
  router.put('/:codven/techo', autenticar(fabrica), exigirRoles(...ROLES_VENTA), guardarTechoVenta);
  router.put('/:codven/comprobante', autenticar(fabrica), exigirRoles(...ROLES_VENTA), guardarComprobanteVenta);
  return router;
}
