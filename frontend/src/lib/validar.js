// Limpiar lo que se escribe
// Validaciones de formularios
export const soloDigitos = (v, max) => String(v ?? "").replace(/\D/g, "").slice(0, max);
export const soloLetras = (v, max = 80) => String(v ?? "").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]/g, "").replace(/\s{2,}/g, " ").slice(0, max);
export const soloMonto = (v) => {
  const limpio = String(v ?? "").replace(/[^\d.]/g, "");
  const [ent, ...dec] = limpio.split(".");
  return dec.length ? `${ent.slice(0, 7)}.${dec.join("").slice(0, 2)}` : ent.slice(0, 7);
};

// Nombre, celular, RUC y correo
export const esNombre = (v) => { const t = String(v ?? "").trim(); return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{3,80}$/.test(t) && (t.match(/\p{L}/gu) || []).length >= 2; };
export const esNombreCompleto = (v) => esNombre(v) && String(v).trim().split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length >= 2;
// Nombres de personas (Sprint 2 y cuentas del equipo): solo letras y espacios, sin números ni símbolos
const LETRAS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
export const soloLetrasNombre = (v, max = 60) => String(v ?? "").replace(new RegExp(`[^${LETRAS} ]`, "g"), "").replace(/\s{2,}/g, " ").replace(/^\s+/, "").slice(0, max);
export const esNombrePersona = (v, min = 2) => { const t = String(v ?? "").trim().replace(/\s+/g, " "); return t.length >= min && t.length <= 80 && new RegExp(`^[${LETRAS}]+( [${LETRAS}]+)*$`).test(t); };
export const esNombreYApellido = (v) => esNombrePersona(v, 5) && String(v).trim().split(/\s+/).filter((w) => w.length >= 2).length >= 2;
export const esCelular = (v) => /^9\d{8}$/.test(String(v ?? ""));
export const esRuc = (v) => {
  const s = String(v ?? "");
  if (!/^(10|15|17|20)\d{9}$/.test(s)) return false;
  const suma = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((a, f, i) => a + f * Number(s[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 10) dv = 0; else if (dv === 11) dv = 1;
  return dv === Number(s[10]);
};
export const esCorreo = (v) => { const t = String(v ?? "").trim(); return t.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(t); };

// Teléfono de contacto: celular (9 dígitos, empieza con 9) o fijo con código: 01 + 7 dígitos (Lima) o 0XX + 6 dígitos (provincias)
export const esTelefono = (v) => /^(9\d{8}|01\d{7}|0[4-8]\d{7})$/.test(String(v ?? ""));
export const limpiarTelefono = (v) => String(v ?? "").replace(/\D/g, "").replace(/^51(?=9\d{8}$)/, "");
export function formatoTelefono(v) {
  const t = limpiarTelefono(v);
  if (/^9\d{8}$/.test(t)) return `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}`;
  if (/^01\d{7}$/.test(t)) return `(01) ${t.slice(2, 5)} ${t.slice(5)}`;
  if (/^0\d{8}$/.test(t)) return `(${t.slice(0, 3)}) ${t.slice(3, 6)} ${t.slice(6)}`;
  return t;
}

// EMT-97 · Contacto de una ubicación: opcional y guardado como texto (conserva +, ceros y separadores).
// Mismas reglas que la API: hasta 30 caracteres, solo números, espacios, guiones, paréntesis y un + inicial, de 6 a 15 dígitos.
export function validarContacto(v) {
  const valor = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!valor) return { valor: "", error: "" };
  if ([...valor].length > 30) return { valor, error: "El contacto admite hasta 30 caracteres." };
  if (!/^\+?[0-9() -]+$/.test(valor)) return { valor, error: "Solo números, espacios, guiones, paréntesis y un + al inicio." };
  const n = valor.replace(/\D/g, "").length;
  if (n < 6 || n > 15) return { valor, error: "El número debe tener entre 6 y 15 dígitos." };
  return { valor, error: "" };
}

// EMT-97 · Mientras se escribe el contacto: solo deja números, espacios, guiones, paréntesis y un + al inicio,
// sin espacios dobles y hasta 15 dígitos (así no se puede tipear una letra ni pasarse del largo, ni al pegar)
export const MAX_CONTACTO = 20;
export function filtrarContacto(v) {
  let digitos = 0;
  const t = String(v ?? "").replace(/[^0-9+() -]/g, "").replace(/^\s+/, "").replace(/(?!^)\+/g, "").replace(/ {2,}/g, " ");
  return [...t].filter((c) => !/\d/.test(c) || ++digitos <= 15).join("").slice(0, MAX_CONTACTO);
}

// Documento de identidad: DNI (8), carné de extranjería (9) o RUC (11 con dígito verificador)
export const DOCUMENTOS = { DNI: 8, CE: 9, RUC: 11 };
export function validarDocumento(tipo, num) {
  const n = String(num ?? "");
  const largo = DOCUMENTOS[tipo];
  if (!largo) return "Elige el tipo de documento.";
  if (!n) return `Ingresa el ${tipo}.`;
  if (!/^\d+$/.test(n)) return "Solo números.";
  if (n.length !== largo) return `El ${tipo} tiene ${largo} dígitos.`;
  if (tipo === "RUC" && !esRuc(n)) return MSJ.ruc;
  if (/^(\d)\1+$/.test(n)) return `Ese ${tipo} no es válido.`;
  return "";
}

// Fechas y horas siempre en hora de Lima (America/Lima, UTC−5, sin horario de verano), aunque la computadora o el
// navegador estén en otra zona. La base guarda los instantes en UTC (por ejemplo, 2026-11-17T01:25:39Z es el 16/11 a
// las 20:25 en Lima): nunca se toma el día cortando el texto, se convierte. Las fechas de negocio (fecha de pago, de
// la venta, de la entrega) llegan como «YYYY-MM-DD» o a medianoche UTC y se muestran tal cual.
export const ZONA_LIMA = "America/Lima";
const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_LIMA, year: "numeric", month: "2-digit", day: "2-digit" });
const esDia = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t);
// Fecha de negocio guardada como timestamp a medianoche UTC (así se guarda la fecha de la venta)
const MEDIANOCHE_UTC = /^(\d{4}-\d{2}-\d{2})[T ]00:00:00(?:\.0+)?(?:Z|[+-]00(?::?00)?)$/;
const instante = (v) => (v instanceof Date ? v : new Date(v));
// Día YYYY-MM-DD en Lima de un instante (Date o ISO)
export const fechaLocal = (d = new Date()) => { const x = instante(d); return Number.isNaN(x.getTime()) ? "" : FORMATO_DIA.format(x); };
export const hoyLocal = () => fechaLocal(new Date());
export const mesLocal = () => hoyLocal().slice(0, 7);
// Día de un valor de la base: «YYYY-MM-DD» o medianoche UTC → tal cual; instante con hora → su día en Lima
export function diaLima(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return fechaLocal(v);
  const t = String(v).trim();
  if (esDia(t)) return t;
  const m = MEDIANOCHE_UTC.exec(t);
  if (m) return m[1];
  const d = fechaLocal(t);
  return d || t.slice(0, 10);
}
// Mediodía en Lima de un día (para dar formato a una fecha sin que cambie de día en ninguna zona)
const mediodiaLima = (dia) => new Date(`${dia}T12:00:00-05:00`);
export const sumarDias = (n, desde = new Date()) => {
  const [y, m, d] = diaLima(desde).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const limpiarTexto = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
// Días entre dos fechas (YYYY-MM-DD o ISO), contando en hora de Lima
export const diasEntre = (desde, hasta = hoyLocal()) => Math.round((Date.parse(`${diaLima(hasta)}T00:00:00Z`) - Date.parse(`${diaLima(desde)}T00:00:00Z`)) / 86400000);
// Hora de Lima: "20:25"
export const horaLima = (iso) => { if (!iso) return ""; const d = instante(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ZONA_LIMA }); };
// Fecha en Lima con el formato pedido (opciones de toLocaleDateString)
export function formatoDia(f, opciones) {
  const dia = diaLima(f);
  if (!esDia(dia)) return "";
  return mediodiaLima(dia).toLocaleDateString("es-PE", { ...opciones, timeZone: ZONA_LIMA });
}
// Fecha y hora legibles: "17 oct, 10:20"
export function fechaHora(iso) {
  if (!iso) return "";
  return `${formatoDia(fechaLocal(iso), { day: "numeric", month: "short" }).replace(".", "")}, ${horaLima(iso)}`;
}
export function fechaLarga(f) {
  if (!f) return "";
  return formatoDia(f, { weekday: "long", day: "numeric", month: "long" });
}
// "hace 5 min", "hace 2 h", "hace 3 días"
export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

// Mensajes de error
export const MSJ = {
  nombre: "Escribe un nombre válido (solo letras, mínimo 3).",
  nombreCompleto: "Escribe nombre y apellido (solo letras).",
  celular: "Celular de 9 dígitos que empiece con 9.",
  ruc: "RUC no válido: 11 dígitos, empieza con 10, 15, 17 o 20 y su último dígito debe ser el verificador.",
  correo: "Escribe un correo válido (ejemplo: nombre@empresa.com).",
  telefono: "Celular de 9 dígitos que empiece con 9, o teléfono fijo con su código (01 y 7 dígitos en Lima).",
};
