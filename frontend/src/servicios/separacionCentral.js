// HU-005 · Separar una moto con adelanto confirmado (API de Michelle, PR #44, y complementos 2026110700xx–1000xx)
// Todo pasa por la API con la sesión de la persona: el comprador, la captura y la separación se guardan en la base
// central. La separación se envía con una clave de intento (Idempotency-Key): si la red falla y se reintenta,
// no se registra dos veces. La decisión de techo viaja en la misma solicitud (contrato de Michelle del 9 de
// noviembre): si la separación se guarda pero el techo no, la API responde 202 y solo se reintenta el techo.
import { pedir, urlFirmadaStorage } from "../lib/api";

export const BUCKET_CAPTURAS = "separaciones-evidencia";
export const MAX_CAPTURA = 5 * 1024 * 1024; // mismo límite que el bucket
export const TIPOS_CAPTURA = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_REFERENCIA = 30; // N° de operación del banco (la base admite hasta 200)
export const MAX_OBSERVACION = 300; // mismo límite que hu005_crear_separacion
export const DIAS_FECHA_ADELANTO = 30; // la fecha del adelanto puede ser de hoy o de los últimos 30 días
export const MAX_MONTO = 9999999.99;
export const MIN_ADELANTO = 100; // mínimo del adelanto (OBS-S3-013, confirmado por Harold); la base lo vuelve a revisar
// Máximo del adelanto: el precio de lista de la moto (regla de Harold); la base lo vuelve a revisar

// Situaciones en las que la moto ya está comprometida y no se puede separar
export const COMPROMETIDA = ["Separada", "Vendida"];
// Una moto se puede separar si está identificada (motor y chasis) y no tiene separación ni venta.
export const sePuedeSeparar = (u) => Boolean(u?.nummotuni && u?.chauni) && !COMPROMETIDA.includes(u?.comercial);

// La API a la que está conectado el panel no tiene las rutas de la HU-005 (responde 404 sin JSON)
export const FALTA_INSTALAR = "La API conectada todavía no tiene la separación: falta desplegar su versión nueva. Si estás probando en tu computadora, inicia la API de esta rama (npm run dev) y conecta el panel a ella con EPSA_API_LOCAL=1.";
export const faltaInstalar = (e) => Boolean(e?.detalle?.sinRuta);

// Datos del formulario: quién soy, responsables, gerentes, tipos de techo y precios de lista
export const formularioSeparacionApi = () => pedir("/api/separaciones/formulario").then((r) => r.data);
// Registrar comprador (sin documento: nombres, apellidos y celular). Si ya hay uno con los mismos nombres,
// apellidos y celular, devuelve ese registro: reintentar no lo duplica.
export const registrarCompradorApi = (datos) => pedir("/api/separaciones/compradores", { metodo: "POST", cuerpo: datos }).then((r) => r.data);
// Captura de la transferencia: se guarda en la carpeta privada de la moto y devuelve su ruta
export function subirCapturaApi(coduni, archivo) {
  const fd = new FormData();
  fd.append("archivo", archivo, archivo.name || "captura");
  return pedir(`/api/unidades/${coduni}/separaciones/evidencia`, { metodo: "POST", formulario: fd }).then((r) => r.data);
}
// La separación con su decisión de techo: 201 nueva; 200 si era el mismo envío y ya estaba guardado; 202 si la
// separación quedó guardada pero falta guardar el techo (warning TECHO_PENDIENTE_GUARDAR)
export const separarMotoApi = (coduni, cuerpo, clave) =>
  pedir(`/api/unidades/${coduni}/separaciones`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } });
export const techoPendienteDeGuardar = (r) => r?.status === 202 || r?.warning?.code === "TECHO_PENDIENTE_GUARDAR" || r?.data?.techo?.guardado === false;
// Cuerpo del techo para la API: { decision } o { decision: «Con techo», codtte }
export const techoParaEnviar = (decision, tipo) => (decision === CON_TECHO ? { decision, codtte: Number(tipo?.codtte) } : { decision });
// Guarda o reintenta la decisión de techo de una separación: resuelve «Por definir» con la decisión final del
// comprador. Repetir la misma decisión no cambia nada; una decisión final ya guardada no se puede cambiar.
export const guardarTechoSeparacionApi = (codsep, decision, tipo) =>
  pedir(`/api/separaciones/${codsep}/techo`, { metodo: "PUT", cuerpo: techoParaEnviar(decision, tipo) }).then((r) => r.data);
