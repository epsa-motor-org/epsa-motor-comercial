// HU-006 · Ventas a clientes con la base central (GET /api/ventas de Michelle, PR #47)
// Lista las mismas ventas que muestra la ficha de cada moto (mismos identificadores e importes): comprador, moto,
// desglose (precio base + techo = total), lo recibido y el saldo, el techo y el responsable. Se busca por comprador,
// celular, motor, chasis o comprobante, por páginas. Gerencia, administración y vendedores ven todas las ventas.
// «Registrar venta» abre el registro de la HU-006: se elige la moto por su motor o chasis (solo motos libres o
// separadas) y se completa la venta. Ya no se registra marcando un interesado como convertido (CP-006-18 y CP-006-19).
// HU-021: las ventas canceladas siguen en la lista (no se borran), marcadas «Cancelada», con lo recibido que se conserva y
// el detalle de su cancelación. Ya no tienen saldo por cobrar ni cuentan como venta vigente de la moto.
import { useEffect, useMemo, useState } from "react";
import { Link } from "./LinkPanel";
import { useAuth } from "../../context/AuthContext";
import { mensajeError } from "../../lib/errores";
import { inventarioApi, useConsultaCentral } from "../../servicios/central";
import { ubicacionDe } from "../../servicios/inventarioCentral";
import * as S from "../../servicios/separacionCentral";
import * as V from "../../servicios/ventaCentral";
import { Aviso, Campo, Card, Modal, PageHeader, Tabla, Vacio, btnMini } from "../ui";
import { AvisoConexion, BarraActualizacion, ColorUnidad, Paginador, PillComercial, sinApi } from "./Central";
import SeccionPendiente from "./SeccionPendiente";
import VenderMotoCentral from "./VenderCentral";
import { DetalleCancelacionModal } from "./CancelarCentral";

// Fecha corta de la venta (12 nov 2026): la fecha se guarda como el día indicado
const fechaCorta = (f) => { const d = new Date(`${V.soloFecha(f)}T12:00:00`); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }).replace(".", ""); };
const textoTecho = (t) => (!t?.decision ? "Sin dato" : t.decision === S.CON_TECHO ? t.nombre || "Con techo" : t.decision === S.SIN_TECHO ? "Sin techo" : "Por definir");

