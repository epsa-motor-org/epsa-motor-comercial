// HU-032 · Registrar la entrega efectiva de una moto vendida (contrato de Michelle del 15/11, docs/HU-032.md)
// La entrega es un hecho propio: no se deduce de la factura, los pagos, la ubicación, la preparación ni un traslado.
// GET /api/ventas/:codven/entrega dice si la venta está «Vendida pendiente de entrega», «Lista para entrega»,
// «Lista para entrega embalada», «Entregada» o «Venta cancelada», con las condiciones que faltan.
// POST /api/ventas/:codven/entrega registra la entrega con una clave de intento (Idempotency-Key): un reintento no
// la duplica. El servidor vuelve a comprobar todo al confirmar (responsable vigente, sede, tránsito, armado y techo).
// La entrega no cambia la venta, los pagos, la ubicación, el techo ni la preparación de la moto.
import { listarUbicaciones, pedir } from "../lib/api";
import * as S from "./separacionCentral";
import * as V from "./ventaCentral";
import { VENTA, cancelacionDeApi } from "./cancelacionCentral";

export const entregaDeVentaApi = (codven) => pedir(`/api/ventas/${codven}/entrega`).then((r) => r.data ?? null);
// 201 nueva; 200 si era el mismo envío y ya estaba registrada
export const registrarEntregaApi = (codven, cuerpo, clave) =>
  pedir(`/api/ventas/${codven}/entrega`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } });

export const ENTREGADA = "Entregada";
export const LISTA = "Lista para entrega";
export const LISTA_EMBALADA = "Lista para entrega embalada";
export const PENDIENTE = "Vendida pendiente de entrega";
export const CANCELADA = "Venta cancelada";
export const RETORNADA = "Retornada"; // HU-021: venta cancelada después de entregar y la moto ya regresó (retorno físico)
export const lista = (e) => e?.estado === LISTA || e?.estado === LISTA_EMBALADA;
export const TONO_ENTREGA = { [ENTREGADA]: "verde", [LISTA]: "verde", [LISTA_EMBALADA]: "verde", [PENDIENTE]: "ambar", [CANCELADA]: "gris", [RETORNADA]: "gris" };

// Quién la registra (para mostrar el botón; el servidor decide): gerente y administradora; un vendedor solo si es el
// responsable comercial vigente de la venta.
export function permisoEntrega(user, venta) {
  const rol = String(user?.rol || "").toLowerCase();
  if (rol === "gerente" || rol === "administradora") return { puede: true, texto: "" };
  if (rol !== "vendedor") return { puede: false, texto: "Tu rol no registra entregas." };
  const r = venta?.responsable;
  if (r?.codusu && String(r.codusu) === String(user?.codusu ?? "")) return { puede: true, texto: "" };
  return { puede: false, texto: `La registra su responsable${r?.nombre ? ` (${r.nombre})` : ""}, el gerente o la administradora.` };
}

// Quién puede consultar la entrega: gerente, administradora y el vendedor responsable vigente. Al vendedor que no es
// el responsable el servidor se la niega; no se consulta, para no mostrarle un error (QA 16/11, EMT-159: le salía
// «error interno»).
export function puedeVerEntrega(user, venta) {
  const rol = String(user?.rol || "").toLowerCase();
  if (rol === "gerente" || rol === "administradora") return true;
  if (rol !== "vendedor") return false;
  const r = venta?.responsable;
  return Boolean(r?.codusu && String(r.codusu) === String(user?.codusu ?? ""));
}

// HU-021 con HU-032 (regla del PO del 16/11): si se cancela una venta ya entregada, la entrega se conserva y la moto
// sigue «Vendida», bloqueada hasta que el gerente registre su retorno real; con el retorno registrado vuelve a
// ofrecerse. La moto ya no tiene venta vigente, así que la ficha busca su venta cancelada (Ventas a clientes, por
// motor o chasis) y la entrega de esa venta para mostrar el motivo real del bloqueo (QA 16/11, EMT-157).
// Devuelve { venta, entrega, cancelacion, restringida } o { venta: null } si no encuentra una venta cancelada.
export async function ventaCanceladaEntregadaApi(unidad, user) {
  const q = S.limpio(unidad?.nummotuni || unidad?.chauni || "");
  if (!q || !unidad?.coduni) return { venta: null };
  const r = await V.ventasApi({ q, limite: 20 });
  const canceladas = (r.items || [])
    .filter((v) => String(v.unidad?.coduni ?? "") === String(unidad.coduni) && v.estado === "Cancelada")
    .sort((a, b) => Number(b.codven) - Number(a.codven));
  if (!canceladas.length) return { venta: null };
  const visibles = canceladas.filter((v) => puedeVerEntrega(user, v)).slice(0, 5);
  for (const v of visibles) {
    const e = await entregaDeVentaApi(v.codven);
    if (e?.estado === ENTREGADA && e.entrega) {
      const cancelacion = await cancelacionDeApi(VENTA, v.codven).catch(() => null);
      return { venta: v, entrega: e, cancelacion };
    }
  }
  return { venta: canceladas[0], entrega: null, cancelacion: null, restringida: !visibles.length };
}
// ---------------------------------------------------------------------------------------------
// HU-021 · Retorno físico de una moto entregada cuya venta se canceló (contrato de Michelle, PR #65, 19/11)
// POST /api/ventas/:codven/retorno, solo Gerente, con Idempotency-Key. Cuerpo exacto: fechaRetorno (YYYY-MM-DD, no
// futura ni anterior a la entrega), codubi (sede o almacén EPSA activo), condicion (hasta 500) y observacion (hasta
// 1000). Al registrarlo la moto queda en esa ubicación y vuelve a ofrecerse si no tiene otro compromiso (regla del PO
// del 16/11: sin una segunda decisión). No borra la venta, la entrega ni la cancelación; no devuelve dinero.
// ---------------------------------------------------------------------------------------------
export const MAX_CONDICION = 500;
export const MAX_OBS_RETORNO = 1000;
export const registrarRetornoApi = (codven, cuerpo, clave) =>
  pedir(`/api/ventas/${codven}/retorno`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } });
