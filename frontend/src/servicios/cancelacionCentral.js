// HU-021 · Cancelar una separación o una venta sin borrar su información (API de Michelle, PR #48)
// La cancelación deja la operación «Cancelada» con su motivo, quién la canceló y cuándo; conserva el adelanto, los
// pagos, las evidencias y el comprobante, y libera la moto solo si no le queda otro compromiso vigente. No mueve la
// moto ni cambia su techo o preparación, no registra devoluciones ni anula comprobantes.
// Permisos (regla de Harold del 12/11): gerente y administradora cancelan cualquiera; el vendedor, solo las
// operaciones de las que es responsable comercial vigente (no las que registró para otro). El servidor lo vuelve a
// comprobar al confirmar: el botón oculto no es la autorización.
// Cada intento lleva una clave (Idempotency-Key): si la red falla y se reintenta con los mismos datos, no se cancela
// dos veces y se recibe el resultado ya guardado.
import { cancelacionesUnidadApi, pedir } from "../lib/api";
import { faltaInstalar } from "./separacionCentral";

export const MAX_MOTIVO = 250;
export const MAX_OBS_DINERO = 2000;
export const SEPARACION = "separación";
export const VENTA = "venta";

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------
const cuerpoDe = (motivo, observacion) => {
  const o = normalizar(observacion);
  return { motivo: normalizar(motivo), ...(o ? { observacionDinero: o } : {}) };
};
export const cancelarSeparacionApi = (codsep, motivo, observacion, clave) =>
  pedir(`/api/separaciones/${codsep}/cancelacion`, { metodo: "POST", cuerpo: cuerpoDe(motivo, observacion), headers: { "Idempotency-Key": clave } }).then((r) => r.data);
export const cancelarVentaApi = (codven, motivo, observacion, clave) =>
  pedir(`/api/ventas/${codven}/cancelacion`, { metodo: "POST", cuerpo: cuerpoDe(motivo, observacion), headers: { "Idempotency-Key": clave } }).then((r) => r.data);
// Cancelación registrada de una operación (null si no se canceló)
export const cancelacionDeApi = (tipo, cod) =>
  pedir(`/api/${tipo === VENTA ? "ventas" : "separaciones"}/${cod}/cancelacion`).then((r) => r.data ?? null);
// Separaciones y ventas canceladas de una moto (el vendedor ve solo las suyas)
export const cancelacionesDeUnidadApi = (coduni) => cancelacionesUnidadApi(coduni).then((r) => (Array.isArray(r) ? r : []));

// ---------------------------------------------------------------------------------------------
// Permiso (solo para mostrar u ocultar el botón; el servidor decide)
// ---------------------------------------------------------------------------------------------
export function permisoCancelar(user, operacion) {
  const rol = String(user?.rol || "").toLowerCase();
  if (rol === "gerente" || rol === "administradora") return { puede: true, texto: "" };
  if (rol !== "vendedor") return { puede: false, texto: "Tu rol no cancela operaciones comerciales." };
  const r = operacion?.responsable;
  if (!r?.codusu) return { puede: false, texto: "No tiene responsable asignado: la cancelan el gerente o la administradora." };
  if (String(r.codusu) === String(user?.codusu ?? "")) return { puede: true, texto: "" };
  return { puede: false, texto: `La cancelan su responsable${r.nombre ? ` (${r.nombre})` : ""}, el gerente o la administradora.` };
}

