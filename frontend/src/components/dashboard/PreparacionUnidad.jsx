// HU-033 · Preparación de una moto con las funciones de Michelle (techo, con fecha, autor y observación)
// La moto se vende con o sin techo. Solo el techo que eligió el cliente al separar queda pendiente de armado
// hasta que se registra instalado; sin techo elegido, la moto no tiene pendientes.
// Registrar un avance no cambia la ubicación ni la situación comercial. Una reimportación no reinicia nada.
import { useState } from "react";
import { actualizarPreparacionApi, preparacionUnidadApi } from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { useConsultaCentral, useIntento } from "../../servicios/central";
import { etapaComercialDe, etapaOperativa, techoPorArmar } from "../../servicios/inventarioCentral";
import { Aviso, Campo, Card, Modal, useToast } from "../ui";
import { Pill } from "./Sprint2";
import { ColorUnidad, fechaCompleta, nombreUnidad } from "./Central";

const TEXTO_TECHO = { Pendiente: "Falta armar el techo", "En proceso": "Techo en armado", Instalado: "Instalado", "No requiere": "No requiere armado" };
const limpio = (t) => String(t || "").trim().replace(/\s+/g, " ");

// Qué avances se pueden registrar desde el estado actual
export function accionesPreparacion(po) {
  if (!po) return [];
  const t = po.techo || {};
  const a = [];
  if (t.configuracion && t.requiereInstalacion) {
    if (t.estado === "Pendiente") a.push({ etapa: "Techo", estado: "En proceso", texto: "Techo en armado" });
    if (t.estado !== "Instalado") a.push({ etapa: "Techo", estado: "Instalado", texto: "Techo instalado" });
  }
  if (t.configuracion && !t.requiereInstalacion && t.estado !== "No requiere") a.push({ etapa: "Techo", estado: "No requiere", texto: "Techo no requiere instalación" });
  return a;
}