export const puedeRegistrarRetorno = (user) => String(user?.rol || "").toLowerCase() === "gerente";
// Lugares EPSA donde puede quedar la moto al volver: sedes y almacenes activos (no proveedores de techo)
export const ubicacionesRetornoApi = () => listarUbicaciones(true).then((r) => (r.data || [])
  .filter((u) => (u.tipubi === "Sede" || u.tipubi === "Almacen") && u.estubi !== false)
  .map((u) => ({ codubi: String(u.codubi), nombre: u.nomubi, tipo: u.tipubi === "Almacen" ? "Almacén" : "Sede" }))
  .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, "es")));
export function erroresRetorno(f, { hoy, fechaEntrega = "" } = {}) {
  const e = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha || "")) e.fecha = "Indica la fecha real en que volvió la moto.";
  else if (hoy && f.fecha > hoy) e.fecha = "La fecha no puede ser futura: registra el retorno cuando la moto haya vuelto.";
  else if (fechaEntrega && f.fecha < fechaEntrega) e.fecha = "La fecha no puede ser anterior a la entrega.";
  if (!f.codubi) e.codubi = "Elige la sede o el almacén donde quedó la moto.";
  const condicion = limpio(f.condicion);
  if (!condicion) e.condicion = "Describe cómo volvió la moto.";
  else if (condicion.length > MAX_CONDICION || CONTROL.test(f.condicion.replace(/[\r\n\t]/g, " "))) e.condicion = `Máximo ${MAX_CONDICION} caracteres, sin símbolos raros.`;
  const obs = limpio(f.observacion);
  if (!obs) e.observacion = "Escribe una observación del retorno.";
  else if (obs.length > MAX_OBS_RETORNO || CONTROL.test(f.observacion.replace(/[\r\n\t]/g, " "))) e.observacion = `Máximo ${MAX_OBS_RETORNO} caracteres, sin símbolos raros.`;
  return e;
}
export const cuerpoRetorno = (f) => ({ fechaRetorno: f.fecha, codubi: Number(f.codubi), condicion: limpio(f.condicion), observacion: limpio(f.observacion) });
export function textoErrorRetorno(e) {
  const m = String(e?.message || "");
  if (e?.status === 403) return "Solo el gerente registra el retorno de la moto.";
  // La API publicada (Render) todavía no tiene la ruta del retorno: no es un problema de la venta (QA 20/11)
  if (e?.detalle?.sinRuta) return "El registro del retorno todavía no está publicado en el servidor. No se registró nada: avisa al equipo para que lo despliegue.";
  if (e?.status === 404) return "No se encontró la venta o su moto. Actualiza la ficha.";
  if (/ya fue registrado/i.test(m)) return "El retorno de esta moto ya estaba registrado. No se registró otro.";
  if (/Idempotency/i.test(m)) return "Este intento ya se usó con otros datos. Cierra la ventana y vuelve a registrar el retorno.";
  if (/no est[aá] cancelada|entrega efectiva compatible/i.test(m)) return "La venta ya no está cancelada con una entrega registrada (cambió mientras tanto). Actualiza la ficha.";
  if (e?.status === 400) return `${m || "Los datos del retorno no son válidos"}. Revisa la fecha (no futura ni anterior a la entrega) y que la ubicación sea una sede o almacén activo.`;
  if (/cambi[oó]|modificando/i.test(m)) return `${m}. No se registró el retorno.`;
  return m || "No se pudo registrar el retorno.";
}
// Retorno ya registrado de una venta (GET …/entrega lo proyecta con estado «Retornada»)
export const retornoDe = (e) => (e?.estado === RETORNADA || e?.retorno ? e?.retorno || null : null);
// El retorno leído después de una falla es el que se envió (mismo gerente y mismos datos, como compara el servidor)
export const esMismoRetorno = (r, cuerpo, user) => Boolean(r && cuerpo
  && String(r.registradoPor?.codusu ?? "") === String(user?.codusu ?? "-")
  && String(r.fechaRetorno || "").slice(0, 10) === cuerpo.fechaRetorno
  && String(r.ubicacion?.codubi ?? "") === String(cuerpo.codubi)
  && limpio(r.condicion) === cuerpo.condicion && limpio(r.observacion) === cuerpo.observacion);

