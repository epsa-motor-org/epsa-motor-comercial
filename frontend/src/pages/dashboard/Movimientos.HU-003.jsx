// HU-003 · Registrar movimientos de ubicación
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { ESTADOS_MOVIMIENTO } from "../../data/mockData";
import { useMovimientos } from "../../servicios/movimientos";
import { diasEntre, fechaHora, fechaLocal, haceCuanto, mesLocal } from "../../lib/validar";
import { Card, PageHeader, Stat, Tabla, Vacio, btnMini } from "../../components/ui";
import { ColorPunto, EstadoConexion, Pestanas, Pill, TONO_MOVIMIENTO, fechaCorta } from "../../components/dashboard/Sprint2";
import { ModalLlegada, ModalRecibir, ModalTraslado, nombreModeloDe } from "../../components/dashboard/MovimientoModales";

const tonoEspera = (d) => (d > 7 ? "rojo" : d > 3 ? "ambar" : "gris");

// Ruta origen → destino
export function Ruta({ origen, destino, transito }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[13.5px]">
      <span className="font-semibold text-marino dark:text-white">{origen}</span>
      <svg viewBox="0 0 40 10" className={`h-2.5 w-9 shrink-0 ${transito ? "text-sky-500" : "text-slate-400"}`} aria-label="hacia"><path d="M0 5h36m-5-4 5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={transito ? "3 3" : "0"} strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="font-semibold text-marino dark:text-white">{destino}</span>
    </span>
  );
}