// Interesados (leads) por nombre o celular para completar los datos del comprador (OBS-S3-011). El vendedor solo
// ve los suyos; la gerencia y la administración, todos. Hasta 20 resultados.
export const MIN_BUSQUEDA = 2;
export function textoBusquedaValido(t) {
  const x = limpio(t);
  if (x.length < MIN_BUSQUEDA || x.length > 100) return false;
  return /\p{L}/u.test(x) || x.replace(/\D/g, "").length >= 3;
}
export const buscarLeadsApi = (texto) => pedir(`/api/leads?buscar=${encodeURIComponent(limpio(texto))}`).then((r) => (Array.isArray(r.data) ? r.data : r.data?.items || []));
// Separación activa de una moto (null si no tiene)
export const separacionActivaApi = (coduni) => pedir(`/api/unidades/${coduni}/separacion`).then((r) => r.data ?? null);
// Abrir la captura guardada (dirección temporal; solo para los roles comerciales)
export const urlCapturaApi = (ruta) => urlFirmadaStorage(BUCKET_CAPTURAS, ruta, 300);

// ---------------------------------------------------------------------------------------------
// Validaciones del panel (las mismas reglas que la base; el servidor vuelve a validar todo)
// ---------------------------------------------------------------------------------------------
export const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const limpio = (t) => String(t ?? "").trim().replace(/\s+/g, " ");
// Fecha más antigua aceptada para el adelanto (hoy menos 30 días, hora de Lima)
export function fechaMinimaAdelanto() {
  const [y, m, d] = hoyLima().split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d - DIAS_FECHA_ADELANTO));
  return f.toISOString().slice(0, 10);
}
export function errorFechaAdelanto(fecha) {
  if (!fecha) return "Indica la fecha en que se recibió el adelanto.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "Escribe una fecha válida.";
  if (fecha > hoyLima()) return "La fecha no puede ser posterior a hoy.";
  if (fecha < fechaMinimaAdelanto()) return `La fecha no puede ser de hace más de ${DIAS_FECHA_ADELANTO} días.`;
  return "";
}
// N° de operación: letras, números y guiones (sin espacios ni símbolos), con al menos un número
export const filtrarReferencia = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, MAX_REFERENCIA);
export function errorReferencia(v) {
  const t = String(v ?? "");
  if (!t) return "Escribe el número de operación de la transferencia.";
  if (t.length < 4) return "El número de operación tiene al menos 4 caracteres.";
  if (!/\d/.test(t)) return "El número de operación lleva números.";
  if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(t)) return "Usa solo letras, números y guiones entre ellos.";
  return "";
}
// Observación de la recepción en efectivo: texto con palabras (no solo números o símbolos)
export function errorObservacion(v, obligatoria) {
  const t = limpio(v);
  if (!t) return obligatoria ? "Describe la recepción: quién recibió el dinero, dónde y el N° de recibo si lo hay." : "";
  if ([...t].length > MAX_OBSERVACION) return `Máximo ${MAX_OBSERVACION} caracteres.`;
  if ((t.match(/\p{L}/gu) || []).length < 3) return "Describe la recepción con palabras, por ejemplo: recibido por Cesar en caja de Comas, recibo 0045.";
  return "";
}
// Nombres y apellidos: solo letras (con tildes, ñ y ü) y espacios; ni números ni símbolos, tampoco al pegar
const LETRAS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
export const soloNombre = (v, max = 100) => String(v ?? "").replace(new RegExp(`[^${LETRAS} ]`, "g"), "").replace(/\s{2,}/g, " ").replace(/^\s+/, "").slice(0, max);
const esNombre = (t) => t.length >= 2 && t.length <= 100 && new RegExp(`^[${LETRAS}]+( [${LETRAS}]+)*$`).test(t) && (t.match(/\p{L}/gu) || []).length >= 2;
// Celular peruano: solo dígitos, como máximo 9 (también al pegar, por ejemplo «+51 987 654 321»)
export const filtrarTelefono = (v) => {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length > 9 && d.startsWith("51")) d = d.slice(2);
  return d.slice(0, 9);
};
export const errorTelefono = (v) => {
  const t = String(v ?? "");
  if (!t) return "Escribe el celular del comprador.";
  if (!t.startsWith("9")) return "El celular empieza con 9.";
  if (t.length < 9) return `Faltan ${9 - t.length} dígito${9 - t.length === 1 ? "" : "s"}: el celular tiene 9.`;
  if (/^(\d)\1{8}$/.test(t)) return "Escribe un celular real: no pueden ser todos los dígitos iguales.";
  return "";
};

