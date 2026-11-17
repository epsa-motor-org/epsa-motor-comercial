// Resumen del panel
// Con la base conectada muestra solo datos reales (inventario, movimientos, leads, modelos y compras de la API).
// Sin base, la vista de ejemplo muestra los indicadores comerciales con datos de este navegador.
import { useEffect, useMemo, useState } from "react";
import { Link } from "../../components/dashboard/LinkPanel";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { formatoSoles, SEDES_ATENCION } from "../../data/mockData";
import { Card, Stat } from "../../components/ui";
import { BarChart, LineChart, Donut, RankingBarras } from "../../components/charts";
import { estadoVisible } from "../../servicios/separaciones";
import MotoIllustration from "../../components/MotoIllustration";
import { MODO_REAL } from "../../lib/config";
import * as api from "../../lib/api";
import { inventarioApi, leadsCentralApi, useConsultaCentral } from "../../servicios/central";
import { BarraActualizacion, sinApi } from "../../components/dashboard/Central";
import { ZONA_LIMA, formatoDia, hoyLocal, mesLocal } from "../../lib/validar";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function ultimosMeses(n) {
  const [y, m] = mesLocal().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return { clave: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, etiqueta: MESES[d.getUTCMonth()] };
  });
}

// ---------------------------------------------------------------------------------------------
// Bienvenida con la fecha y accesos rápidos según el rol
// ---------------------------------------------------------------------------------------------
function Bienvenida({ children }) {
  const { user, puedeVer } = useAuth();
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl bg-marino px-6 py-7 text-white shadow-card sm:px-8" data-bienvenida>
      <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-acento/25 blur-3xl" aria-hidden="true" />
      <MotoIllustration className="pointer-events-none absolute -bottom-5 right-8 hidden h-40 w-auto text-white/[0.12] md:block" />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-[13.5px] text-white/60 first-letter:uppercase">{formatoDia(hoyLocal(), { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-1 font-display text-[2.4rem] font-bold leading-none tracking-tight sm:text-[2.8rem]">{`Hola, ${String(user.nombre).split(" ")[0]}`}</h1>
          <p className="mt-2 max-w-xl text-[14.5px] text-white/70">Resumen operativo de EPSA Motor.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[["leads", "/admin/leads", "Leads"], ["disponibilidad", "/admin/disponibilidad", "Disponibilidad"], ["movimientos", "/admin/movimientos", "Movimientos"], ["compras", "/admin/compras", "Compras"]].filter(([sec]) => puedeVer(sec)).map(([sec, to, t]) => (
            <Link key={sec} to={to} className="rounded-lg bg-white/10 px-3.5 py-2 text-[13.5px] font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/20">{t}</Link>
          ))}
          {children}
        </div>
      </div>
    </section>
  );
}

export default function Resumen() {
  return MODO_REAL ? <ResumenCentral /> : <ResumenEjemplo />;
}

