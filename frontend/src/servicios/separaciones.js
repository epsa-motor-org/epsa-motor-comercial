// HU-005 · Separar una moto con adelanto confirmado
// Hoy guarda en este navegador (los vouchers en IndexedDB). Al conectar con la base
// (tablas separacion, cliente y tipodocumento, y un bucket privado para vouchers):
//   GET   /api/separaciones                     lista con cliente, moto y vendedor
//   GET   /api/clientes?tipo=DNI&numero=...      buscar cliente por documento
//   POST  /api/separaciones (multipart)          en una sola transacción: bloquea la moto, exige que esté
//                                                Disponible, crea o reutiliza el cliente, guarda la separación
//                                                y deja la moto Separada
//   PATCH /api/separaciones/:id/cancelar         { motivo, detalle }  la moto vuelve a Disponible
//   PATCH /api/separaciones/:id/extender         { motivo }           +7 días (máximo 2 veces)
//   PATCH /api/separaciones/:id/liberar          vencida: la moto vuelve a Disponible
import { useCallback, useMemo } from "react";
import { useApp } from "../store/appStore.jsx";
import { useAuth } from "../context/AuthContext";
import { ADELANTO_MINIMO, DIAS_SEPARACION, MAX_EXTENSIONES, MEDIOS_CON_OPERACION, MEDIOS_PAGO, MOTIVOS_CANCELACION, formatoSoles } from "../data/mockData";
import { MSJ, diasEntre, esCelular, esCorreo, esNombrePersona, hoyLocal, limpiarTexto, sumarDias, validarDocumento } from "../lib/validar";
import { comprimirImagen, guardarArchivoLocal, validarVoucher } from "../lib/archivos";
import { nombreCliente, siguienteId } from "../lib/sprint2";

