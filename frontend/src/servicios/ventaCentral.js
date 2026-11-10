// HU-006 · Registrar una venta con cliente y unidad (API de Michelle, feature/HU-006-venta, y complemento 202611100002)
// La venta se guarda en la base central con la sesión de la persona y una clave de intento (Idempotency-Key): si la
// red falla y se reintenta, no se registra dos veces. Si la moto estaba separada para el mismo comprador, la venta
// convierte esa separación: conserva su adelanto (no se vuelve a sumar como pago) y su decisión de techo.
// La venta no confirma llegada, preparación ni entrega, ni emite comprobantes: la facturación es externa y aquí solo
// se registra su referencia y fecha reales cuando existen.
import { pedir, urlFirmadaStorage } from "../lib/api";
import * as S from "./separacionCentral";

export const BUCKET_VENTAS = "ventas-evidencia";

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------
// 201 nueva; 200 si era el mismo envío y ya estaba guardada
export const crearVentaApi = (coduni, cuerpo, clave) =>
  pedir(`/api/unidades/${coduni}/ventas`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } });
// Evidencia de una transferencia: carpeta privada de la moto (ventas/<coduni>/...)
export function subirEvidenciaVentaApi(coduni, archivo) {
  const fd = new FormData();
  fd.append("archivo", archivo, archivo.name || "evidencia");
  return pedir(`/api/unidades/${coduni}/ventas/evidencia`, { metodo: "POST", formulario: fd }).then((r) => r.data);
}
// Venta registrada de la moto (null si no tiene)
export const ventaDeUnidadApi = (coduni) => pedir(`/api/unidades/${coduni}/venta`).then((r) => r.data ?? null);
// Decisión de techo que quedó «Por definir» en la venta (una decisión final no se cambia)
export const guardarTechoVentaApi = (codven, decision, tipo) =>
  pedir(`/api/ventas/${codven}/techo`, { metodo: "PUT", cuerpo: S.techoParaEnviar(decision, tipo) }).then((r) => r.data);
// Comprobante externo ya emitido (referencia y fecha reales); no se emite ni modifica ningún documento
export const guardarComprobanteVentaApi = (codven, referencia, fecha) =>
  pedir(`/api/ventas/${codven}/comprobante`, { metodo: "PUT", cuerpo: { referencia, fecha } }).then((r) => r.data);
export const urlEvidenciaVentaApi = (ruta) => urlFirmadaStorage(BUCKET_VENTAS, ruta, 300);
// Sedes activas (las mismas de la web)
export const sedesVentaApi = () => pedir("/api/sedes", { privada: false }).then((r) => (r.data || []).map((x) => ({ codsed: String(x.codsed), nombre: x.nomsed, direccion: x.dirsed || "" })));

// Se puede vender una moto identificada (motor y chasis) que está libre, o separada (la venta convierte la separación
// del mismo comprador)
export const sePuedeVender = (u) => Boolean(u?.nummotuni && u?.chauni) && (u?.comercial === "Libre" || u?.comercial === "Separada");

// ---------------------------------------------------------------------------------------------
// Validaciones del panel (el servidor vuelve a validar todo)
// ---------------------------------------------------------------------------------------------
export const MODALIDADES = ["Contado", "Crédito"];
export const DIAS_FECHA_VENTA = 30; // la venta y sus pagos se registran con fecha de hoy o de los últimos 30 días
export const MAX_OBS_VENTA = 500;
export const MAX_OBS_PAGO = 300;
export const MIN_PAGO = 1;
// Importe realista: entre la mitad y 1.3 veces el precio de lista (el techo y los accesorios pueden subirlo)
export const FACTOR_MIN_IMPORTE = 0.5;
export const FACTOR_MAX_IMPORTE = 1.3;
export const redondear = (n) => Math.round(Number(n) * 100) / 100;
export const rangoImporte = (precio) => (typeof precio === "number" && precio > 0
  ? { min: redondear(precio * FACTOR_MIN_IMPORTE), max: redondear(precio * FACTOR_MAX_IMPORTE) }
  : null);

export function fechaMinimaVenta() {
  const [y, m, d] = S.hoyLima().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - DIAS_FECHA_VENTA)).toISOString().slice(0, 10);
}
// Fecha de la venta: de hoy o de los últimos 30 días, y no antes de la separación que convierte
export function errorFechaVenta(fecha, desde = "") {
  if (!fecha) return "Indica la fecha de la venta.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "Escribe una fecha válida.";
  if (fecha > S.hoyLima()) return "La fecha no puede ser posterior a hoy.";
  if (fecha < fechaMinimaVenta()) return `La fecha no puede ser de hace más de ${DIAS_FECHA_VENTA} días.`;
  if (desde && fecha < desde) return "La venta no puede tener fecha anterior a la separación que convierte.";
  return "";
}
export function errorFechaPago(fecha) {
  if (!fecha) return "Indica la fecha en que se recibió el pago.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "Escribe una fecha válida.";
  if (fecha > S.hoyLima()) return "La fecha no puede ser posterior a hoy.";
  if (fecha < fechaMinimaVenta()) return `La fecha no puede ser de hace más de ${DIAS_FECHA_VENTA} días.`;
  return "";
}

