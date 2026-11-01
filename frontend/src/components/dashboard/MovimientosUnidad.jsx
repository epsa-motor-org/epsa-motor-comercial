// HU-003 · Ubicación y movimientos de una moto (ficha)
// Lee la ubicación confirmada, el traslado en tránsito y el historial desde la API de movimientos.
// Gerencia y administración registran la salida y confirman la llegada; el vendedor solo consulta.
import { useState } from "react";
import { momentoMov, movimientosUnidadApi, useConsultaCentral } from "../../servicios/central";
import { TIPO_LUGAR } from "../../servicios/inventarioCentral";
import { Aviso, Card } from "../ui";
import { Pill } from "./Sprint2";
import { ModalLlegadaCentral, ModalTrasladoCentral, ModalUbicacionInicial } from "./ModalesCentral";
import { leerMotivo } from "../../lib/motivos";

// Motivo del traslado y su detalle (los traslados anteriores al motivo muestran solo su observación)
export function MotivoMov({ observacion, className = "" }) {
  const { motivo, detalle } = leerMotivo(observacion);
  if (!motivo && !detalle) return null;
  return (
    <p className={`text-[12.5px] text-slate-500 ${className}`} data-motivo={motivo || ""}>
      {motivo && <span className="mr-1.5 font-semibold text-marino dark:text-white">Motivo: {motivo}.</span>}
      {detalle && <span>{motivo ? detalle : `«${detalle}»`}</span>}
    </p>
  );
}

export const ESTADO_MOV = { "En transito": "En tránsito", Finalizado: "Recibida", Pendiente: "Programado", Cancelado: "Cancelado" };
export const TONO_MOV = { "En transito": "celeste", Finalizado: "verde", Pendiente: "ambar", Cancelado: "gris" };

// «21 oct 2026, 10:45» en hora de Lima, a partir de la fecha y la hora (UTC) que guarda el servidor
const ZONA = "America/Lima";
export const cuandoMov = (fecha, hora) => {
  const iso = momentoMov(fecha, hora);
  if (!iso) return "";
  const d = new Date(iso);
  const dia = d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: ZONA }).replace(".", "");
  return `${dia}, ${d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ZONA })}`;
};

// Flecha de origen a destino (punteada si va en camino)
export function RutaMov({ m }) {
  const transito = m.estado === "En transito";
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[13.5px]">
      <span className="font-semibold text-marino dark:text-white">{m.origen?.nomubi || "Sin origen"}</span>
      <svg viewBox="0 0 40 10" className={`h-2.5 w-9 shrink-0 ${transito ? "text-sky-500" : "text-slate-400"}`} aria-label="hacia"><path d="M0 5h36m-5-4 5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={transito ? "3 3" : "0"} strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="font-semibold text-marino dark:text-white">{m.destino?.nomubi}</span>
    </span>
  );
}

