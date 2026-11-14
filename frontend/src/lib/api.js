// Conexión con la API de Michelle y Supabase
import { API_URL, SUPABASE_URL, SUPABASE_ANON_KEY, MODO_REAL } from "./config";
import { ApiError } from "./errores";

// Sesión guardada
const CLAVE = "epsa-sesion";

export function leerSesion() {
  try { return JSON.parse(sessionStorage.getItem(CLAVE)); } catch { return null; }
}
function guardarSesion(s) {
  try { if (s) sessionStorage.setItem(CLAVE, JSON.stringify(s)); else sessionStorage.removeItem(CLAVE); } catch {}
}
// Últimos datos de cada pantalla (solo en memoria y de la sesión actual): al volver a una pantalla se ven al
// instante mientras se actualizan. Se vacía al entrar y al salir para que otra cuenta nunca vea datos ajenos.
export const cacheConsultas = new Map();
export const cerrarSesionApi = () => { cacheConsultas.clear(); guardarSesion(null); };


// Código de error de Supabase Auth (formato nuevo y antiguo)
const codigoAuth = (j) => j?.error_code || j?.code || j?.error || "";
const MUCHOS_INTENTOS = "Hiciste muchos intentos seguidos. Espera un minuto e inténtalo de nuevo.";

// HU-007 · Login con Supabase Auth
async function authFetch(grant, cuerpo) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(cuerpo),
    });
  } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const c = codigoAuth(j);
    if (r.status === 429 || c === "over_request_rate_limit") throw new ApiError(429, MUCHOS_INTENTOS);
    if (grant === "password") {
      if (c === "email_not_confirmed") throw new ApiError(403, "Tu cuenta aún no está confirmada. Avisa a la gerencia.");
      if (c === "user_banned") throw new ApiError(403, "Tu acceso está suspendido. Consulta con la gerencia.");
      if (r.status === 400 || r.status === 401) throw new ApiError(401, "Correo o contraseña incorrectos.");
    } else if (r.status === 400 || r.status === 401) throw new ApiError(401, "Tu sesión venció. Vuelve a iniciar sesión.");
    throw new ApiError(r.status, "No se pudo iniciar sesión. Inténtalo en unos minutos.");
  }
  return j;
}

export async function iniciarSesion(correo, clave) {
  const j = await authFetch("password", { email: correo, password: clave });
  const sesion = { access_token: j.access_token, refresh_token: j.refresh_token };
  cacheConsultas.clear(); guardarSesion(sesion);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hu007_usuario_actual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${j.access_token}` },
    body: JSON.stringify({}),
  }).catch(() => { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); });
  const d = await r.json().catch(() => null);
  const u = Array.isArray(d) ? d[0] : d;
  if (!r.ok || !u?.rol) { guardarSesion(null); throw new ApiError(403, "Tu usuario no tiene un rol activo en EPSA Motor."); }
  const meta = j.user?.user_metadata || {};
  const local = correo.split("@")[0];
  const nombre = meta.nombre || (/^\d+$/.test(local) ? local : local.replace(/[._-]+/g, " ").replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase()));
  return { nombre, rol: String(u.rol).toLowerCase(), codusu: u.codusu, claveTemporal: meta.clave_temporal === true };
}

// Lectura de tablas de Supabase
async function leerTabla(ruta, error, reintento = true) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${leerSesion()?.access_token || ""}` },
    });
  } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  if (r.status === 401 && reintento) {
    try { await refrescar(); return leerTabla(ruta, error, false); } catch {}
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new ApiError(r.status, j?.message || error);
  return j;
}

export const listarUsuariosSupabase = () =>
  leerTabla("usuario?select=codusu,nomusu,apepatusu,apematusu,corusu,estusu,rol(nomrol)&order=codusu", "No se pudo cargar la lista de usuarios.");

export const listarCanalesWhatsapp = () =>
  leerTabla("canalwhatsapp?select=codcwa,nomcwa,numcwa,estcwa&order=codcwa", "No se pudo cargar el WhatsApp de la empresa.");