// Ventana para registrar un avance
export function ModalAvancePreparacion({ datos, onClose, onHecho }) {
  const toast = useToast();
  const intento = useIntento();
  const [estado, setEstado] = useState(""); const [fuente, setFuente] = useState("Interno"); const [obs, setObs] = useState("");
  const [err, setErr] = useState(""); const [enviando, setEnviando] = useState(false);
  const [clave, setClave] = useState("");
  const k = datos ? `${datos.unidad.coduni}|${datos.etapa}|${datos.estado}|${datos.po?.version}` : "";
  if (datos && clave !== k) { setClave(k); setEstado(datos.estado); setFuente("Interno"); setObs(""); setErr(""); }
  if (!datos) return null;
  const { unidad, po, etapa } = datos;
  const t = po.techo || {};
  const actual = etapa === "Armado" ? po.armado : t.estado;
  const opciones = etapa === "Armado" ? ["Pendiente", "Terminado"] : t.requiereInstalacion ? ["Pendiente", "En proceso", "Instalado"] : ["No requiere"];
  const retrocede = (etapa === "Armado" && actual === "Terminado" && estado === "Pendiente")
    || (etapa === "Techo" && ((actual === "Instalado" && ["Pendiente", "En proceso"].includes(estado)) || (actual === "En proceso" && estado === "Pendiente")));
  const proveedor = po.proveedorTecho;
  const puedeAviso = etapa === "Techo" && estado === "Instalado" && Boolean(proveedor);

  async function guardar(e) {
    e.preventDefault();
    if (enviando) return;
    if (estado === actual) return setErr("Ese ya es el estado registrado.");
    if (retrocede && limpio(obs).length < 5) return setErr("Explica por qué vuelve atrás (mínimo 5 caracteres).");
    if (limpio(obs).length > 500) return setErr("La observación admite hasta 500 caracteres.");
    setErr(""); setEnviando(true);
    const cuerpo = { etapa, estado, version: po.version, observacion: limpio(obs), fuente: puedeAviso ? fuente : "Interno" };
    try {
      await actualizarPreparacionApi(unidad.coduni, cuerpo, intento(JSON.stringify({ u: unidad.coduni, ...cuerpo })));
      toast(`${etapa === "Armado" ? "Armado" : "Techo"}: ${estado === "Terminado" ? "terminado" : TEXTO_TECHO[estado]?.toLowerCase() || estado.toLowerCase()}`);
      onHecho?.();
      onClose();
    } catch (er) {
      setErr(er.status === 409 ? `${mensajeError(er)}. Se actualizó la información: revisa y vuelve a registrar si corresponde.` : er.status === 0 || er.status >= 500 ? "No recibimos la confirmación. Presiona «Registrar» de nuevo: no se registrará dos veces." : mensajeError(er));
      if (er.status === 409) onHecho?.();
    } finally { setEnviando(false); }
  }

  return (
    <Modal abierto onClose={onClose} titulo={etapa === "Armado" ? "Armado de la moto" : "Avance del techo"} ancho="max-w-lg" sinAvisoCambios
      pie={<><button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button><button form="f-prep33" className="btn btn-primary !py-2" disabled={enviando}>{enviando ? "Registrando…" : "Registrar"}</button></>}>
      <form id="f-prep33" onSubmit={guardar} className="space-y-4" noValidate data-modal-preparacion>
        <div className="rounded-xl bg-marino-50 px-4 py-3 text-[13.5px] dark:bg-white/5">
          <p className="font-semibold text-marino dark:text-white">{nombreUnidad(unidad)}</p>
          <p className="text-slate-500"><ColorUnidad color={unidad.coluni} />{unidad.chauni ? ` · chasis ${unidad.chauni}` : ""}</p>
          {etapa === "Techo" && <p className="mt-1 text-slate-500">Techo: <b className="text-marino dark:text-white">{t.configuracion}</b>{proveedor ? ` con ${proveedor}` : ""}{po.detalleTecho ? `, ${po.detalleTecho}` : ""}</p>}
          <p className="mt-1 text-slate-500">Registrado ahora: <b className="text-marino dark:text-white">{etapa === "Armado" ? actual : TEXTO_TECHO[actual] || actual}</b></p>
        </div>
        <fieldset>
          <legend className="field-label">{etapa === "Armado" ? "Estado del armado" : "Avance de la instalación"}</legend>
          <div className={`grid gap-2 ${opciones.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {opciones.map((op) => (
              <label key={op} className={`cursor-pointer rounded-xl border-2 p-3 text-center text-[14px] font-semibold transition ${estado === op ? "border-marino-700 bg-marino-50 text-marino dark:border-white/50 dark:bg-white/10 dark:text-white" : "border-slate-200 text-slate-500 dark:border-white/10"}`}>
                <input type="radio" name="prep-estado" className="sr-only" checked={estado === op} onChange={() => setEstado(op)} data-opcion={op} />{etapa === "Armado" ? op : TEXTO_TECHO[op] || op}
              </label>
            ))}
          </div>
        </fieldset>
        {puedeAviso && (
          <fieldset>
            <legend className="field-label">¿Quién avisó?</legend>
            <div className="flex flex-wrap gap-2">
              {[["Interno", "Lo revisó EPSA Motor"], ["Aviso proveedor", `Aviso de ${proveedor}`]].map(([v, txt]) => (
                <label key={v} className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium ${fuente === v ? "border-marino-700 bg-marino-700 text-white" : "border-slate-300 dark:border-white/15"}`}>
                  <input type="radio" name="prep-fuente" className="sr-only" checked={fuente === v} onChange={() => setFuente(v)} />{txt}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-slate-400">El aviso del taller no mueve la moto ni da por hecho el recojo: el traslado se registra en Movimientos.</p>
          </fieldset>
        )}
        <Campo etiqueta={retrocede ? "Por qué vuelve atrás (obligatorio)" : "Observación (opcional)"} ayuda={etapa === "Techo" && /deportiv/i.test(t.configuracion || "") ? "Si lleva accesorios (cámara de retroceso, sonido…), anótalos aquí." : ""}>
          <textarea className="field-input" rows={3} maxLength={520} value={obs} onChange={(e) => setObs(e.target.value)} data-prep-obs />
        </Campo>
        {err && <Aviso tipo="error">{err}</Aviso>}
        <p className="text-[12px] text-slate-400">Se guarda con tu usuario, fecha y hora. No cambia la ubicación ni la situación comercial de la moto.</p>
      </form>
    </Modal>
  );
}