export default function VentasCentral() {
  const { puede } = useAuth();
  const registra = puede("separaciones.registrar");
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [eligiendo, setEligiendo] = useState(false);
  const [vender, setVender] = useState(null);
  const [detalle, setDetalle] = useState(null);
  // La búsqueda se pide al servidor un momento después de dejar de escribir
  useEffect(() => {
    const t = setTimeout(() => { const x = S.limpio(texto).slice(0, V.MAX_BUSQUEDA_VENTAS); setQ((p) => { if (p !== x) setOffset(0); return x; }); }, 350);
    return () => clearTimeout(t);
  }, [texto]);
  const consulta = useConsultaCentral(() => V.ventasApi({ q, limite: V.LIMITE_VENTAS, offset }), [q, offset], { intervalo: 15000, clave: `ventas-hu006:${q}:${offset}` });
  const d = consulta.data;
  const lista = d?.items || [];

  if (sinApi(consulta)) return <SeccionPendiente titulo="Ventas a clientes" />;

  return (
    <div data-ventas-central>
      <PageHeader titulo="Ventas a clientes" subtitulo="Ventas registradas con su comprador, moto, total con techo, lo recibido y el saldo. Son las mismas que se ven en la ficha de cada moto; las canceladas se conservan marcadas.">
        {registra && <button className="btn btn-primary !py-2.5" onClick={() => setEligiendo(true)} data-registrar-venta>+ Registrar venta</button>}
      </PageHeader>
      <AvisoConexion consulta={consulta} que="las ventas" />

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="ven-buscar">Buscar</label>
            <input id="ven-buscar" className="field-input" value={texto} maxLength={V.MAX_BUSQUEDA_VENTAS} onChange={(e) => setTexto(e.target.value)} placeholder="Comprador, celular, motor, chasis o comprobante" data-buscar-ventas />
          </div>
          <div className="flex items-end gap-3 lg:col-span-2"><BarraActualizacion consulta={consulta} /></div>
        </div>
        {d && <p className="mt-3 text-[13px] text-slate-500" data-total-ventas={d.total}>{q ? `${d.total} venta${d.total === 1 ? "" : "s"} con «${q}»` : `${d.total} venta${d.total === 1 ? "" : "s"} registrada${d.total === 1 ? "" : "s"}`}</p>}
      </Card>

      {consulta.error && !d && <Aviso tipo="error">No se pudieron cargar las ventas: {mensajeError(consulta.error)}</Aviso>}
      {!d && !consulta.error && <p className="text-[13.5px] text-slate-500">Cargando las ventas…</p>}
      {d && (lista.length === 0 ? (
        <Vacio titulo={q ? "No hay ventas con esa búsqueda" : "Todavía no hay ventas registradas"} texto={q ? "Busca por nombre o celular del comprador, motor, chasis o número de comprobante." : "Registra una venta con «Registrar venta» o desde la ficha de una moto libre o separada."} />
      ) : (
        <>
          <Tabla columnas={["Fecha", "Comprador", "Moto", "Total con techo", "Recibido y saldo", "Responsable", ""]}>
            {lista.map((v) => { const cancelada = v.estado === "Cancelada"; return (
              <tr key={v.codven} className={`align-top ${cancelada ? "bg-slate-50/70 text-slate-500 dark:bg-white/[0.03]" : ""}`} data-venta-fila={v.codven} data-coduni={v.unidad?.coduni} data-estado={v.estado}>
                <td className="px-4 py-3 text-slate-500"><span className="whitespace-nowrap">{fechaCorta(v.fecha)}</span><span className="block text-[12px]">{v.modalidad}</span><span className="block text-[12px] text-slate-400">{v.comprobanteExterno ? v.comprobanteExterno.referencia : "Sin comprobante"}</span></td>
                <td className="px-4 py-3"><p className="font-semibold text-marino dark:text-white">{v.comprador?.nombre || "Sin dato"}</p>{v.estado && v.estado !== "Registrada" && <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${cancelada ? "bg-red-50 text-acento dark:bg-red-500/10 dark:text-red-300" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"}`} data-estado-venta={v.estado}>{cancelada ? "Venta cancelada" : v.estado}</span>}{v.comprador?.celular && <p className="cifra text-[12.5px] text-slate-400">{v.comprador.celular}</p>}</td>
                <td className="px-4 py-3">{v.modelo?.nombre}<span className="block text-[12px] text-slate-400 [overflow-wrap:anywhere]">Motor {v.unidad?.motor}</span><span className="block text-[12px] text-slate-400 [overflow-wrap:anywhere]">Chasis {v.unidad?.chasis}</span></td>
                <td className="px-4 py-3" data-total={v.total} data-techo={v.techo?.decision}>
                  <span className={`cifra whitespace-nowrap font-semibold ${cancelada ? "text-slate-500 line-through decoration-slate-400" : "text-marino dark:text-white"}`}>{S.soles(v.total)}</span>
                  <span className="block whitespace-nowrap text-[12px] text-slate-400">Moto <span className="cifra">{S.soles(v.precioBaseAcordado)}</span></span>
                  <span className={`block text-[12px] ${v.techo?.decision === S.POR_DEFINIR && !cancelada ? "font-semibold text-amber-700 dark:text-amber-300" : "text-slate-400"}`}>{v.techo?.decision === S.CON_TECHO ? <>{textoTecho(v.techo)} <span className="cifra whitespace-nowrap">+ {S.soles(v.adicionalTechoAcordado)}</span></> : v.techo?.decision === S.SIN_TECHO ? "Sin techo + S/ 0.00" : "Techo por definir"}</span>
                </td>
                <td className="px-4 py-3" data-saldo={cancelada ? "" : v.saldo}>
                  <span className="cifra whitespace-nowrap">{S.soles(v.totalRecibido)}</span><span className="text-[12px] text-slate-400">{cancelada && Number(v.totalRecibido) > 0 ? " recibido, se conserva" : " recibido"}</span>
                  {cancelada
                    ? <span className="block text-[12px] font-semibold text-slate-500">Sin saldo por cobrar: cancelada</span>
                    : <span className={`block cifra whitespace-nowrap font-semibold ${v.saldo > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{v.saldo > 0 ? `Saldo ${S.soles(v.saldo)}` : "Sin saldo"}</span>}
                  {v.adelanto > 0 && <span className="block text-[12px] text-slate-400">Incluye adelanto <span className="cifra">{S.soles(v.adelanto)}</span></span>}
                </td>
                <td className="px-4 py-3">{v.responsable?.nombre || "Sin responsable"}<span className="block text-[12px] text-slate-400">{v.sedeAtencion?.nombre}</span></td>
                <td className="px-4 py-3"><div className="flex flex-col items-start gap-1.5">
                  <Link className={btnMini} to={`/admin/inventario/${v.unidad?.coduni}`} data-ficha-venta={v.unidad?.coduni}>Ficha</Link>
                  {cancelada && <button type="button" className={btnMini} onClick={() => setDetalle(v)} data-ver-cancelacion={v.codven}>Cancelación</button>}
                </div></td>
              </tr>
            ); })}
          </Tabla>
          <Paginador total={d.total} limite={V.LIMITE_VENTAS} offset={offset} onCambio={setOffset} />
        </>
      ))}

      {eligiendo && <ElegirMoto onClose={() => setEligiendo(false)} onElegir={(u) => { setEligiendo(false); setVender(u); }} />}
      {vender && <VenderMotoCentral unidad={vender} onClose={() => setVender(null)} onHecho={() => consulta.refrescar(true)} onConflicto={() => consulta.refrescar(true)} />}
      {detalle && <DetalleCancelacionModal cod={detalle.codven} titulo={`Venta cancelada · ${detalle.comprador?.nombre || ""}`} onClose={() => setDetalle(null)} />}
    </div>
  );
}

// Elegir la moto que se vende: libre o separada, identificada por motor y chasis
function ElegirMoto({ onClose, onElegir }) {
  const [unidades, setUnidades] = useState(null); const [error, setError] = useState(null);
  const [texto, setTexto] = useState(""); const [coduni, setCoduni] = useState("");
  const cargar = () => { setError(null); inventarioApi().then(({ unidades: u }) => setUnidades(u)).catch(setError); };
  useEffect(cargar, []);
  const vendibles = useMemo(() => (unidades || []).filter(V.sePuedeVender), [unidades]);
  const t = S.limpio(texto).toLowerCase();
  const lista = vendibles.filter((u) => !t || `${u.nummotuni} ${u.chauni} ${u.nommod} ${u.coluni}`.toLowerCase().includes(t)).slice(0, 50);
  const elegida = vendibles.find((u) => u.coduni === coduni) || null;
  return (
    <Modal abierto onClose={onClose} titulo="Registrar venta" ancho="max-w-xl" sinAvisoCambios confirmarGuardar={false}
      pie={<><button className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button><button className="btn btn-primary !py-2" disabled={!elegida} onClick={() => onElegir(elegida)} data-continuar-venta>Continuar</button></>}>
      <div className="space-y-4" data-elegir-moto-venta>
        <p className="text-[13.5px] text-slate-600 dark:text-slate-300">Elige la moto que se vende. Solo aparecen motos identificadas (motor y chasis) libres o separadas: una moto separada se vende a nombre del comprador de su separación.</p>
        <Campo etiqueta="Buscar la moto" ayuda="Motor, chasis, modelo o color">
          <input id="ven-buscar-moto" className="field-input" value={texto} maxLength={100} autoComplete="off" onChange={(e) => setTexto(e.target.value)} placeholder="Ej. EPSA-TEST o el número de chasis" />
        </Campo>
        {error && <Aviso tipo="error">No se pudo cargar el inventario: {mensajeError(error)} <button type="button" className="font-semibold underline" onClick={cargar}>Reintentar</button></Aviso>}
        {!unidades && !error && <p className="text-[13.5px] text-slate-500">Cargando las motos…</p>}
        {unidades && (lista.length === 0 ? (
          <p className="text-[13.5px] text-slate-500" data-sin-motos>{vendibles.length ? "Ninguna moto libre o separada coincide con la búsqueda." : "No hay motos libres o separadas para vender."}</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1" role="radiogroup" aria-label="Motos para vender">
            {lista.map((u) => (
              <li key={u.coduni}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-[13.5px] transition ${coduni === u.coduni ? "border-marino-700 bg-marino-50 dark:border-white/50 dark:bg-white/10" : "border-slate-200 hover:border-slate-300 dark:border-white/10"}`} data-moto-venta={u.coduni}>
                  <input type="radio" name="moto-venta" className="mt-1 h-4 w-4 accent-marino-700" checked={coduni === u.coduni} onChange={() => setCoduni(u.coduni)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-marino dark:text-white">{u.nommod}</span><PillComercial comercial={u.comercial} /></span>
                    <span className="block text-slate-500">Motor <span className="cifra">{u.nummotuni}</span> · Chasis <span className="cifra">{u.chauni}</span></span>
                    <span className="block text-[12.5px] text-slate-400"><ColorUnidad color={u.coluni} /> · {ubicacionDe(u).texto}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ))}
        {vendibles.length > 50 && lista.length === 50 && <p className="text-[12px] text-slate-400">Se muestran 50. Escribe el motor o el chasis para encontrar otra.</p>}
      </div>
    </Modal>
  );
}