// Cambiar contraseña (la temporal o la olvidada). Marca que la persona ya eligió la suya.
export async function cambiarClaveApi(nueva) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${leerSesion()?.access_token || ""}` },
      body: JSON.stringify({ password: nueva, data: { clave_temporal: false, clave_cambiada: new Date().toISOString() } }),
    });
  } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const c = codigoAuth(j);
    if (c === "same_password") throw new ApiError(422, "La nueva contraseña debe ser distinta a la anterior.");
    if (c === "weak_password") throw new ApiError(422, "Esa contraseña es muy débil. Usa al menos 8 caracteres con letras y números.");
    if (c === "reauthentication_needed" || r.status === 401) throw new ApiError(401, "Por seguridad, pide un código nuevo y vuelve a intentarlo.");
    if (r.status === 429) throw new ApiError(429, MUCHOS_INTENTOS);
    throw new ApiError(r.status, "No se pudo cambiar la contraseña. Inténtalo en unos minutos.");
  }
  return true;
}

// Datos dentro del token de sesión (por ejemplo, cuándo vence)
const datosToken = (t) => { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; } };

// Funciones SQL de Supabase (docs/*.sql). Con «publica» se llama como visitante de la web, sin sesión.
// Si una función todavía no está creada, no se vuelve a pedir hasta recargar la página (evita avisos repetidos).
const funcionesFaltantes = new Set();
const errorFaltaSql = () => new ApiError(404, "Esta función todavía no está habilitada en el sistema.", { faltaSql: true });
async function rpc(nombre, cuerpo = {}, { reintento = true, publica = false } = {}) {
  if (!MODO_REAL) throw new ApiError(0, "Esta función necesita conexión.");
  if (funcionesFaltantes.has(nombre)) throw errorFaltaSql();
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${publica ? SUPABASE_ANON_KEY : leerSesion()?.access_token || ""}` },
      body: JSON.stringify(cuerpo),
    });
  } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  if (r.status === 401 && reintento && !publica) {
    try { await refrescar(); return rpc(nombre, cuerpo, { reintento: false }); } catch {}
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    if (j?.code === "PGRST202") {
      console.warn(`[EPSA] Falta la función ${nombre} en Supabase: ejecuta el SQL de docs/ que la crea.`);
      funcionesFaltantes.add(nombre);
      throw errorFaltaSql();
    }
    if (r.status === 401) throw new ApiError(401, "Tu sesión venció. Vuelve a iniciar sesión.");
    throw new ApiError(r.status, j?.message || "No se pudo completar la operación.");
  }
  return j;
}
export const equipoListarApi = () => rpc("equipo_listar");
export const equipoCrearApi = (d) => rpc("equipo_crear_cuenta", { p_correo: d.correo, p_nombres: d.nombres, p_apellido_paterno: d.paterno, p_apellido_materno: d.materno || null, p_rol: d.rol, p_clave: d.clave });
export const equipoActualizarApi = (d) => rpc("equipo_actualizar_cuenta", { p_codusu: Number(d.codusu), p_nombres: d.nombres, p_apellido_paterno: d.paterno, p_apellido_materno: d.materno || null, p_rol: d.rol, p_activo: d.activo });
export const equipoReiniciarClaveApi = (codusu, clave) => rpc("equipo_reiniciar_clave", { p_codusu: Number(codusu), p_clave: clave });

// Roles y permisos: secciones que el gerente desactiva para la administradora y el vendedor (docs/supabase-permisos-roles.sql)
export const permisosListarApi = () => rpc("permisos_listar");
export const permisosGuardarApi = (rol, seccion, activo) => rpc("permisos_guardar", { p_rol: rol, p_seccion: seccion, p_activo: activo });

// Cotización o consulta de la web: queda como interesado en Leads (docs/supabase-sprint2-conexiones.sql)
export const registrarInteresadoWebApi = (d) => rpc("web_registrar_interesado", {
  p_nombre: d.nombre, p_telefono: d.telefono, p_codmod: d.codmod ? Number(d.codmod) : null, p_color: d.color || null,
  p_codsed: d.codsed ? Number(d.codsed) : null, p_detalle: d.detalle || null, p_tipo: d.tipo,
}, { publica: true });

// HU-036: página de torito.pe leída desde Supabase (docs/supabase-torito-en-vivo.sql)
export const paginaToritoApi = (ruta) => rpc("hu036_pagina_torito", { p_ruta: ruta });
// HU-036: una imagen de torito.pe descargada por Supabase ({ tipo, base64 }) para guardarla en nuestro Storage
export const imagenToritoApi = (url) => rpc("hu036_imagen_torito", { p_url: url });

