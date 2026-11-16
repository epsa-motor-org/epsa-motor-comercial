// HU-015 · Asignar o transferir un interesado (base central)
// Gerente y administradora asignan o transfieren (API de Michelle: GET /api/leads, GET /api/leads/responsables y
// PATCH /api/leads/:codlea/responsable); el vendedor ve solo los suyos. Cambiar el responsable no cambia la etapa,
// el canal, el número de WhatsApp que lo recibió ni sus seguimientos. Los filtros se aplican en la pantalla.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { mensajeError } from "../../lib/errores";
import { asignarLeadApi, leadsCentralApi, responsablesApi, sinRespuesta, useConsultaCentral } from "../../servicios/central";
import { Aviso, Campo, Card, Modal, Stat, Tabla, Vacio, btnMini, useToast } from "../ui";
import { Pill } from "./Sprint2";
import { ETIQUETA_ESTADO } from "./SeguimientoCentral";
import { AvisoConexion, BarraActualizacion, Paginador, capital, fechaCompleta } from "./Central";
import { ModalHistorialLead, UltimaActualizacion, useActualizaciones } from "./HistorialLead";

const ESTADOS = ["Nuevo", "Contactado", "En seguimiento", "Cerrado", "Convertido"];
const TONO = { Nuevo: "celeste", Contactado: "marino", "En seguimiento": "ambar", Cerrado: "gris", Convertido: "verde" };
const ABIERTOS = ["Nuevo", "Contactado", "En seguimiento"];
const LIMITE = 50;
const limpio = (t) => String(t || "").trim().replace(/\s+/g, " ");