export const numeroSeparacion = (s) => `SEP-${String(s.id).padStart(4, "0")}`;
// Razón social: letras, números y los signos de una empresa (S.A.C., & , -)
const esRazonSocial = (v) => { const t = limpiarTexto(v); return t.length >= 3 && t.length <= 100 && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9&.,' -]+$/.test(t) && (t.match(/\p{L}/gu) || []).length >= 3; };
export const limpiarOperacion = (t) => String(t || "").replace(/[^\w-]/g, "").toUpperCase().slice(0, 20);
export const venceDe = (fechaPago) => sumarDias(DIAS_SEPARACION, fechaPago);

// Estado que ve el usuario (una activa puede estar por vencer o ya vencida)
export function estadoVisible(s, hoy = hoyLocal()) {
  if (s.estado !== "Activa") return s.estado;
  const d = diasEntre(hoy, s.vence);
  if (d < 0) return "Vencida por liberar";
  if (d <= 2) return "Por vencer";
  return "Activa";
}
export function textoPlazo(s, hoy = hoyLocal()) {
  if (s.estado !== "Activa") return "";
  const d = diasEntre(hoy, s.vence);
  if (d < 0) return d === -1 ? "Venció ayer" : `Venció hace ${-d} días`;
  if (d === 0) return "Vence hoy";
  if (d === 1) return "Vence mañana";
  return `Vence en ${d} días`;
}

// Nombres a partir de un texto («Mario Díaz Ruiz»)
function partirNombre(t) {
  const p = limpiarTexto(t).split(" ").filter(Boolean);
  if (p.length >= 3) return { nombres: p.slice(0, -2).join(" "), apellidoPaterno: p.at(-2), apellidoMaterno: p.at(-1) };
  return { nombres: p[0] || "", apellidoPaterno: p[1] || "", apellidoMaterno: "" };
}

export function useSeparaciones() {
  const { separaciones = [], clientes = [], unidades = [], ventas = [], modelos = [], publicos = [], agregar, actualizar } = useApp();
  const { user } = useAuth();
  const hoy = hoyLocal();

  const lista = useMemo(() => separaciones.map((s) => ({
    ...s, numero: numeroSeparacion(s), clienteDatos: clientes.find((c) => c.id === s.cliente), estadoVisible: estadoVisible(s, hoy), dias: diasEntre(hoy, s.vence),
  })).sort((a, b) => b.fecha.localeCompare(a.fecha)), [separaciones, clientes, hoy]);
  const activaDe = useCallback((unidadId) => separaciones.find((s) => s.unidad === unidadId && s.estado === "Activa") || null, [separaciones]);
  const buscarCliente = useCallback((tipoDoc, doc) => clientes.find((c) => c.tipoDoc === tipoDoc && c.doc === doc) || null, [clientes]);
  const precioDe = (u) => Number((modelos.find((m) => m.id === u?.modelo) || publicos.find((m) => m.id === u?.modelo))?.precioDesde) || 0;
  const operacionUsada = (op, medio, sinId) => separaciones.some((s) => s.id !== sinId && s.estado !== "Cancelada" && s.operacion && s.operacion === op && s.medio === medio)
    || ventas.some((v) => v.operacion && limpiarOperacion(v.operacion) === op && v.medioPago === medio);
  const anotar = (x, texto) => [...(x.historial || []), { fecha: hoy, detalle: `${texto} · ${user.nombre}` }];

  // Paso 1: la moto
  function validarMoto(u) {
    if (!u) return "Elige la moto que se separa.";
    const actual = unidades.find((x) => x.id === u.id);
    if (!actual || actual.disponibilidad !== "Disponible") return `${u.id} ya no está disponible. Elige otra moto.`;
    if (activaDe(u.id)) return `${u.id} ya tiene una separación activa.`;
    return "";
  }

  // Paso 2: el cliente
  function validarCliente(c) {
    const x = {};
    const e = validarDocumento(c.tipoDoc, c.doc);
    if (e) x.doc = e;
    const existente = !e && buscarCliente(c.tipoDoc, c.doc);
    if (!existente) {
      if (c.tipoDoc === "RUC") {
        if (!limpiarTexto(c.razonSocial)) x.razonSocial = "Escribe la razón social de la empresa.";
        else if (!esRazonSocial(c.razonSocial)) x.razonSocial = "Razón social de 3 a 100 caracteres: letras, números y los signos . , & -";
      } else {
        if (!limpiarTexto(c.nombres)) x.nombres = "Escribe sus nombres.";
        else if (!esNombrePersona(c.nombres)) x.nombres = "Los nombres solo llevan letras y espacios (sin números ni símbolos).";
        if (!limpiarTexto(c.apellidoPaterno)) x.apellidoPaterno = "Escribe el apellido paterno.";
        else if (!esNombrePersona(c.apellidoPaterno)) x.apellidoPaterno = "Solo letras y espacios (sin números ni símbolos).";
        if (limpiarTexto(c.apellidoMaterno) && !esNombrePersona(c.apellidoMaterno)) x.apellidoMaterno = "Solo letras y espacios, o déjalo vacío.";
      }
    }
    if (!c.celular) x.celular = "Escribe su celular."; else if (!esCelular(c.celular)) x.celular = MSJ.celular;
    if (c.correo && !esCorreo(c.correo)) x.correo = MSJ.correo;
    return x;
  }

  // Paso 3: el adelanto
  function validarAdelanto(a, u) {
    const x = {};
    const precio = precioDe(u);
    const monto = Number(a.monto);
    if (!a.monto || !(monto > 0)) x.monto = "Ingresa el monto del adelanto.";
    else if (monto < ADELANTO_MINIMO) x.monto = `El adelanto mínimo es ${formatoSoles(ADELANTO_MINIMO)}.`;
    else if (precio && monto >= precio) x.monto = `Debe ser menor al precio de la moto (${formatoSoles(precio)}). Si paga todo, registra la venta.`;
    if (!MEDIOS_PAGO.includes(a.medio)) x.medio = "Elige el medio de pago.";
    const op = limpiarOperacion(a.operacion);
    if (MEDIOS_CON_OPERACION.includes(a.medio)) {
      if (op.length < 4) x.operacion = "Ingresa el N° de operación (mínimo 4 caracteres).";
      else if (operacionUsada(op, a.medio)) x.operacion = "Ese N° de operación ya está registrado en otra separación o venta.";
      if (!a.archivo) x.archivo = "Adjunta el voucher del pago.";
    }
    if (a.archivo) { const e = validarVoucher(a.archivo); if (e) x.archivo = e; }
    if (!a.fechaPago) x.fechaPago = "Indica la fecha del pago.";
    else if (a.fechaPago > hoy) x.fechaPago = "La fecha del pago no puede ser futura.";
    else if (diasEntre(a.fechaPago, hoy) > 3) x.fechaPago = "Registra pagos de los últimos 3 días.";
    if (!a.vendedor) x.vendedor = "Elige al vendedor responsable.";
    if (limpiarTexto(a.obs).length > 300) x.obs = "Máximo 300 caracteres.";
    return x;
  }

  // Guardar la separación
  async function crear({ unidad: u, cliente: c, adelanto: a }) {
    const error = validarMoto(u);
    if (error) throw new Error(error);
    let cli = buscarCliente(c.tipoDoc, c.doc);
    if (cli) {
      if (cli.celular !== c.celular || (cli.correo || "") !== limpiarTexto(c.correo)) actualizar("clientes", cli.id, { celular: c.celular, correo: limpiarTexto(c.correo) });
    } else {
      cli = { id: siguienteId(clientes), tipoDoc: c.tipoDoc, doc: c.doc, nombres: c.tipoDoc === "RUC" ? "" : limpiarTexto(c.nombres), apellidoPaterno: c.tipoDoc === "RUC" ? "" : limpiarTexto(c.apellidoPaterno), apellidoMaterno: c.tipoDoc === "RUC" ? "" : limpiarTexto(c.apellidoMaterno), razonSocial: c.tipoDoc === "RUC" ? limpiarTexto(c.razonSocial) : "", celular: c.celular, correo: limpiarTexto(c.correo), registrado: hoy };
      agregar("clientes", cli, `Cliente registrado: ${nombreCliente(cli)}`);
    }
    let voucher = null;
    if (a.archivo) {
      const imagen = a.archivo.type.startsWith("image/");
      const blob = imagen ? await comprimirImagen(a.archivo, { lado: 1600, calidad: 0.8, tipo: "image/jpeg" }) : a.archivo;
      const clave = `vouchers/${u.id}/${Date.now()}-${a.archivo.name.replace(/[^\w.-]+/g, "_")}`;
      await guardarArchivoLocal(clave, blob);
      voucher = { archivo: clave, nombre: a.archivo.name, tipo: imagen ? "image/jpeg" : a.archivo.type, tamano: blob.size };
    }
    const sep = {
      id: siguienteId(separaciones), unidad: u.id, cliente: cli.id, vendedor: a.vendedor, sede: u.ubicacion, monto: Math.round(Number(a.monto) * 100) / 100, medio: a.medio,
      operacion: limpiarOperacion(a.operacion), fechaPago: a.fechaPago, voucher, fecha: new Date().toISOString(), vence: venceDe(a.fechaPago), extensiones: 0,
      estado: "Activa", obs: limpiarTexto(a.obs), registradaPor: user.nombre,
    };
    agregar("separaciones", sep);
    actualizar("unidades", u.id, (x) => ({ disponibilidad: "Separada", historial: anotar(x, `Separada para ${nombreCliente(cli)} (adelanto ${formatoSoles(sep.monto)}, ${sep.medio}) hasta el ${sep.vence}`) }), `${u.id} separada para ${nombreCliente(cli)}`);
    return { ...sep, numero: numeroSeparacion(sep) };
  }

  // Cancelar (la moto vuelve a la venta)
  function validarCancelacion(motivo, detalle) {
    if (!MOTIVOS_CANCELACION.includes(motivo)) return { motivo: "Elige el motivo." };
    const t = limpiarTexto(detalle);
    if (motivo === "Otro motivo" && t.length < 5) return { detalle: "Describe el motivo (mínimo 5 caracteres)." };
    if (t.length > 250) return { detalle: "Máximo 250 caracteres." };
    return {};
  }
  function liberarUnidad(s, texto) {
    actualizar("unidades", s.unidad, (x) => (x.disponibilidad === "Separada" && !s.ventaId ? { disponibilidad: "Disponible", historial: anotar(x, texto) } : { historial: anotar(x, texto) }));
  }
  function cancelar(s, motivo, detalle) {
    actualizar("separaciones", s.id, { estado: "Cancelada", cancelacion: { fecha: new Date().toISOString(), motivo, detalle: limpiarTexto(detalle), usuario: user.nombre } }, `Separación ${numeroSeparacion(s)} cancelada`);
    liberarUnidad(s, `Separación ${numeroSeparacion(s)} cancelada: ${motivo}. Vuelve a estar disponible`);
    return `${numeroSeparacion(s)} cancelada. ${s.unidad} vuelve a estar disponible.`;
  }

  // Extender el plazo
  function validarExtension(s, motivo) {
    if (s.estado !== "Activa") return "Solo se extiende una separación activa.";
    if ((s.extensiones || 0) >= MAX_EXTENSIONES) return `Ya se extendió ${MAX_EXTENSIONES} veces. Concreta la venta o libera la moto.`;
    if (limpiarTexto(motivo).length < 5) return "Escribe el motivo (mínimo 5 caracteres).";
    if (limpiarTexto(motivo).length > 200) return "Máximo 200 caracteres.";
    return "";
  }
  const nuevoVence = (s) => sumarDias(DIAS_SEPARACION, s.vence < hoy ? hoy : s.vence);
  function extender(s, motivo) {
    const vence = nuevoVence(s);
    actualizar("separaciones", s.id, { vence, extensiones: (s.extensiones || 0) + 1, prorrogas: [...(s.prorrogas || []), { fecha: new Date().toISOString(), antes: s.vence, vence, motivo: limpiarTexto(motivo), usuario: user.nombre }] }, `Separación ${numeroSeparacion(s)} extendida al ${vence}`);
    actualizar("unidades", s.unidad, (x) => ({ historial: anotar(x, `Separación extendida hasta el ${vence}: ${limpiarTexto(motivo)}`) }));
    return `Plazo extendido hasta el ${vence}.`;
  }

  // Liberar una separación vencida
  function liberarVencida(s) {
    actualizar("separaciones", s.id, { estado: "Vencida", liberacion: { fecha: new Date().toISOString(), usuario: user.nombre } }, `Separación ${numeroSeparacion(s)} vencida`);
    liberarUnidad(s, `Separación ${numeroSeparacion(s)} vencida sin concretar la venta. Vuelve a estar disponible`);
    return `${s.unidad} vuelve a estar disponible para la venta.`;
  }

  // Ventas: la separación pasa a venta
  function convertir(s, ventaId) {
    actualizar("separaciones", s.id, { estado: "Convertida en venta", ventaId, conversion: { fecha: new Date().toISOString(), usuario: user.nombre } }, `Separación ${numeroSeparacion(s)} convertida en venta`);
  }
  // Ventas: una venta separa una moto directamente (queda registrada como separación convertida)
  function registrarDesdeVenta({ unidadId, ventaId, cliente, documento, celular, monto, medio, operacion, fechaPago, vendedor }) {
    const [tipoDoc, doc] = String(documento || "").split(" ");
    let cli = tipoDoc && doc ? buscarCliente(tipoDoc, doc) : null;
    if (!cli) {
      const n = tipoDoc === "RUC" ? { nombres: "", apellidoPaterno: "", apellidoMaterno: "", razonSocial: limpiarTexto(cliente) } : { ...partirNombre(cliente), razonSocial: "" };
      cli = { id: siguienteId(clientes), tipoDoc: tipoDoc || "DNI", doc: doc || "", ...n, celular: celular || "", correo: "", registrado: hoy };
      agregar("clientes", cli);
    }
    const u = unidades.find((x) => x.id === unidadId);
    agregar("separaciones", {
      id: siguienteId(separaciones), unidad: unidadId, cliente: cli.id, vendedor, sede: u?.ubicacion || "", monto: Number(monto) || 0, medio: medio || "", operacion: limpiarOperacion(operacion),
      fechaPago: fechaPago || hoy, voucher: null, fecha: new Date().toISOString(), vence: venceDe(fechaPago || hoy), extensiones: 0, estado: "Convertida en venta",
      ventaId, conversion: { fecha: new Date().toISOString(), usuario: user.nombre }, obs: "Registrada desde Ventas", registradaPor: user.nombre,
    });
  }
  // Ventas: si se elimina la venta, su separación queda cancelada
  function anularPorVenta(ventaId) {
    separaciones.filter((s) => s.ventaId === ventaId && s.estado === "Convertida en venta").forEach((s) => actualizar("separaciones", s.id, { estado: "Cancelada", cancelacion: { fecha: new Date().toISOString(), motivo: "Error al registrar", detalle: "Se eliminó la venta", usuario: user.nombre } }));
  }

  return {
    lista, activaDe, buscarCliente, precioDe, validarMoto, validarCliente, validarAdelanto, crear,
    validarCancelacion, cancelar, validarExtension, nuevoVence, extender, liberarVencida, convertir, registrarDesdeVenta, anularPorVenta,
  };
}