export default function MovimientosUnidad({ unidad, gestiona, ubicaciones = [], onCambio }) {
  const consulta = useConsultaCentral(() => movimientosUnidadApi(unidad.coduni), [unidad.coduni], { clave: `movimientos:${unidad.coduni}` });
  const [modal, setModal] = useState(null);
  const [todos, setTodos] = useState(false);
  const d = consulta.data;
  const conf = d?.ubicacionConfirmada || null;
  const activo = d?.movimientoActivo || null;
  const lugar = ubicaciones.find((l) => String(l.codubi) === String(conf?.codubi));
  const historial = d?.movimientos || [];
  const visibles = todos ? historial : historial.slice(0, 5);
  const recargar = () => { consulta.refrescar(true); onCambio?.(); };

  return (
    <Card data-card-ubicacion>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-marino dark:text-white">Ubicación y movimientos</h2>
        {d && <button className="text-[12.5px] font-semibold text-marino-700 hover:underline dark:text-white/80" onClick={() => consulta.refrescar()} disabled={consulta.cargando}>{consulta.cargando ? "Actualizando…" : "Actualizar"}</button>}
      </div>

      {!d && consulta.error?.detalle?.sinRuta && (
        <div className="mt-3" data-sin-api={consulta.error.detalle.endpoint}><Aviso tipo="aviso">Los movimientos de esta moto todavía no están disponibles. Inténtalo más adelante.</Aviso></div>
      )}
      {!d && consulta.error && !consulta.error.detalle?.sinRuta && (
        <div className="mt-3"><Aviso tipo="error">No se pudo cargar su ubicación. <button className="font-semibold underline" onClick={() => consulta.refrescar()}>Reintentar</button></Aviso></div>
      )}
      {!d && !consulta.error && <p className="mt-3 text-[13px] text-slate-400">Cargando su ubicación…</p>}
      {d && consulta.fallo && <p className="mt-2 text-[12px] font-medium text-amber-700 dark:text-amber-300" role="status">No se pudo actualizar; lo que ves puede estar desactualizado.</p>}

      {d && (activo ? (
        <div className={`mt-3 rounded-xl p-3.5 ${activo.estado === "En transito" ? "bg-sky-50 dark:bg-sky-500/10" : "bg-amber-50 dark:bg-amber-500/10"}`} data-movimiento-activo={activo.estado}>
          <p className="text-[12px] font-semibold text-sky-800/80 dark:text-sky-200/80">{activo.estado === "En transito" ? "En tránsito" : "Traslado programado"}</p>
          <div className="mt-1"><RutaMov m={activo} /></div>
          <p className="mt-1.5 text-[12.5px] text-slate-600 dark:text-white/70">Salió el {cuandoMov(activo.fechaSalida, activo.horaSalida)}{activo.autorSalida?.nombre ? `, lo registró ${activo.autorSalida.nombre}` : ""}. Sigue figurando en {activo.origen?.nomubi} hasta que se confirme la llegada.</p>
          <MotivoMov observacion={activo.observacion} className="mt-1" />
          {gestiona && activo.estado === "En transito" && <button className="btn btn-primary mt-3 !px-3.5 !py-2 text-[13.5px]" onClick={() => setModal({ tipo: "llegada", m: activo })}>Confirmar llegada</button>}
        </div>
      ) : conf ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[1.2rem] font-bold text-marino dark:text-white" data-ubicacion-confirmada={conf.codubi}>{conf.nomubi}</p>
            <p className="text-[12.5px] text-slate-500">{lugar ? `${TIPO_LUGAR[lugar.tipubi] || lugar.tipubi}. ` : ""}Ubicación confirmada.</p>
          </div>
          {gestiona && <button className="btn btn-secondary !px-3.5 !py-2 text-[13.5px]" onClick={() => setModal({ tipo: "traslado" })}>Registrar traslado</button>}
          {lugar?.tipubi === "Proveedor" && <p className="w-full text-[12.5px] text-slate-500">Si el taller avisa por WhatsApp que está lista, la moto sigue aquí hasta que registres su traslado.</p>}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[1.2rem] font-bold text-amber-700 dark:text-amber-300">Sin ubicación confirmada</p>
            <p className="text-[12.5px] text-slate-500">Para trasladarla, primero debe registrarse dónde está.</p>
          </div>
          {gestiona && <button className="btn btn-primary !px-3.5 !py-2 text-[13.5px]" onClick={() => setModal({ tipo: "inicial" })}>Registrar ubicación inicial</button>}
        </div>
      ))}
      {!gestiona && d && <p className="mt-3 text-[12.5px] text-slate-400">Solo gerencia y administración registran movimientos.</p>}

      {d && (
        <div className="mt-5">
          <h3 className="text-[13.5px] font-semibold text-marino dark:text-white">Historial de movimientos</h3>
          {historial.length === 0 ? <p className="mt-1 text-[13px] text-slate-400">Sin movimientos registrados.</p> : (
            <ol className="mt-2 space-y-3 border-l-2 border-slate-200 pl-4 dark:border-white/15" data-historial-movimientos>
              {visibles.map((m) => (
                <li key={m.codmub} className="relative text-[13px]" data-movimiento={m.codmub} data-estado={m.estado}>
                  <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${m.estado === "En transito" ? "bg-sky-500" : "bg-marino dark:bg-white"}`} />
                  <p className="flex flex-wrap items-center gap-2"><RutaMov m={m} /><Pill tono={TONO_MOV[m.estado] || "gris"}>{ESTADO_MOV[m.estado] || m.estado}</Pill></p>
                  <p className="text-[12px] text-slate-500">Salida: {cuandoMov(m.fechaSalida, m.horaSalida)}{m.autorSalida?.nombre ? `, ${m.autorSalida.nombre}` : ""}</p>
                  {m.fechaRecepcion && <p className="text-[12px] text-slate-500">Llegada: {cuandoMov(m.fechaRecepcion, m.horaRecepcion)}{m.autorRecepcion?.nombre ? `, recibió ${m.autorRecepcion.nombre}` : ""}</p>}
                  <MotivoMov observacion={m.observacion} />
                </li>
              ))}
            </ol>
          )}
          {historial.length > 5 && <button className="mt-2 text-[12.5px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => setTodos(!todos)}>{todos ? "Ver menos" : `Ver los ${historial.length}`}</button>}
        </div>
      )}

      <ModalTrasladoCentral abierto={modal?.tipo === "traslado"} unidad={unidad} ubicaciones={ubicaciones} onClose={() => setModal(null)} onHecho={recargar} onConflicto={recargar} />
      <ModalLlegadaCentral datos={modal?.tipo === "llegada" ? { unidad, movimiento: modal.m } : null} onClose={() => setModal(null)} onHecho={recargar} onConflicto={recargar} />
      <ModalUbicacionInicial unidad={modal?.tipo === "inicial" ? unidad : null} ubicaciones={ubicaciones} onClose={() => setModal(null)} onHecho={recargar} onConflicto={recargar} />
    </Card>
  );
}
