// HU-004 · Ficha de la unidad (base central) · HU-001, HU-003 y HU-033
// Ubicación, preparación y situación comercial se muestran por separado. Gerente y administradora registran
// movimientos y avances; el vendedor solo consulta. La ficha se actualiza sola.
// HU-005: los tres roles comerciales separan la moto desde aquí y ven su separación activa.
// HU-006: también registran su venta (directa o desde la separación) y ven la venta registrada.
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { useAuth } from "../../context/AuthContext";
import { MAX_DETALLE_TECHO, TIPOS_TECHO } from "../../data/mockData";
import * as api from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { unidadCentralApi, useConsultaCentral } from "../../servicios/central";
import { preparacionDe, techoDe, ubicacionDe } from "../../servicios/inventarioCentral";
import { Aviso, Campo, Card, PageHeader, useConfirm, useToast } from "../../components/ui";
import { AvisoConexion, BarraActualizacion, PillComercial, PillPreparacion, capital } from "../../components/dashboard/Central";
import MovimientosUnidad from "../../components/dashboard/MovimientosUnidad";
import { PreparacionUnidadCard } from "../../components/dashboard/PreparacionUnidad";
import SepararMotoCentral, { SeparacionActivaCard } from "../../components/dashboard/SepararCentral";
import { sePuedeSeparar } from "../../servicios/separacionCentral";
import VenderMotoCentral, { VentaCard } from "../../components/dashboard/VenderCentral";
import { sePuedeVender } from "../../servicios/ventaCentral";
const DESCRIPCION_TECHO = {
  "Sin techo": "La unidad no lleva techo instalado.",
  Lona: "Techo de lona. No necesita proveedor externo.",
  "Techo clásico de fibra": "Fibra fabricada por EPSA Motor. No necesita proveedor externo.",
  "Techo de fibra deportiva": "Fibra deportiva hecha por FIVESA, JAVICAR o FIBRAT.",
};
const limpiar = (t) => String(t || "").trim().replace(/\s+/g, " ");

export default function FichaCentralRuta() {
  const { id } = useParams();
  return <FichaCentral key={id} id={id} />;
}

