// HU-005 · Separar una moto con adelanto confirmado (API de Michelle + complemento 202611070001)
// Todo pasa por la API con la sesión de la persona: el comprador, la captura y la separación se guardan en la base
// central. La separación se envía con una clave de intento (Idempotency-Key): si la red falla y se reintenta,
// no se registra dos veces.
import { pedir, urlFirmadaStorage } from "../lib/api";
import { esRuc } from "../lib/validar";

export const BUCKET_CAPTURAS = "separaciones-evidencia";
export const MAX_CAPTURA = 5 * 1024 * 1024; // mismo límite que el bucket
export const TIPOS_CAPTURA = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_REFERENCIA = 200; // mismos límites que hu005_crear_separacion
export const MAX_OBSERVACION = 300;
export const MAX_MONTO = 9999999.99;

// Situaciones en las que la moto ya está comprometida y no se puede separar
export const COMPROMETIDA = ["Separada", "Vendida"];
// Una moto se puede separar si está identificada (motor y chasis) y no tiene separación ni venta.
// «No disponible» (aún no se puso a la venta) también se puede separar: la entrega queda para cuando esté lista.
export const sePuedeSeparar = (u) => Boolean(u?.nummotuni && u?.chauni) && !COMPROMETIDA.includes(u?.comercial);

// Datos del formulario: quién soy, responsables, gerentes y tipos de documento
export const formularioSeparacionApi = () => pedir("/api/separaciones/formulario").then((r) => r.data);
// Comprador por número de documento (null si no está registrado)
export const buscarCompradorApi = (numero) => pedir(`/api/separaciones/compradores?numero=${encodeURIComponent(numero)}`).then((r) => r.data ?? null);
// Registrar comprador: si el documento ya existía, devuelve ese registro sin cambiarlo
export const registrarCompradorApi = (datos) => pedir("/api/separaciones/compradores", { metodo: "POST", cuerpo: datos }).then((r) => r.data);
// Captura de la transferencia: se guarda en la carpeta privada de la moto y devuelve su ruta
export function subirCapturaApi(coduni, archivo) {
  const fd = new FormData();
  fd.append("archivo", archivo, archivo.name || "captura");
  return pedir(`/api/unidades/${coduni}/separaciones/evidencia`, { metodo: "POST", formulario: fd }).then((r) => r.data);
}
// La separación (201 nueva; 200 si era el mismo envío y ya estaba guardado)
export const separarMotoApi = (coduni, cuerpo, clave) =>
  pedir(`/api/unidades/${coduni}/separaciones`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } });
// Separación activa de una moto (null si no tiene)
export const separacionActivaApi = (coduni) => pedir(`/api/unidades/${coduni}/separacion`).then((r) => r.data ?? null);
// Abrir la captura guardada (dirección temporal; solo para los roles comerciales)
export const urlCapturaApi = (ruta) => urlFirmadaStorage(BUCKET_CAPTURAS, ruta, 300);

// ---------------------------------------------------------------------------------------------
// Validaciones del panel (las mismas reglas que la base; el servidor vuelve a validar todo)
// ---------------------------------------------------------------------------------------------
export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const limpio = (t) => String(t ?? "").trim().replace(/\s+/g, " ");
export const normalizarDocumento = (t) => String(t ?? "").replace(/[\s-]+/g, "").toUpperCase();

// Reglas por tipo de documento: largo máximo al escribir, si es solo números y cómo se valida
export const REGLAS_DOCUMENTO = {
  DNI: { max: 8, numerico: true, ayuda: "8 dígitos" },
  RUC: { max: 11, numerico: true, ayuda: "11 dígitos" },
  "Carné de extranjería": { max: 12, numerico: false, ayuda: "De 9 a 12 letras o números" },
  Pasaporte: { max: 12, numerico: false, ayuda: "De 6 a 12 letras o números" },
};
export function filtrarDocumento(tipo, v) {
  const r = REGLAS_DOCUMENTO[tipo] || { max: 20, numerico: false };
  const t = normalizarDocumento(v);
  return (r.numerico ? t.replace(/\D/g, "") : t.replace(/[^A-Z0-9]/g, "")).slice(0, r.max);
}
export function errorDocumento(tipo, n) {
  if (!tipo) return "Elige el tipo de documento.";
  if (!n) return `Escribe el número de ${tipo === "DNI" || tipo === "RUC" ? tipo : "documento"}.`;
  if (tipo === "DNI") return /^\d{8}$/.test(n) && !/^(\d)\1+$/.test(n) ? "" : "El DNI tiene 8 dígitos.";
  if (tipo === "RUC") return esRuc(n) ? "" : "RUC no válido: 11 dígitos, empieza con 10, 15, 17 o 20 y su último dígito es el verificador.";
  if (tipo === "Carné de extranjería") return /^[A-Z0-9]{9,12}$/.test(n) ? "" : "El carné de extranjería tiene de 9 a 12 letras o números.";
  if (tipo === "Pasaporte") return /^[A-Z0-9]{6,12}$/.test(n) ? "" : "El pasaporte tiene de 6 a 12 letras o números.";
  return /^[A-Z0-9]{4,20}$/.test(n) ? "" : "Número de documento no válido.";
}
// Un RUC que empieza con 20 es de una empresa: se registra su razón social, sin apellidos
export const esEmpresa = (tipo, n) => tipo === "RUC" && String(n).startsWith("20");