// HU-001: motor y chasis de cada moto (mismo SQL), mientras GET /api/inventario no los envíe
export const seriesUnidadesApi = () => rpc("hu001_series_unidades");

// HU-003: ubicación inicial de una moto identificada a mano (mismo SQL), mientras la API no tenga su ruta
export const ubicacionInicialSqlApi = (coduni, codubi, observacion) => rpc("hu003_ubicacion_inicial", { p_coduni: Number(coduni), p_codubi: Number(codubi), p_observacion: observacion || null });

// Seguimiento del vendedor: sus interesados, cada contacto y el nuevo estado (mismo SQL)
export const seguimientoListarApi = () => rpc("seguimiento_listar");
export const seguimientoRegistrarApi = (d) => rpc("seguimiento_registrar", {
  p_codlea: Number(d.codlea), p_tipo: d.tipo, p_detalle: d.detalle, p_estado: d.estado || null, p_proximo: d.proximo || null,
});

// Mejoras del Sprint 2 (docs/supabase-sprint2-mejoras.sql)
// HU-003: motivos de traslado y el motivo guardado de cada movimiento
export const motivosTrasladoApi = () => rpc("hu003_motivos_traslado");
// HU-015: última actualización de cada interesado y su historial completo
export const ultimasActualizacionesApi = () => rpc("hu015_ultimas_actualizaciones");
export const historialLeadApi = (codlea) => rpc("hu015_historial_lead", { p_codlea: Number(codlea) });
// Ventas a clientes con quien concretó cada una (el vendedor recibe solo las suyas)
export const ventasListarApi = () => rpc("ventas_listar");

// HU-030 · Facturas recibidas (importación de Michelle + funciones del panel en supabase-sprint2-mejoras.sql)
export const BUCKET_FACTURAS = "facturas-compra";
export const listarEquivalenciasImportacionApi = (ruc) => rpc("listar_equivalencias_importacion", { p_ruc_emisor: ruc });
export const importarDocumentoCompraApi = (payload) => rpc("importar_documento_compra", { p_payload: payload });
export const documentosRecibidosApi = () => rpc("hu030_documentos_listar");
export const documentoRecibidoApi = (coddoc) => rpc("hu030_documento_detalle", { p_coddoc: Number(coddoc) });
export const recepcionesConErrorApi = () => rpc("hu030_recepciones_con_error");
export const codigosCroslandApi = () => rpc("hu030_equivalencias_listar");
export const guardarCodigoCroslandApi = (d) => rpc("hu030_guardar_equivalencia", { p_codigo: d.codigo, p_clasificacion: d.clasificacion, p_codmod: d.codmod ? Number(d.codmod) : null, p_observacion: d.observacion || null });
export const desactivarCodigoCroslandApi = (codequ) => rpc("hu030_desactivar_equivalencia", { p_codequ: Number(codequ) });
export const registrarSubidaPanelApi = (d) => rpc("hu030_registrar_subida_panel", { p_coddoc: Number(d.coddoc), p_rutaxml: d.rutaxml || null, p_sha256xml: d.sha256xml || null, p_rutapdf: d.rutapdf || null, p_sha256pdf: d.sha256pdf || null });
export const correosRecibidosApi = () => rpc("hu030_correos_listar");