// ---------------------------------------------------------------------------------------------
// Monto del adelanto (observación de Harold del 8 de noviembre): se valida el texto tal como se escribió o pegó,
// antes de convertirlo a número. El signo se conserva (−300.50 no se convierte en 300.50). Cero y negativos
// muestran «El adelanto debe ser mayor que cero» y no se envían. Coma o punto sirven para los decimales.
// ---------------------------------------------------------------------------------------------
export const MONTO_MAYOR_QUE_CERO = "El adelanto debe ser mayor que cero";
// Al escribir o pegar se quitan los caracteres que nunca forman un monto (letras, «S/», espacios) y no se deja
// escribir más de 2 decimales ni más cifras enteras que las del tope (DEF-S3-001: 9999999999,59 ya no entra).
// Si lo escrito o pegado se pasa, el campo conserva el valor anterior («previo»): nunca se recorta un monto
// pegado en silencio (por ejemplo, 1.000.000 no queda en 10000).
// El signo menos se deja visible para avisar que el monto debe ser mayor que cero (regla de Harold). Si se pega un
// monto con separador de miles («S/ 3,000.00»), se toma el último separador como decimal.
export const cifrasEnteras = (tope) => (Number.isFinite(Number(tope)) && Number(tope) > 0 ? String(Math.trunc(Number(tope))).length : 8);
export function filtrarMonto(v, maxEnteros = 8, previo) {
  let t = String(v ?? "").replace(/[^\d.,-]/g, "");
  const negativo = t.startsWith("-");
  t = t.replace(/-/g, "");
  const seps = [...t.matchAll(/[.,]/g)];
  let sep = "";
  if (seps.length) {
    const tipos = new Set(seps.map((m) => m[0]));
    if (tipos.size > 1 || seps.length === 1) {
      const ultimo = seps[seps.length - 1];
      sep = ultimo[0];
      t = t.slice(0, ultimo.index).replace(/[.,]/g, "") + sep + t.slice(ultimo.index + 1);
    } else t = t.replace(/[.,]/g, ""); // 1.000.000: separadores de miles
  }
  let [ent, dec] = sep ? t.split(sep) : [t, undefined];
  ent = ent.replace(/^0+(?=\d)/, "");
  if (ent.length > maxEnteros || (dec !== undefined && dec.length > 2)) {
    if (previo !== undefined) return previo;
    ent = ent.slice(0, maxEnteros);
    if (dec !== undefined) dec = dec.slice(0, 2);
  }
  return `${negativo ? "-" : ""}${ent}${dec !== undefined ? `${sep}${dec}` : ""}`;
}
const FORMA_MONTO = /^-?\d+(?:[.,]\d+)?$/;
// Número del monto (con coma o punto) o NaN si el texto no es un monto
export function leerMonto(texto) {
  const t = String(texto ?? "").trim();
  if (!FORMA_MONTO.test(t)) return NaN;
  return Number(t.replace(",", "."));
}
// Monto para enviar: dos decimales exactos (300,5 → 300.5; 300,50 → 300.5)
export const montoParaEnviar = (texto) => Math.round(leerMonto(texto) * 100) / 100;

// Datos del comprador; devuelve los errores por campo
export function erroresComprador(c) {
  const x = {};
  if (!esNombre(limpio(c.nombres))) x.nombres = limpio(c.nombres) ? "Los nombres solo llevan letras y espacios (al menos 2 letras)." : "Escribe los nombres del comprador.";
  if (!esNombre(limpio(c.apellidoPaterno))) x.apellidoPaterno = limpio(c.apellidoPaterno) ? "El apellido solo lleva letras y espacios (al menos 2 letras)." : "Escribe el apellido paterno.";
  if (limpio(c.apellidoMaterno) && !esNombre(limpio(c.apellidoMaterno))) x.apellidoMaterno = "El apellido solo lleva letras y espacios (al menos 2 letras).";
  const tel = errorTelefono(c.telefono);
  if (tel) x.telefono = tel;
  return x;
}