const LETRAS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
export const soloNombre = (v, max = 100) => String(v ?? "").replace(new RegExp(`[^${LETRAS}' .-]`, "g"), "").replace(/\s{2,}/g, " ").replace(/^\s+/, "").slice(0, max);
export const soloRazonSocial = (v, max = 100) => String(v ?? "").replace(new RegExp(`[^${LETRAS}0-9&.,' -]`, "g"), "").replace(/\s{2,}/g, " ").replace(/^\s+/, "").slice(0, max);
const esNombre = (t) => t.length >= 2 && t.length <= 100 && new RegExp(`^[${LETRAS}' .-]+$`).test(t) && (t.match(/\p{L}/gu) || []).length >= 2;
const esRazonSocial = (t) => t.length >= 2 && t.length <= 100 && new RegExp(`^[${LETRAS}0-9&.,' -]+$`).test(t) && (t.match(/\p{L}/gu) || []).length >= 2;
export const filtrarTelefono = (v) => String(v ?? "").replace(/[^0-9+() -]/g, "").replace(/(?!^)\+/g, "").replace(/ {2,}/g, " ").slice(0, 20);
export const filtrarMonto = (v) => {
  const t = String(v ?? "").replace(",", ".").replace(/[^\d.]/g, "");
  const [ent, ...dec] = t.split(".");
  return dec.length ? `${ent.slice(0, 7)}.${dec.join("").slice(0, 2)}` : ent.slice(0, 7);
};

// Datos del comprador nuevo; devuelve los errores por campo
export function erroresCompradorNuevo(tipo, numero, c) {
  const x = {};
  const empresa = esEmpresa(tipo, numero);
  const nombres = limpio(c.nombres);
  if (empresa ? !esRazonSocial(nombres) : !esNombre(nombres)) x.nombres = empresa ? "Escribe la razón social (al menos 2 letras)." : "Escribe los nombres (solo letras).";
  if (!empresa) {
    if (!esNombre(limpio(c.apellidoPaterno))) x.apellidoPaterno = "Escribe el apellido paterno (solo letras).";
    if (limpio(c.apellidoMaterno) && !esNombre(limpio(c.apellidoMaterno))) x.apellidoMaterno = "Solo letras.";
  }
  const tel = limpio(c.telefono);
  if (tel) {
    const digitos = tel.replace(/\D/g, "").length;
    if (!/^\+?[0-9() -]+$/.test(tel) || digitos < 7 || digitos > 15) x.telefono = "Teléfono de 7 a 15 dígitos (ejemplo: 987 654 321).";
  }
  const correo = limpio(c.correo).toLowerCase();
  if (correo && (correo.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(correo))) x.correo = "Escribe un correo válido (ejemplo: nombre@correo.com).";
  return x;
}

export function errorCaptura(archivo) {
  if (!archivo) return "Adjunta la captura de la transferencia.";
  if (!TIPOS_CAPTURA.includes(archivo.type)) return "La captura debe ser una imagen JPG, PNG o WEBP, o un PDF.";
  if (!archivo.size) return "El archivo está vacío.";
  if (archivo.size > MAX_CAPTURA) return "La captura pesa más de 5 MB. Sube una más liviana.";
  return "";
}

export const soles = (n) => `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const nombreComprador = (c) => (c ? [c.nombres, c.apellidoPaterno, c.apellidoMaterno].filter(Boolean).join(" ") : "");