// Mejoras finales del Sprint 2 (docs/supabase-sprint2-final.sql)
// Compras a proveedor: proveedores, registro de varias compras a la vez, lista completa, pedido y compras del mismo registro
export const proveedoresCompraApi = () => rpc("hu034_proveedores_compra");
export const registrarCarritoApi = (codpro, items, clave) => rpc("hu034_registrar_carrito", {
  p_codpro: Number(codpro), p_clave: clave,
  p_items: items.map((x) => ({ codmod: Number(x.codmod), color: x.color, cantidad: Number(x.cantidad), pedido: x.pedido || null })),
});
export const comprasListarApi = () => rpc("hu034_compras_listar");
export const compraExtraApi = (codcom) => rpc("hu034_compra_extra", { p_codcom: Number(codcom) });
export const guardarPedidoApi = (codcom, pedido) => rpc("hu034_guardar_pedido", { p_codcom: Number(codcom), p_pedido: pedido || "" });
// HU-001: poner una moto lista para entrega a la venta («Disponible») o retirarla («No disponible»)
export const situacionComercialApi = (coduni, situacion) => rpc("hu001_cambiar_situacion_comercial", { p_coduni: Number(coduni), p_situacion: situacion });
// Web y catálogo: eliminar un modelo (solo gerencia)
export const eliminarModeloApi = (codmod) => rpc("hu012_eliminar_modelo", { p_codmod: Number(codmod) });
// HU-023 (función de Michelle): compras pendientes sin depender de la ruta de Render
export const comprasPendientesSqlApi = ({ origen, limite = 200, offset = 0 } = {}) => rpc("hu023_consultar_compras_pendientes", { p_origen: origen || null, p_limite: limite, p_offset: offset });
// HU-033 (funciones de Michelle): preparación de cada moto, su historial y el registro de avances
export const preparacionListaApi = () => rpc("hu033_preparacion_listar");
// HU-006: decisión de techo del comprador de cada moto separada o vendida (CP-006-06)
export const techoComercialUnidadesApi = () => rpc("hu006_techo_comercial_unidades");
// HU-021 · Separaciones y ventas canceladas de una moto (solo lectura; el vendedor ve las suyas)
export const cancelacionesUnidadApi = (coduni) => rpc("hu021_cancelaciones_unidad", { p_coduni: Number(coduni) });
// HU-022 · Correcciones de comprador o moto de una venta o de una moto, con nombres (solo lectura; gerente y administradora)
export const correccionesDetalleApi = ({ codven, coduni } = {}) => rpc("hu022_correcciones_detalle", { p_codven: codven ? Number(codven) : null, p_coduni: coduni ? Number(coduni) : null });
export const preparacionUnidadApi = (coduni) => rpc("hu033_consultar_preparacion_unidad", { p_coduni: Number(coduni) });
export const actualizarPreparacionApi = (coduni, d, clave) => rpc("hu033_actualizar_preparacion_unidad", {
  p_coduni: Number(coduni), p_etapa: d.etapa, p_estado: d.estado, p_version_esperada: Number(d.version),
  p_observacion: d.observacion || null, p_fuente: d.fuente || "Interno", p_idempotencia: clave,
});

// Renovar la sesión
async function refrescar() {
  const s = leerSesion();
  if (!s?.refresh_token) throw new ApiError(401, "Sesión vencida");
  const j = await authFetch("refresh_token", { refresh_token: s.refresh_token });
  guardarSesion({ access_token: j.access_token, refresh_token: j.refresh_token });
}

// Petición a la API
// Un 404 que no viene en JSON lo da Express cuando la ruta no existe: el servidor publicado todavía no
// tiene ese endpoint (por ejemplo, la API del Sprint 1 frente a una pantalla del Sprint 2).
// Los 404 de la API («no se encontró el registro») siempre vienen en JSON.
// La persona solo ve un mensaje de negocio; la ruta que falta se anota una vez en la consola para el equipo técnico.
const esJson = (r) => (r.headers.get("content-type") || "").includes("json");
const rutasAvisadas = new Set();
function sinRuta(metodo, ruta) {
  const endpoint = `${metodo} ${ruta.split("?")[0]}`;
  if (!rutasAvisadas.has(endpoint)) { rutasAvisadas.add(endpoint); console.warn(`[EPSA] La API publicada todavía no tiene ${endpoint}`); }
  return new ApiError(404, "Esta función todavía no está disponible. Inténtalo más adelante.", { sinRuta: true, endpoint });
}

export async function pedir(ruta, { metodo = "GET", cuerpo, formulario, headers = {}, privada = true } = {}, reintento = true) {
  if (!MODO_REAL) throw new ApiError(0, "Esta función necesita conexión.");
  const h = { ...headers };
  if (cuerpo !== undefined) h["Content-Type"] = "application/json";
  if (privada) h.Authorization = `Bearer ${leerSesion()?.access_token || ""}`;
  const body = formulario || (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined);
  let r;
  try {
    r = await fetch(`${API_URL}${ruta}`, body === undefined ? { method: metodo, headers: h } : { method: metodo, headers: h, body });
  } catch { throw new ApiError(0, "No se pudo conectar. Si es la primera consulta del día, espera un minuto y vuelve a intentar."); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && privada && reintento) {
    try { await refrescar(); return pedir(ruta, { metodo, cuerpo, formulario, headers, privada }, false); } catch {}
  }
  if (r.status === 404 && !esJson(r)) throw sinRuta(metodo, ruta);
  if (!r.ok || j.ok === false) throw new ApiError(r.status, j.message || "Error", j);
  return { data: j.data, message: j.message, status: r.status, ...(j.warning ? { warning: j.warning } : {}) };
}

