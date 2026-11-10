// HU-014 · Leads: registrar interesado · HU-015: asignar o transferir (base central) · HU-011: consultas web (vista previa)
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { CANALES, ESTADOS_LEAD, FAMILIAS, FILTROS_CATALOGO, SEDES_ATENCION } from "../../data/mockData";
import { Aviso, btnMini, btnMiniPeligro, Campo, Card, Modal, PageHeader, Stat, Tabla, useConfirm, useToast, Vacio } from "../../components/ui";
import { RankingBarras } from "../../components/charts";
import { esCelular, esNombre, hoyLocal, limpiarTexto, MSJ, soloDigitos, soloLetras } from "../../lib/validar";
import { MODO_REAL, WHATSAPP_NUMERO } from "../../lib/config";
import { listarCanalesWhatsapp, listarUsuariosSupabase, registrarLeadApi } from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { EstadoConexion } from "../../components/dashboard/Sprint2";
import LeadsCentral from "../../components/dashboard/LeadsCentral";
import { inventarioApi } from "../../servicios/central";

const TONO = { Nuevo: "bg-sky-100 text-sky-700", "En seguimiento": "bg-amber-100 text-amber-700", Cotizado: "bg-violet-100 text-violet-700", "Cerrado ganado": "bg-emerald-100 text-emerald-700", Perdido: "bg-slate-200 text-slate-600" };
const VACIO = { contacto: "", telefono: "", canal: "", modelo: "", color: "", sede: "Comas", responsable: "", codusu: "", proximo: "", estado: "Nuevo", nota: "", primerContacto: true, otraOportunidad: false };
const SIN = "Sin asignar";
const hoyISO = hoyLocal;

// Datos que acepta la API de leads
const COLORES_LEAD = ["Rojo", "Azul", "Amarillo", "Verde", "Negro"];
// «AMARILLO», «amarillo» o «Amarillo» son el mismo color
const colorLead = (c) => COLORES_LEAD.find((x) => x.toLowerCase() === String(c || "").trim().toLowerCase()) || "";
const ROLES_LEAD = ["Gerente", "Administradora", "Vendedor"];
function canalApi(canal) {
  if (canal === "Visita a sede") return { canlea: "Presencial", orilea: null };
  if (canal === "Formulario web") return { canlea: canal, orilea: "Web" };
  if (["Facebook", "TikTok", "Referido"].includes(canal)) return { canlea: canal, orilea: canal };
  return { canlea: canal, orilea: null };
}
// Fecha del primer contacto
function instanteContacto(dia) {
  if (dia === hoyLocal()) return new Date(Date.now() + 30 * 60000).toISOString();
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d, 9, 0, 0).toISOString();
}

