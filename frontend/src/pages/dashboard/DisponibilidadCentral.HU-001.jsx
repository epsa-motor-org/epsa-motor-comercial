// HU-001 · Consultar disponibilidad compartida (base central)
// La misma lectura para gerente, administradora y vendedores: ubicación, modelo, color, techo, preparación y
// situación comercial, cada una por separado. Sin clientes, costos ni boletas. La ubicación se filtra en el servidor
// y el modelo aquí (con la lista de modelos que tienen motos); la vista se actualiza sola, con «Actualizar» y al volver
// a la pestaña. HU-005: desde aquí se separa una moto libre (sin mostrar clientes en esta vista).
// HU-006: también se registra la venta de una moto libre o separada (la venta convierte la separación).
import { useEffect, useMemo, useState } from "react";
import { Link } from "../../components/dashboard/LinkPanel";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { COLORES } from "../../data/mockData";
import { inventarioApi, useConsultaCentral } from "../../servicios/central";
import { sePuedeSeparar } from "../../servicios/separacionCentral";
import SepararMotoCentral from "../../components/dashboard/SepararCentral";
import VenderMotoCentral from "../../components/dashboard/VenderCentral";
import { sePuedeVender } from "../../servicios/ventaCentral";
import { ETAPAS_FILTRO_CENTRAL as ETAPAS_FILTRO, FILTRO_INICIAL, GRUPOS_LUGAR_API, TONO_COMERCIAL, contar, filtrarUnidades, modelosDeUnidades, techoDe, ubicacionDe } from "../../servicios/inventarioCentral";
import ModeloImg from "../../components/ModeloImg";
import MotoIllustration from "../../components/MotoIllustration";
import { Card, PageHeader, Stat, Tabla, btnMini } from "../../components/ui";
import { ColorPunto, EstadoConexion, Pestanas, Pill } from "../../components/dashboard/Sprint2";
import { AvisoConexion, nombreUnidad, sinApi, BarraActualizacion, ColorUnidad, PillComercial, PillPreparacion, TextoTecho, TextoUbicacion, capital } from "../../components/dashboard/Central";

const CLAVE_FILTROS = "epsa-filtros-disponibilidad";
const SERVIDOR_INICIAL = { codubi: "", codmod: "" };
function leerFiltros() {
  try { const g = JSON.parse(sessionStorage.getItem(CLAVE_FILTROS) || "null"); if (g) return g; } catch {}
  return { servidor: SERVIDOR_INICIAL, f: FILTRO_INICIAL, vista: "modelo" };
}

// Texto de la situación comercial con su cantidad (libre, no disponible, separada o vendida)
// HU-005 · Botón principal para separar (se distingue de «Ver ficha»)
const btnSeparar = "rounded-md bg-marino-700 px-3 py-1 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-marino focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino-700 dark:bg-white dark:text-marino dark:hover:bg-white/90";
// HU-006 · Botón para registrar la venta (secundario: se distingue de «Separar»)
const btnVender = "rounded-md border border-emerald-600 px-3 py-1 text-[12.5px] font-semibold text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-500/10";
const textoComercial = (c, k) => ({ Libre: k === 1 ? "libre" : "libres", "No disponible": k === 1 ? "no disponible" : "no disponibles", Separada: k === 1 ? "separada" : "separadas", Vendida: k === 1 ? "vendida" : "vendidas" }[c] || String(c).toLowerCase());