// HU-036 · Almacenamiento central de Supabase (bucket «modelos», diseño de Michelle)
// La foto se sube con la sesión de la persona: los permisos de Storage dejan escribir solo a gerencia y
// administración. Nunca se usa una clave privilegiada en el navegador.
export const BUCKET_FOTOS = "modelos";
const rutaCodificada = (ruta) => ruta.split("/").map(encodeURIComponent).join("/");
export const urlPublicaStorage = (bucket, ruta) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${rutaCodificada(ruta)}`;
const cabecerasStorage = (extra = {}) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${leerSesion()?.access_token || ""}`, ...extra });

// Renueva la sesión si está por vencer: Storage no la renueva por su cuenta
async function sesionVigente() {
  const exp = Number(datosToken(leerSesion()?.access_token || "").exp || 0);
  if (exp && exp * 1000 - Date.now() < 60000) { try { await refrescar(); } catch {} }
}

export async function subirArchivoStorage(bucket, ruta, archivo, reintento = true) {
  if (!MODO_REAL) throw new ApiError(0, "Esta función necesita conexión.");
  await sesionVigente();
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${rutaCodificada(ruta)}`, {
      method: "POST",
      headers: cabecerasStorage({ "Content-Type": archivo.type || "application/octet-stream", "x-upsert": "false", "cache-control": "3600" }),
      body: archivo,
    });
  } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  if (r.ok) return urlPublicaStorage(bucket, ruta);
  const j = await r.json().catch(() => ({}));
  const texto = `${j.error || ""} ${j.message || ""}`;
  const estado = Number(j.statusCode) || r.status;
  if (reintento && (r.status === 401 || /jwt|exp" claim|token/i.test(texto))) {
    try { await refrescar(); return subirArchivoStorage(bucket, ruta, archivo, false); } catch {}
  }
  if (estado === 413 || /too large|exceeded/i.test(texto)) throw new ApiError(413, "La foto pesa más de 6 MB.");
  if (estado === 415 || /mime/i.test(texto)) throw new ApiError(415, "Solo se aceptan fotos JPG, PNG o WebP.");
  if (/bucket not found/i.test(texto)) {
    console.warn(`[EPSA] Falta el bucket «${bucket}» en Supabase Storage.`);
    throw new ApiError(404, "El almacenamiento de fotos todavía no está configurado. Avisa a quien administra el sistema.", { sinRuta: false });
  }
  if (estado === 403 || /row-level security|unauthorized/i.test(texto)) throw new ApiError(403, "No tienes permiso para subir fotos.");
  if (estado === 409 || /already exists|duplicate/i.test(texto)) throw new ApiError(409, "Ya existe un archivo con ese nombre. Vuelve a intentarlo.");
  throw new ApiError(estado >= 400 ? estado : 500, "No se pudo subir la foto. Inténtalo de nuevo.");
}

// Archivo privado de Storage: dirección firmada por unos minutos (solo si la sesión tiene permiso de lectura)
export async function urlFirmadaStorage(bucket, ruta, segundos = 300) {
  if (!MODO_REAL) throw new ApiError(0, "Esta función necesita conexión.");
  await sesionVigente();
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${rutaCodificada(ruta)}`, {
      method: "POST", headers: cabecerasStorage({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: segundos }),
    });
  } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  const j = await r.json().catch(() => ({}));
  const firmada = j.signedURL || j.signedUrl;
  if (!r.ok || !firmada) throw new ApiError(r.status === 400 ? 404 : r.status, "No se encontró el archivo o no tienes permiso para verlo.");
  return /^https?:/i.test(firmada) ? firmada : `${SUPABASE_URL}/storage/v1${firmada.startsWith("/") ? "" : "/"}${firmada}`;
}
export async function descargarStorage(bucket, ruta) {
  const url = await urlFirmadaStorage(bucket, ruta, 120);
  let r;
  try { r = await fetch(url); } catch { throw new ApiError(0, "No se pudo conectar. Revisa tu internet e inténtalo de nuevo."); }
  if (!r.ok) throw new ApiError(r.status, "No se pudo descargar el archivo.");
  return r.blob();
}