// ---------------------------------------------------------------------------------------------
// Vista de ejemplo (sin base): indicadores comerciales con los datos de este navegador
// ---------------------------------------------------------------------------------------------
function ResumenEjemplo() {
  const { puedeVer } = useAuth();
  const { ventas, leads, unidades, seguimientos, modelos, ubicaciones, equipo, metas, actividad, publicos = [], movimientos = [], separaciones = [] } = useApp();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [sede, setSede] = useState("Todas");
  const [metrica, setMetrica] = useState("cantidad");

  const en = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
  const V = useMemo(() => ventas.filter((v) => en(v.fecha) && (sede === "Todas" || v.sede === sede)), [ventas, desde, hasta, sede]); // eslint-disable-line
  const L = useMemo(() => leads.filter((l) => en(l.fecha) && (sede === "Todas" || l.sede === sede)), [leads, desde, hasta, sede]); // eslint-disable-line
  const U = unidades.filter((u) => sede === "Todas" || u.ubicacion === sede);
  const nombreModelo = (id) => (modelos.find((m) => m.id === id) || publicos.find((m) => m.id === id))?.nombre || id;

  const cerradas = V.filter((v) => ["Pedido registrado", "Entregado"].includes(v.etapa));
  const solicitudes = ventas.filter((v) => v.etapa === "Solicitud web").length;
  const sinAsignar = leads.filter((l) => (l.responsable === "Sin asignar" || !l.responsable) && !["Cerrado ganado", "Perdido"].includes(l.estado)).length;
  const ingresos = cerradas.reduce((s, v) => s + v.total, 0);
  const adelantos = cerradas.reduce((s, v) => s + v.adelanto, 0);
  const ganados = L.filter((l) => l.estado === "Cerrado ganado").length;
  const conv = L.length ? Math.round((ganados / L.length) * 100) : 0;
  const hoy = hoyLocal();
  const pendSeg = seguimientos.filter((s) => !s.hecho);
  const vencidos = pendSeg.filter((s) => s.fecha < hoy).length;
  const disp = U.filter((u) => u.disponibilidad === "Disponible").length;
  const transito = U.filter((u) => !u.ubicacion).length;

  const meses = ultimosMeses(6);
  const porMes = meses.map((m) => {
    const vs = cerradas.filter((v) => v.fecha.startsWith(m.clave));
    return { etiqueta: m.etiqueta, cantidad: vs.length, monto: vs.reduce((s, v) => s + v.total, 0), leads: L.filter((l) => l.fecha.startsWith(m.clave)).length };
  });

  const cuenta = (arr, fn) => { const o = {}; arr.forEach((x) => { const k = fn(x); o[k] = (o[k] || 0) + 1; }); return Object.entries(o).map(([k, v]) => ({ id: k, etiqueta: k, v })).sort((a, b) => b.v - a.v); };
  const ventasModelo = cuenta(cerradas, (v) => nombreModelo(v.modelo)).slice(0, 6);
  const canales = cuenta(L, (l) => l.canal);
  const embudo = ["Nuevo", "En seguimiento", "Cotizado", "Cerrado ganado", "Perdido"].map((e) => ({ etiqueta: e.replace("Cerrado ganado", "Ganado"), v: L.filter((l) => l.estado === e).length }));
  const consultados = cuenta(L, (l) => l.modelo).map((d) => ({ ...d, etiqueta: nombreModelo(d.id) })).slice(0, 6);
  const inventarioPorUbic = cuenta(unidades, (u) => u.ubicacion || "Sin recepción");

  const mesActual = mesLocal();
  const lista = [
    ["Hay sedes activas", ubicaciones.some((u) => u.tipo === "Sede propia" && u.activo), "/admin/ubicaciones"],
    ["Hay modelos publicados", modelos.some((m) => m.estado === "Publicado"), "/admin/modelos"],
    ["Hay vendedores activos", equipo.some((p) => p.rol === "vendedor" && p.activo), "/admin/equipo"],
    ["Inventario cargado", unidades.length > 0, "/admin/inventario"],
    ["Metas del mes registradas", metas.some((m) => m.mes === mesActual), "/admin/metas"],
  ];

  return (
    <div>
      <Bienvenida>
        {import.meta.env.VITE_ROUTER !== "memory" && <button className="rounded-lg px-3.5 py-2 text-[13.5px] font-semibold text-white/80 ring-1 ring-white/25 transition hover:bg-white/10" onClick={() => window.print()}>Imprimir</button>}
      </Bienvenida>

      {/* Filtros */}
      <Card className="mb-6 flex flex-wrap items-end gap-3">
        <div><label className="field-label">Desde</label><input type="date" className="field-input" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div><label className="field-label">Hasta</label><input type="date" className="field-input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div><label className="field-label">Sede</label>
          <select className="field-input" value={sede} onChange={(e) => setSede(e.target.value)}><option>Todas</option>{SEDES_ATENCION.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        {(desde || hasta || sede !== "Todas") && <button className="pb-3 text-[13px] font-semibold text-acento hover:underline" onClick={() => { setDesde(""); setHasta(""); setSede("Todas"); }}>Limpiar filtros</button>}
      </Card>

      {(solicitudes > 0 || sinAsignar > 0) && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {solicitudes > 0 && <Link to="/admin/ventas" className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"><span><b className="cifra text-[18px]">{solicitudes}</b> {solicitudes === 1 ? "solicitud de compra" : "solicitudes de compra"} desde la web por atender</span><span className="text-[13px] font-semibold">Ver en Ventas</span></Link>}
          {sinAsignar > 0 && <Link to="/admin/leads" className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-900 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"><span><b className="cifra text-[18px]">{sinAsignar}</b> {sinAsignar === 1 ? "lead sin asignar" : "leads sin asignar"}</span><span className="text-[13px] font-semibold">Repartir en Leads</span></Link>}
        </div>
      )}

      {/* Sprint 2 · Operación de hoy */}
      {(() => {
        const sepEst = separaciones.filter((x) => x.estado === "Activa").map((x) => estadoVisible(x));
        const items = [
          ["movimientos", "/admin/movimientos", movimientos.filter((m) => m.estado === "En tránsito").length, "en camino entre sedes", "celeste"],
          ["preparacion", "/admin/preparacion", unidades.filter((u) => u.ubicacion && u.disponibilidad !== "Vendida" && u.preparacion !== "Lista para entrega").length, "en preparación", "marino"],
          ["separaciones", "/admin/separaciones", sepEst.filter((e) => e === "Por vencer").length, "separaciones vencen en 2 días", "ambar"],
          ["separaciones", "/admin/separaciones", sepEst.filter((e) => e === "Vencida por liberar").length, "separaciones vencidas por liberar", "rojo"],
          ["disponibilidad", "/admin/disponibilidad", unidades.filter((u) => u.disponibilidad === "Disponible").length, "motos disponibles para vender", "verde"],
        ].filter(([sec, , n], i) => puedeVer(sec) && (n > 0 || i === 4));
        const tono = { celeste: "text-sky-700 dark:text-sky-300", marino: "text-marino dark:text-white", ambar: "text-amber-600", rojo: "text-acento", verde: "text-emerald-600" };
        return items.length > 0 && (
          <Card className="mb-6" data-operacion-hoy>
            <h2 className="mb-3 font-bold text-marino dark:text-white">Operación de hoy</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {items.map(([, ruta, n, texto, t]) => (
                <Link key={texto} to={ruta} className="rounded-xl border border-slate-100 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5">
                  <span className={`cifra block font-display text-[2rem] font-bold leading-none ${tono[t]}`}>{n}</span>
                  <span className="mt-1 block text-[13px] text-slate-600 dark:text-white/70">{n === 1 ? texto.replace(/^motos/, "moto").replace(/^separaciones vencen/, "separación vence").replace(/^separaciones vencidas/, "separación vencida") : texto}</span>
                </Link>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat etiqueta="Ventas registradas" valor={cerradas.length} nota={`${V.filter((v) => v.etapa === "Cotización").length} cotizaciones abiertas`} />
        <Stat etiqueta="Ingresos" valor={formatoSoles(ingresos)} nota={`Adelantos: ${formatoSoles(adelantos)}`} tono="verde" />
        <Stat etiqueta="Leads" valor={L.length} nota={`Conversión ${conv}%`} />
        <Stat etiqueta="Seguimientos pendientes" valor={pendSeg.length} nota={vencidos ? `${vencidos} vencidos` : "Al día"} tono={vencidos ? "rojo" : "marino"} />
        <Stat etiqueta="Unidades en inventario" valor={U.length} nota={`${disp} disponibles`} />
        <Stat etiqueta="Por recibir" valor={transito} nota="Identificadas, sin recepción física" tono="ambar" />
        <Stat etiqueta="Modelos publicados" valor={modelos.filter((m) => m.estado === "Publicado").length} nota={`de ${modelos.length} en catálogo`} />
        <Stat etiqueta="Entregas pendientes" valor={cerradas.filter((v) => v.etapa === "Pedido registrado").length} nota="Pedidos por entregar" tono="ambar" />
      </div>

      {/* Gráficos */}
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-marino dark:text-white">Ventas por mes</h2>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-[12.5px] dark:bg-white/10">
              {[["cantidad", "Unidades"], ["monto", "Monto"]].map(([k, l]) => (
                <button key={k} onClick={() => setMetrica(k)} className={`rounded-md px-3 py-1 font-semibold ${metrica === k ? "bg-white text-marino shadow dark:bg-marino-700 dark:text-white" : "text-slate-500"}`}>{l}</button>
              ))}
            </div>
          </div>
          <BarChart datos={porMes} series={[{ clave: metrica, nombre: metrica === "monto" ? "Monto" : "Unidades" }]} formato={metrica === "monto" ? formatoSoles : (v) => v} />
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Ventas por modelo</h2>
          {ventasModelo.length ? <Donut datos={ventasModelo} tam={170} /> : <p className="py-8 text-center text-slate-400">Sin ventas en este periodo.</p>}
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Leads por mes</h2>
          <LineChart ancho={380} alto={230} datos={porMes.map((m) => ({ etiqueta: m.etiqueta, v: m.leads }))} />
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Embudo de leads</h2>
          <BarChart datos={embudo.map((e) => ({ etiqueta: e.etiqueta.slice(0, 9), v: e.v }))} series={[{ clave: "v", nombre: "Leads" }]} ancho={380} alto={230} />
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-marino dark:text-white">Modelos más consultados</h2><Link to="/admin/leads" className="text-[12.5px] font-semibold text-marino-700 hover:underline dark:text-white/70">Ver leads →</Link></div>
          <RankingBarras datos={consultados} />
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Leads por canal</h2>
          <Donut datos={canales} tam={160} />
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Inventario por ubicación</h2>
          <Donut datos={inventarioPorUbic} tam={160} />
        </Card>
        <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Puesta en marcha comercial</h2>
          <ul className="space-y-2.5">
            {lista.map(([t, ok, to]) => (
              <li key={t}><Link to={to} className="flex items-center gap-3 rounded-lg p-1.5 text-[14px] hover:bg-slate-50 dark:hover:bg-white/5">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{ok ? "✓" : "!"}</span>{t}
              </Link></li>
            ))}
          </ul>
        </Card>
        <Card className="xl:col-span-3">
          <h2 className="mb-3 font-bold text-marino dark:text-white">Actividad reciente</h2>
          {actividad.length === 0 ? <p className="text-[13.5px] text-slate-400">Aún no hay movimientos. Lo que hagas en el panel (publicar un modelo, registrar un lead, editar una sede…) aparecerá aquí.</p> : (
            <ul className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
              {actividad.slice(0, 8).map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{a.detalle}</span><span className="text-slate-400">{new Date(a.fecha).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: ZONA_LIMA })} · {a.quien}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Con la base conectada: solo datos reales de la API (cada bloque avisa si aún no hay datos)
// ---------------------------------------------------------------------------------------------
const ABIERTOS = ["Nuevo", "Contactado", "En seguimiento"];
const cuentaPor = (lista, fn) => Object.entries(lista.reduce((o, x) => { const k = fn(x) || "Sin dato"; o[k] = (o[k] || 0) + 1; return o; }, {}))
  .map(([k, v]) => ({ id: k, etiqueta: k, v })).sort((a, b) => b.v - a.v);
const SinDatos = ({ texto = "Sin datos todavía." }) => <p className="py-8 text-center text-[13.5px] text-slate-400">{texto}</p>;

function ResumenCentral() {
  const { puedeVer, puede } = useAuth();
  const { publicos = [], catalogo } = useApp();
  const verMotos = puedeVer("inventario") || puedeVer("disponibilidad");
  const inventario = useConsultaCentral(() => inventarioApi(), [], { activo: verMotos, clave: "inventario::" });
  const leadsC = useConsultaCentral(() => leadsCentralApi({ limite: 200 }), [], { activo: puedeVer("leads"), clave: "leads" });
  const [compras, setCompras] = useState(null);
  useEffect(() => {
    if (!puede("compras.registrar") || !puedeVer("compras")) return;
    api.listarCompras(100, 0).then((r) => setCompras(r.data || [])).catch(() => setCompras(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unidades = inventario.data?.unidades || [];
  const leads = leadsC.data?.leads || [];
  const libres = unidades.filter((u) => u.comercial === "Libre");
  const transito = unidades.filter((u) => u.movimiento_activo?.estado === "En transito");
  const listas = unidades.filter((u) => u.preparacion?.lista_para_entrega);
  const sinUbicacion = unidades.filter((u) => !u.ubicacion);
  const porUbicacion = cuentaPor(unidades, (u) => (u.movimiento_activo?.estado === "En transito" ? "En tránsito" : u.ubicacion?.nomubi || "Sin ubicación"));
  const libresPorModelo = cuentaPor(libres, (u) => u.nommod).slice(0, 6);
  const leadsPorEstado = ["Nuevo", "Contactado", "En seguimiento", "Cerrado", "Convertido"].map((e) => ({ etiqueta: e.replace("En seguimiento", "Seguim."), v: leads.filter((l) => l.estlea === e).length }));
  const leadsPorCanal = cuentaPor(leads, (l) => l.canlea);
  const hayInventario = Boolean(inventario.data);
  const hayLeads = Boolean(leadsC.data);
  // Solo se muestran los bloques cuya consulta ya existe en el servidor
  const motosOk = verMotos && !sinApi(inventario);
  const leadsOk = puedeVer("leads") && !sinApi(leadsC);
  const valor = (hay, n) => (hay ? n : "—");

  return (
    <div>
      <Bienvenida />
      {(inventario.data || leadsC.data) && <div className="mb-4 flex flex-wrap items-center justify-end gap-2"><BarraActualizacion consulta={inventario.data ? inventario : leadsC} /></div>}

      {/* Indicadores reales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6" data-resumen-real>
        {motosOk && <Stat etiqueta="Motos en inventario" valor={valor(hayInventario, unidades.length)} nota={hayInventario ? `${libres.length} libres para vender` : "Aún sin datos"} />}
        {motosOk && <Stat etiqueta="En tránsito" valor={valor(hayInventario, transito.length)} tono={transito.length ? "ambar" : "marino"} nota="Falta confirmar la llegada" />}
        {motosOk && <Stat etiqueta="Listas para entrega" valor={valor(hayInventario, listas.length)} tono="verde" nota="Preparación terminada" />}
        {leadsOk && <Stat etiqueta="Leads abiertos" valor={valor(hayLeads, leads.filter((l) => ABIERTOS.includes(l.estlea)).length)} nota={hayLeads ? `${leadsC.data.total ?? leads.length} registrados` : "Aún sin datos"} />}
        <Stat etiqueta="Modelos en la web" valor={valor(catalogo?.estado === "listo", publicos.length)} nota={catalogo?.estado === "error" ? "No se pudo leer el catálogo" : "Publicados en el catálogo"} />
        {compras && <Stat etiqueta="Compras por completar" valor={compras.length} tono={compras.length ? "ambar" : "marino"} nota="Esperan su factura" />}
        {motosOk && hayInventario && sinUbicacion.length > 0 && <Stat etiqueta="Sin ubicación" valor={sinUbicacion.length} tono="rojo" nota="Falta registrar dónde están" />}
      </div>

      {/* Gráficos con datos reales */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {motosOk && <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Motos por ubicación</h2>
          {unidades.length ? <Donut datos={porUbicacion} tam={170} /> : <SinDatos />}
        </Card>}
        {motosOk && <Card>
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-bold text-marino dark:text-white">Libres por modelo</h2>{puedeVer("disponibilidad") && <Link to="/admin/disponibilidad" className="text-[12.5px] font-semibold text-marino-700 hover:underline dark:text-white/70">Ver disponibilidad</Link>}</div>
          {libresPorModelo.length ? <RankingBarras datos={libresPorModelo} /> : <SinDatos />}
        </Card>}
        {leadsOk && <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Leads por estado</h2>
          {leads.length ? <BarChart datos={leadsPorEstado} series={[{ clave: "v", nombre: "Leads" }]} ancho={380} alto={220} /> : <SinDatos />}
        </Card>}
        {leadsOk && <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Leads por canal</h2>
          {leads.length ? <Donut datos={leadsPorCanal} tam={160} /> : <SinDatos />}
        </Card>}
        {motosOk && <Card>
          <h2 className="mb-3 font-bold text-marino dark:text-white">Para revisar hoy</h2>
          {!hayInventario ? <SinDatos /> : (
            <ul className="space-y-2.5 text-[14px]">
              {[["En tránsito, por confirmar llegada", transito.length, "/admin/movimientos"],
                ["Sin ubicación registrada", sinUbicacion.length, "/admin/movimientos"],
                ["Listas para entregar", listas.length, "/admin/preparacion"]].map(([t, n, to]) => (
                <li key={t}><Link to={to} className="flex items-center justify-between gap-3 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-white/5"><span>{t}</span><b className={`cifra ${n ? "text-marino dark:text-white" : "text-slate-400"}`}>{n}</b></Link></li>
              ))}
            </ul>
          )}
        </Card>}
      </div>
    </div>
  );
}