export const BLOQUEO_RETORNO = "La venta se canceló después de entregar la moto: la entrega se conserva y la moto queda bloqueada hasta que el gerente registre su retorno. Con el retorno registrado, vuelve a ofrecerse.";

export const MAX_RECEPTOR = 200;
export const MAX_OBSERVACION = 1000;
export const MAX_GUIA = 250;
// Caracteres de control: se rechazan a propósito (QA 20/11 pidió quitar la advertencia del lint)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const limpio = (t) => S.limpio(String(t ?? "").replace(/\s+/g, " "));

// Validación del formulario (la misma del servidor; además, la fecha no puede ser anterior a la venta)
export function erroresEntrega(f, { hoy, fechaVenta = "" } = {}) {
  const e = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha || "")) e.fecha = "Indica la fecha real de la entrega.";
  else if (hoy && f.fecha > hoy) e.fecha = "La fecha de entrega no puede ser futura: registra la entrega cuando ocurra.";
  else if (fechaVenta && f.fecha < fechaVenta) e.fecha = "La fecha de entrega no puede ser anterior a la venta.";
  const receptor = limpio(f.receptor);
  if (!receptor) e.receptor = "Indica quién recibió la moto.";
  else if (receptor.length > MAX_RECEPTOR || CONTROL.test(f.receptor)) e.receptor = `Máximo ${MAX_RECEPTOR} caracteres, sin símbolos raros.`;
  else if (!/\p{L}{2,}/u.test(receptor)) e.receptor = "Escribe el nombre de quien recibió la moto.";
  if (f.documentosPendientes) {
    if (!limpio(f.observacionDocumentos)) e.observacionDocumentos = "Indica qué documentos quedan pendientes (por ejemplo, tarjeta y placa).";
    if (!limpio(f.referenciaGuia)) e.referenciaGuia = "Registra la referencia de la guía de remisión.";
  }
  if (limpio(f.observacionDocumentos).length > MAX_OBSERVACION) e.observacionDocumentos = `Máximo ${MAX_OBSERVACION} caracteres.`;
  if (limpio(f.referenciaGuia).length > MAX_GUIA) e.referenciaGuia = `Máximo ${MAX_GUIA} caracteres.`;
  if (limpio(f.observacion).length > MAX_OBSERVACION) e.observacion = `Máximo ${MAX_OBSERVACION} caracteres.`;
  return e;
}

export function cuerpoEntrega(f, venta, estado) {
  const pendientes = Boolean(f.documentosPendientes);
  return {
    coduni: Number(venta.coduni ?? estado?.coduni),
    codcli: Number(venta.comprador?.codcli ?? estado?.codcli),
    modalidad: estado?.modalidadAcordada,
    fecha: f.fecha,
    receptor: limpio(f.receptor),
    documentosPendientes: pendientes,
    ...(limpio(f.observacion) ? { observacion: limpio(f.observacion) } : {}),
    ...(pendientes ? { observacionDocumentos: limpio(f.observacionDocumentos), referenciaGuia: limpio(f.referenciaGuia) } : {}),
  };
}

// Mensaje claro para los errores al registrar
export function textoErrorEntrega(e) {
  const m = String(e?.message || "");
  if (e?.status === 403) return /responsable/i.test(m) ? "Solo el responsable vigente de la venta, el gerente o la administradora pueden registrar esta entrega. Si cambió el responsable, recarga la ficha." : "No tienes permiso para registrar esta entrega.";
  if (/ya tiene una entrega/i.test(m) || e?.detalle?.data?.entregaExistente) return "Esta moto ya tiene una entrega registrada. No se registró otra.";
  if (/condiciones actuales/i.test(m)) return "La moto ya no cumple las condiciones para entregarse (cambió la venta, la ubicación, el traslado, el armado o el techo). No se registró la entrega: revisa lo que falta.";
  if (/Idempotency/i.test(m)) return "Este intento ya se usó con otros datos. Vuelve a abrir la ventana y registra de nuevo.";
  if (/cambió|modificando/i.test(m)) return `${m}. No se registró la entrega.`;
  return m || "No se pudo registrar la entrega.";
}
