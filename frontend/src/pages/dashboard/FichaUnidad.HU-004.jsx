// HU-004 · Ficha de la unidad y configuración de techo · Sprint 2: recorrido, ubicación (HU-003) y preparación (HU-033)
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { MAX_DETALLE_TECHO, PASO_PREPARACION, PROVEEDORES_TECHO, TECHO_REQUIERE_PROVEEDOR, TIPOS_TECHO, normalizarTecho } from "../../data/mockData";
import { MODO_REAL } from "../../lib/config";
import * as api from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { Aviso, Campo, Card, PageHeader, useConfirm, useToast } from "../../components/ui";
import { useMovimientos } from "../../servicios/movimientos";
import { nombreTecho, usePreparacion } from "../../servicios/preparacion";
import { recorridoDe } from "../../servicios/recorrido";
import { fechaHora, haceCuanto } from "../../lib/validar";
import { PasosPreparacion, Pill, Recorrido, TONO_MOVIMIENTO, fechaCorta } from "../../components/dashboard/Sprint2";
import { ModalLlegada, ModalRecibir, ModalTraslado } from "../../components/dashboard/MovimientoModales";
import PreparacionModal from "../../components/dashboard/PreparacionModal";

const DESCRIPCION_TECHO = {
  "Sin techo": "La unidad no lleva techo instalado.",
  Lona: "Techo de lona de fábrica. No necesita proveedor externo.",
  "Techo clásico de fibra": "Fibra fabricada por EPSA Motor. No necesita proveedor externo.",
  "Fibra clásica equipada": "Fibra clásica con su equipamiento completo. No necesita proveedor externo.",
  "Techo de fibra deportiva": "Fibra deportiva hecha por un proveedor externo: FIVESA, JAVICAR o FIBRAT.",
};
const limpiar = (t) => String(t || "").trim().replace(/\s+/g, " ");
const DISP = { "No disponible": "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70", Disponible: "bg-emerald-100 text-emerald-700", Separada: "bg-amber-100 text-amber-700", Vendida: "bg-slate-200 text-slate-600" };
const hoy = () => new Date().toLocaleDateString("en-CA");

// Dibujo del techo
function SiluetaTecho({ tipo }) {
  const fibra = TECHO_REQUIERE_PROVEEDOR(tipo);
  return (
    <svg viewBox="0 0 64 36" className="h-10 w-[72px] shrink-0" aria-hidden="true">
      <path d="M8 28h48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".4" />
      <circle cx="16" cy="29" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" opacity=".8" />
      <circle cx="48" cy="29" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" opacity=".8" />
      <path d="M12 24V16l6-4h26l8 6v6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" opacity=".8" />
      {tipo === "Lona" && <path d="M14 12c6-6 30-6 36 0" fill="none" stroke="#c62828" strokeWidth="2.5" strokeDasharray="3 3" />}
      {/fibra/i.test(tipo) && <path d={fibra ? "M12 12l8-7h26l10 8" : "M13 12l7-6h25l8 6"} fill="none" stroke="#c62828" strokeWidth="3.5" strokeLinejoin="round" />}
    </svg>
  );
}

export default function FichaUnidadRuta() {
  const { id } = useParams();
  return <FichaUnidad key={id} id={id} />;
}