// Página de leads
export default function Leads() {
  const { leads, modelos, equipo, seguimientos, config, agregar, actualizar, eliminar, configurar, publicos = [], sedes = [] } = useApp();
  const { user, puede } = useAuth();
  const toast = useToast(); const confirmar = useConfirm(); const nav = useNavigate();
  const [f, setF] = useState({ q: "", estado: "", canal: "", sede: "", resp: "", modelo: "" });
  const [fm, setFm] = useState({ tipoMotor: "", combustible: "", familia: "" });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [err, setErr] = useState({});
  const [asignando, setAsignando] = useState(null); const [vendAsig, setVendAsig] = useState("");
  const vendedores = equipo.filter((p) => p.rol === "vendedor" && p.activo);
  const nombreModelo = (id) => (modelos.find((m) => m.id === id) || publicos.find((m) => m.id === id))?.nombre || "Sin modelo";
  const ausencia = !!config?.modoAusencia;
  const hoy = hoyISO();

  // Responsables, sedes y WhatsApp
  const [cuentas, setCuentas] = useState(null);
  const [canalWa, setCanalWa] = useState(undefined);
  const [dupApi, setDupApi] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (!MODO_REAL) return;
    listarUsuariosSupabase()
      .then((l) => setCuentas(l.filter((u) => u.estusu !== false && ROLES_LEAD.includes(u.rol?.nomrol))
        .map((u) => ({ codusu: String(u.codusu), nombre: [u.nomusu, u.apepatusu, u.apematusu].filter(Boolean).join(" "), rol: u.rol.nomrol }))))
      .catch(() => setCuentas([]));
    const num = (x) => String(x || "").replace(/\D/g, "").slice(-9);
    listarCanalesWhatsapp()
      .then((l) => { const act = l.filter((c) => c.estcwa !== false); const c = act.find((x) => num(x.numcwa) === num(WHATSAPP_NUMERO)) || act[0]; setCanalWa(c ? String(c.codcwa) : null); })
      .catch(() => setCanalWa(null));
  }, []);
  const yo = MODO_REAL && user?.codusu ? { codusu: String(user.codusu), nombre: user.nombre, rol: "" } : null;
  const responsablesApi = !MODO_REAL ? [] : cuentas?.length ? [...cuentas].sort((a, b) => (b.rol === "Vendedor") - (a.rol === "Vendedor")) : yo ? [yo] : [];
  const modelosLead = MODO_REAL ? publicos.filter((m) => m.codmodApi) : modelos;
  // Con la base conectada, las sedes vienen de la API (sin lista fija)
  const sedesLead = MODO_REAL ? sedes.map((s) => s.nombre) : SEDES_ATENCION;
  const codsedDe = (nombre) => sedes.find((s) => s.nombre === nombre)?.codsed || null;
  const nuevoReal = MODO_REAL && !modal?.lead;

  // Color de interés (DEF-LDS-001): los colores activos del modelo y los que hay en el inventario central para ese
  // modelo (sin contar las vendidas), entre los cinco que acepta la API. Si el inventario no responde, los del modelo.
  const [coloresInventario, setColoresInventario] = useState({});
  const abiertoNuevo = Boolean(modal) && nuevoReal;
  useEffect(() => {
    if (!abiertoNuevo) return undefined;
    let vivo = true;
    inventarioApi().then(({ unidades }) => {
      if (!vivo) return;
      const m = {};
      unidades.filter((u) => u.comercial !== "Vendida").forEach((u) => { (m[String(u.codmod)] ||= new Set()).add(colorLead(u.coluni)); });
      setColoresInventario(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].filter(Boolean)])));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [abiertoNuevo]);
  const coloresDe = (m) => {
    if (!m) return [];
    const hay = new Set([...(m.colores || []), ...(nuevoReal ? coloresInventario[String(m.codmodApi || "")] || [] : [])].map(colorLead));
    const extra = nuevoReal ? [] : (m.colores || []).filter((c) => !COLORES_LEAD.includes(c));
    return [...COLORES_LEAD.filter((c) => hay.has(c)), ...extra];
  };

  const proximo = (l) => seguimientos.filter((s) => s.leadId === l.id && !s.hecho).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  const cerrado = (l) => ["Cerrado ganado", "Perdido"].includes(l.estado);

  // Filtros y ranking
  const filtrados = useMemo(() => leads.filter((l) => {
    const q = f.q.toLowerCase();
    if (q && !`${l.contacto} ${l.telefono}`.toLowerCase().includes(q)) return false;
    return (!f.estado || l.estado === f.estado) && (!f.canal || l.canal === f.canal) && (!f.sede || l.sede === f.sede) && (!f.resp || l.responsable === f.resp) && (!f.modelo || l.modelo === f.modelo);
  }), [leads, f]);

  const ranking = useMemo(() => {
    const ok = (m) => (!fm.tipoMotor || m.tipoMotor === fm.tipoMotor) && (!fm.combustible || m.combustible === fm.combustible) && (!fm.familia || m.familia === fm.familia);
    const c = {};
    leads.forEach((l) => { const m = modelos.find((x) => x.id === l.modelo); if (m && ok(m)) c[l.modelo] = (c[l.modelo] || 0) + 1; });
    return Object.entries(c).map(([id, v]) => ({ id, v, etiqueta: nombreModelo(id) })).sort((a, b) => b.v - a.v);
  }, [leads, modelos, fm]); // eslint-disable-line

  // Celular repetido
  const celularSinCambio = Boolean(modal?.lead && modal.lead.telefono === form.telefono);
  const duplicado = esCelular(form.telefono) && !celularSinCambio ? leads.find((l) => l.telefono === form.telefono && l.id !== modal?.lead?.id) : null;
  const modeloForm = (nuevoReal ? modelosLead : modelos).find((m) => m.id === form.modelo);

  // Abrir formulario
  function abrir(l) {
    setErr({}); setDupApi(null);
    if (l) setForm({ ...VACIO, ...l, primerContacto: false });
    else if (MODO_REAL) {
      const propio = responsablesApi.find((r) => r.codusu === String(user?.codusu));
      const resp = (user.rol === "vendedor" && propio) || responsablesApi.find((r) => r.rol === "Vendedor") || propio || responsablesApi[0];
      setForm({ ...VACIO, sede: sedesLead.includes(VACIO.sede) ? VACIO.sede : sedesLead[0] || "", codusu: resp?.codusu || "", responsable: resp?.nombre || "", proximo: hoy });
    } else setForm({ ...VACIO, responsable: ausencia ? SIN : user.rol === "vendedor" ? user.nombre : vendedores[0]?.nombre || SIN });
    setModal({ lead: l });
  }
  // Validación
  function validar() {
    const x = {};
    if (!esNombre(form.contacto)) x.contacto = MSJ.nombre;
    if (!esCelular(form.telefono)) x.telefono = MSJ.celular;
    else if (duplicado && !form.otraOportunidad) x.telefono = "Este celular ya está registrado. Abre ese lead o márcalo como otra oportunidad.";
    else if (dupApi && !form.otraOportunidad) x.telefono = "Este celular ya tiene una oportunidad activa. Márcalo como otra oportunidad para registrarlo.";
    if (!form.canal) x.canal = "Indica por dónde llegó la consulta.";
    if (!form.modelo || ![...modelos, ...publicos].some((m) => m.id === form.modelo)) x.modelo = "Elige el modelo que consultó.";
    if (limpiarTexto(form.nota).length > 500) x.nota = "Máximo 500 caracteres.";
    if (nuevoReal) {
      if (!modelosLead.length) x.modelo = "Aún no cargan los modelos. Espera un momento y vuelve a intentar.";
      else if (!x.modelo && !modelosLead.some((m) => m.id === form.modelo)) x.modelo = "Ese modelo no está publicado. Elige otro.";
      if (form.canal === "WhatsApp" && !canalWa) x.canal = canalWa === undefined ? "Cargando el WhatsApp de la empresa… vuelve a intentar en un momento." : "El WhatsApp de la empresa aún no está registrado. Elige otro canal.";
      if (form.canal === "Visita a sede" && !codsedDe(form.sede)) x.sede = "Esta sede aún no está registrada. Elige otra sede u otro canal.";
      if (!form.codusu) x.responsable = "Elige quién atenderá a este interesado.";
      if (!form.proximo || form.proximo < hoy) x.proximo = "Elige hoy o una fecha futura.";
    }
    setErr(x); return Object.keys(x).length === 0;
  }
  // Guardar
  async function guardar(e) {
    e.preventDefault();
    if (enviando || !validar()) return;
    const { primerContacto, otraOportunidad, proximo, ...datos } = form;
    datos.contacto = limpiarTexto(datos.contacto);
    datos.nota = limpiarTexto(datos.nota);
    if (!datos.codusu) delete datos.codusu;
    if (modal.lead) { actualizar("leads", modal.lead.id, datos, `Lead editado: ${datos.contacto}`); toast("Lead actualizado"); }
    else if (MODO_REAL) return registrarEnSupabase(datos, otraOportunidad, proximo);
    else {
      if (otraOportunidad && duplicado) datos.nota = [datos.nota, `Otra oportunidad del mismo cliente (lead #${duplicado.id}).`].filter(Boolean).join(" ");
      const id = leads.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
      agregar("leads", { id, ...datos, estado: "Nuevo", fecha: hoy }, `Lead registrado: ${datos.contacto}`);
      const agenda = primerContacto && datos.responsable !== SIN;
      if (agenda) agregar("seguimientos", { leadId: id, fecha: hoy, tipo: datos.canal === "WhatsApp" ? "WhatsApp" : "Llamada", responsable: datos.responsable, hecho: false, detalle: `Primer contacto: consulta por el ${nombreModelo(datos.modelo)}` }, `Seguimiento creado para ${datos.contacto}`);
      toast(datos.responsable === SIN ? "Lead registrado como «Sin asignar» y sin próximo contacto" : agenda ? "Lead registrado y primer contacto agendado en Seguimiento" : "Lead registrado");
    }
    setModal(null);
  }

  // Registrar en la API (POST /api/leads)
  async function registrarEnSupabase(datos, otra, proximo) {
    const modelo = modelosLead.find((m) => m.id === datos.modelo);
    const resp = responsablesApi.find((r) => r.codusu === datos.codusu);
    const { canlea, orilea } = canalApi(datos.canal);
    const collea = COLORES_LEAD.find((c) => c.toLowerCase() === String(datos.color || "").toLowerCase()) || null;
    const previo = dupApi?.codlea || duplicado?.codlea;
    const nota = [datos.nota, datos.color && !collea ? `Color de interés: ${datos.color}.` : "",
      otra && (dupApi || duplicado) ? `Otra oportunidad del mismo cliente${previo ? ` (lead #${previo})` : ""}.` : ""].filter(Boolean).join(" ");
    const codsed = codsedDe(datos.sede);
    setEnviando(true);
    try {
      const r = await registrarLeadApi({
        nomlea: datos.contacto, tellea: datos.telefono, codmod: modelo.codmodApi, canlea, orilea,
        ...(codsed ? { codsed } : {}), ...(canlea === "WhatsApp" ? { codcwa: canalWa } : {}),
        collea, codusu: datos.codusu, estlea: "Nuevo", fecprosle: instanteContacto(proximo), obslea: nota || null, nueva_oportunidad: otra,
      });
      const codlea = r.data?.codlea;
      const nombre = resp?.nombre || datos.responsable;
      const id = leads.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
      // Queda anotado en este equipo para mostrarlo mientras la lista completa no esté disponible
      agregar("leads", { id, ...datos, nota, responsable: nombre, codlea, estado: "Nuevo", fecha: hoy, registrado: new Date().toISOString(), nombreModelo: nombreModelo(datos.modelo) }, `Lead #${codlea} registrado: ${datos.contacto}`);
      toast(`Lead #${codlea} registrado. Primer contacto: ${proximo === hoy ? "hoy" : proximo}`);
      setModal(null); setToken((t) => t + 1);
    } catch (e) {
      const msg = mensajeError(e);
      if (e.status === 409) { setDupApi({ codlea: "", codmod: "", estlea: "", ...e.detalle?.coincidencia }); setForm((p) => ({ ...p, otraOportunidad: false })); setErr({}); }
      else if (/modelo/i.test(msg)) setErr({ modelo: msg });
      else if (/responsable/i.test(msg)) setErr({ responsable: msg });
      else if (/sede/i.test(msg)) setErr({ sede: msg });
      else if (/whatsapp/i.test(msg)) setErr({ canal: msg });
      else setErr({ general: msg });
    } finally { setEnviando(false); }
  }

  // Asignar, cambiar estado y eliminar
  function abrirAsignar(l) { setVendAsig(vendedores.find((p) => p.sede === l.sede && !p.ausente)?.nombre || vendedores[0]?.nombre || ""); setAsignando(l); }
  function guardarAsignacion(e) {
    e.preventDefault();
    if (!vendAsig) return toast("No hay vendedores activos para asignar. Revisa el Equipo.", "error");
    actualizar("leads", asignando.id, { responsable: vendAsig }, `Lead ${asignando.contacto} asignado a ${vendAsig}`);
    if (!proximo(asignando)) agregar("seguimientos", { leadId: asignando.id, fecha: hoy, tipo: "Llamada", responsable: vendAsig, hecho: false, detalle: "Primer contacto tras la asignación" });
    toast(`Asignado a ${vendAsig}. Primer contacto agendado para hoy.`); setAsignando(null);
  }

  async function cambiarEstado(l, estado) {
    if (["Cerrado ganado", "Perdido"].includes(estado) && !(await confirmar({ titulo: `Marcar como «${estado}»`, texto: `${l.contacto} saldrá de la lista de leads abiertos.`, boton: "Confirmar" }))) return;
    actualizar("leads", l.id, { estado }, `Lead ${l.contacto}: ${estado}`);
    if (["Cerrado ganado", "Perdido"].includes(estado)) seguimientos.filter((s) => s.leadId === l.id && !s.hecho).forEach((s) => actualizar("seguimientos", s.id, { hecho: true, resultado: `Lead marcado como «${estado}»`, cerrado: hoy }));
    toast(`Estado: ${estado}`);
  }
  async function borrar(l) {
    const segs = seguimientos.filter((s) => s.leadId === l.id);
    if (!(await confirmar({ titulo: "Eliminar lead", texto: `¿Eliminar a ${l.contacto}?${segs.length ? ` También se eliminarán sus ${segs.length} seguimiento(s).` : ""} Esta acción no se puede deshacer.`, boton: "Eliminar", peligro: true }))) return;
    segs.forEach((s) => eliminar("seguimientos", s.id));
    eliminar("leads", l.id, `Lead eliminado: ${l.contacto}`); toast("Lead eliminado");
  }
  // Modo ausencia
  async function alternarAusencia() {
    if (!ausencia && !(await confirmar({ titulo: "Activar modo ausencia", texto: MODO_REAL ? "Los leads nuevos de la web quedarán «Sin asignar» y sin próximo contacto hasta que alguien los reparta. Los que se registran en el panel siempre llevan responsable." : "Los leads nuevos (web y manuales) quedarán «Sin asignar» y sin próximo contacto hasta que alguien los reparta.", boton: "Activar" }))) return;
    configurar({ modoAusencia: !ausencia }, `Modo ausencia ${ausencia ? "desactivado" : "activado"} por ${user.nombre}`);
    toast(ausencia ? "Modo ausencia desactivado: vuelve el reparto por turnos" : "Modo ausencia activo");
  }

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const sel = (k, et, ops) => (
    <div><label className="field-label">{et}</label>
      <select className="field-input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">Todos</option>{ops.map((o) => <option key={o.v ?? o} value={o.v ?? o}>{o.t ?? o}</option>)}</select></div>
  );
  const abiertos = leads.filter((l) => !cerrado(l));
  const webNuevas = leads.filter((l) => l.canal === "Formulario web" && l.estado === "Nuevo");

  return (
    <div>
      <PageHeader titulo="Leads" subtitulo={MODO_REAL ? "Interesados registrados. Gerencia y administración los asignan o transfieren; cada vendedor ve los suyos." : "Interesados que llegan por la web, WhatsApp, redes o las sedes. Un celular no se registra dos veces."}>
        {MODO_REAL && <EstadoConexion hu="HU-015" />}
        {!MODO_REAL && puede("leads.ausencia") && (
          <button type="button" onClick={alternarAusencia} aria-pressed={ausencia} className={`btn !py-2.5 border ${ausencia ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" : "border-slate-300 text-slate-600 dark:border-white/15 dark:text-white/80"}`}>
            <span className={`relative h-5 w-9 rounded-full transition ${ausencia ? "bg-amber-500" : "bg-slate-300 dark:bg-white/20"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${ausencia ? "left-[18px]" : "left-0.5"}`} /></span>
            Modo ausencia
          </button>
        )}
        <button className="btn btn-primary !py-2.5" onClick={() => abrir(null)}>+ Registrar interesado</button>
      </PageHeader>
      {MODO_REAL && <LeadsCentral token={token} recientes={leads.filter((l) => l.codlea).sort((a, b) => Number(b.codlea) - Number(a.codlea)).slice(0, 50)} />}
      {!MODO_REAL && <>
      {ausencia && <div className="mb-5"><Aviso tipo="aviso">Modo ausencia activo: los leads nuevos{MODO_REAL ? " de la web" : ""} quedan «Sin asignar» y «Sin próximo contacto». Repártelos con el botón «Asignar».</Aviso></div>}

      {/* HU-011 · Consultas desde la web */}
      {webNuevas.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl2 border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-500/30 dark:bg-sky-500/10" data-aviso-web>
          <p className="text-[14px] text-sky-900 dark:text-sky-100"><b>{webNuevas.length === 1 ? "1 consulta nueva" : `${webNuevas.length} consultas nuevas`}</b> desde la web{webNuevas.some((l) => l.responsable === SIN || !l.responsable) ? ", algunas sin asignar" : ""}. Responde el mismo día.</p>
          <div className="flex flex-wrap items-center gap-2">
            <EstadoConexion hu="HU-011" />
            <button className="btn btn-primary !py-2 text-[13.5px]" onClick={() => setF({ q: "", estado: "Nuevo", canal: "Formulario web", sede: "", resp: "", modelo: "" })}>Ver consultas web</button>
          </div>
        </div>
      )}

      {/* Indicadores */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat etiqueta="Nuevos hoy" valor={leads.filter((l) => l.fecha === hoy).length} />
        <Stat etiqueta="Sin asignar" valor={abiertos.filter((l) => l.responsable === SIN).length} tono="ambar" />
        <Stat etiqueta="Sin próximo contacto" valor={abiertos.filter((l) => !proximo(l)).length} tono="rojo" />
        <Stat etiqueta="Cotizados" valor={leads.filter((l) => l.estado === "Cotizado").length} tono="verde" />
      </div>

      {/* Modelos consultados y filtros */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Card>
          <h2 className="font-bold text-marino dark:text-white">Modelos consultados</h2>
          <p className="mb-3 text-[12.5px] text-slate-400">Filtra igual que en el catálogo de la web. Toca una barra para ver sus leads.</p>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {[["tipoMotor", "Motor", FILTROS_CATALOGO.tipoMotor], ["combustible", "Combustible", FILTROS_CATALOGO.combustible], ["familia", "Familia", FAMILIAS]].map(([k, l, o]) => (
              <select key={k} aria-label={l} className="field-input !px-2 !py-2 !text-[12.5px]" value={fm[k]} onChange={(e) => setFm({ ...fm, [k]: e.target.value })}><option value="">{l}</option>{o.map((v) => <option key={v}>{v}</option>)}</select>
            ))}
          </div>
          {ranking.length ? <RankingBarras datos={ranking} elegido={f.modelo} onElegir={(id) => setF({ ...f, modelo: id })} /> : <p className="py-6 text-center text-[13.5px] text-slate-400">Sin consultas con ese filtro.</p>}
        </Card>

        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><label className="field-label">Buscar</label><input className="field-input" placeholder="Nombre o celular" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
            {sel("estado", "Estado", ESTADOS_LEAD)}
            {sel("canal", "Canal", CANALES)}
            {sel("sede", "Sede", SEDES_ATENCION)}
            {sel("resp", "Responsable", [...new Set([SIN, ...vendedores.map((v) => v.nombre), ...(MODO_REAL ? leads.map((l) => l.responsable).filter(Boolean) : [])])])}
            {sel("modelo", "Modelo", modelos.map((m) => ({ v: m.id, t: m.nombre })))}
            <div className="flex items-end"><button className="pb-3 text-[13px] font-semibold text-acento hover:underline" onClick={() => setF({ q: "", estado: "", canal: "", sede: "", resp: "", modelo: "" })}>Limpiar filtros</button></div>
          </div>
          <p className="mt-3 text-[13px] text-slate-500">{filtrados.length} de {leads.length} leads</p>
        </Card>
      </div>

      {/* Tabla de leads */}
      <div className="mt-6">
        {filtrados.length === 0 ? <Vacio titulo="No hay leads con esos filtros" texto="Limpia los filtros o registra un interesado nuevo." /> : (
          <Tabla columnas={["Fecha", "Interesado", "Modelo consultado", "Canal", "Responsable", "Próximo contacto", "Estado", "Acciones"]}>
            {filtrados.map((l) => {
              const px = proximo(l);
              return (
                <tr key={l.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{l.fecha}</td>
                  <td className="px-4 py-3"><p className="font-semibold text-marino dark:text-white">{l.contacto}</p><p className="text-[12.5px] text-slate-400">{l.telefono} · {l.sede}</p></td>
                  <td className="px-4 py-3">{l.modelo ? nombreModelo(l.modelo) : <span className="text-slate-400">Aún no decide</span>}{l.color && <span className="text-slate-400"> · {l.color}</span>}
                    {l.mensaje && <p className="mt-1 max-w-[260px] truncate text-[12.5px] italic text-slate-500" title={l.mensaje}>“{l.mensaje}”</p>}</td>
                  <td className="px-4 py-3">{l.canal}{l.tipoConsulta && <span className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.tipoConsulta === "Consulta" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>{l.tipoConsulta === "Consulta" ? "Pregunta" : "Cotización"}</span>}{l.codigoWeb && <span className="block text-[11.5px] text-slate-400">{l.codigoWeb}</span>}</td>
                  <td className="px-4 py-3">{l.responsable === SIN || !l.responsable ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[12px] font-semibold text-amber-800">Sin asignar</span> : l.responsable}</td>
                  <td className="whitespace-nowrap px-4 py-3">{cerrado(l) ? <span className="text-slate-400">—</span> : px ? <span className={px.fecha < hoy ? "font-semibold text-acento" : ""}>{px.fecha} · {px.tipo}</span> : <span className="rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">Sin próximo contacto</span>}</td>
                  <td className="px-4 py-3">
                    <select aria-label={`Estado de ${l.contacto}`} value={l.estado} onChange={(e) => cambiarEstado(l, e.target.value)} className={`rounded-full border-0 px-2.5 py-1 text-[12px] font-semibold ${TONO[l.estado]}`}>
                      {ESTADOS_LEAD.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                    {(l.responsable === SIN || !l.responsable) && !cerrado(l) && <button className={btnMini} onClick={() => abrirAsignar(l)}>Asignar</button>}
                    <a className={btnMini} target="_blank" rel="noopener noreferrer" href={`https://wa.me/51${l.telefono}?text=${encodeURIComponent(`Hola ${l.contacto}, te escribimos de EPSA Motor por tu consulta del ${nombreModelo(l.modelo)}.`)}`}>WhatsApp</a>
                    <button className={btnMini} onClick={() => nav("/admin/seguimiento", { state: { leadId: l.id } })}>Seguimiento</button>
                    <button className={btnMini} onClick={() => nav("/admin/ventas", { state: { lead: l } })}>Vender</button>
                    <button className={btnMini} onClick={() => abrir(l)}>Editar</button>
                    {puede("eliminar") && <button className={btnMiniPeligro} onClick={() => borrar(l)}>Eliminar</button>}
                  </div></td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </div>

      </>}

      {/* Formulario: registrar / editar interesado */}
      <Modal abierto={!!modal} onClose={() => setModal(null)} titulo={modal?.lead ? `Editar lead de ${modal.lead.contacto}` : "Registrar interesado"} ancho="max-w-2xl"
        confirmarGuardar={modal?.lead ? { titulo: "¿Guardar los cambios?", texto: `Se actualizará el lead de ${form.contacto || "este interesado"}.`, boton: "Guardar cambios", validar } : false}
        pie={<><button className="btn btn-secondary !py-2" onClick={() => setModal(null)}>Cancelar</button><button form="f-lead" className="btn btn-primary !py-2" type="submit" disabled={enviando || ((!!duplicado || !!dupApi) && !form.otraOportunidad)}>{modal?.lead ? "Guardar" : enviando ? "Registrando…" : "Registrar"}</button></>}>
        <form id="f-lead" onSubmit={guardar} className="grid gap-4 sm:grid-cols-2" noValidate>
          {err.general && <div className="sm:col-span-2"><Aviso tipo="error">{err.general}</Aviso></div>}
          <Campo etiqueta="Nombre del interesado" error={err.contacto}><input id="lead-nombre" className="field-input" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: soloLetras(e.target.value) })} autoComplete="off" /></Campo>
          <Campo etiqueta="Celular" error={err.telefono}><input id="lead-celular" className="field-input" inputMode="numeric" maxLength={9} value={form.telefono} onChange={(e) => { setForm({ ...form, telefono: soloDigitos(e.target.value, 9), otraOportunidad: false }); setDupApi(null); }} placeholder="9XXXXXXXX" /></Campo>
          {/* Aviso de celular repetido */}
          {(duplicado || dupApi) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13.5px] text-amber-900 sm:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              {duplicado ? <>
                <p className="font-semibold">Este celular ya está registrado{duplicado.modelo !== form.modelo && form.modelo ? " (por otro modelo)" : ""}</p>
                <p className="mt-1">{duplicado.contacto} · {nombreModelo(duplicado.modelo)} · {duplicado.estado} · {duplicado.responsable || SIN} · desde el {duplicado.fecha}</p>
              </> : <>
                <p className="font-semibold">Este celular ya está registrado{dupApi.codmod && modeloForm?.codmodApi && String(dupApi.codmod) !== modeloForm.codmodApi ? " (por otro modelo)" : ""}</p>
                <p className="mt-1">Lead #{dupApi.codlea} · {publicos.find((m) => m.codmodApi === String(dupApi.codmod))?.nombre || "otro modelo"} · {dupApi.estlea} · con actividad en los últimos 14 días</p>
              </>}
              <div className="mt-3 flex flex-wrap gap-2">
                {duplicado && <button type="button" data-dup="vincular" className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-amber-900 shadow-sm hover:bg-amber-100 dark:bg-white/10 dark:text-amber-100" onClick={() => abrir(duplicado)}>Es el mismo cliente: abrir su lead</button>}
                {!modal?.lead && <button type="button" data-dup="otra" aria-pressed={form.otraOportunidad} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold shadow-sm ${form.otraOportunidad ? "bg-amber-600 text-white" : "bg-white text-amber-900 hover:bg-amber-100 dark:bg-white/10 dark:text-amber-100"}`} onClick={() => setForm({ ...form, otraOportunidad: !form.otraOportunidad })}>{form.otraOportunidad ? "✓ Se registrará como otra oportunidad" : "Registrar como otra oportunidad"}</button>}
              </div>
            </div>
          )}
          <Campo etiqueta="Canal de la consulta" error={err.canal}><select id="lead-canal" className="field-input" value={form.canal} onChange={set("canal")}><option value="">Elige el canal</option>{CANALES.map((c) => <option key={c}>{c}</option>)}</select></Campo>
          <Campo etiqueta="Modelo consultado" error={err.modelo}><select id="lead-modelo" className="field-input" value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value, color: "" })}><option value="">{nuevoReal && !modelosLead.length ? "Cargando modelos…" : "Elige el modelo"}</option>{(nuevoReal ? modelosLead : modelos).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Sede de interés" error={err.sede}><select id="lead-sede" className="field-input" value={form.sede} onChange={set("sede")}>{[...new Set([...(nuevoReal ? sedesLead : SEDES_ATENCION), ...(form.sede ? [form.sede] : [])])].map((c) => <option key={c}>{c}</option>)}</select></Campo>
          <Campo etiqueta="Responsable" error={err.responsable}>{nuevoReal
            ? <select id="lead-responsable" className="field-input" value={form.codusu} onChange={(e) => setForm({ ...form, codusu: e.target.value, responsable: responsablesApi.find((r) => r.codusu === e.target.value)?.nombre || "" })}>
                {!responsablesApi.length && <option value="">Sin responsables disponibles</option>}
                {responsablesApi.map((r) => <option key={r.codusu} value={r.codusu}>{r.nombre}{r.rol && r.rol !== "Vendedor" ? ` (${r.rol})` : ""}</option>)}
              </select>
            : <select id="lead-responsable" className="field-input" value={form.responsable} onChange={set("responsable")}>{[...new Set([SIN, ...vendedores.map((v) => v.nombre), ...(form.responsable ? [form.responsable] : [])])].map((n) => <option key={n}>{n}</option>)}</select>}</Campo>
          {modal?.lead && <Campo etiqueta="Estado"><select className="field-input" value={form.estado} onChange={set("estado")}>{ESTADOS_LEAD.map((c) => <option key={c}>{c}</option>)}</select></Campo>}
          <Campo etiqueta="Color de interés"><select id="lead-color" className="field-input" value={form.color} onChange={set("color")} disabled={!modeloForm}><option value="">{modeloForm ? "Cualquiera" : "Elige primero el modelo"}</option>{coloresDe(modeloForm).map((c) => <option key={c}>{c}</option>)}</select></Campo>
          {nuevoReal && <Campo etiqueta="Primer contacto" error={err.proximo}><input id="lead-proximo" type="date" className="field-input" min={hoy} value={form.proximo} onChange={set("proximo")} /></Campo>}
          <Campo etiqueta="Notas" error={err.nota} className="sm:col-span-2"><textarea className="field-input" rows={2} maxLength={520} value={form.nota} onChange={set("nota")} placeholder="Qué preguntó, cuándo prefiere que lo llamen…" /></Campo>
          {!modal?.lead && !MODO_REAL && (
            form.responsable === SIN
              ? <p className="text-[13px] text-slate-500 sm:col-span-2">Sin responsable no se agenda contacto: el lead quedará «Sin asignar» y «Sin próximo contacto», no como atendido.</p>
              : <label className="flex items-center gap-2 text-[13.5px] font-medium sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[#0e2c52]" checked={form.primerContacto} onChange={(e) => setForm({ ...form, primerContacto: e.target.checked })} />Agendar el primer contacto en Seguimiento para hoy</label>
          )}
        </form>
      </Modal>

      {/* Asignar vendedor */}
      <Modal abierto={!!asignando} onClose={() => setAsignando(null)} titulo={`Asignar a ${asignando?.contacto || ""}`} ancho="max-w-md"
        confirmarGuardar={{ titulo: "¿Asignar este lead?", texto: `Quedará a cargo de ${vendAsig || "—"} con el primer contacto para hoy.`, boton: "Asignar" }}
        pie={<><button className="btn btn-secondary !py-2" onClick={() => setAsignando(null)}>Cancelar</button><button form="f-asig" className="btn btn-primary !py-2">Asignar</button></>}>
        <form id="f-asig" onSubmit={guardarAsignacion} className="grid gap-4" noValidate>
          <p className="text-[13.5px] text-slate-500">{asignando?.telefono} · {nombreModelo(asignando?.modelo)} · {asignando?.sede}</p>
          <Campo etiqueta="Vendedor"><select className="field-input" value={vendAsig} onChange={(e) => setVendAsig(e.target.value)}>{vendedores.map((v) => <option key={v.id} value={v.nombre}>{v.nombre}{v.ausente ? " (ausente)" : ""}</option>)}</select></Campo>
        </form>
      </Modal>
    </div>
  );
}