function FichaCentral({ id }) {
  const { puede } = useAuth();
  const gestiona = puede("unidades.gestionar");
  const separa = puede("separaciones.registrar");
  const [separando, setSeparando] = useState(false);
  const [vendiendo, setVendiendo] = useState(false);
  const { state } = useLocation();
  const valido = /^[1-9]\d{0,18}$/.test(String(id));
  const consulta = useConsultaCentral(() => unidadCentralApi(id), [id], { activo: valido, clave: `unidad:${id}` });
  // Si se llegó desde la compra, se suman el motor y el chasis (el inventario central no los envía)
  const desdeCompra = state?.unidad?.coduni === String(id) ? state.unidad : null;
  const u = consulta.data && desdeCompra ? { ...consulta.data, nummotuni: consulta.data.nummotuni || desdeCompra.nummotuni || "", chauni: consulta.data.chauni || desdeCompra.chauni || "" } : consulta.data;
  const [ubicaciones, setUbicaciones] = useState([]);
  useEffect(() => {
    if (!gestiona) return;
    api.listarUbicaciones().then((r) => setUbicaciones((r.data || []).map((l) => ({ codubi: String(l.codubi), nomubi: l.nomubi, tipubi: l.tipubi, estubi: !!l.estubi })))).catch(() => setUbicaciones([]));
  }, [gestiona]);
  const recargar = () => consulta.refrescar(true);

  if (!valido || (consulta.error?.status === 404 && !consulta.error?.detalle?.sinRuta && !u)) {
    return <div className="space-y-3"><Aviso tipo="error">No encontramos la unidad {id} en el inventario central.</Aviso><Link className="btn btn-secondary" to="/admin/inventario">Volver al inventario</Link></div>;
  }
  if (!u && consulta.error?.detalle?.sinRuta) {
    // Mientras la ficha central no esté publicada, se muestra lo que sí tiene rutas: movimientos (HU-003) y techo (HU-004)
    const r = state?.unidad?.coduni === String(id) ? state.unidad : null;
    const unidad = { coduni: String(id), preparacion: null, ...r };
    return (
      <div>
        <PageHeader titulo={r?.nommod ? `${r.nommod} · motor ${r.nummotuni}` : `Unidad N° ${id}`} subtitulo={r ? `${capital(r.coluni)} · chasis ${r.chauni} · unidad N° ${id}` : "Ubicación, movimientos y configuración de techo de la unidad."}>
          <Link to={r?.codcom ? `/admin/compras/${r.codcom}` : "/admin/compras"} className="btn btn-secondary !py-2.5">{r?.codcom ? `Compra N° ${r.codcom}` : "Compras"}</Link>
        </PageHeader>
        <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
          <MovimientosUnidad unidad={unidad} gestiona={gestiona} ubicaciones={ubicaciones} />
          <ConfigTecho unidad={unidad} gestiona={gestiona} onGuardado={() => {}} />
        </div>
      </div>
    );
  }
  if (!u) {
    return <div><AvisoConexion consulta={consulta} que="la ficha de la unidad" />{!consulta.error && <p className="py-10 text-center text-slate-400">Cargando la ficha…</p>}</div>;
  }

  const x = ubicacionDe(u);
  const p = u.preparacion;
  const t = techoDe(p);
  const prep = preparacionDe(p);
  const textoSituacion = { Libre: "Libre para vender, con o sin techo.", "No disponible": "Todavía no está a la venta.", Separada: "Tiene una separación activa.", Vendida: "Vendida, pendiente de entrega." }[u.comercial] || "";

  // Inventario central (API de Michelle): ubicación, techo, preparación y situación tal como están en la base,
  // con la preparación por etapas (HU-033), los movimientos (HU-003) y la configuración de techo (HU-004).
  return (
    <div>
      <PageHeader titulo={`${u.nommod}${u.nummotuni ? ` · motor ${u.nummotuni}` : ""}`} subtitulo={`${capital(u.coluni) || "Sin color"}${u.chauni ? ` · chasis ${u.chauni}` : ""} · unidad N° ${u.coduni}`}>
        <BarraActualizacion consulta={consulta} />
        <BotonVolver />
      </PageHeader>
      <AvisoConexion consulta={consulta} que="la ficha de la unidad" />
      <div className="mb-6 grid gap-4 md:grid-cols-3" data-ejes>
        <Card data-eje="ubicacion"><p className="text-[12px] font-semibold text-slate-400">Ubicación registrada</p><p className={`mt-1 text-[1.25rem] font-bold ${x.transito ? "text-sky-700 dark:text-sky-300" : x.sin ? "text-amber-700 dark:text-amber-300" : "text-marino dark:text-white"}`}>{x.texto}</p><p className="text-[12.5px] text-slate-500">{x.detalle}</p></Card>
        <Card data-eje="preparacion"><p className="text-[12px] font-semibold text-slate-400">Preparación</p><div className="mt-1.5"><PillPreparacion preparacion={p} /></div><p className="mt-1.5 text-[12.5px] text-slate-500">{prep.nota || `Techo: ${t.config}`}</p></Card>
        <Card data-eje="comercial"><p className="text-[12px] font-semibold text-slate-400">Situación comercial</p><div className="mt-1.5"><PillComercial comercial={u.comercial} /></div><p className="mt-1.5 text-[12.5px] text-slate-500">{textoSituacion}</p>{separa && (sePuedeSeparar(u) || (sePuedeVender(u) && u.comercial === "Libre")) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sePuedeSeparar(u) && <button className="btn btn-primary !py-2 text-[13px]" onClick={() => setSeparando(true)} data-separar-ficha>Separar esta moto</button>}
            {sePuedeVender(u) && u.comercial === "Libre" && <button className="btn btn-secondary !py-2 text-[13px]" onClick={() => setVendiendo(true)} data-vender-ficha>Registrar venta</button>}
          </div>
        )}</Card>
      </div>
      {u.comercial === "Separada" && <div className="mb-6"><SeparacionActivaCard unidad={u} puedeTecho={separa} onCambio={recargar} onVender={separa && sePuedeVender(u) ? () => setVendiendo(true) : undefined} /></div>}
      {u.comercial === "Vendida" && <div className="mb-6"><VentaCard unidad={u} puedeEditar={separa} onCambio={recargar} /></div>}
      <div className="mb-6"><PreparacionUnidadCard unidad={u} gestiona={gestiona} onCambio={recargar} /></div>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <MovimientosUnidad unidad={u} gestiona={gestiona} ubicaciones={ubicaciones} onCambio={recargar} />
        <ConfigTecho unidad={u} gestiona={gestiona} onGuardado={recargar} />
      </div>
      {separando && <SepararMotoCentral unidad={u} onClose={() => setSeparando(false)} onHecho={recargar} onConflicto={recargar} />}
      {vendiendo && <VenderMotoCentral unidad={u} onClose={() => setVendiendo(false)} onHecho={recargar} onConflicto={recargar} />}
    </div>
  );
}

