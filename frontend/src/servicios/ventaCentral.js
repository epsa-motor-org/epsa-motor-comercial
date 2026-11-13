// HU-006 · Registrar una venta con cliente y unidad (API de Michelle: PR #45 y #47 del 12 de noviembre, y complementos
// 202611100002 y 202611130001)
// La venta se guarda en la base central con la sesión de la persona y una clave de intento (Idempotency-Key): si la
// red falla y se reintenta, no se registra dos veces. Si la moto estaba separada para el mismo comprador, la venta
// convierte esa separación: conserva su adelanto (no se vuelve a sumar como pago) y su decisión de techo.
// Desglose (regla de Harold del 11 de noviembre): el total lo calcula el servidor. Precio base = precio de lista del
// modelo (no se escribe); adicional del techo = el referencial del tipo elegido, o el que se acordó con el comprador
// (queda explícito); total = base + adicional; saldo = total − adelanto − pagos. «Sin techo» suma 0 y «Por definir»
// no suma nada hasta que se elija (entonces se recalculan total y saldo de la misma venta).
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
// Decisión de techo que quedó «Por definir» en la venta (una decisión final no se cambia). Con techo lleva el
// adicional acordado: el servidor recalcula total y saldo de la misma venta y rechaza pagos que superen el total.
export const guardarTechoVentaApi = (codven, decision, tipo, adicional) =>
  pedir(`/api/ventas/${codven}/techo`, { metodo: "PUT", cuerpo: { ...S.techoParaEnviar(decision, tipo), ...(decision === S.CON_TECHO ? { adicionalAcordado: adicional } : {}) } }).then((r) => r.data);
// Ventas registradas (Ventas a clientes): búsqueda por comprador, celular, motor, chasis o comprobante, por páginas
export const LIMITE_VENTAS = 20;
export const MAX_BUSQUEDA_VENTAS = 100;
export const ventasApi = ({ q = "", limite = LIMITE_VENTAS, offset = 0 } = {}) => {
  const t = S.limpio(q).slice(0, MAX_BUSQUEDA_VENTAS);
  const p = new URLSearchParams({ limite: String(limite), offset: String(offset) });
  if (t) p.set("q", t);
  return pedir(`/api/ventas?${p}`).then((r) => r.data || { items: [], total: 0, limite, offset });
};
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
export const redondear = (n) => Math.round(Number(n) * 100) / 100;

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

// ---------------------------------------------------------------------------------------------
// Desglose: precio base (lista) + adicional del techo = total
// ---------------------------------------------------------------------------------------------
// Adicional referencial de un tipo de techo del catálogo (null si el tipo no lo tiene configurado)
export const adicionalReferencialDe = (tipo) => {
  const n = Number(tipo?.adicionalReferencial);
  return tipo && tipo.adicionalReferencial !== null && tipo.adicionalReferencial !== undefined && Number.isFinite(n) && n >= 0 ? redondear(n) : null;
};
// Un adicional acordado distinto del referencial queda explícito; para evitar errores de tipeo se admite hasta el
// doble del referencial (el servidor solo exige que no sea negativo y tenga 2 decimales)
export const FACTOR_MAX_ADICIONAL = 2;
export const MAX_ENTEROS_ADICIONAL = 5;
export const maxAdicional = (referencial) => (typeof referencial === "number" && referencial > 0 ? redondear(referencial * FACTOR_MAX_ADICIONAL) : 99999.99);
export function errorAdicional(texto, referencial) {
  const t = String(texto ?? "").trim();
  if (!t) return "Escribe el adicional del techo (puede ser 0 si se acordó sin costo).";
  if (t.startsWith("-")) return "El adicional no puede ser negativo.";
  if (/[.,]$/.test(t)) return "Completa los decimales o borra la coma.";
  const n = S.leerMonto(t);
  if (Number.isNaN(n)) return "Escribe solo el monto, sin separador de miles (por ejemplo 1700 o 1700,50).";
  if (/[.,]\d{3,}$/.test(t)) return "El adicional lleva como máximo 2 decimales.";
  if (n < 0) return "El adicional no puede ser negativo.";
  const max = maxAdicional(referencial);
  if (n > max) return typeof referencial === "number" && referencial > 0 ? `El adicional no puede superar ${S.soles(max)} (el doble del referencial). Revisa el monto acordado.` : `El adicional no puede superar ${S.soles(max)}.`;
  return "";
}
export const ayudaAdicional = (referencial) => (typeof referencial === "number"
  ? `Referencial ${S.soles(referencial)}. Si se acordó otro monto con el comprador, escríbelo: queda registrado como acordado.`
  : "Este techo no tiene adicional referencial: escribe el monto acordado.");
// Total y saldo a la vista (el servidor los vuelve a calcular)
export function cuentasVenta({ base, adicional, adelanto = 0, pagos = 0 }) {
  if (typeof base !== "number" || !(base > 0)) return { total: null, recibido: redondear(adelanto + pagos), saldo: null };
  const total = redondear(base + (Number.isFinite(adicional) ? adicional : 0));
  const recibido = redondear(adelanto + pagos);
  return { total, recibido, saldo: redondear(total - recibido) };
}
// Texto del desglose del techo de una venta
export function textoAdicional(decision, nombre, acordado, referencial) {
  if (decision === S.POR_DEFINIR) return "Techo por definir: no suma hasta que el comprador lo elija";
  if (decision === S.SIN_TECHO) return "Sin techo: no suma";
  const dif = typeof acordado === "number" && typeof referencial === "number" && redondear(acordado) !== redondear(referencial);
  return `${nombre || "Techo"}${dif ? ` (acordado; referencial ${S.soles(referencial)})` : ""}`;
}

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
  if (typeof disponible === "number" && n > redondear(disponible) + 0.0001) return disponible > 0 ? `El pago no puede superar el saldo pendiente (${S.soles(disponible)}).` : "No queda saldo pendiente: este pago supera el total de la venta.";
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

// Forma de entrega pactada con el comprador (se guarda en la observación de la venta). Es un acuerdo pendiente: no
// marca la moto armada ni entregada (CP-006-06); su preparación real se ve en la ficha.
export const ENTREGAS = [
  { id: "", titulo: "Aún no se acuerda" },
  { id: "armada", titulo: "Armada" },
  { id: "embalada", titulo: "Embalada" },
];
export const PREFIJO_ENTREGA = "Entrega pactada (pendiente):";
export const textoEntrega = (entrega, sede) => {
  if (!entrega && !sede) return "";
  const modo = entrega ? `se entregará ${entrega === "armada" ? "armada" : "embalada"}` : "";
  return `${PREFIJO_ENTREGA} ${[modo, sede ? `en ${sede}` : ""].filter(Boolean).join(" ")}.`;
};
// Separa de la observación guardada la forma de entrega pactada (también la de ventas anteriores, «Entrega acordada:»)
export function partirObservacion(obs) {
  const t = String(obs || "").trim();
  const m = t.match(/^(?:Entrega pactada \(pendiente\):|Entrega acordada:)\s*([^.]*)\.\s*(.*)$/s);
  if (!m) return { entrega: "", resto: t };
  return { entrega: m[1].replace(/^se entregará\s+/, "").trim(), resto: m[2].trim() };
}

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
  if (/adicional\s*acordado|adicional(Techo)?Acordado/i.test(m)) return "adicional";
  if (/total recalculado|superan el importe/i.test(m)) return "pagos";
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
