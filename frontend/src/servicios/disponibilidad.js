// HU-001 · Consultar disponibilidad compartida
// Stock de todas las ubicaciones: sedes, fibreras (proveedores de techo) y el almacén de Crossland.
// Cada moto muestra su estado, color y techo. No expone datos de clientes ni funciones de boletas.
// Hoy lee las motos guardadas en este navegador (se actualiza al instante entre pestañas).
// Al conectar con la base: GET /api/disponibilidad?ubicacion=&modelo=&color=&estado= para Gerente,
// Administradora y Vendedor (sin columnas de cliente), y se vuelve a consultar cada 30 s y al volver a la pestaña.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../store/appStore.jsx";
import { ORIGEN_RECEPCION } from "../data/mockData";
import { useMovimientos } from "./movimientos";
import { formatoDia } from "../lib/validar";

export const ESTADOS_STOCK = ["Disponible", "Separada", "No disponible"];
export const GRUPOS_LUGAR = [
  { tipo: "Sede propia", titulo: "Sedes" },
  { tipo: "Proveedor de techo", titulo: "Fibreras (proveedores de techo)" },
  { tipo: "Almacén externo", titulo: "Almacenes" },
];

// Por qué una moto está en ese estado (sin datos del cliente)
function detalleDe(u, { porRecibir, transito, tipoLugar, estado, vence }) {
  if (porRecibir) return "Por recibir: sigue en el almacén de Crossland";
  if (transito) return `En camino a ${transito.destino}`;
  if (tipoLugar === "Proveedor de techo") return "En la fibrera: instalando el techo";
  if (estado === "Separada") return vence ? `Separada con adelanto hasta el ${vence}` : "Separada con adelanto";
  if (estado === "Disponible") return "Lista para vender";
  if (u.preparacion === "Lista para entrega") return "Fuera de la venta";
  return `En preparación: ${u.preparacion || "Sin preparar"}`;
}

export function useDisponibilidad() {
  const { unidades = [], modelosConFotos = [], publicos = [], ubicaciones = [], separaciones = [] } = useApp();
  const { transitoDe } = useMovimientos();
  const [actualizado, setActualizado] = useState(() => Date.now());
  useEffect(() => { setActualizado(Date.now()); }, [unidades]);
  const refrescar = useCallback(() => setActualizado(Date.now()), []);

  // Stock: toda moto registrada que aún no se vendió
  const stock = useMemo(() => unidades.filter((u) => u.disponibilidad !== "Vendida").map((u) => {
    const porRecibir = !u.ubicacion;
    const lugar = porRecibir ? ORIGEN_RECEPCION : u.ubicacion;
    const tipoLugar = ubicaciones.find((a) => a.nombre === lugar)?.tipo || (porRecibir ? "Almacén externo" : "Sede propia");
    const transito = transitoDe(u.id);
    const estado = u.disponibilidad === "Disponible" ? "Disponible" : u.disponibilidad === "Separada" ? "Separada" : "No disponible";
    const sep = estado === "Separada" ? separaciones.find((s) => s.unidad === u.id && s.estado === "Activa") : null;
    const vence = sep?.vence ? formatoDia(sep.vence, { day: "numeric", month: "short" }).replace(".", "") : "";
    // Solo datos de la moto: nada del cliente
    const fila = { id: u.id, modelo: u.modelo, nombreModelo: u.nombreModelo, color: u.color, motor: u.motor, chasis: u.chasis, techo: u.techo || "Sin techo", proveedorTecho: u.proveedorTecho, estadoTecho: u.estadoTecho, preparacion: u.preparacion, disponibilidad: u.disponibilidad, ubicacion: u.ubicacion, historial: u.historial };
    return { ...fila, transito, porRecibir, lugar, tipoLugar, estado, vence, detalle: detalleDe(u, { porRecibir, transito, tipoLugar, estado, vence }) };
  }), [unidades, ubicaciones, separaciones, transitoDe]);

  // Ubicaciones que se pueden consultar: sedes, fibreras y almacenes activos, y las que tengan motos
  const lugares = useMemo(() => {
    const conMotos = new Set(stock.map((u) => u.lugar));
    const lista = ubicaciones.filter((a) => a.activo || conMotos.has(a.nombre));
    if (conMotos.has(ORIGEN_RECEPCION) && !lista.some((a) => a.nombre === ORIGEN_RECEPCION)) lista.push({ id: "crossland", nombre: ORIGEN_RECEPCION, tipo: "Almacén externo", activo: true });
    return lista;
  }, [ubicaciones, stock]);

  // Catálogo: modelos publicados y cualquier modelo que tenga motos
  const catalogo = useMemo(() => {
    const vistos = new Map();
    for (const m of [...modelosConFotos.filter((x) => x.estado === "Publicado"), ...publicos]) if (!vistos.has(m.id)) vistos.set(m.id, m);
    for (const u of unidades) if (!vistos.has(u.modelo)) { const m = modelosConFotos.find((x) => x.id === u.modelo); if (m) vistos.set(m.id, m); }
    return [...vistos.values()];
  }, [modelosConFotos, publicos, unidades]);

  return { stock, lugares, catalogo, actualizado, refrescar };
}