// Volver a la lista de donde se abrió la ficha (Inventario o Disponibilidad), con sus filtros tal como estaban.
// Si la ficha se abrió directo (enlace o recarga), lleva al Inventario.
function BotonVolver() {
  const navigate = useNavigate();
  const location = useLocation();
  const volver = () => (location.key !== "default" ? navigate(-1) : navigate("/admin/inventario"));
  return <button type="button" className="btn btn-secondary !py-2.5" onClick={volver} data-volver>Volver a la lista</button>;
}

// HU-004 · Tipo de techo y proveedor (la API de Michelle; el avance de instalación es de HU-033)
function ConfigTecho({ unidad, gestiona, onGuardado }) {
  const toast = useToast(); const confirmar = useConfirm();
  const [cat, setCat] = useState(null); const [errCarga, setErrCarga] = useState("");
  const [f, setF] = useState({ techo: "", proveedor: "", detalle: "" }); const [inicial, setInicial] = useState(null);
  const [err, setErr] = useState({}); const [guardando, setGuardando] = useState(false);
  const [soloLectura, setSoloLectura] = useState(null);
  useEffect(() => {
    if (!gestiona && !unidad.preparacion) {
      // Sin la ficha central, la consulta de techo (HU-004) da la configuración a quien solo consulta
      let vivo = true;
      api.techoUnidadApi(unidad.coduni).then((c) => vivo && setSoloLectura(c.data || {})).catch((e) => vivo && setErrCarga(mensajeError(e)));
      return () => { vivo = false; };
    }
    if (!gestiona) return undefined;
    let vivo = true;
    Promise.all([api.tiposTechoApi(), api.proveedoresTechoApi(), api.techoUnidadApi(unidad.coduni)])
      .then(([tt, pp, c]) => {
        if (!vivo) return;
        setCat({ tipos: tt.data || [], proveedores: pp.data || [] });
        const conf = c.data || {};
        const v = { techo: conf.tipoTecho?.nombre || "", proveedor: conf.proveedor?.nombre || "", detalle: conf.detalle || "" };
        setF(v); setInicial(v);
      })
      .catch((e) => vivo && setErrCarga(mensajeError(e)));
    return () => { vivo = false; };
  }, [gestiona, unidad.coduni]);
  const t = techoDe(unidad.preparacion);

  if (!gestiona) {
    const filas = soloLectura
      ? [["Tipo de techo", soloLectura.tipoTecho?.nombre || "Sin techo"], ["Proveedor", soloLectura.proveedor?.nombre || "No aplica"], ["Detalle", soloLectura.detalle || "Sin detalle"]]
      : [["Tipo de techo", t.config], ["Proveedor", t.proveedor || "No aplica"], ["Instalación", t.avance === "No requiere" ? "No requiere" : t.avance]];
    return (
      <Card>
        <h2 className="text-lg font-bold text-marino dark:text-white">Configuración de techo</h2>
        {errCarga && <div className="mt-3"><Aviso tipo="error">No se pudo cargar el techo: {errCarga}</Aviso></div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {filas.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-marino-50 p-4 dark:bg-white/5"><p className="text-[12px] text-slate-500">{k}</p><p className="font-semibold text-marino dark:text-white">{v}</p></div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-slate-500">Tu rol puede consultar la configuración técnica, pero no cambiarla.</p>
      </Card>
    );
  }
  const orden = (n) => { const i = TIPOS_TECHO.indexOf(n); return i < 0 ? 99 : i; };
  const tipos = cat ? [...cat.tipos].sort((a, b) => orden(a.nomtte) - orden(b.nomtte)) : [];
  const tipo = tipos.find((x) => x.nomtte === f.techo);
  const requiere = Boolean(tipo?.reqprotte);
  const cambio = inicial && (f.techo !== inicial.techo || (requiere && f.proveedor !== inicial.proveedor) || limpiar(requiere ? f.detalle : "") !== limpiar(inicial.detalle));

  async function guardar(e) {
    e.preventDefault();
    if (guardando || !cat) return;
    const x = {};
    const detalle = requiere ? limpiar(f.detalle) : "";
    const prov = requiere ? cat.proveedores.find((pp) => pp.nompro === f.proveedor) : null;
    if (!tipo) x.techo = "Elige un tipo de techo.";
    if (requiere && !f.proveedor) x.proveedor = "Elige el proveedor que hará la fibra deportiva.";
    else if (requiere && !prov) x.proveedor = "Ese proveedor no está habilitado para techos.";
    if ([...detalle].length > MAX_DETALLE_TECHO) x.detalle = `Máximo ${MAX_DETALLE_TECHO} caracteres.`;
    if (unidad.comercial === "Vendida") x.general = "La unidad ya se vendió: su configuración no se modifica.";
    setErr(x); if (Object.keys(x).length) return;
    const avance = t.requiereInstalacion && t.avance !== "Pendiente" ? " El avance de instalación registrado se reinicia a «Pendiente»." : "";
    if (!(await confirmar({ titulo: "¿Guardar la configuración?", texto: `${f.techo}${requiere ? ` con ${f.proveedor}` : ""}${detalle ? `, ${detalle}` : ""}.${avance}`, boton: "Guardar configuración" }))) return;
    setGuardando(true);
    try {
      const r = await api.guardarTechoUnidadApi(unidad.coduni, { codtte: String(tipo.codtte), codpro: prov ? String(prov.codpro) : null, detalle: detalle || null });
      const conf = r.data || {};
      const v = { techo: conf.tipoTecho?.nombre || f.techo, proveedor: conf.proveedor?.nombre || "", detalle: conf.detalle || "" };
      setF(v); setInicial(v);
      toast("Configuración de techo guardada");
      onGuardado?.();
    } catch (er) { setErr({ general: mensajeError(er) }); }
    finally { setGuardando(false); }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-marino dark:text-white">Configuración de techo</h2>
      <p className="text-[13px] text-slate-500">Tipo de techo y proveedor de esta unidad. Su instalación se registra en Preparación.</p>
      {!cat && !errCarga && <p className="mt-4 text-[13px] text-slate-500">Cargando la configuración del techo…</p>}
      {errCarga && <div className="mt-4"><Aviso tipo="error">No se pudo cargar el techo: {errCarga}</Aviso></div>}
      {cat && (
        <form onSubmit={guardar} className="mt-5 space-y-5" noValidate>
          <fieldset>
            <legend className="field-label">Tipo de techo</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {tipos.map((x) => (
                <label key={x.codtte} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${f.techo === x.nomtte ? "border-marino-700 bg-marino-50 text-marino dark:border-white/50 dark:bg-white/10 dark:text-white" : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10"}`}>
                  <input type="radio" name="techo-central" className="sr-only" checked={f.techo === x.nomtte} onChange={() => setF({ ...f, techo: x.nomtte, proveedor: x.reqprotte ? f.proveedor : "", detalle: x.reqprotte ? f.detalle : "" })} />
                  <span className="min-w-0"><span className="block text-[14px] font-semibold text-marino dark:text-white">{x.nomtte}</span><span className="block text-[12px] leading-snug text-slate-500">{DESCRIPCION_TECHO[x.nomtte] || "Tipo de techo registrado en el sistema."}</span></span>
                </label>
              ))}
            </div>
            {err.techo && <p className="mt-1 text-[12px] font-medium text-acento">{err.techo}</p>}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta={requiere ? "Proveedor de la fibra deportiva" : "Proveedor"} error={err.proveedor}>
              <select className="field-input" value={f.proveedor} disabled={!requiere} onChange={(e) => setF({ ...f, proveedor: e.target.value })}>
                <option value="">{requiere ? "Elige el proveedor" : "No aplica"}</option>
                {cat.proveedores.map((pp) => <option key={pp.codpro}>{pp.nompro}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Detalle técnico (opcional)" error={err.detalle} ayuda={requiere ? `${[...limpiar(f.detalle)].length}/${MAX_DETALLE_TECHO}` : "Solo aplica al techo de fibra deportiva."}>
              <input className="field-input" value={requiere ? f.detalle : ""} disabled={!requiere} maxLength={MAX_DETALLE_TECHO + 20} onChange={(e) => setF({ ...f, detalle: e.target.value })} />
            </Campo>
          </div>
          {err.general && <Aviso tipo="error">{err.general}</Aviso>}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={!cambio || guardando}>{guardando ? "Guardando…" : "Guardar configuración"}</button>
            {!cambio && <span className="text-[12.5px] text-slate-400">Sin cambios por guardar.</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