export default function Movimientos() {
  const { unidades, modelos, publicos, compras, ubicaciones } = useApp();
  const { puede } = useAuth();
  const mv = useMovimientos();
  const [params] = useSearchParams();
  const [vista, setVista] = useState(params.get("unidad") ? "historial" : mv.enTransito.length ? "transito" : "recibir");
  const [f, setF] = useState({ q: params.get("unidad") || "", tipo: "", estado: "", lugar: "", desde: "", hasta: "" });
  const [modal, setModal] = useState(null);
  const recibe = puede("unidades.gestionar");
  const traslada = puede("unidades.trasladar");
  const mes = mesLocal();
  const unidad = (id) => unidades.find((u) => u.id === id);
  const nombre = (u) => nombreModeloDe(u, modelos, publicos);

  const historial = useMemo(() => [...mv.movimientos].sort((a, b) => b.salida.localeCompare(a.salida)).filter((m) => {
    const u = unidad(m.unidad);
    const q = f.q.trim().toLowerCase();
    if (q && !`${m.unidad} ${u?.motor || ""} ${u?.chasis || ""} ${nombre(u)}`.toLowerCase().includes(q)) return false;
    const dia = fechaLocal(m.salida);
    return (!f.tipo || m.tipo === f.tipo) && (!f.estado || m.estado === f.estado) && (!f.lugar || m.origen === f.lugar || m.destino === f.lugar) && (!f.desde || dia >= f.desde) && (!f.hasta || dia <= f.hasta);
  }), [mv.movimientos, f, unidades]); // eslint-disable-line

  const delMes = (tipo) => mv.movimientos.filter((m) => m.tipo === tipo && m.estado !== "Cancelado" && fechaLocal(m.salida).startsWith(mes)).length;
  const compraDe = (u) => compras.find((c) => String(c.codcom) === String(u.codcom));
  const identificada = (u) => (u.historial || []).map((h) => h.fecha).sort()[0] || "";

  return (
    <div>
      <PageHeader titulo="Movimientos de motos" subtitulo="Recepciones desde Crosland y traslados entre sedes, almacenes y proveedores de techo. Cada movimiento queda en el historial de la moto.">
        <EstadoConexion hu="HU-003" />
        {traslada && <button id="btn-nuevo-traslado" className="btn btn-primary !py-2.5" onClick={() => setModal({ tipo: "traslado" })}>Registrar traslado</button>}
      </PageHeader>

      {/* Indicadores */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat etiqueta="En tránsito" valor={mv.enTransito.length} nota="Salieron y aún no llegan" />
        <Stat etiqueta="Por recibir" valor={mv.porRecibir.length} tono={mv.porRecibir.length ? "ambar" : "marino"} nota="Identificadas, aún en Crosland" />
        <Stat etiqueta="Recepciones del mes" valor={delMes("Recepción")} tono="verde" />
        <Stat etiqueta="Traslados del mes" valor={delMes("Traslado")} />
      </div>

      <div className="mb-4">
        <Pestanas etiqueta="Movimientos" valor={vista} onCambio={setVista} opciones={[
          { id: "transito", label: "En tránsito", n: mv.enTransito.length },
          { id: "recibir", label: "Por recibir", n: mv.porRecibir.length, alerta: true },
          { id: "historial", label: "Historial", n: mv.movimientos.length },
        ]} />
      </div>

      {/* En tránsito */}
      {vista === "transito" && (mv.enTransito.length === 0 ? <Vacio titulo="Ninguna moto en tránsito" texto="Cuando registres un traslado que «sale ahora», aparecerá aquí hasta que confirmes su llegada." /> : (
        <div className="space-y-3" data-lista="transito">
          {mv.enTransito.map((m) => {
            const u = unidad(m.unidad);
            const horas = (Date.now() - new Date(m.salida).getTime()) / 3600000;
            return (
              <Card key={m.id} className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold text-marino dark:text-white"><Link className="hover:underline" to={`/admin/inventario/${m.unidad}`}>{m.unidad}</Link> <span className="font-semibold text-slate-500 dark:text-white/60">{nombre(u)}</span> <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-slate-400"><ColorPunto color={u?.color} className="h-2.5 w-2.5" />{u?.color}</span></p>
                  <div className="mt-1.5"><Ruta origen={m.origen} destino={m.destino} transito /></div>
                  <p className="mt-1.5 text-[12.5px] text-slate-500">Salió el {fechaHora(m.salida)} ({haceCuanto(m.salida)}). Registró {m.usuario}.{m.motivo ? ` Motivo: ${m.motivo}.` : ""}</p>
                  {horas > 24 && <p className="mt-1 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">Lleva más de un día en tránsito. Confirma su llegada cuando la reciban.</p>}
                </div>
                {traslada && <button className="btn btn-primary !px-4 !py-2 text-[13.5px]" onClick={() => setModal({ tipo: "llegada", m })}>Confirmar llegada</button>}
              </Card>
            );
          })}
        </div>
      ))}

      {/* Por recibir */}
      {vista === "recibir" && (mv.porRecibir.length === 0 ? <Vacio titulo="No hay motos por recibir" texto="Todas las motos identificadas ya llegaron a una sede o almacén." /> : (
        <Tabla columnas={["Moto", "Modelo", "Compra", "Identificada", "Esperando", "Acción"]}>
          {mv.porRecibir.map((u) => {
            const c = compraDe(u); const desde = identificada(u); const dias = desde ? diasEntre(desde) : 0;
            return (
              <tr key={u.id} data-por-recibir={u.id}>
                <td className="px-4 py-3"><p className="font-semibold text-marino dark:text-white">{u.id}</p><p className="text-[12px] text-slate-400">motor {u.motor} / chasis {u.chasis}</p></td>
                <td className="px-4 py-3">{nombre(u)}<span className="flex items-center gap-1.5 text-[12px] text-slate-400"><ColorPunto color={u.color} className="h-2.5 w-2.5" />{u.color}</span></td>
                <td className="px-4 py-3">{u.codcom ? <Link className="font-semibold text-marino-700 hover:underline dark:text-white" to={`/admin/compras/${u.codcom}`}>#{u.codcom}</Link> : "—"}{c && <span className="block text-[12px] text-slate-400">{c.estcom}</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fechaCorta(desde)}</td>
                <td className="px-4 py-3"><Pill tono={tonoEspera(dias)}>{dias === 0 ? "Hoy" : dias === 1 ? "1 día" : `${dias} días`}</Pill></td>
                <td className="px-4 py-3">{recibe ? <button className={btnMini} onClick={() => setModal({ tipo: "recibir", u })}>Recibir</button> : <span className="text-[12.5px] text-slate-400">Solo administración</span>}</td>
              </tr>
            );
          })}
        </Tabla>
      ))}

      {/* Historial */}
      {vista === "historial" && <>
        <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2"><label className="field-label">Moto</label><input className="field-input" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Código, motor o modelo" /></div>
          <div><label className="field-label">Tipo</label><select className="field-input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos</option><option>Recepción</option><option>Traslado</option></select></div>
          <div><label className="field-label">Estado</label><select className="field-input" value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos</option>{ESTADOS_MOVIMIENTO.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><label className="field-label">Ubicación</label><select className="field-input" value={f.lugar} onChange={(e) => setF({ ...f, lugar: e.target.value })}><option value="">Todas</option>{ubicaciones.map((x) => <option key={x.id}>{x.nombre}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2"><div><label className="field-label">Desde</label><input type="date" className="field-input !px-2" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></div><div><label className="field-label">Hasta</label><input type="date" className="field-input !px-2" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></div></div>
        </Card>
        <p className="mb-2 text-[13px] text-slate-500">{historial.length} movimiento{historial.length === 1 ? "" : "s"}{f.q || f.tipo || f.estado || f.lugar || f.desde || f.hasta ? <> · <button className="font-semibold text-acento hover:underline" onClick={() => setF({ q: "", tipo: "", estado: "", lugar: "", desde: "", hasta: "" })}>Limpiar filtros</button></> : null}</p>
        {historial.length === 0 ? <Vacio titulo="Sin movimientos con esos filtros" /> : (
          <Tabla columnas={["Fecha", "Moto", "Tipo", "Ruta", "Estado", "Registró", "Detalle"]}>
            {historial.map((m) => {
              const u = unidad(m.unidad);
              return (
                <tr key={m.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fechaHora(m.salida)}{m.llegada && m.tipo === "Traslado" && <span className="block text-[12px] text-slate-400">Llegó {fechaHora(m.llegada)}</span>}</td>
                  <td className="px-4 py-3"><Link className="font-semibold text-marino hover:underline dark:text-white" to={`/admin/inventario/${m.unidad}`}>{m.unidad}</Link><span className="block text-[12px] text-slate-400">{nombre(u)}</span></td>
                  <td className="px-4 py-3">{m.tipo}</td>
                  <td className="px-4 py-3"><Ruta origen={m.origen} destino={m.destino} transito={m.estado === "En tránsito"} /></td>
                  <td className="px-4 py-3"><Pill tono={TONO_MOVIMIENTO[m.estado]}>{m.estado}</Pill></td>
                  <td className="px-4 py-3 text-slate-500">{m.usuario}</td>
                  <td className="max-w-[260px] px-4 py-3 text-[12.5px] text-slate-500">{m.estado === "Cancelado" ? <span>Cancelado por {m.cancelacion?.usuario}: {m.cancelacion?.motivo}</span> : [m.motivo, m.obs].filter(Boolean).join(". ") || "—"}</td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </>}

      <ModalTraslado abierto={modal?.tipo === "traslado"} onClose={() => setModal(null)} onHecho={(llego) => setVista(llego ? "historial" : "transito")} />
      <ModalRecibir unidad={modal?.tipo === "recibir" ? modal.u : null} onClose={() => setModal(null)} />
      <ModalLlegada movimiento={modal?.tipo === "llegada" ? modal.m : null} onClose={() => setModal(null)} />
    </div>
  );
}