// Ficha de la unidad
function FichaUnidad({ id }) {
  const { unidades, modelos, compras, actualizar, movimientos = [], historialPreparacion = [], separaciones = [], clientes = [] } = useApp();
  const mv = useMovimientos();
  const prep = usePreparacion();
  const [modalS2, setModalS2] = useState(null);
  const { puede, user } = useAuth();
  const toast = useToast(); const confirmar = useConfirm();
  const u = unidades.find((x) => x.id === id);
  const gestiona = puede("unidades.gestionar");
  const observa = gestiona || puede("unidades.observar");
  const [f, setF] = useState(() => ({ techo: normalizarTecho(u?.techo, u?.proveedorTecho), proveedor: u?.proveedorTecho || "", detalle: u?.detalleTecho || "" }));
  const [err, setErr] = useState({});
  const [obs, setObs] = useState(""); const [obsErr, setObsErr] = useState("");
  const conectada = Boolean(MODO_REAL && u?.coduni);
  const [cat, setCat] = useState(null);
  const [cargandoApi, setCargandoApi] = useState(conectada);
  const [errApi, setErrApi] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (!conectada) return undefined;
    let vivo = true;
    Promise.all([api.tiposTechoApi(), api.proveedoresTechoApi(), api.techoUnidadApi(u.coduni)])
      .then(([t, p, c]) => {
        if (!vivo) return;
        setCat({ tipos: t.data || [], proveedores: p.data || [] });
        const conf = c.data || {};
        const techo = conf.tipoTecho?.nombre || "Sin techo", proveedor = conf.proveedor?.nombre || "", detalle = conf.detalle || "";
        setF((prev) => ({ ...prev, techo, proveedor, detalle }));
        const antes = normalizarTecho(u.techo, u.proveedorTecho);
        if (antes !== techo || (u.proveedorTecho || "") !== proveedor || (u.detalleTecho || "") !== detalle) {
          const estadoTecho = techo === "Sin techo" ? "" : antes === techo && (u.proveedorTecho || "") === proveedor ? u.estadoTecho : "Pendiente de instalación";
          const retirar = estadoTecho === "Pendiente de instalación" && u.disponibilidad === "Disponible";
          actualizar("unidades", u.id, { techo, proveedorTecho: proveedor, detalleTecho: detalle, estadoTecho, ...(retirar ? { disponibilidad: "No disponible" } : {}),
            historial: [...(u.historial || []), { fecha: hoy(), detalle: `Techo actualizado: ${techo}${proveedor ? ` (${proveedor})` : ""}${retirar ? " · sale de la venta hasta instalarlo" : ""}` }] });
        }
      })
      .catch((e) => vivo && setErrApi(mensajeError(e)))
      .finally(() => vivo && setCargandoApi(false));
    return () => { vivo = false; };
  }, [conectada]); // eslint-disable-line

  if (!u) return <div className="space-y-3"><Aviso tipo="error">No encontramos la unidad {id}. Puede que se haya eliminado.</Aviso><Link className="btn btn-secondary" to="/admin/inventario">Volver al inventario</Link></div>;

  const m = modelos.find((x) => x.id === u.modelo);
  const compra = compras.find((c) => c.codcom === u.codcom);
  const orden = (n) => { const i = TIPOS_TECHO.indexOf(n); return i < 0 ? 99 : i; };
  const tipos = conectada && cat ? [...cat.tipos].sort((a, b) => orden(a.nomtte) - orden(b.nomtte)).map((t) => t.nomtte) : TIPOS_TECHO;
  const requiere = conectada && cat ? Boolean(cat.tipos.find((t) => t.nomtte === f.techo)?.reqprotte) : TECHO_REQUIERE_PROVEEDOR(f.techo);
  const proveedores = conectada && cat ? cat.proveedores.map((p) => p.nompro) : PROVEEDORES_TECHO;
  const techoActual = normalizarTecho(u.techo, u.proveedorTecho);
  const log = (detalle) => [...(u.historial || []), { fecha: hoy(), detalle: `${detalle} · ${user.nombre}` }];
  const cambio = f.techo !== techoActual || (requiere && f.proveedor !== (u.proveedorTecho || "")) || limpiar(f.detalle) !== limpiar(u.detalleTecho);

  // Guardar el techo (PUT /api/unidades/:id/techo)
  async function guardar(e) {
    e.preventDefault();
    if (guardando) return;
    const x = {};
    const detalle = requiere ? limpiar(f.detalle) : "";
    if (!tipos.includes(f.techo)) x.techo = "Elige un tipo de techo.";
    if (requiere && !f.proveedor) x.proveedor = "Elige el proveedor que hará la fibra deportiva.";
    if (requiere && f.proveedor && !proveedores.includes(f.proveedor)) x.proveedor = "Ese proveedor no está habilitado para techos.";
    if (detalle.length > MAX_DETALLE_TECHO) x.detalle = `Máximo ${MAX_DETALLE_TECHO} caracteres.`;
    if (u.disponibilidad === "Vendida") x.general = "La unidad ya se vendió: su configuración no se modifica.";
    if (conectada && !cat) x.general = errApi || "Espera a que cargue la configuración del techo.";
    setErr(x); if (Object.keys(x).length) return;
    const techoCambia = f.techo !== techoActual || (requiere && f.proveedor !== u.proveedorTecho);
    const estado = f.techo === "Sin techo" ? "" : techoCambia ? "Pendiente de instalación" : u.estadoTecho;
    // HU-033: si el techo nuevo queda por instalar, la preparación vuelve a «Pendiente de techo»
    const vuelvePrep = estado === "Pendiente de instalación" && ["En preparación", "Lista para entrega"].includes(u.preparacion);
    const texto = `Techo: ${f.techo}${requiere ? ` (${f.proveedor})` : ""}${estado ? ` · ${estado.toLowerCase()}` : ""}${detalle ? ` · ${detalle}` : ""}${vuelvePrep ? " · preparación: Pendiente de techo" : ""}`;
    if (!(await confirmar({ titulo: "¿Guardar la configuración?", texto: `${u.id}: ${texto}.${techoCambia && u.estadoTecho === "Instalado" ? " El techo anterior figuraba instalado; el nuevo quedará pendiente de instalación." : ""}${estado === "Pendiente de instalación" && u.disponibilidad === "Disponible" ? " La unidad saldrá del stock de la web hasta que se instale el techo y la vuelvas a liberar." : ""}`, boton: "Guardar configuración" }))) return;
    if (conectada) {
      const tipo = cat.tipos.find((t) => t.nomtte === f.techo);
      const prov = requiere ? cat.proveedores.find((p) => p.nompro === f.proveedor) : null;
      setGuardando(true);
      try {
        const r = await api.guardarTechoUnidadApi(u.coduni, { codtte: String(tipo.codtte), codpro: prov ? String(prov.codpro) : null, detalle: detalle || null });
        const conf = r.data || {};
        setF((p) => ({ ...p, techo: conf.tipoTecho?.nombre || f.techo, proveedor: conf.proveedor?.nombre || "", detalle: conf.detalle || "" }));
      } catch (er) { setErr({ general: mensajeError(er) }); toast(mensajeError(er), "error"); return; }
      finally { setGuardando(false); }
    }
    const retirar = estado === "Pendiente de instalación" && u.disponibilidad === "Disponible";
    actualizar("unidades", u.id, { techo: f.techo, proveedorTecho: requiere ? f.proveedor : "", detalleTecho: detalle, estadoTecho: estado, ...(retirar ? { disponibilidad: "No disponible" } : {}), historial: log(`${texto}${retirar ? " · sale de la venta hasta instalar el techo" : ""}`) }, `Techo actualizado en ${u.id}`);
    if (vuelvePrep) prep.cambiarPaso({ ...u, disponibilidad: retirar ? "No disponible" : u.disponibilidad }, "Pendiente de techo", `Techo nuevo por instalar: ${f.techo}`, { forzar: true });
    setF((p) => ({ ...p, detalle }));
    toast("Configuración de techo guardada");
  }

  // Instalación y observaciones
  async function confirmarInstalacion() {
    if (!(await confirmar({ titulo: "Confirmar instalación", texto: `¿${u.proveedorTecho || "El proveedor"} ya instaló el techo ${u.techo} en ${u.id}? Se mostrará como instalado en la consulta de stock.`, boton: "Confirmar instalación" }))) return;
    actualizar("unidades", u.id, { estadoTecho: "Instalado", fechaInstalacion: hoy(), historial: log(`Techo instalado: ${u.techo}${u.proveedorTecho ? ` por ${u.proveedorTecho}` : ""}`) }, `Techo instalado en ${u.id}`);
    if (u.preparacion === "Pendiente de techo") prep.cambiarPaso(u, "En preparación", "Techo instalado", { forzar: true });
    toast(u.preparacion === "Pendiente de techo" ? "Instalación confirmada. La moto pasó a «En preparación»." : "Instalación confirmada");
  }

  function agregarObservacion(e) {
    e.preventDefault();
    const t = limpiar(obs);
    if (t.length < 3 || (t.match(/[\p{L}\d]/gu) || []).length < 3) { setObsErr("Escribe la observación (mínimo 3 letras o números)."); return; }
    if (t.length > 300) { setObsErr("Máximo 300 caracteres."); return; }
    setObsErr("");
    actualizar("unidades", u.id, { observaciones: [...(u.observaciones || []), { fecha: hoy(), autor: user.nombre, texto: t }], historial: log(`Observación comercial: ${t}`) }, `Observación en ${u.id}`);
    setObs(""); toast("Observación agregada. La configuración técnica no cambió.");
  }

  return (
    <div>
      <PageHeader titulo={`${u.id} · ${m?.nombre || u.nombreModelo || u.modelo}`} subtitulo={`${u.color} · motor ${u.motor} · chasis ${u.chasis}`}>
        <Link to="/admin/inventario" className="btn btn-secondary !py-2.5">← Inventario</Link>
      </PageHeader>

      <div className="mb-6 flex flex-wrap gap-2 text-[12.5px]">
        <span className={`rounded-full px-3 py-1 font-semibold ${DISP[u.disponibilidad]}`}>{u.disponibilidad}</span>
        <span className="rounded-full bg-marino-50 px-3 py-1 font-semibold text-marino dark:bg-white/10 dark:text-white">{u.ubicacion || "Sin recepción"}</span>
        <span className="rounded-full bg-marino-50 px-3 py-1 font-semibold text-marino dark:bg-white/10 dark:text-white">{u.preparacion}</span>
        {u.estadoTecho && <span className={`rounded-full px-3 py-1 font-semibold ${u.estadoTecho === "Instalado" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>Techo {u.estadoTecho.toLowerCase()}</span>}
      </div>

      {/* Recorrido de la moto (Sprint 2) */}
      <Card className="mb-6" data-recorrido>
        <h2 className="mb-4 text-lg font-bold text-marino dark:text-white">Recorrido de la moto</h2>
        <Recorrido estaciones={recorridoDe(u, { movimientos, historialPreparacion, separaciones, clientes })} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="min-w-0 space-y-6">
          {/* HU-033 · Preparación */}
          <Card data-card-preparacion>
            {(() => {
              const sig = prep.siguiente(u);
              const motivo = sig ? prep.bloqueo(u, sig) : "";
              const pasos = prep.historialDe(u.id);
              return <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-marino dark:text-white">Preparación</h2>
                    <p className="text-[13px] text-slate-500">{u.ubicacion ? `${PASO_PREPARACION[u.preparacion] || ""}${prep.desdeCuando(u) ? ` Desde ${haceCuanto(prep.desdeCuando(u))}.` : ""}` : "Empieza cuando la moto llegue a una sede."}</p>
                  </div>
                  {gestiona && u.ubicacion && u.disponibilidad !== "Vendida" && (
                    <div className="flex flex-wrap gap-2">
                      {sig && !motivo && <button className="btn btn-primary !py-2 text-[13.5px]" onClick={() => setModalS2({ tipo: "prep", destino: sig })}>Pasar a «{sig}»</button>}
                      <button className="btn btn-secondary !py-2 text-[13.5px]" onClick={() => setModalS2({ tipo: "prep" })}>Elegir paso</button>
                    </div>
                  )}
                </div>
                <div className="mt-4"><PasosPreparacion pasos={prep.PASOS} actual={u.preparacion} /></div>
                {gestiona && sig && motivo && u.disponibilidad !== "Vendida" && <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-300">Para pasar a «{sig}»: {motivo}</p>}
                {pasos.length > 0 && (
                  <ol className="mt-4 space-y-1.5 text-[13px]" aria-label="Historial de preparación">
                    {[...pasos].reverse().slice(0, 5).map((h) => <li key={h.id} className="flex flex-wrap gap-x-2 text-slate-500"><span className="cifra text-slate-400">{fechaHora(h.fecha)}</span><span className="font-semibold text-marino dark:text-white">{h.paso}</span><span>{h.usuario}{h.obs ? `: ${h.obs}` : ""}</span></li>)}
                  </ol>
                )}
              </>;
            })()}
          </Card>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-marino dark:text-white">Configuración de techo</h2>
                <p className="text-[13px] text-slate-500">Tipo de techo y proveedor de esta unidad. No se registran precios ni modelos de fibra no confirmados.</p>
              </div>
              {u.estadoTecho === "Pendiente de instalación" && gestiona && <button className="btn btn-primary !py-2" onClick={confirmarInstalacion}>Confirmar instalación</button>}
            </div>

            {conectada && cargandoApi && <p className="mt-4 text-[13px] text-slate-500" data-techo-cargando>Cargando la configuración del techo…</p>}
            {conectada && errApi && <div className="mt-4"><Aviso tipo="error">No se pudo cargar el techo: {errApi}</Aviso></div>}
            {u.estadoTecho === "Pendiente de instalación" && <div className="mt-4"><Aviso tipo="aviso">El {nombreTecho(u.techo)}{u.proveedorTecho ? ` de ${u.proveedorTecho}` : ""} figura pendiente de instalación.</Aviso></div>}
            {u.estadoTecho === "Instalado" && <div className="mt-4"><Aviso tipo="ok">{nombreTecho(u.techo).replace(/^t/, "T")}{u.proveedorTecho ? ` de ${u.proveedorTecho}` : ""} instalado{u.fechaInstalacion ? ` el ${fechaCorta(u.fechaInstalacion)}` : ""}.</Aviso></div>}

            {/* Formulario del techo */}
            {gestiona ? (
              <form onSubmit={guardar} className="mt-5 space-y-5" noValidate>
                <fieldset>
                  <legend className="field-label">Tipo de techo</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tipos.map((t) => (
                      <label key={t} className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition ${f.techo === t ? "border-marino-700 bg-marino-50 text-marino dark:border-white/50 dark:bg-white/10 dark:text-white" : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10"}`}>
                        <input type="radio" name="techo" className="sr-only" checked={f.techo === t} onChange={() => { const req = conectada && cat ? Boolean(cat.tipos.find((x) => x.nomtte === t)?.reqprotte) : TECHO_REQUIERE_PROVEEDOR(t); setF({ ...f, techo: t, proveedor: req ? f.proveedor : "", detalle: req ? f.detalle : "" }); }} />
                        <SiluetaTecho tipo={t} />
                        <span className="min-w-0"><span className="block text-[14px] font-semibold text-marino dark:text-white">{t}</span><span className="block text-[12px] leading-snug text-slate-500">{DESCRIPCION_TECHO[t] || "Tipo de techo registrado en el sistema."}</span></span>
                      </label>
                    ))}
                  </div>
                  {err.techo && <p className="mt-1 text-[12px] font-medium text-acento">{err.techo}</p>}
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo etiqueta={requiere ? "Proveedor de la fibra deportiva (obligatorio)" : "Proveedor"} error={err.proveedor}>
                    <select id="ficha-proveedor" className="field-input" value={f.proveedor} disabled={!requiere} onChange={(e) => setF({ ...f, proveedor: e.target.value })}>
                      <option value="">{requiere ? "Elige el proveedor" : "No aplica"}</option>
                      {proveedores.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </Campo>
                  <Campo etiqueta={requiere ? "Detalle técnico (opcional)" : "Detalle técnico"} error={err.detalle} ayuda={requiere ? `${limpiar(f.detalle).length}/${MAX_DETALLE_TECHO} caracteres.` : "Solo aplica al techo de fibra deportiva."} className="sm:col-span-2">
                    <input id="ficha-detalle" className="field-input" value={requiere ? f.detalle : ""} disabled={!requiere} maxLength={MAX_DETALLE_TECHO + 20} onChange={(e) => setF({ ...f, detalle: e.target.value })} placeholder={requiere ? "Ej: con portaequipaje, cámara de retroceso" : "No aplica"} />
                  </Campo>
                </div>
                {err.general && <Aviso tipo="error">{err.general}</Aviso>}
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn btn-primary" disabled={!cambio || guardando || (conectada && cargandoApi)}>{guardando ? "Guardando…" : "Guardar configuración"}</button>
                  {!cambio && <span className="text-[12.5px] text-slate-400">Sin cambios por guardar.</span>}
                </div>
              </form>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[["Tipo de techo", conectada ? f.techo : techoActual], ["Proveedor", (conectada ? f.proveedor : u.proveedorTecho) || "No aplica"], ["Preparación", u.preparacion]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-marino-50 p-4 dark:bg-white/5"><p className="text-[12px] text-slate-500">{k}</p><p className="font-semibold text-marino dark:text-white">{v}</p></div>
                ))}
                <p className="text-[12.5px] text-slate-500 sm:col-span-3">Tu rol puede consultar la configuración técnica, pero no cambiarla. Si el cliente pide otro techo, déjalo como observación comercial.</p>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-marino dark:text-white">Observaciones comerciales</h2>
            <p className="text-[13px] text-slate-500">Notas de venta sobre esta unidad. No modifican la configuración técnica.</p>
            {(u.observaciones || []).length === 0 ? <p className="mt-4 text-[13.5px] text-slate-400">Aún no hay observaciones.</p> : (
              <ul className="mt-4 space-y-2">{[...u.observaciones].reverse().map((o, i) => <li key={i} className="rounded-lg bg-slate-50 px-4 py-3 text-[14px] dark:bg-white/5"><p>{o.texto}</p><p className="mt-1 text-[12px] text-slate-400">{o.autor} · {o.fecha}</p></li>)}</ul>
            )}
            {/* Observaciones */}
            {observa && (
              <form onSubmit={agregarObservacion} className="mt-4 flex flex-col gap-2 sm:flex-row" noValidate>
                <div className="min-w-0 flex-1">
                  <input id="ficha-observacion" className="field-input" maxLength={320} value={obs} onChange={(e) => { setObs(e.target.value); if (obsErr) setObsErr(""); }} placeholder="Ej: cliente interesado en fibra deportiva roja" />
                  {obsErr && <p className="mt-1 text-[12px] font-medium text-acento" data-error-observacion>{obsErr}</p>}
                </div>
                <button className="btn btn-secondary shrink-0 self-start !py-2.5">Agregar observación</button>
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* HU-003 · Ubicación y movimientos */}
          <Card data-card-ubicacion>
            {(() => {
              const t = mv.transitoDe(u.id);
              const ultimos = mv.deUnidad(u.id).slice(0, 3);
              return <>
                <h2 className="font-bold text-marino dark:text-white">Ubicación</h2>
                {t ? (
                  <div className="mt-3 rounded-xl bg-sky-50 p-3 dark:bg-sky-500/10">
                    <p className="text-[14px] font-semibold text-sky-800 dark:text-sky-200">En camino de {t.origen} a {t.destino}</p>
                    <p className="text-[12.5px] text-sky-700/80 dark:text-sky-200/70">Salió {haceCuanto(t.salida)}. Registró {t.usuario}.</p>
                    {puede("unidades.trasladar") && <div className="mt-2.5 flex flex-wrap gap-2"><button className="btn btn-primary !px-3 !py-1.5 text-[13px]" onClick={() => setModalS2({ tipo: "llegada", m: t })}>Confirmar llegada</button></div>}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[1.35rem] font-bold text-marino dark:text-white">{u.ubicacion || "Aún en Crosland"}</p>
                    {!u.ubicacion && gestiona && <button className="btn btn-primary !px-3.5 !py-2 text-[13.5px]" onClick={() => setModalS2({ tipo: "recibir" })}>Recibir</button>}
                    {u.ubicacion && u.disponibilidad !== "Vendida" && puede("unidades.trasladar") && <button className="btn btn-secondary !px-3.5 !py-2 text-[13.5px]" onClick={() => setModalS2({ tipo: "trasladar" })}>Trasladar</button>}
                  </div>
                )}
                {ultimos.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-[12.5px] dark:border-white/10">
                    {ultimos.map((m) => <li key={m.id} className="flex items-start justify-between gap-2"><span className="min-w-0 text-slate-600 dark:text-white/70"><span className="font-semibold">{m.tipo}</span> {m.origen} → {m.destino}<span className="block text-slate-400">{fechaCorta(m.salida)}, {m.usuario}</span></span><Pill tono={TONO_MOVIMIENTO[m.estado]}>{m.estado}</Pill></li>)}
                  </ul>
                )}
                {mv.deUnidad(u.id).length > 0 && puede("unidades.trasladar") && <Link className="mt-3 inline-block text-[13px] font-semibold text-marino-700 hover:underline dark:text-white" to={`/admin/movimientos?unidad=${u.id}`}>Ver todos sus movimientos</Link>}
              </>;
            })()}
          </Card>

          <Card>
            <h2 className="mb-3 font-bold text-marino dark:text-white">Datos de la unidad</h2>
            <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
              {[["Modelo", m?.nombre || u.nombreModelo || u.modelo], ["Color", u.color], ["N° de motor", u.motor], ["N° de chasis", u.chasis], ["Ubicación", u.ubicacion || "Sin recepción"], ["Disponibilidad", u.disponibilidad]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold text-marino dark:text-white">{v}</dd></div>
              ))}
              <div className="flex justify-between gap-4 py-2"><dt className="text-slate-500">Compra</dt><dd className="text-right font-semibold">{compra ? <Link className="text-marino-700 underline-offset-2 hover:underline dark:text-white" to={`/admin/compras/${compra.codcom}`}>#{compra.codcom} · {compra.estcom}</Link> : "Registro anterior"}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 font-bold text-marino dark:text-white">Historial</h2>
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4 dark:border-white/15">
              {[...(u.historial || [])].reverse().map((h, i) => <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-marino dark:bg-white" /><p className="text-[12px] text-slate-400">{fechaCorta(h.fecha)}</p><p className="text-[13.5px]">{h.detalle}</p></li>)}
            </ol>
          </Card>
        </div>
      </div>

      <ModalRecibir unidad={modalS2?.tipo === "recibir" ? u : null} onClose={() => setModalS2(null)} />
      <ModalTraslado abierto={modalS2?.tipo === "trasladar"} unidad={u} onClose={() => setModalS2(null)} />
      <ModalLlegada movimiento={modalS2?.tipo === "llegada" ? modalS2.m : null} onClose={() => setModalS2(null)} />
      <PreparacionModal unidad={modalS2?.tipo === "prep" ? u : null} destinoInicial={modalS2?.destino} onClose={() => setModalS2(null)} />
    </div>
  );
}