export function errorCaptura(archivo) {
  if (!archivo) return "Adjunta la captura de la transferencia.";
  if (!TIPOS_CAPTURA.includes(archivo.type)) return "La captura debe ser una imagen JPG, PNG o WEBP, o un PDF.";
  if (!archivo.size) return "El archivo está vacío.";
  if (archivo.size > MAX_CAPTURA) return "La captura pesa más de 5 MB. Sube una más liviana.";
  return "";
}

// ---------------------------------------------------------------------------------------------
// Tope del adelanto (DEF-S3-001): no puede superar el precio de lista del modelo de la moto
// ---------------------------------------------------------------------------------------------
// undefined: no se sabe (base sin esta versión); null: el modelo no tiene precio de lista; número: el precio
export function precioListaDe(form, unidad) {
  if (!form?.preciosLista || !unidad?.codmod) return undefined;
  const p = Number(form.preciosLista[String(unidad.codmod)]);
  return Number.isFinite(p) && p > 0 ? p : null;
}
export const SIN_PRECIO = "Esta moto no tiene precio de lista registrado. Pide a gerencia que lo registre en Modelos antes de separarla.";
// Orden de los mensajes: vacío, formato, mayor que cero, decimales, precio de lista, mínimo y tope
export function errorMonto(texto, precio) {
  const t = String(texto ?? "").trim();
  if (!t) return "Escribe el monto del adelanto.";
  if (t.startsWith("-")) return MONTO_MAYOR_QUE_CERO;
  if (/[.,]$/.test(t)) return "Completa los decimales o borra la coma.";
  if (!FORMA_MONTO.test(t)) return "Escribe solo el monto, sin separador de miles y con coma o punto para los decimales (por ejemplo 3000 o 3000,50).";
  const monto = leerMonto(t);
  if (monto <= 0) return MONTO_MAYOR_QUE_CERO;
  if (/[.,]\d{3,}$/.test(t)) return "El monto lleva como máximo 2 decimales.";
  if (precio === null) return SIN_PRECIO;
  if (typeof precio === "number" && monto > precio) return `El adelanto no puede superar el precio de lista de la moto (${soles(precio)}).`;
  if (monto > MAX_MONTO) return "El monto es demasiado alto.";
  if (monto < MIN_ADELANTO) return `El adelanto mínimo es ${soles(MIN_ADELANTO)}.`;
  return "";
}
export const ayudaAdelanto = (precio) => (typeof precio === "number" ? `De ${soles(MIN_ADELANTO)} a ${soles(precio)} (precio de lista). Sin separador de miles.` : `Desde ${soles(MIN_ADELANTO)}. Sin separador de miles.`);