export async function borrarArchivoStorage(bucket, rutas) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, { method: "DELETE", headers: cabecerasStorage({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: rutas }) });
  } catch { throw new ApiError(0, "No se pudo conectar."); }
  if (!r.ok) throw new ApiError(r.status, "No se pudo borrar el archivo.");
  return true;
}

// HU-012 · Modelos publicados
export const modelosPublicos = () => pedir("/api/modelos", { privada: false });
// HU-012 · Administración de modelos (Gerente y Administradora)
export const modelosAdminApi = () => pedir("/api/modelos/admin");
export const crearModeloApi = (b) => pedir("/api/modelos", { metodo: "POST", cuerpo: b });
export const editarModeloApi = (codmod, b) => pedir(`/api/modelos/${codmod}`, { metodo: "PUT", cuerpo: b });
export const estadoModeloApi = (codmod, estmod) => pedir(`/api/modelos/${codmod}/estado`, { metodo: "PATCH", cuerpo: { estmod } });
export const agregarImagenModeloApi = (codmod, urlimo) => pedir(`/api/modelos/${codmod}/imagenes`, { metodo: "POST", cuerpo: { urlimo, ordimo: 1 } });
export const editarImagenModeloApi = (codmod, codimo, urlimo) => pedir(`/api/modelos/${codmod}/imagenes/${codimo}`, { metodo: "PUT", cuerpo: { urlimo, ordimo: 1 } });
// HU-010 · Sedes
export const sedesPublicasApi = () => pedir("/api/sedes", { privada: false });
// HU-014 · Registrar interesado
export const registrarLeadApi = (b) => pedir("/api/leads", { metodo: "POST", cuerpo: b });

// HU-026 · Ubicaciones
export const listarUbicaciones = (activo) => pedir(`/api/ubicaciones${activo === undefined ? "" : `?activo=${activo}`}`);
export const crearUbicacion = (b) => pedir("/api/ubicaciones", { metodo: "POST", cuerpo: b });
export const editarUbicacion = (id, b) => pedir(`/api/ubicaciones/${id}`, { metodo: "PUT", cuerpo: b });
export const estadoUbicacion = (id, estubi) => pedir(`/api/ubicaciones/${id}/estado`, { metodo: "PATCH", cuerpo: { estubi } });

// HU-034 · Compras
export const listarCompras = (limite = 50, offset = 0) => pedir(`/api/compras?limite=${limite}&offset=${offset}`);
export const obtenerCompra = (id) => pedir(`/api/compras/${id}`);
export const crearCompra = (b, idempotencia) => pedir("/api/compras", { metodo: "POST", cuerpo: b, headers: { "Idempotency-Key": idempotencia } });

// HU-002 · Factura, PDF e identificación
export const registrarFactura = (id, b) => pedir(`/api/compras/${id}/factura`, { metodo: "PUT", cuerpo: b });
export const subirPdfFacturaApi = (id, archivo) => {
  const fd = new FormData();
  fd.append("archivo", archivo instanceof File && archivo.type === "application/pdf" ? archivo : new File([archivo], archivo.name || "factura.pdf", { type: "application/pdf" }));
  return pedir(`/api/compras/${id}/factura/archivo`, { metodo: "POST", formulario: fd });
};
export const consultarPdfFacturaApi = (id) => pedir(`/api/compras/${id}/factura/archivo`);
export const urlPdfFacturaApi = (id) => pedir(`/api/compras/${id}/factura/archivo/url`);
// HU-004 · Techo de la unidad
export const tiposTechoApi = () => pedir("/api/unidades/catalogos/tipos-techo");
export const proveedoresTechoApi = () => pedir("/api/unidades/catalogos/proveedores-techo");
export const techoUnidadApi = (coduni) => pedir(`/api/unidades/${coduni}/techo`);
export const guardarTechoUnidadApi = (coduni, b) => pedir(`/api/unidades/${coduni}/techo`, { metodo: "PUT", cuerpo: b });
// HU-009 · Ficha de un modelo
export const modeloPublicadoApi = (codmod) => pedir(`/api/modelos/${codmod}`, { privada: false });
export const listarUnidadesCompra = (id) => pedir(`/api/compras/${id}/unidades`);
export const vincularUnidades = (id, unidades) => pedir(`/api/compras/${id}/unidades`, { metodo: "POST", cuerpo: { unidades } });
