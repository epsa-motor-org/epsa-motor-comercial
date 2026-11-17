// Sprint 2 · Piezas visuales compartidas (estados, pestañas, recorrido y pasos)
import { COLOR_HEX } from "../../data/mockData";
import { CONECTADO } from "../../lib/sprint2";
import { IconCheck } from "../Icons";
import { formatoDia } from "../../lib/validar";

// ¿Esta pantalla trabaja con los datos compartidos del equipo? (el código de la HU queda solo en data-hu)
// Si la sección todavía no está disponible en el servidor, no se muestra (ya lo explica el aviso de la página).
// Con la base conectada no se muestra nada: solo la vista de ejemplo lleva su etiqueta.
export function EstadoConexion({ hu, consulta }) {
  const ok = Boolean(CONECTADO[hu]);
  if (ok || (consulta?.error?.detalle?.sinRuta && !consulta.data)) return null;
  return (
    <span data-conexion={ok ? "base" : "local"} data-hu={hu} title={ok ? "Todo el equipo ve la misma información, que se actualiza sola." : "Datos de ejemplo guardados solo en este equipo."}
      className={`inline-flex items-center gap-2 self-center rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"}`}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
      {ok ? "En línea" : "Vista de ejemplo"}
    </span>
  );
}

// Etiqueta de estado
const TONOS = {
  verde: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  ambar: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  celeste: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  gris: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70",
  oscuro: "bg-slate-200 text-slate-700 dark:bg-white/15 dark:text-white/80",
  rojo: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  naranja: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200",
  azul: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
  marino: "bg-marino-50 text-marino dark:bg-white/10 dark:text-white",
};
export function Pill({ tono = "gris", children, className = "" }) {
  return <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONOS[tono] || TONOS.gris} ${className}`}>{children}</span>;
}
export const TONO_DISPONIBILIDAD = { "No disponible": "gris", Disponible: "verde", Separada: "ambar", Vendida: "oscuro" };
export const TONO_MOVIMIENTO = { "En tránsito": "celeste", Finalizado: "verde", Cancelado: "gris" };
export const TONO_SEPARACION = { Activa: "ambar", "Por vencer": "ambar", "Vencida por liberar": "rojo", Vencida: "gris", Cancelada: "gris", "Convertida en venta": "verde" };

// Punto de color de la moto
export function ColorPunto({ color, className = "h-3 w-3" }) {
  return <span className={`inline-block shrink-0 rounded-full ring-1 ring-black/15 ${className}`} style={{ background: COLOR_HEX[color] || "#94a3b8" }} aria-hidden="true" />;
}

// Pestañas
export function Pestanas({ opciones, valor, onCambio, etiqueta = "Vista" }) {
  return (
    <div role="tablist" aria-label={etiqueta} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
      {opciones.map((o) => {
        const sel = valor === o.id;
        return (
          <button key={o.id} type="button" role="tab" aria-selected={sel} onClick={() => onCambio(o.id)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-semibold transition ${sel ? "bg-white text-marino shadow-sm dark:bg-white/15 dark:text-white" : "text-slate-500 hover:text-marino dark:text-white/60 dark:hover:text-white"}`}>
            {o.label}
            {o.n !== undefined && <span className={`cifra min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11.5px] ${sel ? "bg-marino-700 text-white dark:bg-white dark:text-marino" : o.alerta && o.n ? "bg-amber-200 text-amber-900" : "bg-white text-slate-500 dark:bg-white/10 dark:text-white/70"}`}>{o.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Fecha corta: "12 oct"
export function fechaCorta(f) {
  if (!f) return "";
  return formatoDia(f, { day: "numeric", month: "short" }).replace(".", "");
}

// Recorrido de la moto: de la compra a la venta
export function Recorrido({ estaciones }) {
  const marcada = estaciones.findIndex((e) => e.actual);
  const actual = marcada >= 0 ? marcada : estaciones.findIndex((e) => !e.hecho && !e.omitido);
  return (
    <ol className="grid sm:grid-cols-6" aria-label="Recorrido de la moto">
      {estaciones.map((e, i) => {
        // «aqui»: estado ya alcanzado donde la moto está ahora; «actual»: tarea pendiente
        const estado = i === actual && e.hecho ? "aqui" : e.hecho ? "hecho" : e.omitido ? "omitido" : i === actual ? "actual" : "pendiente";
        const ultimo = i === estaciones.length - 1;
        return (
          <li key={e.nombre} className="relative flex gap-3 pb-5 last:pb-0 sm:block sm:pb-0 sm:pr-3" aria-current={estado === "actual" ? "step" : undefined} data-estacion={e.nombre} data-estado={estado}>
            {!ultimo && <span aria-hidden="true" className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 sm:left-8 sm:top-[13px] sm:h-0.5 sm:w-[calc(100%-2rem)] ${e.hecho && estaciones[i + 1]?.hecho ? "bg-marino-700 dark:bg-white/60" : "bg-slate-200 dark:bg-white/10"}`} />}
            <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
              estado === "aqui" ? "bg-emerald-500 text-white ring-4 ring-emerald-500/20"
              : estado === "hecho" ? "bg-marino-700 text-white dark:bg-white dark:text-marino"
                : estado === "actual" ? "bg-white text-acento ring-2 ring-acento dark:bg-[#121a2b]"
                  : estado === "omitido" ? "bg-slate-100 text-slate-300 dark:bg-white/5 dark:text-white/30" : "bg-white text-slate-400 ring-1 ring-slate-300 dark:bg-[#121a2b] dark:ring-white/20"}`}>
              {estado === "hecho" || estado === "aqui" ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 sm:mt-2.5">
              <p className={`text-[13.5px] font-semibold leading-tight ${estado === "actual" ? "text-acento" : estado === "aqui" ? "text-emerald-700 dark:text-emerald-300" : estado === "hecho" ? "text-marino dark:text-white" : "text-slate-400"}`}>{e.nombre}{estado === "aqui" && <span className="ml-1.5 text-[11.5px] font-semibold text-emerald-600">ahora</span>}</p>
              {e.nota && <p className={`mt-0.5 text-[12px] leading-snug ${estado === "pendiente" || estado === "omitido" ? "text-slate-400" : "text-slate-500 dark:text-white/60"}`}>{e.nota}</p>}
              {e.fecha && <p className="cifra mt-0.5 text-[11.5px] text-slate-400">{fechaCorta(e.fecha)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Pasos de la preparación (HU-033)
export function PasosPreparacion({ pasos, actual, compacto = false }) {
  const i = pasos.indexOf(actual);
  return (
    <ol className={`grid grid-cols-4 gap-1.5 ${compacto ? "" : "sm:gap-2"}`} aria-label="Pasos de la preparación">
      {pasos.map((p, k) => (
        <li key={p} aria-current={k === i ? "step" : undefined} className="min-w-0">
          <span className={`block h-1.5 rounded-full ${k < i ? "bg-marino-700 dark:bg-white/70" : k === i ? (k === pasos.length - 1 ? "bg-emerald-500" : "bg-acento") : "bg-slate-200 dark:bg-white/10"}`} />
          {!compacto && <span className={`mt-1.5 block truncate text-[11.5px] font-semibold ${k === i ? "text-marino dark:text-white" : "text-slate-400"}`} title={p}>{k + 1}. {p}</span>}
        </li>
      ))}
    </ol>
  );
}