// ---------------------------------------------------------------------------------------------
// Techo al separar (decisión de negocio del 8 de noviembre y contrato de Michelle del 9)
//   «Por definir»: el comprador aún no decide; la separación queda activa y la decisión pendiente.
//   «Sin techo»: el comprador eligió expresamente la moto sin techo.
//   «Con techo»: se registra el tipo elegido.
// Es la decisión comercial: no cambia la configuración física de la moto ni su preparación (HU-004 y HU-033).
// Una vez elegida «Sin techo» o «Con techo», no se cambia ni vuelve a «Por definir».
// Si la moto ya tiene un techo instalado, solo se admite «Por definir» o ese mismo techo (PT438).
// Si la separación se guardó pero el techo elegido no, se anota aquí para reintentarlo: eso es distinto de
// «Por definir» (el comprador sí decidió; lo que falta es guardarlo).
// ---------------------------------------------------------------------------------------------
export const POR_DEFINIR = "Por definir";
export const SIN_TECHO = "Sin techo";
export const CON_TECHO = "Con techo";
export const tipoSinTecho = (tipos = []) => tipos.find((t) => t.sinTecho === true) || (tipos.some((t) => "sinTecho" in t) ? null : tipos.find((t) => !t.requiereInstalacion)) || null;
export const tiposConTecho = (tipos = []) => { const sin = tipoSinTecho(tipos); return tipos.filter((t) => t !== sin); };
// Decisión con la que se abre la ventana: la del techo que la moto ya tiene configurado, o «Por definir»
export function decisionInicial(tipos = [], nombreConfigurado = "") {
  const t = nombreConfigurado ? tipos.find((x) => x.nombre === nombreConfigurado) : null;
  if (!t) return { decision: POR_DEFINIR, codtte: "", configurado: null };
  return t === tipoSinTecho(tipos) ? { decision: SIN_TECHO, codtte: "", configurado: t } : { decision: CON_TECHO, codtte: t.codtte, configurado: t };
}
// Tipo de techo que corresponde a la decisión (null para «Por definir»)
export function tipoDeDecision(tipos = [], decision, codtte) {
  if (decision === SIN_TECHO) return tipoSinTecho(tipos);
  if (decision === CON_TECHO) return tiposConTecho(tipos).find((t) => t.codtte === codtte) || null;
  return null;
}
export const ESTADO_TECHO = { Pendiente: "por armar", "En proceso": "en armado", Instalado: "instalado" };
// Techo instalado en la moto (HU-033 lo confirmó como «Instalado»): { codtte, nombre } o null
export function techoInstaladoDe(unidad) {
  const t = unidad?.preparacion?.operativa?.techo;
  if (!t?.codtte || t.estado !== "Instalado") return null;
  return { codtte: String(t.codtte), nombre: t.configuracion || unidad?.preparacion?.techo?.configuracion || "" };
}
// Con un techo instalado, una decisión es compatible si es «Por definir» o ese mismo techo
export const compatibleConInstalado = (instalado, decision, tipo) => !instalado || decision === POR_DEFINIR || (decision === CON_TECHO && String(tipo?.codtte) === instalado.codtte);
export const textoInstalado = (instalado) => `Esta moto tiene «${instalado.nombre}» instalado. Solo puede venderse o separarse con ese techo (o con el techo por definir). Si el comprador quiere otro techo o la moto sin techo, elige otra moto compatible del mismo modelo e infórmale el plazo estimado de preparación o instalación.`;
// Texto de una decisión de techo ya guardada
export function textoDecision(d, tipos = []) {
  if (!d?.decision) return "Sin dato";
  if (d.decision === POR_DEFINIR) return "Por definir: el comprador aún no decide";
  if (d.decision === SIN_TECHO) return "Sin techo, elegido por el comprador";
  const nombre = d.nombre || tipos.find((t) => String(t.codtte) === String(d.codtte))?.nombre || "Techo";
  return `${nombre}, elegido por el comprador`;
}

// Techo elegido que quedó pendiente de guardar (solo en este navegador; la separación ya está en la base)
const clavePendiente = (coduni) => `epsa:hu005:techo-pendiente:${coduni}`;
export function guardarTechoPendiente(coduni, dato) {
  try { window.localStorage.setItem(clavePendiente(coduni), JSON.stringify(dato)); } catch { /* sin almacenamiento local */ }
}
export function leerTechoPendiente(coduni) {
  try {
    const d = JSON.parse(window.localStorage.getItem(clavePendiente(coduni)) || "null");
    return d && d.codsep && (d.decision === SIN_TECHO || (d.decision === CON_TECHO && d.codtte)) ? d : null;
  } catch { return null; }
}
export function borrarTechoPendiente(coduni) {
  try { window.localStorage.removeItem(clavePendiente(coduni)); } catch { /* sin almacenamiento local */ }
}

// Nombre de un interesado (un solo texto) repartido en nombres y apellidos, para revisarlo antes de guardar:
// 2 palabras: nombre y apellido; 3: nombre y dos apellidos; 4 o más: dos nombres y el resto apellidos
export function separarNombreLead(nombre) {
  const p = soloNombre(limpio(nombre)).trim().split(" ").filter(Boolean)
    .map((x) => x.charAt(0).toLocaleUpperCase("es-PE") + x.slice(1).toLocaleLowerCase("es-PE"));
  if (p.length <= 1) return { nombres: p[0] || "", apellidoPaterno: "", apellidoMaterno: "" };
  if (p.length === 2) return { nombres: p[0], apellidoPaterno: p[1], apellidoMaterno: "" };
  if (p.length === 3) return { nombres: p[0], apellidoPaterno: p[1], apellidoMaterno: p[2] };
  return { nombres: p.slice(0, 2).join(" "), apellidoPaterno: p[2], apellidoMaterno: p.slice(3).join(" ") };
}

export const soles = (n) => `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const nombreComprador = (c) => (c ? [c.nombres, c.apellidoPaterno, c.apellidoMaterno].filter(Boolean).join(" ") : "");
// Comprador con su celular (y su documento, solo si se registró con uno antes de este cambio)
export const textoComprador = (c) => (c ? `${nombreComprador(c)}${c.numeroDocumento ? ` (${c.tipoDocumento || "Doc."} ${c.numeroDocumento})` : ""}${c.telefono ? `, celular ${c.telefono}` : ""}` : "");
