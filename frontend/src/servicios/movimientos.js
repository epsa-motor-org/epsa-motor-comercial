// HU-003 · Registrar movimientos de ubicación (recepción y traslados)
// Hoy guarda en este navegador. Al conectar con la base (tabla movimientoubicacion):
//   POST  /api/unidades/:id/recepcion    primera llegada desde Crosland (queda Finalizado)
//   POST  /api/unidades/:id/movimientos  traslado (En transito o Finalizado)
//   PATCH /api/movimientos/:id           confirmar llegada (Finalizado)
//   GET   /api/movimientos y /api/unidades/:id/movimientos
import { useCallback, useMemo } from "react";
import { useApp } from "../store/appStore.jsx";
import { useAuth } from "../context/AuthContext";
import { ORIGEN_RECEPCION } from "../data/mockData";
import { fechaLocal, hoyLocal, limpiarTexto } from "../lib/validar";
import { siguienteId } from "../lib/sprint2";

const MAX_TEXTO = 200;
const ahoraISO = () => new Date().toISOString();
const fechaDe = (iso) => fechaLocal(iso);

export function useMovimientos() {
  const { movimientos = [], unidades = [], ubicaciones = [], historialPreparacion = [], agregar, actualizar } = useApp();
  const { user } = useAuth();

  const enTransito = useMemo(() => movimientos.filter((m) => m.estado === "En tránsito"), [movimientos]);
  const transitoDe = useCallback((id) => enTransito.find((m) => m.unidad === id) || null, [enTransito]);
  const porRecibir = useMemo(() => unidades.filter((u) => !u.ubicacion && u.disponibilidad !== "Vendida"), [unidades]);
  const deUnidad = useCallback((id) => movimientos.filter((m) => m.unidad === id).sort((a, b) => b.salida.localeCompare(a.salida)), [movimientos]);
  const lugar = (nombre) => ubicaciones.find((a) => a.nombre === nombre);
  const activa = (nombre) => Boolean(lugar(nombre)?.activo);
  const destinosPara = (origen) => ubicaciones.filter((a) => a.activo && a.nombre !== origen);
  const anotar = (u, texto, fecha = hoyLocal()) => [...(u.historial || []), { fecha, detalle: `${texto} · ${user.nombre}` }];

  // Fecha desde la que existe la unidad (para no registrar llegadas anteriores)
  const fechaIdentificacion = (u) => (u.historial || []).map((h) => h.fecha).sort()[0] || "";

  // Recepción: primera llegada desde Crosland
  function validarRecepcion(u, d) {
    const x = {};
    if (u.ubicacion) x.general = `Esta moto ya fue recibida en ${u.ubicacion}.`;
    if (!lugar(ORIGEN_RECEPCION)?.activo) x.general = `Activa la ubicación «${ORIGEN_RECEPCION}» en Ubicaciones: es el origen de toda recepción.`;
    if (!d.destino) x.destino = "Elige dónde llegó la moto.";
    else if (d.destino === ORIGEN_RECEPCION) x.destino = `${ORIGEN_RECEPCION} es el origen. Elige la sede o almacén donde llegó.`;
    else if (!activa(d.destino)) x.destino = "Esa ubicación está desactivada.";
    if (!d.llegada) x.llegada = "Indica cuándo llegó.";
    else if (new Date(d.llegada).getTime() > Date.now() + 5 * 60000) x.llegada = "La llegada no puede ser en el futuro.";
    else if (fechaIdentificacion(u) && fechaDe(d.llegada) < fechaIdentificacion(u)) x.llegada = `No puede ser anterior a su identificación (${fechaIdentificacion(u)}).`;
    if (limpiarTexto(d.obs).length > 300) x.obs = "Máximo 300 caracteres.";
    return x;
  }
  function recibir(u, d) {
    const llegada = new Date(d.llegada).toISOString();
    const revisado = (d.checklist || []).join(", ");
    const faltan = (d.faltantes || []).join(", ");
    const obs = [revisado && `Llegó con: ${revisado}.`, faltan && `Falta: ${faltan}.`, limpiarTexto(d.obs)].filter(Boolean).join(" ");
    agregar("movimientos", { id: siguienteId(movimientos), unidad: u.id, tipo: "Recepción", origen: ORIGEN_RECEPCION, destino: d.destino, estado: "Finalizado", salida: llegada, llegada, usuario: user.nombre, motivo: "", obs });
    actualizar("unidades", u.id, (x) => ({ ubicacion: d.destino, preparacion: x.preparacion || "Sin preparar", historial: anotar(x, `Recepción desde Crosland en ${d.destino}${obs ? ` (${obs})` : ""}`, fechaDe(llegada)) }), `${u.id} recibida en ${d.destino}`);
    // La preparación (HU-033) empieza al recibirla
    if (!historialPreparacion.some((h) => h.unidad === u.id)) agregar("historialPreparacion", { id: siguienteId(historialPreparacion), unidad: u.id, paso: u.preparacion || "Sin preparar", anterior: "", fecha: llegada, usuario: user.nombre, obs: "Inicio al recibirla" });
    return `${u.id} recibida en ${d.destino}. Ya puedes empezar su preparación.`;
  }

  // Traslado entre ubicaciones
  function validarTraslado(u, d) {
    const x = {};
    if (!u) return { unidad: "Elige la moto que se mueve." };
    if (u.disponibilidad === "Vendida") x.general = "Una moto vendida ya no se mueve.";
    else if (!u.ubicacion) x.general = "Esta moto aún no llega a una sede: registra primero su recepción.";
    else if (transitoDe(u.id)) x.general = `Ya tiene un traslado en camino a ${transitoDe(u.id).destino}. Confírmalo o cancélalo primero.`;
    if (!d.destino) x.destino = "Elige el destino.";
    else if (d.destino === u.ubicacion) x.destino = "El destino debe ser distinto de la ubicación actual.";
    else if (!activa(d.destino)) x.destino = "Ese destino está desactivado.";
    if (u.ubicacion && !activa(u.ubicacion)) x.general = `${u.ubicacion} está desactivada. Actívala para registrar la salida.`;
    if (limpiarTexto(d.motivo).length > MAX_TEXTO) x.motivo = `Máximo ${MAX_TEXTO} caracteres.`;
    return x;
  }
  const saleDeLaVenta = (u, destino) => lugar(destino)?.tipo === "Proveedor de techo" && u.disponibilidad === "Disponible";
  function trasladar(u, d) {
    const ahora = ahoraISO();
    const motivo = limpiarTexto(d.motivo);
    const retirar = saleDeLaVenta(u, d.destino);
    const mov = { id: siguienteId(movimientos), unidad: u.id, tipo: "Traslado", origen: u.ubicacion, destino: d.destino, estado: d.llego ? "Finalizado" : "En tránsito", salida: ahora, llegada: d.llego ? ahora : null, usuario: user.nombre, motivo, obs: "", ...(retirar ? { previo: { disponibilidad: "Disponible" } } : {}) };
    agregar("movimientos", mov);
    actualizar("unidades", u.id, (x) => ({
      ...(d.llego ? { ubicacion: d.destino } : {}),
      ...(retirar ? { disponibilidad: "No disponible" } : {}),
      historial: anotar(x, `${d.llego ? "Traslado" : "Sale"} ${u.ubicacion} → ${d.destino}${d.llego ? "" : " (en tránsito)"}${motivo ? `: ${motivo}` : ""}${retirar ? ". Sale de la venta mientras esté en el proveedor" : ""}`),
    }), `${u.id}: ${u.ubicacion} → ${d.destino}`);
    return d.llego ? `${u.id} ya figura en ${d.destino}.` : `${u.id} salió hacia ${d.destino}. Confirma su llegada cuando llegue.`;
  }

  // Confirmar la llegada de un traslado
  function validarLlegada(m, d) {
    const x = {};
    if (!d.llegada) x.llegada = "Indica la hora de llegada.";
    else if (new Date(d.llegada).getTime() > Date.now() + 5 * 60000) x.llegada = "La llegada no puede ser en el futuro.";
    // Se compara al minuto: el campo de hora no lleva segundos
    else if (new Date(d.llegada).getTime() < Math.floor(new Date(m.salida).getTime() / 60000) * 60000) x.llegada = "La llegada no puede ser antes de la salida.";
    if (!activa(m.destino)) x.general = `${m.destino} está desactivada. Actívala o cancela el traslado.`;
    if (limpiarTexto(d.obs).length > 300) x.obs = "Máximo 300 caracteres.";
    return x;
  }
  function confirmarLlegada(m, d) {
    const u = unidades.find((x) => x.id === m.unidad);
    const llegada = new Date(d.llegada).toISOString();
    const obs = limpiarTexto(d.obs);
    actualizar("movimientos", m.id, { estado: "Finalizado", llegada, obs, confirmadoPor: user.nombre });
    const vieneDeProveedor = lugar(m.origen)?.tipo === "Proveedor de techo";
    const instalar = vieneDeProveedor && d.techoInstalado && u?.estadoTecho === "Pendiente de instalación";
    const avanza = instalar && u?.preparacion === "Pendiente de techo";
    if (avanza) agregar("historialPreparacion", { id: siguienteId(historialPreparacion), unidad: m.unidad, paso: "En preparación", anterior: "Pendiente de techo", fecha: llegada, usuario: user.nombre, obs: `Techo instalado por ${m.origen}` });
    actualizar("unidades", m.unidad, (x) => ({
      ubicacion: m.destino,
      ...(instalar ? { estadoTecho: "Instalado", fechaInstalacion: fechaDe(llegada) } : {}),
      ...(avanza ? { preparacion: "En preparación" } : {}),
      historial: anotar(x, `Llegó a ${m.destino} desde ${m.origen}${obs ? ` (${obs})` : ""}${instalar ? `. Techo ${x.techo} instalado` : ""}`, fechaDe(llegada)),
    }), `${m.unidad} llegó a ${m.destino}`);
    return { texto: `${m.unidad} ya está en ${m.destino}.`, instalado: instalar };
  }

  return {
    movimientos, enTransito, transitoDe, porRecibir, deUnidad, destinosPara, lugar, saleDeLaVenta, origenRecepcion: ORIGEN_RECEPCION,
    validarRecepcion, recibir, validarTraslado, trasladar, validarLlegada, confirmarLlegada,
  };
}