export default function LeadsCentral({ token = 0, recientes = [] }) {
  const { puede } = useAuth();
  const nav = useNavigate();
  const gestiona = puede("leads.asignar");
  const [f, setF] = useState({ estado: "", responsable: "", sin: false });
  const [texto, setTexto] = useState(""); const [buscar, setBuscar] = useState("");
  const [offset, setOffset] = useState(0);
  const [asignar, setAsignar] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [detalleWeb, setDetalleWeb] = useState(null);
  // Última actualización de cada interesado (se guarda en la base con cada cambio)
  const { porLead, consulta: actualizaciones } = useActualizaciones();
  useEffect(() => { const t = setTimeout(() => setBuscar(limpio(texto).slice(0, 100).toLowerCase()), 250); return () => clearTimeout(t); }, [texto]);
  useEffect(() => { setOffset(0); }, [f, buscar]);
  const consulta = useConsultaCentral(() => leadsCentralApi(), [token], { clave: "leads-lista" });
  const [responsables, setResponsables] = useState(null);
  useEffect(() => { if (gestiona) responsablesApi().then(setResponsables).catch(() => setResponsables([])); }, [gestiona, token]);
  const datos = consulta.data;
  const todos = useMemo(() => datos?.leads || [], [datos]);
  // Filtros en pantalla: etapa, responsable y búsqueda por nombre o celular
  const filtrados = useMemo(() => todos.filter((l) => {
    if (f.estado && l.estlea !== f.estado) return false;
    if (f.sin && l.responsable) return false;
    if (f.responsable && l.responsable?.codusu !== f.responsable) return false;
    if (buscar && !`${l.nomlea} ${l.tellea}`.toLowerCase().includes(buscar)) return false;
    return true;
  }), [todos, f, buscar]);
  const leads = filtrados.slice(offset, offset + LIMITE);
  const abiertosDe = (codusu) => todos.filter((l) => l.responsable?.codusu === codusu && ABIERTOS.includes(l.estlea)).length;
  const hoy = new Date().toLocaleDateString("en-CA");
  const hayFiltro = Boolean(f.estado || f.responsable || f.sin || buscar);
  // Si el servidor aún no ofrece la lista, se muestran los interesados registrados desde este equipo
  const sinLista = Boolean(consulta.error?.detalle?.sinRuta) && !datos;

  return (
    <div data-hu015>
      {sinLista ? <RecienRegistrados recientes={recientes} endpoint={consulta.error.detalle.endpoint} /> : <AvisoConexion consulta={consulta} que="los interesados" />}
      {!sinLista && <>
      {!gestiona && <div className="mb-4"><Aviso>Ves los interesados que tienes asignados. La gerencia y la administración los asignan o transfieren.</Aviso></div>}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat etiqueta={gestiona ? "Interesados" : "Mis interesados"} valor={datos ? filtrados.length : "—"} nota={hayFiltro ? "Con estos filtros" : "Registrados en total"} />
        {gestiona ? <Stat etiqueta="Sin responsable" valor={datos ? todos.filter((l) => !l.responsable).length : "—"} tono={todos.some((l) => !l.responsable) ? "ambar" : "marino"} nota="Esperan asignación" />
          : <Stat etiqueta="Abiertos" valor={todos.filter((l) => ABIERTOS.includes(l.estlea)).length} />}
        <Stat etiqueta="Abiertos" valor={datos ? todos.filter((l) => ABIERTOS.includes(l.estlea)).length : "—"} nota="Nuevos, contactados o en seguimiento" />
        <Stat etiqueta="Registrados hoy" valor={todos.filter((l) => l.fecreglea && new Date(l.fecreglea).toLocaleDateString("en-CA") === hoy).length} />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2"><label className="field-label" htmlFor="lc-buscar">Buscar</label><input id="lc-buscar" className="field-input" value={texto} maxLength={100} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre o celular" /></div>
          <div><label className="field-label" htmlFor="lc-estado">Etapa</label><select id="lc-estado" className="field-input" value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todas</option>{ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e] || e}</option>)}</select></div>
          {gestiona && <div><label className="field-label" htmlFor="lc-resp">Responsable</label>
            <select id="lc-resp" className="field-input" value={f.sin ? "__sin" : f.responsable} onChange={(e) => setF({ ...f, sin: e.target.value === "__sin", responsable: e.target.value === "__sin" ? "" : e.target.value })}>
              <option value="">Todos</option><option value="__sin">Sin responsable</option>
              {(responsables || []).map((r) => <option key={r.codusu} value={r.codusu}>{r.nombre}{r.rol !== "Vendedor" ? ` (${r.rol})` : ""}</option>)}
            </select></div>}
          <div className="flex items-end gap-3"><BarraActualizacion consulta={consulta} /></div>
        </div>
        {hayFiltro && <button className="mt-3 text-[13px] font-semibold text-acento hover:underline" onClick={() => { setF({ estado: "", responsable: "", sin: false }); setTexto(""); }}>Limpiar filtros</button>}
      </Card>

      {datos && filtrados.length === 0 ? <Vacio titulo={hayFiltro ? "No hay interesados con esos filtros" : gestiona ? "Todavía no hay interesados registrados" : "No tienes interesados asignados"} texto={hayFiltro ? "Limpia los filtros o busca con otro dato." : "Regístralos con «Registrar interesado»."} /> : datos && (
        <>
          <Tabla columnas={["Registrado", "Interesado", "Moto de interés", "Llegó por", "Responsable", "Etapa", "Última actualización", "Acciones"]}>
            {leads.map((l) => (
              <tr key={l.codlea} className="align-top" data-lead={l.codlea}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fechaCompleta(l.fecreglea)}<span className="block text-[12px] text-slate-400">N° {l.codlea}</span></td>
                <td className="px-4 py-3"><p className="font-semibold text-marino dark:text-white">{l.nomlea}</p><p className="text-[12.5px] text-slate-400">{l.tellea || "Sin celular"}{l.sede ? ` · ${l.sede.nomsed}` : ""}</p>{l.orilea === "Web" && l.obslea && <button type="button" className="mt-1 text-left text-[12.5px] font-semibold text-marino dark:text-white" data-consulta-web onClick={() => setDetalleWeb(l)}>Ver consulta web</button>}</td>
                <td className="px-4 py-3">{l.modelo?.nommod || <span className="text-slate-400">Sin modelo</span>}{l.collea && <span className="block text-[12px] text-slate-400">{capital(l.collea)}</span>}</td>
                <td className="px-4 py-3">{l.canlea}{l.whatsapp && <span className="block text-[12px] text-slate-400">Recibido en {l.whatsapp.numcwa}</span>}{l.orilea && <span className="block text-[12px] text-slate-400">Origen: {l.orilea}</span>}</td>
                <td className="px-4 py-3" data-responsable={l.responsable?.codusu || ""}>{l.responsable ? <><span className="font-semibold text-marino dark:text-white">{l.responsable.nombre}</span>{!l.responsable.activo && <span className="block text-[12px] font-semibold text-acento">Sin acceso activo</span>}{l.asignado_desde && <span className="block text-[12px] text-slate-400">Desde {fechaCompleta(l.asignado_desde)}</span>}</> : <Pill tono="ambar">Sin responsable</Pill>}</td>
                <td className="px-4 py-3"><Pill tono={TONO[l.estlea] || "gris"}>{ETIQUETA_ESTADO[l.estlea] || l.estlea}</Pill></td>
                <td className="min-w-[13rem] max-w-[16rem] px-4 py-3"><UltimaActualizacion act={porLead.get(String(l.codlea))} respaldo={{ fecha: l.fecreglea, detalle: "Registrado", usuario: "" }} onAbrir={() => setHistorial(l)} /></td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                  {gestiona && <button className={btnMini} onClick={() => setAsignar(l)}>{l.responsable ? "Transferir" : "Asignar"}</button>}
                  {l.responsable && <button className={btnMini} onClick={() => nav("/admin/seguimiento", { state: { codlea: l.codlea } })}>Seguimiento</button>}
                  {l.tellea && <a className={btnMini} target="_blank" rel="noopener noreferrer" href={`https://wa.me/51${String(l.tellea).replace(/\D/g, "").slice(-9)}`}>WhatsApp</a>}
                </div></td>
              </tr>
            ))}
          </Tabla>
          <Paginador total={filtrados.length} limite={LIMITE} offset={offset} onCambio={setOffset} />
        </>
      )}
      <p className="mt-3 text-[12.5px] text-slate-400">Asignar no marca al interesado como atendido ni cambia su etapa; no se envían mensajes automáticos.</p>

      </>}
      <Modal abierto={!!detalleWeb} onClose={() => setDetalleWeb(null)} titulo="Consulta recibida desde la web">
        {detalleWeb && <div data-detalle-consulta-web className="space-y-3 text-[14px]"><p className="font-semibold">{detalleWeb.nomlea}</p><p className="text-slate-500">{detalleWeb.tellea} · {detalleWeb.sede?.nomsed || "Sin sede"}</p><p className="whitespace-pre-wrap break-words">{detalleWeb.obslea}</p></div>}
      </Modal>
      <ModalAsignar lead={asignar} responsables={responsables} abiertosDe={abiertosDe} onClose={() => setAsignar(null)} onHecho={() => { consulta.refrescar(true); actualizaciones.refrescar(true); }} />
      <ModalHistorialLead lead={historial} onClose={() => setHistorial(null)} />
    </div>
  );
}

