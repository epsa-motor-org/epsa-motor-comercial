// HU-022 · Corregir el comprador o la moto de una venta registrada (API de Michelle, PR #51)
// La venta no se cancela ni se crea otra: se cambia su comprador, su moto o ambos, con un motivo, y queda un evento en
// el historial (quién, cuándo, antes y después). Pagos, adelanto, evidencias, importes y comprobante siguen en la
// misma venta. Solo gerente y administradora; el servidor lo vuelve a comprobar en cada consulta y confirmación.
// Reglas que el servidor aplica al confirmar (aquí se adelantan para no ofrecer lo que va a rechazar):
// - La moto nueva debe estar libre (sin venta ni separación vigente), con motor, chasis y modelo.
// - Si es de otro modelo, su precio de lista debe ser el precio base pactado en la venta (PT688).
// - Un techo instalado distinto de lo acordado bloquea (PT438). Un techo solo configurado no: se muestra la diferencia
//   para ajustar la configuración en la ficha (regla del PO del 13/11, migración 202611140004).
// - Cambiar el comprador de una venta con dinero recibido o comprobante solo lo confirma el gerente (PT686).
// Cada confirmación lleva su clave (Idempotency-Key): si la red falla y se reintenta igual, no se corrige dos veces.
import { correccionesDetalleApi, pedir } from "../lib/api";
import { faltaInstalar, soles, CON_TECHO, POR_DEFINIR, SIN_TECHO, compatibleConInstalado, estadoTechoMoto, techoConfiguradoDe, techoDeLaMoto } from "./separacionCentral";

export const MAX_MOTIVO = 500;
export const COMPRADOR = "comprador";
export const MOTO = "moto";
export const AMBOS = "ambos";
export const INTERCAMBIO = "intercambio";

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------
export const previewCorreccionApi = (codven) => pedir(`/api/ventas/${codven}/correccion-relacion`).then((r) => r.data);
export const corregirVentaApi = (codven, cuerpo, clave) =>
  pedir(`/api/ventas/${codven}/correccion-relacion`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } }).then((r) => r.data);
export const previewIntercambioApi = (codvenA, codvenB) =>
  pedir(`/api/ventas/correccion-relacion/intercambio?codvenA=${encodeURIComponent(codvenA)}&codvenB=${encodeURIComponent(codvenB)}`).then((r) => r.data);
export const intercambiarApi = (cuerpo, clave) =>
  pedir("/api/ventas/correccion-relacion/intercambio", { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } }).then((r) => r.data);
export const historialVentaApi = (codven) => pedir(`/api/ventas/${codven}/correcciones-relacion`).then((r) => (Array.isArray(r.data) ? r.data : []));
// Historial con nombres y motor/chasis (función SQL de solo lectura, 202611140004)
export const correccionesDeUnidadApi = (coduni) => correccionesDetalleApi({ coduni }).then((r) => (Array.isArray(r) ? r : []));

// ---------------------------------------------------------------------------------------------
// Permiso (solo para mostrar el botón; el servidor decide)
// ---------------------------------------------------------------------------------------------
const rolDe = (user) => String(user?.rol || "").toLowerCase();
export const puedeCorregir = (user) => ["gerente", "administradora"].includes(rolDe(user));
export const esGerente = (user) => rolDe(user) === "gerente";
// ¿La venta tiene dinero recibido o comprobante? Entonces cambiar el comprador lo confirma solo el gerente.
export const tieneDinero = (f) => Boolean(f && (f.tienePagos || f.tieneAdelanto || f.comprobanteExterno));

// ---------------------------------------------------------------------------------------------
// Motivo (la misma regla del servidor: espacios repetidos se juntan, sin caracteres de control)
// ---------------------------------------------------------------------------------------------
export const normalizar = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const CONTROL = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex
export function errorMotivo(t) {
  const m = normalizar(t);
  if (!m) return "Escribe el motivo de la corrección.";
  if (m.length > MAX_MOTIVO) return `El motivo admite hasta ${MAX_MOTIVO} caracteres (tiene ${m.length}).`;
  if (CONTROL.test(m)) return "El motivo tiene caracteres que no se pueden guardar.";
  return "";
}