// Importe de la venta (texto como se escribió): mayor que cero, 2 decimales, dentro del rango y no menor que el
// adelanto de la separación (un pago que pasa el saldo se avisa en el propio pago)
export function errorImporte(texto, precio, recibido = 0) {
  const t = String(texto ?? "").trim();
  if (!t) return "Escribe el importe de la venta.";
  if (t.startsWith("-")) return "El importe debe ser mayor que cero.";
  if (/[.,]$/.test(t)) return "Completa los decimales o borra la coma.";
  const n = S.leerMonto(t);
  if (Number.isNaN(n)) return "Escribe solo el importe, sin separador de miles (por ejemplo 17199 o 17199,50).";
  if (n <= 0) return "El importe debe ser mayor que cero.";
  if (/[.,]\d{3,}$/.test(t)) return "El importe lleva como máximo 2 decimales.";
  if (precio === null) return "Esta moto no tiene precio de lista registrado. Pide a gerencia que lo registre en Modelos antes de venderla.";
  const r = rangoImporte(precio);
  if (r && n > r.max) return `El importe no puede superar ${S.soles(r.max)} (precio de lista más 30 %).`;
  if (r && n < r.min) return `El importe no puede ser menor que ${S.soles(r.min)} (la mitad del precio de lista).`;
  if (n < recibido) return `El importe no puede ser menor que el adelanto de la separación (${S.soles(recibido)}).`;
  return "";
}
export const ayudaImporte = (precio) => {
  const r = rangoImporte(precio);
  return r ? `Precio de lista ${S.soles(precio)}. Puede ir de ${S.soles(r.min)} a ${S.soles(r.max)}. Sin separador de miles.` : "Sin separador de miles.";
};

// Monto de un pago: mayor que cero, 2 decimales y sin pasar el saldo pendiente
export function errorMontoPago(texto, disponible) {
  const t = String(texto ?? "").trim();
  if (!t) return "Escribe el monto del pago.";
  if (t.startsWith("-")) return "El pago debe ser mayor que cero.";
  if (/[.,]$/.test(t)) return "Completa los decimales o borra la coma.";
  const n = S.leerMonto(t);
  if (Number.isNaN(n)) return "Escribe solo el monto, sin separador de miles.";
  if (n <= 0) return "El pago debe ser mayor que cero.";
  if (/[.,]\d{3,}$/.test(t)) return "El monto lleva como máximo 2 decimales.";
  if (n < MIN_PAGO) return `El pago mínimo es ${S.soles(MIN_PAGO)}.`;
  if (typeof disponible === "number" && n > redondear(disponible) + 0.0001) return disponible > 0 ? `El pago no puede superar el saldo pendiente (${S.soles(disponible)}).` : "No queda saldo pendiente: este pago supera el importe de la venta.";
  return "";
}

// Comprobante externo: serie y número tal como figuran en la boleta o factura (B001-00012345, F001-123)
export const MAX_COMPROBANTE = 20;
export const filtrarComprobante = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, MAX_COMPROBANTE);
export function errorComprobante(referencia, fecha, fechaVenta) {
  const e = {};
  if (!referencia) e.referencia = "Escribe la serie y el número del comprobante.";
  else if (!/^[A-Z0-9]{4}-\d{1,8}$/.test(referencia)) e.referencia = "Escribe la serie (4 caracteres) y el número, por ejemplo B001-00012345 o F001-123.";
  if (!fecha) e.fecha = "Indica la fecha de emisión del comprobante.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) e.fecha = "Escribe una fecha válida.";
  else if (fecha > S.hoyLima()) e.fecha = "La fecha de emisión no puede ser posterior a hoy.";
  else if (fechaVenta && fecha < fechaVenta) e.fecha = "La fecha de emisión no puede ser anterior a la fecha de la venta.";
  return e;
}

// Observación con palabras (no solo números o símbolos)
export function errorTextoLibre(v, max) {
  const t = S.limpio(v);
  if (!t) return "";
  if ([...t].length > max) return `Máximo ${max} caracteres.`;
  if ((t.match(/\p{L}/gu) || []).length < 3) return "Escribe la observación con palabras.";
  return "";
}

// Entrega acordada (se guarda en la observación de la venta: no marca la moto armada ni entregada)
export const ENTREGAS = [
  { id: "", titulo: "Aún no se acuerda" },
  { id: "armada", titulo: "Armada" },
  { id: "embalada", titulo: "Embalada" },
];
export const textoEntrega = (entrega, sede) => {
  if (!entrega && !sede) return "";
  const modo = entrega ? `${entrega === "armada" ? "armada" : "embalada"}` : "";
  return `Entrega acordada: ${[modo, sede ? `en ${sede}` : ""].filter(Boolean).join(" ")}.`;
};

// Fecha (YYYY-MM-DD) de un valor de la base que puede venir con hora (la fecha de la venta se guarda como el día
// indicado a medianoche: se toma tal cual)
export const soloFecha = (v) => String(v || "").slice(0, 10);
// Día en Lima de un instante (por ejemplo, cuándo se registró la separación)
export function fechaLima(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return soloFecha(iso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Mensaje claro para los errores de la venta
export function campoDelError(e) {
  const m = String(e?.message || "");
  if (/importe|superan el importe/i.test(m)) return "importe";
  if (/evidencia/i.test(m)) return "pagos";
  if (/confirmador|gerente/i.test(m)) return "pagos";
  if (/pago|efectivo|transferencia/i.test(m)) return "pagos";
  if (/techo/i.test(m)) return "techo";
  if (/comprobante/i.test(m)) return "comprobante";
  if (/responsable/i.test(m)) return "responsable";
  if (/sede/i.test(m)) return "sede";
  if (/comprador/i.test(m)) return "comprador";
  return "general";
}
