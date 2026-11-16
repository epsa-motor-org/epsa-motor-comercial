// Sprint 2 · Estado de conexión de cada historia con la base de datos
// Con la API configurada (MODO_REAL), las historias del Sprint 2 leen y guardan en la base central.
// Sin API, el panel funciona como vista previa y guarda en este navegador.
import { MODO_REAL } from "./config";

// HU-011 usa el registro central del Sprint 3; requiere aplicar su migración junto al frontend.
export const CONECTADO = {
  "HU-001": MODO_REAL, // Consultar disponibilidad compartida
  "HU-003": MODO_REAL, // Registrar movimientos de ubicación
  "HU-005": false, // Separar una moto con adelanto confirmado (fuera del Sprint 2)
  "HU-011": MODO_REAL, // Enviar una consulta desde la web (Sprint 3)
  "HU-015": MODO_REAL, // Asignar o transferir un interesado
  "HU-023": MODO_REAL, // Consultar compras pendientes de identificación o recepción
  "HU-030": MODO_REAL, // Registrar compras y unidades desde facturas recibidas por correo
  "HU-033": MODO_REAL, // Actualizar la preparación de una unidad
  "HU-036": MODO_REAL, // Gestionar imágenes de modelos mediante API y almacenamiento central
  "EMT-97": MODO_REAL, // Mejora técnica de HU-026: contacto en ubicaciones de trabajo
};

export const siguienteId = (lista = []) => lista.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

// Nombre visible del cliente (persona o empresa)
export function nombreCliente(c) {
  if (!c) return "Cliente";
  if (c.tipoDoc === "RUC") return c.razonSocial || "Empresa";
  return [c.nombres, c.apellidoPaterno, c.apellidoMaterno].filter(Boolean).join(" ") || "Cliente";
}