// ---------------------------------------------------------------------------------------------
// Motos a las que se puede pasar la venta
// ---------------------------------------------------------------------------------------------
// actual: moto de la venta (de la ficha); venta: preview; form: formulario de separación (precios de lista y techos)
// Devuelve { ok, motivo, aviso }: «motivo» explica por qué no se puede; «aviso», una diferencia que no impide.
export function compatibilidadMoto(cand, { actual, venta, form }) {
  if (!cand?.nummotuni || !cand?.chauni || !cand?.codmod) return { ok: false, motivo: "Le falta motor, chasis o modelo." };
  const base = venta?.finanzas?.precioBaseAcordado;
  if (String(cand.codmod) !== String(actual?.codmod ?? "")) {
    const precio = form?.preciosLista ? Number(form.preciosLista[String(cand.codmod)]) : NaN;
    if (base === null || base === undefined) return { ok: false, motivo: "Es de otro modelo y la venta no tiene precio base registrado." };
    if (form?.preciosLista && Number(precio) !== Number(base)) return { ok: false, motivo: `Es de otro modelo con otro precio de lista${Number.isFinite(precio) ? ` (${soles(precio)})` : ""}; la venta se pactó en ${soles(base)}.` };
  }
  const tipos = form?.tiposTecho || [];
  const t = venta?.techo || {};
  const tipo = t.codtte ? { codtte: String(t.codtte) } : null;
  const instalado = techoDeLaMoto(cand, tipos);
  if (instalado && !compatibleConInstalado(instalado, t.decision, tipo)) {
    return { ok: false, motivo: `Tiene «${instalado.nombre}» instalado y la venta es ${t.decision === SIN_TECHO ? "sin techo" : "con otro techo"}.` };
  }
  return { ok: true, aviso: diferenciaTecho(techoConfiguradoDe(cand, tipos), t, tipos) };
}
// Techo configurado (sin instalar) distinto de lo acordado: se puede corregir; luego se ajusta la configuración
export function diferenciaTecho(cfg, t, tipos = []) {
  if (!cfg || cfg.instalado || !t?.decision || t.decision === POR_DEFINIR) return "";
  if (t.decision === SIN_TECHO) return `Tiene «${cfg.nombre}» ${estadoTechoMoto(cfg)} y la venta es sin techo. Después cambia su configuración de techo en la ficha.`;
  if (t.decision === CON_TECHO && String(t.codtte) !== cfg.codtte) {
    const acordado = tipos.find((x) => String(x.codtte) === String(t.codtte))?.nombre || "otro techo";
    return `Tiene «${cfg.nombre}» ${estadoTechoMoto(cfg)} y la venta es con «${acordado}». Después cambia su configuración de techo en la ficha.`;
  }
  return "";
}
const normal = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Motos libres e identificadas (sin la actual), primero las compatibles y las del mismo modelo
export function motosParaCorregir(unidades = [], { actual, venta, form, q = "" }) {
  const b = normal(q).trim();
  return unidades
    .filter((u) => u.comercial === "Libre" && String(u.coduni) !== String(actual?.coduni) && u.nummotuni && u.chauni)
    .filter((u) => !b || [u.nummotuni, u.chauni, u.nommod, u.coluni, u.ubicacion?.nomubi].some((x) => normal(x).includes(b)))
    .map((u) => ({ unidad: u, ...compatibilidadMoto(u, { actual, venta, form }) }))
    .sort((a, c) => Number(c.ok) - Number(a.ok) || Number(String(c.unidad.codmod) === String(actual?.codmod)) - Number(String(a.unidad.codmod) === String(actual?.codmod))
      || String(a.unidad.nommod).localeCompare(String(c.unidad.nommod)) || String(a.unidad.nummotuni).localeCompare(String(c.unidad.nummotuni)));
}

// ---------------------------------------------------------------------------------------------
// Firma de un intento (si cambia, se usa otra clave) y confirmación después de una falla de red
// ---------------------------------------------------------------------------------------------
export const firmaCorreccion = (x) => JSON.stringify(x);
// ¿El historial de la venta ya tiene esta corrección, hecha por esta persona desde esta versión?
export function correccionYaGuardada(historial = [], { codusu, motivo, versionEsperada, codcliNuevo, coduniNuevo, codven }) {
  return historial.find((ev) => String(ev.actor?.codusu ?? "") === String(codusu ?? "") && normalizar(ev.motivo) === normalizar(motivo)
    && (ev.operaciones || []).some((o) => String(o.codven) === String(codven) && Number(o.versionAnterior) === Number(versionEsperada)
      && (!codcliNuevo || String(o.codcliNuevo) === String(codcliNuevo)) && (!coduniNuevo || String(o.coduniNueva) === String(coduniNuevo)))) || null;
}

