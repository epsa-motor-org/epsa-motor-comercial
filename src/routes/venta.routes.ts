import { Router } from 'express';
import { autenticar, exigirRoles } from '../middleware/autenticacion';
import type { FabricaCliente } from '../middleware/autenticacion';
import {
  consultarVentas, crearVenta, guardarComprobanteVenta, guardarTechoVenta, subirEvidenciaVenta
} from '../controllers/venta.controller';
import { recibirEvidenciaVenta } from '../middleware/venta.evidencia';
import { obtenerVentaDeUnidad } from '../controllers/venta.consulta.controller';
import { cancelarVenta, consultarCancelacionVenta } from '../controllers/cancelacion.controller';
import {
  consultarHistorialCorreccionVenta, corregirRelacionVenta, intercambiarRelacionVentas,
  previsualizarCorreccionVenta, previsualizarIntercambioVentas
} from '../controllers/venta.correccion.controller';

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
  router.get('/', autenticar(fabrica), exigirRoles(...ROLES_VENTA), consultarVentas);
  const ROLES_CORRECCION = ['Gerente', 'Administradora'] as const;
  router.get('/correccion-relacion/intercambio', autenticar(fabrica), exigirRoles(...ROLES_CORRECCION), previsualizarIntercambioVentas);
  router.post('/correccion-relacion/intercambio', autenticar(fabrica), exigirRoles(...ROLES_CORRECCION), intercambiarRelacionVentas);
  router.get('/:codven/correccion-relacion', autenticar(fabrica), exigirRoles(...ROLES_CORRECCION), previsualizarCorreccionVenta);
  router.post('/:codven/correccion-relacion', autenticar(fabrica), exigirRoles(...ROLES_CORRECCION), corregirRelacionVenta);
  router.get('/:codven/correcciones-relacion', autenticar(fabrica), exigirRoles(...ROLES_CORRECCION), consultarHistorialCorreccionVenta);
  router.put('/:codven/techo', autenticar(fabrica), exigirRoles(...ROLES_VENTA), guardarTechoVenta);
  router.put('/:codven/comprobante', autenticar(fabrica), exigirRoles(...ROLES_VENTA), guardarComprobanteVenta);
  router.post('/:codven/cancelacion', autenticar(fabrica), exigirRoles(...ROLES_VENTA), cancelarVenta);
  router.get('/:codven/cancelacion', autenticar(fabrica), exigirRoles(...ROLES_VENTA), consultarCancelacionVenta);
  return router;
}