// Asignar (sin responsable) o transferir (con motivo breve)
function ModalAsignar({ lead: inicial, responsables, abiertosDe, onClose, onHecho }) {
  const toast = useToast();
  const [lead, setLead] = useState(null);
  const [codusu, setCodusu] = useState(""); const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState({}); const [enviando, setEnviando] = useState(false); const [aviso, setAviso] = useState(null);
  useEffect(() => { setLead(inicial); setCodusu(""); setMotivo(""); setErr({}); setAviso(null); }, [inicial?.codlea]); // eslint-disable-line react-hooks/exhaustive-deps
  const opciones = useMemo(() => (responsables || []).filter((r) => r.activo && r.codusu !== lead?.responsable?.codusu), [responsables, lead]);
  if (!inicial || !lead) return null;
  const transferencia = Boolean(lead.responsable);
  const elegido = opciones.find((r) => r.codusu === codusu);
  const largo = [...limpio(motivo)].length;

  function validar() {
    const x = {};
    if (!codusu) x.codusu = "Elige quién atenderá a este interesado.";
    else if (!elegido) x.codusu = "Ese usuario no está activo o no tiene un rol comercial.";
    if (transferencia && largo < 5) x.motivo = "Indica un motivo breve de la transferencia (mínimo 5 caracteres).";
    if (largo > 250) x.motivo = "El motivo admite hasta 250 caracteres.";
    setErr(x);
    return Object.keys(x).length === 0;
  }
  async function guardar(e) {
    e.preventDefault();
    if (enviando || !validar()) return;
    setEnviando(true); setAviso(null);
    try {
      await asignarLeadApi(lead.codlea, { codusuNuevo: codusu, codusuEsperado: lead.responsable?.codusu ?? null, motivo: limpio(motivo) });
      toast(transferencia ? `Interesado transferido a ${elegido.nombre}` : `Interesado asignado a ${elegido.nombre}`);
      onHecho(); onClose();
    } catch (er) {
      if (er.status === 409) {
        // Otra persona cambió el responsable: no se sobrescribe; se actualiza la lista para ver el vigente
        setCodusu(""); onHecho();
        setAviso({ tipo: "error", t: "Otra persona cambió el responsable de este interesado mientras lo revisabas. Cierra y vuelve a abrirlo para ver el responsable vigente." });
      } else if (sinRespuesta(er)) {
        setAviso({ tipo: "aviso", t: "No se pudo confirmar si se guardó. Vuelve a intentarlo (no se duplicará) o usa Actualizar para ver el responsable vigente." });
      } else setAviso({ tipo: "error", t: mensajeError(er) });
    } finally { setEnviando(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo={transferencia ? `Transferir a ${lead.nomlea}` : `Asignar a ${lead.nomlea}`} ancho="max-w-lg"
      confirmarGuardar={{ titulo: transferencia ? "¿Transferir este interesado?" : "¿Asignar este interesado?", texto: `${lead.nomlea} quedará a cargo de ${elegido?.nombre || "—"}. Se conservan su etapa, canal, número de WhatsApp, moto de interés y seguimientos.`, boton: transferencia ? "Transferir" : "Asignar", validar }}
      pie={<><button className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button><button form="f-asignar-lead" className="btn btn-primary !py-2" disabled={enviando}>{enviando ? "Guardando…" : transferencia ? "Transferir" : "Asignar"}</button></>}>
      <form id="f-asignar-lead" onSubmit={guardar} className="space-y-4" noValidate>
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-[13.5px] dark:bg-white/5">
          <p className="font-semibold text-marino dark:text-white">{lead.nomlea} · {lead.tellea || "sin celular"}</p>
          <p className="text-slate-500">{lead.modelo?.nommod || "Sin modelo"}, {lead.canlea}{lead.whatsapp ? ` (${lead.whatsapp.numcwa})` : ""}, {lead.estlea}</p>
          <p className="mt-1 text-slate-500">Responsable actual: <b className="text-marino dark:text-white">{lead.responsable?.nombre || "sin responsable"}</b></p>
        </div>
        <Campo etiqueta="Nuevo responsable" error={err.codusu}>
          <select id="asig-responsable" className="field-input" value={codusu} onChange={(e) => setCodusu(e.target.value)}>
            <option value="">{responsables === null ? "Cargando responsables…" : opciones.length ? "Elige el responsable" : "No hay otros usuarios comerciales activos"}</option>
            {opciones.map((r) => { const n = abiertosDe(r.codusu); return <option key={r.codusu} value={r.codusu}>{r.nombre} ({r.rol}), {n} abierto{n === 1 ? "" : "s"}</option>; })}
          </select>
        </Campo>
        <Campo etiqueta={transferencia ? "Motivo de la transferencia" : "Motivo (opcional)"} error={err.motivo} ayuda={`${largo}/250. Un texto breve; no transcribas conversaciones.`}>
          <input id="asig-motivo" className="field-input" maxLength={270} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={transferencia ? "Ej: vacaciones del vendedor" : ""} />
        </Campo>
        <p className="text-[12.5px] text-slate-500">No cambia la etapa, el canal ni el número que recibió la consulta, y no envía WhatsApp.</p>
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.t}</Aviso>}
      </form>
    </Modal>
  );
}