export default function DisponibilidadCentral() {
  const { publicos = [] } = useApp();
  const { puede } = useAuth();
  const separa = puede("separaciones.registrar");
  const [separar, setSeparar] = useState(null);
  const [vender, setVender] = useState(null);
  const guardado = useMemo(leerFiltros, []);
  const [servidor, setServidor] = useState({ ...SERVIDOR_INICIAL, ...guardado.servidor });
  const [f, setF] = useState({ ...FILTRO_INICIAL, ...guardado.f });
  const [vista, setVista] = useState(guardado.vista || "modelo");
  const [abierto, setAbierto] = useState({});
  useEffect(() => { try { sessionStorage.setItem(CLAVE_FILTROS, JSON.stringify({ servidor, f, vista })); } catch {} }, [servidor, f, vista]);

  // Lectura central: la ubicación la filtra el servidor; el modelo se filtra aquí, para que la lista de modelos
  // muestre todos los que tienen motos en esa ubicación y se pueda combinar con los demás filtros
  const consulta = useConsultaCentral(() => inventarioApi({ codubi: servidor.codubi }), [servidor.codubi], { clave: `inventario:${servidor.codubi || ""}:` });
  const datos = consulta.data;
  const todas = useMemo(() => datos?.unidades || [], [datos]);
  const unidades = useMemo(() => (servidor.codmod ? todas.filter((u) => String(u.codmod) === String(servidor.codmod)) : todas), [todas, servidor.codmod]);
  const lista = useMemo(() => filtrarUnidades(unidades, f), [unidades, f]);
  const ubicaciones = datos?.ubicaciones || [];
  // Cantidad por modelo sin contar las vendidas (igual que el indicador «Unidades»)
  const modelos = useMemo(() => modelosDeUnidades(todas, servidor.codmod, (u) => u.comercial !== "Vendida"), [todas, servidor.codmod]);
  const provisionales = servidor.codubi ? [] : datos?.provisionales || [];

  const cambiar = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const limpiar = () => { setServidor(SERVIDOR_INICIAL); setF(FILTRO_INICIAL); };
  const hayFiltro = Boolean(servidor.codubi || servidor.codmod || f.color || f.techo || f.prep || f.q || f.comercial !== FILTRO_INICIAL.comercial);
  const nombreLugar = ubicaciones.find((l) => l.codubi === servidor.codubi)?.nomubi;
  const nombreModelo = modelos.find((m) => m.codmod === servidor.codmod)?.nommod;
  const filtrosActivos = [
    nombreLugar && `Ubicación: ${nombreLugar}`, nombreModelo && `Modelo: ${nombreModelo}`, f.prep && `Preparación: ${f.prep}`,
    f.comercial === "" ? "Incluye vendidas" : f.comercial !== "activas" && `Situación: ${f.comercial}`,
    f.color && `Color: ${f.color}`, f.techo && { sin: "Sin techo", con: "Con techo" }[f.techo], f.q && `Búsqueda: «${f.q.trim()}»`,
  ].filter(Boolean);
  const colores = [...new Set([...COLORES, ...unidades.map((u) => capital(u.coluni)).filter(Boolean)])];
  const modeloWeb = (codmod) => publicos.find((m) => String(m.codmodApi || "") === String(codmod));
  const n = (fn) => lista.filter(fn).length;
  const sinProvisionales = provisionales.reduce((a, p) => a + (Number(p.cantidad) || 0), 0);

  // Grupos por modelo
  const grupos = useMemo(() => Object.values(lista.reduce((o, u) => { (o[u.codmod] ||= { codmod: u.codmod, nommod: u.nommod, us: [] }).us.push(u); return o; }, {}))
    .sort((a, b) => b.us.filter((u) => u.comercial === "Libre").length - a.us.filter((u) => u.comercial === "Libre").length || a.nommod.localeCompare(b.nommod)), [lista]);

  // Una moto: motor, color, situación comercial, preparación, ubicación y techo
  const filaUnidad = (u) => (
    <li key={u.coduni} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5" data-unidad={u.coduni} data-comercial={u.comercial}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
          <Link to={`/admin/inventario/${u.coduni}`} className="font-bold text-marino hover:underline dark:text-white">{nombreUnidad(u)}</Link>
          <span className="text-slate-500"><ColorUnidad color={u.coluni} /></span>
          <PillComercial comercial={u.comercial} />
          <PillPreparacion preparacion={u.preparacion} />
        </p>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          {(() => { const x = ubicacionDe(u); return <span className={x.transito ? "font-semibold text-sky-700 dark:text-sky-300" : x.sin ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>{x.texto}{x.programado ? `, ${x.detalle.toLowerCase()}` : ""}</span>; })()}
          {", "}{(() => { const c = techoDe(u.preparacion).config; return c === "Por definir" ? "techo por definir" : c.toLowerCase(); })()}, chasis {u.chauni}
        </p>
      </div>
      <span className="flex shrink-0 gap-2">
        {separa && sePuedeSeparar(u) && <button type="button" className={btnSeparar} onClick={() => setSeparar(u)} data-separar={u.coduni}>Separar</button>}
        {separa && sePuedeVender(u) && <button type="button" className={btnVender} onClick={() => setVender(u)} data-vender={u.coduni}>Vender</button>}
        <Link className={btnMini} to={`/admin/inventario/${u.coduni}`}>Ver ficha</Link>
      </span>
    </li>
  );

  // Si el servidor todavía no tiene esta consulta, se muestra solo el aviso (sin cifras en cero ni filtros vacíos)
  if (sinApi(consulta)) return (
    <div>
      <PageHeader titulo="Disponibilidad" subtitulo="Inventario central compartido: gerencia, administración y vendedores ven las mismas unidades, con su ubicación, preparación y situación comercial por separado." />
      <AvisoConexion consulta={consulta} que="el inventario central" />
    </div>
  );

  return (
    <div>
      <PageHeader titulo="Disponibilidad" subtitulo="Inventario central compartido: gerencia, administración y vendedores ven las mismas unidades, con su ubicación, preparación y situación comercial por separado.">
        <EstadoConexion hu="HU-001" consulta={consulta} />
        <BarraActualizacion consulta={consulta} />
      </PageHeader>
      <AvisoConexion consulta={consulta} que="el inventario central" />

      {/* Indicadores (siguen a los filtros) */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4" data-indicadores>
        <Stat etiqueta="Unidades" valor={lista.length} nota={hayFiltro ? "Con estos filtros" : "Identificadas, sin contar vendidas"} />
        <Stat etiqueta="Libres para vender" valor={n((u) => u.comercial === "Libre")} tono="verde" nota="Sin separación ni venta" />
        <Stat etiqueta="Listas para entrega" valor={n((u) => u.preparacion?.lista_para_entrega)} tono="verde" nota="Preparación terminada" />
        <Stat etiqueta="En traslado" valor={n((u) => u.movimiento_activo)} tono="ambar" nota="En camino o programadas" />
      </div>

      {/* Filtros */}
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div><label className="field-label" htmlFor="disp-lugar">Ubicación</label>
            <select id="disp-lugar" className="field-input" value={servidor.codubi} onChange={(e) => setServidor((s) => ({ ...s, codubi: e.target.value }))}>
              <option value="">Todas</option>
              {GRUPOS_LUGAR_API.map((g) => { const ls = ubicaciones.filter((l) => l.tipubi === g.tipo); return ls.length ? <optgroup key={g.tipo} label={g.titulo}>{ls.map((l) => <option key={l.codubi} value={l.codubi}>{l.nomubi}{l.estubi ? "" : " (inactiva)"}</option>)}</optgroup> : null; })}
            </select></div>
          <div><label className="field-label" htmlFor="disp-modelo">Modelo</label>
            <select id="disp-modelo" className="field-input" value={servidor.codmod} onChange={(e) => setServidor((s) => ({ ...s, codmod: e.target.value }))}>
              <option value="">Todos los modelos</option>{modelos.map((m) => <option key={m.codmod} value={m.codmod}>{m.nommod} ({m.n})</option>)}
            </select></div>
          <div><label className="field-label" htmlFor="disp-prep">Preparación</label>
            <select id="disp-prep" className="field-input" value={f.prep} onChange={(e) => cambiar("prep", e.target.value)}><option value="">Todas las etapas</option>{ETAPAS_FILTRO.map((e) => <option key={e}>{e}</option>)}</select></div>
          <div><label className="field-label" htmlFor="disp-comercial">Situación comercial</label>
            <select id="disp-comercial" className="field-input" value={f.comercial} onChange={(e) => cambiar("comercial", e.target.value)}>
              <option value="activas">Libres y separadas</option><option value="Libre">Solo libres</option><option value="Separada">Solo separadas</option><option value="Vendida">Solo vendidas</option><option value="">Todas, con vendidas</option>
            </select></div>
          <div><label className="field-label" htmlFor="disp-techo">Techo</label>
            <select id="disp-techo" className="field-input" value={f.techo} onChange={(e) => cambiar("techo", e.target.value)}><option value="">Con o sin techo</option><option value="sin">Sin techo</option><option value="con">Con techo</option></select></div>
          <div><label className="field-label" htmlFor="disp-buscar">Buscar</label><input id="disp-buscar" className="field-input" value={f.q} maxLength={40} onChange={(e) => cambiar("q", e.target.value)} placeholder="Motor, chasis o N°" /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Color">
          <span className="text-[13px] font-semibold">Color</span>
          {["", ...colores].map((c) => (
            <button key={c || "todos"} type="button" aria-pressed={f.color === c} onClick={() => cambiar("color", c)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${f.color === c ? "border-marino-700 bg-marino-700 text-white dark:border-white dark:bg-white dark:text-marino" : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-white/15 dark:text-white/70"}`}>
              {c && <ColorPunto color={c} className="h-2.5 w-2.5" />}{c || "Todos"}
            </button>
          ))}
          {hayFiltro && <button className="ml-auto text-[13px] font-semibold text-acento hover:underline" onClick={limpiar} data-limpiar>Limpiar filtros</button>}
        </div>
      </Card>

      {/* Cantidades provisionales: compradas sin identificar, separadas de las unidades */}
      {sinProvisionales > 0 && (
        <div className="mb-5 rounded-xl2 border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-white/15 dark:bg-white/5" data-provisionales>
          <p className="text-[14px] font-semibold text-marino dark:text-white">{sinProvisionales} moto{sinProvisionales === 1 ? "" : "s"} comprada{sinProvisionales === 1 ? "" : "s"} sin identificar</p>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Se cuentan aparte: todavía no tienen motor ni chasis, ni ubicación, y no están listas para entrega. No se suman a las unidades de arriba.</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-[12.5px]">
            {provisionales.map((p) => <li key={`${p.codmod}-${p.color}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-semibold text-marino shadow-sm dark:bg-white/10 dark:text-white"><ColorPunto color={capital(p.color)} className="h-2.5 w-2.5" /><span>{p.nommod}, {capital(p.color)}: <span className="cifra">{p.cantidad}</span>{p.sin_factura ? <span className="font-normal text-slate-400">, sin factura</span> : null}</span></li>)}
          </ul>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Pestanas etiqueta="Ver por" valor={vista} onCambio={setVista} opciones={[{ id: "modelo", label: "Por modelo" }, { id: "lugar", label: "Por ubicación" }, { id: "lista", label: "Lista", n: lista.length }]} />
        <p className="text-[13px] text-slate-500" data-conteo>{consulta.cargando && !datos ? "Cargando…" : `${lista.length} unidad${lista.length === 1 ? "" : "es"}${hayFiltro ? " con estos filtros" : ""}`}</p>
      </div>

      {/* Sin coincidencias: se dice claro y no se muestra stock que no existe */}
      {datos && lista.length === 0 && (
        <div className="rounded-xl2 border-2 border-dashed border-slate-200 px-6 py-10 text-center dark:border-white/10" data-sin-coincidencias role="status">
          <p className="text-[17px] font-bold text-marino dark:text-white">{hayFiltro ? "No hay unidades que coincidan con estos filtros" : "Todavía no hay unidades en el inventario central"}</p>
          {filtrosActivos.length > 0 && <p className="mt-1.5 text-[13.5px] text-slate-500">{filtrosActivos.join(", ")}</p>}
          <p className="mx-auto mt-2 max-w-md text-[13.5px] text-slate-500">{hayFiltro ? "Ninguna unidad registrada cumple esos filtros. Prueba con otra ubicación o modelo." : "Aparecen aquí cuando se identifican motos en Compras o llega una factura de Crosland por correo."}</p>
          {hayFiltro && <button className="btn btn-secondary mt-4 !py-2" onClick={limpiar}>Limpiar filtros</button>}
        </div>
      )}

      {/* Por modelo */}
      {vista === "modelo" && lista.length > 0 && (
        <div className="space-y-3" data-vista="modelo">
          {grupos.map(({ codmod, nommod, us }) => {
            const ver = abierto[codmod];
            const libres = us.filter((u) => u.comercial === "Libre").length;
            const web = modeloWeb(codmod);
            const colorPrincipal = capital(us[0]?.coluni);
            return (
              <Card key={codmod} className="!p-0" data-modelo={codmod}>
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                  <div className="grid h-24 w-full shrink-0 place-items-center overflow-hidden rounded-xl bg-escenario sm:w-36 dark:bg-escenario-oscuro">
                    {web ? <ModeloImg modelo={web} color={web.colores?.includes(colorPrincipal) ? colorPrincipal : undefined} className="h-full w-full object-contain p-2" /> : <MotoIllustration className="h-16 w-24 text-slate-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="font-display text-[1.6rem] font-bold uppercase leading-none tracking-tight text-marino dark:text-white">{nommod}</h2>
                      <p className="text-[13px] text-slate-500"><b className="cifra font-display text-[1.6rem] leading-none text-emerald-600">{libres}</b> libre{libres === 1 ? "" : "s"} de {us.length}</p>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {Object.entries(contar(us, (u) => u.comercial)).map(([c, k]) => <Pill key={c} tono={TONO_COMERCIAL[c]}>{k} {textoComercial(c, k)}</Pill>)}
                      {us.some((u) => u.preparacion?.lista_para_entrega) && <Pill tono="celeste">{us.filter((u) => u.preparacion?.lista_para_entrega).length} lista{us.filter((u) => u.preparacion?.lista_para_entrega).length === 1 ? "" : "s"} para entrega</Pill>}
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
                      <span className="flex flex-wrap items-center gap-2">{Object.entries(contar(us, (u) => capital(u.coluni))).map(([c, k]) => <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold dark:bg-white/10"><ColorPunto color={c} className="h-2.5 w-2.5" />{c} <span className="cifra">{k}</span></span>)}</span>
                      <span className="flex flex-wrap items-center gap-2">
                        {Object.entries(contar(us.filter((u) => u.ubicacion && u.movimiento_activo?.estado !== "En transito"), (u) => u.ubicacion.codubi)).map(([id, k]) => {
                          const l = ubicaciones.find((x) => x.codubi === id);
                          return <button key={id} onClick={() => setServidor((s) => ({ ...s, codubi: id }))} className="rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-marino-700 hover:bg-marino-50 dark:border-white/15 dark:text-white/80" title={`Ver solo ${l?.nomubi || "esa ubicación"}`}>{l?.nomubi || "Ubicación"} <span className="cifra">{k}</span></button>;
                        })}
                        {us.some((u) => u.movimiento_activo?.estado === "En transito") && <span className="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">En camino {us.filter((u) => u.movimiento_activo?.estado === "En transito").length}</span>}
                        {us.some((u) => !u.ubicacion) && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">Sin ubicación {us.filter((u) => !u.ubicacion).length}</span>}
                      </span>
                    </div>
                  </div>
                  <button className="btn btn-secondary shrink-0 !py-2 text-[13.5px]" aria-expanded={!!ver} onClick={() => setAbierto({ ...abierto, [codmod]: !ver })}>{ver ? "Ocultar motos" : `Ver motos (${us.length})`}</button>
                </div>
                {ver && <ul className="divide-y divide-slate-100 border-t border-slate-100 px-4 sm:px-5 dark:divide-white/10 dark:border-white/10">{us.map(filaUnidad)}</ul>}
              </Card>
            );
          })}
        </div>
      )}

      {/* Por ubicación: sedes, almacenes y fibreras, más las que van en camino o no tienen ubicación */}
      {vista === "lugar" && lista.length > 0 && (
        <div className="space-y-6" data-vista="lugar">
          {[...GRUPOS_LUGAR_API.map((g) => ({ ...g, tarjetas: ubicaciones.filter((l) => l.tipubi === g.tipo).map((l) => ({ id: l.codubi, nombre: l.nomubi, us: lista.filter((u) => u.ubicacion?.codubi === l.codubi && u.movimiento_activo?.estado !== "En transito") })) })),
            { tipo: "camino", titulo: "En camino", tarjetas: [{ id: "camino", nombre: "Entre ubicaciones", us: lista.filter((u) => u.movimiento_activo?.estado === "En transito") }] },
            { tipo: "sin", titulo: "Sin ubicación registrada", tarjetas: [{ id: "sin", nombre: "Falta registrar su ubicación inicial", us: lista.filter((u) => !u.ubicacion) }] },
          ].map((g) => {
            const tarjetas = g.tarjetas.filter((t) => t.us.length);
            if (!tarjetas.length) return null;
            return (
              <section key={g.tipo}>
                <h2 className="mb-2.5 text-[14px] font-bold text-marino dark:text-white">{g.titulo}</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {tarjetas.map(({ id, nombre, us }) => (
                    <Card key={id} data-lugar={nombre}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-[16px] font-bold text-marino dark:text-white">{nombre}</h3>
                        <span className="cifra text-[13px] text-slate-500">{us.length} unidad{us.length === 1 ? "" : "es"}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(contar(us, (u) => u.comercial)).map(([c, k]) => <Pill key={c} tono={TONO_COMERCIAL[c]}>{k} {textoComercial(c, k)}</Pill>)}</div>
                      <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/10">
                        {Object.entries(contar(us, (u) => u.codmod)).sort((a, b) => b[1] - a[1]).map(([codmod, k]) => {
                          const del = us.filter((u) => u.codmod === codmod);
                          const clave = `${id}-${codmod}`;
                          return (
                            <li key={codmod} className="py-2">
                              <button className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={!!abierto[clave]} onClick={() => setAbierto({ ...abierto, [clave]: !abierto[clave] })}>
                                <span className="min-w-0"><span className="block truncate font-semibold text-marino dark:text-white">{del[0].nommod}</span><span className="flex flex-wrap gap-2 text-[12px] text-slate-500">{Object.entries(contar(del, (u) => capital(u.coluni))).map(([c, j]) => <span key={c} className="inline-flex items-center gap-1"><ColorPunto color={c} className="h-2 w-2" />{c} {j}</span>)}</span></span>
                                <span className="cifra shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[13px] font-bold text-marino dark:bg-white/10 dark:text-white">{k}</span>
                              </button>
                              {abierto[clave] && <ul className="mt-1 divide-y divide-slate-100 rounded-lg bg-slate-50 px-3 dark:divide-white/10 dark:bg-white/5">{del.map(filaUnidad)}</ul>}
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Lista */}
      {vista === "lista" && lista.length > 0 && (
        <Tabla columnas={["Moto", "Modelo", "Color", "Ubicación", "Techo", "Preparación", "Situación comercial", ""]}>
          {lista.map((u) => (
            <tr key={u.coduni} data-unidad={u.coduni} data-comercial={u.comercial} className="align-top">
              <td className="px-4 py-3"><Link to={`/admin/inventario/${u.coduni}`} className="font-semibold text-marino hover:underline dark:text-white">{nombreUnidad(u)}</Link>{u.chauni && <span className="block text-[12px] text-slate-400">chasis {u.chauni}</span>}</td>
              <td className="px-4 py-3">{u.nommod}</td>
              <td className="px-4 py-3"><ColorUnidad color={u.coluni} /></td>
              <td className="px-4 py-3"><TextoUbicacion unidad={u} /></td>
              <td className="px-4 py-3"><TextoTecho preparacion={u.preparacion} /></td>
              <td className="px-4 py-3"><PillPreparacion preparacion={u.preparacion} /></td>
              <td className="px-4 py-3"><PillComercial comercial={u.comercial} /></td>
              <td className="px-4 py-3"><span className="flex gap-2">{separa && sePuedeSeparar(u) && <button type="button" className={btnSeparar} onClick={() => setSeparar(u)} data-separar={u.coduni}>Separar</button>}{separa && sePuedeVender(u) && <button type="button" className={btnVender} onClick={() => setVender(u)} data-vender={u.coduni}>Vender</button>}<Link className={btnMini} to={`/admin/inventario/${u.coduni}`}>Ficha</Link></span></td>
            </tr>
          ))}
        </Tabla>
      )}
      <p className="mt-4 text-[12.5px] text-slate-400">Ubicación, preparación y situación comercial se registran por separado. Toda moto libre se puede separar o vender con o sin techo. La decisión de techo del comprador no cambia la configuración ni la preparación de la moto: su instalación se programa desde la ficha.</p>
      {separar && <SepararMotoCentral unidad={separar} onClose={() => setSeparar(null)} onHecho={() => consulta.refrescar(true)} onConflicto={() => consulta.refrescar(true)} />}
      {vender && <VenderMotoCentral unidad={vender} onClose={() => setVender(null)} onHecho={() => consulta.refrescar(true)} onConflicto={() => consulta.refrescar(true)} />}
    </div>
  );
}