// ---------------------------------------------------------------------------------------------
// Validación (la misma del servidor: espacios repetidos se juntan; sin caracteres de control)
// ---------------------------------------------------------------------------------------------
export const normalizar = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const CONTROL = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex
// ¿Hace falta explicar qué pasó con el dinero? En una separación siempre (tiene adelanto); en una venta, si se
// recibió algo (adelanto confirmado o pagos).
export const exigeObservacion = (tipo, recibido) => tipo === SEPARACION || Number(recibido) > 0;
export function erroresCancelacion(motivo, observacion, exige) {
  const m = normalizar(motivo);
  const o = normalizar(observacion);
  const e = {};
  if (!m) e.motivo = "Escribe el motivo de la cancelación.";
  else if (m.length > MAX_MOTIVO) e.motivo = `El motivo admite hasta ${MAX_MOTIVO} caracteres (tiene ${m.length}).`;
  else if (CONTROL.test(m)) e.motivo = "El motivo tiene caracteres que no se pueden guardar.";
  if (!o && exige) e.observacion = "Anota qué pasó con el dinero recibido y su evidencia (por ejemplo, si sigue en caja o si el comprador pidió su devolución).";
  else if (o.length > MAX_OBS_DINERO) e.observacion = `La observación admite hasta ${MAX_OBS_DINERO} caracteres (tiene ${o.length}).`;
  else if (o && CONTROL.test(o)) e.observacion = "La observación tiene caracteres que no se pueden guardar.";
  return e;
}
export const firmaCancelacion = (cod, motivo, observacion) => JSON.stringify([String(cod), normalizar(motivo), normalizar(observacion)]);

// ---------------------------------------------------------------------------------------------
// Errores del servidor en palabras de la pantalla. Devuelve { campo, texto, cambio }: «campo» marca el campo del
// formulario y «cambio» indica que la operación cambió (hay que revisar qué pasó y refrescar la ficha).
// ---------------------------------------------------------------------------------------------
export function errorCancelacion(er, tipo) {
  const msg = String(er?.message || "");
  const st = er?.status;
  if (faltaInstalar(er)) return { texto: "La API conectada todavía no tiene la cancelación (HU-021): falta desplegar su versión nueva. No se canceló nada." };
  if (st === 403) {
    return /responsable/i.test(msg)
      ? { cambio: true, texto: `No se canceló: ya no eres el responsable comercial vigente de esta ${tipo}. La responsabilidad pudo cambiar mientras tenías abierta la pantalla.` }
      : { texto: `No se canceló: tu usuario no tiene permiso para cancelar esta ${tipo}.` };
  }
  if (st === 404) return { cambio: true, texto: `No se encontró esta ${tipo}. Actualiza la ficha.` };
  if (st === 409) {
    if (/convertida/i.test(msg)) return { cambio: true, texto: "No se canceló: la separación ya se convirtió en venta. Para liberar la moto hay que cancelar la venta vigente; la moto sigue vendida." };
    if (/idempotency/i.test(msg)) return { texto: "Este intento ya se usó con otros datos. Vuelve a pulsar el botón para enviarlo como un intento nuevo." };
    return { cambio: true, texto: `No se canceló: la ${tipo} ya cambió de estado (otra persona la canceló, la convirtió o la moto cambió). Actualiza la ficha.` };
  }
  if (st === 422 || st === 400) {
    if (/observaci/i.test(msg)) return { campo: "observacion", texto: /obligatoria|registra una observaci/i.test(msg) ? "Anota qué pasó con el dinero recibido y su evidencia." : "Revisa la observación: admite hasta 2000 caracteres sin caracteres especiales." };
    if (/motivo/i.test(msg)) return { campo: "motivo", texto: "Escribe el motivo (hasta 250 caracteres, sin caracteres especiales)." };
  }
  if (st === 401) return { texto: "Tu sesión venció. Vuelve a iniciar sesión; no se canceló nada." };
  return { texto: msg || "No se pudo cancelar." };
}

// Cancelación ya registrada: ¿la hizo esta persona con estos mismos datos? (para confirmar tras una falla de red)
export const esMiCancelacion = (c, codusu, motivo) =>
  Boolean(c && String(c.actor?.codusu ?? "") === String(codusu ?? "") && normalizar(c.motivo) === normalizar(motivo));

// Texto de cómo quedó la moto
export const ESTADO_MOTO = { Disponible: "Libre para vender", Separada: "Sigue separada (tiene otra separación activa)", Vendida: "Sigue vendida (tiene otra venta vigente)" };
export const textoEstadoMoto = (e) => ESTADO_MOTO[e] || e || "Sin dato";
export const textoTipo = (t) => (t === "Venta" ? "Venta" : "Separación");