// ---------------------------------------------------------------------------------------------
// Interesados registrados desde este equipo (mientras la lista completa no esté disponible)
// ---------------------------------------------------------------------------------------------
function RecienRegistrados({ recientes, endpoint }) {
  return (
    <div className="space-y-4" data-sin-api={endpoint} data-recientes>
      <Aviso tipo="aviso">La lista completa de interesados todavía no está disponible. Puedes registrar interesados con normalidad: los que registres desde este equipo aparecen aquí.</Aviso>
      {recientes.length === 0 ? <Vacio titulo="Todavía no registraste interesados" texto="Regístralos con «Registrar interesado»." /> : (
        <Tabla columnas={["N°", "Interesado", "Modelo", "Canal", "Responsable", "Registrado"]}>
          {recientes.map((l) => (
            <tr key={l.codlea || l.id} data-reciente={l.codlea}>
              <td className="px-4 py-3 font-semibold">#{l.codlea}</td>
              <td className="px-4 py-3"><span className="font-semibold text-marino dark:text-white">{l.contacto}</span><span className="block text-[12px] text-slate-400">{l.telefono}</span></td>
              <td className="px-4 py-3">{l.nombreModelo || "—"}{l.color && <span className="block text-[12px] text-slate-400">{capital(l.color)}</span>}</td>
              <td className="px-4 py-3">{l.canal}{l.sede && <span className="block text-[12px] text-slate-400">Sede {l.sede}</span>}</td>
              <td className="px-4 py-3">{l.responsable || "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{l.registrado ? fechaCompleta(l.registrado) : l.fecha}</td>
            </tr>
          ))}
        </Tabla>
      )}
    </div>
  );
}