// Tarjeta de preparación de la ficha de la moto (HU-001): etapas, lo que falta, acciones e historial
export function PreparacionUnidadCard({ unidad, gestiona, onCambio }) {
  const consulta = useConsultaCentral(() => preparacionUnidadApi(unidad.coduni), [unidad.coduni], { clave: `prep33:${unidad.coduni}` });
  const [modal, setModal] = useState(null);
  const [todos, setTodos] = useState(false);
  if (consulta.error?.detalle?.faltaSql) return null;
  const po = consulta.data?.actual ? { ...consulta.data.actual, proveedorTecho: unidad.preparacion?.techo?.proveedor || "", detalleTecho: unidad.preparacion?.techo?.detalle || "" } : null;
  const historial = [...(consulta.data?.historial || [])].reverse();
  // CP-006-06: con el techo del comprador por definir o sin configurar, la moto no figura lista para entrega
  const eComercial = po ? etapaComercialDe(po, unidad.techoComercial) : null;
  const e = eComercial || etapaOperativa(po);
  const t = po?.techo || {};
  const abrir = (etapa, estado) => setModal({ unidad, po, etapa, estado });
  return (
    <Card data-card-preparacion>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-marino dark:text-white">Preparación</h2>
          <p className="text-[13px] text-slate-500">La moto se vende con o sin techo. Si se le configura un techo, aquí se registra su armado hasta que quede instalado.</p>
        </div>
        {po && <Pill tono={e.tono}>{e.etapa}</Pill>}
      </div>
      {consulta.error && !po && <div className="mt-3"><Aviso tipo="error">No se pudo cargar la preparación: {mensajeError(consulta.error)}</Aviso></div>}
      {!po && !consulta.error && <p className="mt-3 text-[13px] text-slate-400">Cargando la preparación…</p>}
      {po && <>
        <ol className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-white/10 dark:border-white/10">
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-etapa="Techo">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-marino dark:text-white">1. Techo</p>
              <p className="text-[12.5px] text-slate-500">{t.configuracion ? <>Techo: <b className="text-marino dark:text-white">{t.configuracion}</b>{po.proveedorTecho ? ` con ${po.proveedorTecho}` : ""}. {TEXTO_TECHO[t.estado] || t.estado}.</> : "Sin techo. Si se le configura un techo, aquí se registra su armado."}</p>
            </div>
            {gestiona && t.configuracion && (t.requiereInstalacion
              ? <button className="btn btn-secondary !px-3 !py-1.5 text-[13px]" onClick={() => abrir("Techo", t.estado === "Pendiente" ? "En proceso" : t.estado === "En proceso" ? "Instalado" : "Instalado")}>Registrar avance del techo</button>
              : t.estado !== "No requiere" && <button className="btn btn-secondary !px-3 !py-1.5 text-[13px]" onClick={() => abrir("Techo", "No requiere")}>Marcar sin instalación</button>)}
          </li>
          <li className="px-4 py-3" data-etapa="Entrega">
            <p className="text-[14px] font-semibold text-marino dark:text-white">2. Condición de entrega</p>
            <p className="text-[12.5px] text-slate-500" data-condicion-entrega={e.etapa}>{eComercial ? eComercial.nota : techoPorArmar(po) ? `Falta armar el techo (${t.configuracion}).` : "Lista para entrega. No equivale a entregada al comprador."}</p>
          </li>
        </ol>
        {po.ultimaActualizacion && <p className="mt-2 text-[12px] text-slate-400">Última actualización: {fechaCompleta(po.ultimaActualizacion)}{po.actualizadoPor?.nombre ? `, ${po.actualizadoPor.nombre}` : ""}</p>}
        {!gestiona && <p className="mt-2 text-[12.5px] text-slate-400">Solo gerencia y administración registran el armado del techo.</p>}
        <div className="mt-5">
          <h3 className="text-[13.5px] font-semibold text-marino dark:text-white">Historial de preparación</h3>
          {historial.length === 0 ? <p className="mt-1 text-[13px] text-slate-400">Aún no se registraron avances.</p> : (
            <ol className="mt-2 space-y-2.5 border-l-2 border-slate-200 pl-4 dark:border-white/15" data-historial-preparacion>
              {(todos ? historial : historial.slice(0, 5)).map((h) => (
                <li key={h.codhprep} className="relative text-[13px]">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-marino dark:bg-white" />
                  <p className="font-semibold text-marino dark:text-white">{h.fuente === "Configuración techo" ? "Cambió la configuración del techo" : h.etapa}: {h.estadoAnterior} → {h.estadoNuevo}</p>
                  <p className="text-[12px] text-slate-400">{fechaCompleta(h.fecha)}{h.autor?.nombre ? `, ${h.autor.nombre}` : ""}{h.fuente === "Aviso proveedor" && h.proveedor ? `, aviso de ${h.proveedor.nombre}` : ""}</p>
                  {h.observacion && <p className="text-[12.5px] text-slate-500">{h.observacion}</p>}
                </li>
              ))}
            </ol>
          )}
          {historial.length > 5 && <button className="mt-2 text-[12.5px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => setTodos(!todos)}>{todos ? "Ver menos" : `Ver los ${historial.length}`}</button>}
        </div>
      </>}
      <ModalAvancePreparacion datos={modal} onClose={() => setModal(null)} onHecho={() => { consulta.refrescar(true); onCambio?.(); }} />
    </Card>
  );
}