// ---------------------------------------------------------------------------------------------
// Errores del servidor en palabras de la pantalla: { texto, campo, recargar, bloquear, motos }
// recargar: volver a leer la venta (cambió); bloquear: ya no se puede corregir desde esta pantalla;
// motos: volver a leer las motos libres; nuevaClave: el reintento debe ir con otra clave.
// ---------------------------------------------------------------------------------------------
export function errorCorreccion(er) {
  const msg = String(er?.message || "");
  const st = er?.status;
  if (faltaInstalar(er)) return { texto: "La API conectada todavía no tiene la corrección de ventas (HU-022): falta desplegar su versión nueva. No se cambió nada." };
  if (st === 401) return { texto: "Tu sesión venció. Vuelve a iniciar sesión; no se cambió nada." };
  if (st === 403) {
    if (/gerente/i.test(msg) && /dinero|comprobante/i.test(msg)) return { texto: "No se cambió: esta venta ya tiene dinero recibido o comprobante, y cambiar su comprador solo lo confirma el gerente." };
    return { texto: "No se cambió: solo el gerente y la administradora corrigen ventas." };
  }
  if (st === 404) return { texto: "No se encontró esta venta. Actualiza la ficha.", bloquear: true };
  if (/cambi[oó] desde la consulta|relaci[oó]n cambi/i.test(msg)) return { texto: "Otra persona cambió esta venta mientras la revisabas. Se volvió a leer: revisa los datos y confirma de nuevo.", recargar: true };
  if (/no cambia/i.test(msg)) return { texto: "La corrección no cambia nada: elige otro comprador u otra moto." };
  if (/idempotency/i.test(msg)) return { texto: "Este intento ya se usó con otros datos. Vuelve a confirmar para enviarlo como un intento nuevo.", nuevaClave: true };
  if (/precio base/i.test(msg)) return { texto: "La moto elegida es de otro modelo con otro precio de lista: no corresponde al precio pactado en esta venta. Elige otra moto.", motos: true };
  if (/techo instalado/i.test(msg)) return { texto: "La moto elegida tiene un techo instalado distinto de lo acordado en la venta. Elige otra moto.", motos: true };
  if (/contradice/i.test(msg)) return { texto: "La base todavía rechaza una moto con otro techo solo configurado: falta aplicar el SQL 202611140004 en Supabase. Elige una moto con el mismo techo o pide que lo apliquen.", motos: true };
  if (/Registradas/i.test(msg)) return { texto: "La venta ya no está registrada (pudo cancelarse). Actualiza la ficha.", bloquear: true };
  if (/separaci[oó]n (vinculada|antecedente)/i.test(msg)) return { texto: "La separación de esta venta no figura como convertida. Revísala con el equipo técnico antes de corregir.", bloquear: true };
  if (/intercambio/i.test(msg) || /exactamente/i.test(msg)) return { texto: "Las dos ventas ya no tienen esas motos. Se volvieron a leer: revisa y confirma de nuevo.", recargar: true };
  if (/compromiso|no est[aá] disponible|estado comercial de las unidades/i.test(msg)) return { texto: "La moto elegida ya no está libre (otra persona la separó, la vendió o la retiró). Elige otra.", motos: true };
  if (/comprador/i.test(msg) && /inactivo|no existe/i.test(msg)) return { texto: "El comprador elegido está inactivo o no existe. Revisa sus datos.", campo: "comprador" };
  if (/identificaci[oó]n/i.test(msg)) return { texto: "La moto elegida no tiene motor, chasis o modelo registrados. Elige otra.", motos: true };
  if (/motivo/i.test(msg)) return { texto: "Escribe el motivo (hasta 500 caracteres, sin caracteres especiales).", campo: "motivo" };
  if (/40001|40P01|cambi[oó] durante|modificando/i.test(msg) || st === 409) return { texto: "La moto o la venta cambió durante la operación. Se volvieron a leer: confirma de nuevo.", recargar: true };
  return { texto: msg || "No se pudo corregir la venta." };
}

// Texto de cómo quedó una moto
const ESTADO = { Disponible: "libre para vender", Vendida: "vendida", Separada: "separada (tiene otra separación activa)", "No disponible": "no disponible (tiene un traslado en curso)" };
export const textoEstado = (e) => ESTADO[e] || String(e || "sin dato").toLowerCase();
export const textoMoto = (m) => (m ? `${m.modelo || m.nommod || "Moto"} · motor ${m.motor || m.nummotuni || "—"}` : "Sin dato");
export const detalleMoto = (m) => (m ? [m.color || m.coluni, (m.chasis || m.chauni) && `chasis ${m.chasis || m.chauni}`].filter(Boolean).join(" · ") : "");
export const textoTipo = (t) => (t === "Intercambio" ? "Intercambio de motos entre dos ventas" : "Corrección de la venta");
