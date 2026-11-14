// HU-022 · Corregir el comprador o la moto de una venta registrada (base central)
// Desde «Venta registrada» en la ficha, el gerente o la administradora cambian a nombre de quién está la venta, la moto
// que se vendió, ambos, o intercambian las motos de dos ventas que quedaron cruzadas. La venta no se cancela ni se crea
// otra: sus pagos, adelanto, evidencias, importes y comprobante siguen en ella. Antes de confirmar se revisa el antes y
// el después; queda un evento con el motivo, quién y cuándo. La moto anterior vuelve a quedar libre si no tiene otro
// compromiso. Si la red falla, se revisa el historial de la venta antes de decir nada.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { mensajeError } from "../../lib/errores";
import { inventarioApi, sinRespuesta, useConsultaCentral, useIntento } from "../../servicios/central";
import * as C from "../../servicios/correccionCentral";
import * as S from "../../servicios/separacionCentral";
import * as V from "../../servicios/ventaCentral";
import { Aviso, Campo, Card, Modal, useToast } from "../ui";
import { IconCheck } from "../Icons";
import { Link } from "./LinkPanel";
import { fechaCompleta } from "./Central";
import { fechaLarga } from "../../lib/validar";
import { BuscarInteresado, Opcion } from "./SepararCentral";

const COMPRADOR_VACIO = { nombres: "", apellidoPaterno: "", apellidoMaterno: "", telefono: "" };
const FIRMA_COMPRADOR = (c) => JSON.stringify([S.limpio(c.nombres), S.limpio(c.apellidoPaterno), S.limpio(c.apellidoMaterno), c.telefono]);
const NO_CONFIRMADO = "No se pudo confirmar si la corrección se guardó porque falló la conexión. Vuelve a pulsar «Confirmar corrección»: este mismo envío no se registrará dos veces.";
const motoPreview = (u) => (u ? { modelo: u.modelo, motor: u.motor, chasis: u.chasis, color: u.color, coduni: u.coduni } : null);
const motoInventario = (u) => (u ? { modelo: u.nommod, motor: u.nummotuni, chasis: u.chauni, color: u.coluni, coduni: u.coduni } : null);

function Dato({ k, children, data }) {
  return <div className="grid gap-1 py-1.5 sm:grid-cols-[10rem_1fr]" data-dato={data || k}><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-marino [overflow-wrap:anywhere] dark:text-white">{children}</dd></div>;
}
function Moto({ m }) {
  return <>{C.textoMoto(m)}{C.detalleMoto(m) && <span className="block text-[12px] font-normal text-slate-500">{C.detalleMoto(m)}</span>}</>;
}
// «Antes → después» de un dato; si no cambia, solo se muestra el valor
function Cambio({ antes, despues, cambia }) {
  if (!cambia) return <span className="font-normal text-slate-500">{antes} (sin cambio)</span>;
  return <span className="block"><span className="font-normal text-slate-500 line-through decoration-slate-300">{antes}</span><span className="block">{despues}</span></span>;
}

// ---------------------------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------------------------
export function CorregirVentaModal({ venta: vta, unidad, onClose, onHecho, onCambio }) {
  const { user } = useAuth();
  const toast = useToast();
  const intento = useIntento();
  const [preview, setPreview] = useState(null); const [errCarga, setErrCarga] = useState(null);
  const [form, setForm] = useState(null);
  const [unidades, setUnidades] = useState(null); const [errMotos, setErrMotos] = useState("");
  const [que, setQue] = useState("");
  const [nuevo, setNuevo] = useState(COMPRADOR_VACIO); const [desdeLead, setDesdeLead] = useState(null);
  const [registrado, setRegistrado] = useState(null);
  const [coduni, setCoduni] = useState(""); const [qMoto, setQMoto] = useState("");
  const [otra, setOtra] = useState(null); // venta B del intercambio: { item, preview }
  const [motivo, setMotivo] = useState("");
  const [paso, setPaso] = useState("form"); // form | revision
  const [intentado, setIntentado] = useState(false);
  const [err, setErr] = useState({}); const [enviando, setEnviando] = useState(""); const [bloqueada, setBloqueada] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [renovar, setRenovar] = useState(0); // fuerza una clave nueva tras un 409 de idempotencia
  const refError = useRef(null);
  useEffect(() => { if (err.general) refError.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [err.general]);

  const cargarPreview = () => C.previewCorreccionApi(vta.codven).then((d) => { setPreview(d); setErrCarga(null); return d; }).catch((e) => { setErrCarga(e); return null; });
  const cargarMotos = () => { setErrMotos(""); return inventarioApi().then(({ unidades: u }) => setUnidades(u)).catch((e) => setErrMotos(mensajeError(e))); };
  useEffect(() => {
    cargarPreview();
    S.formularioSeparacionApi().then(setForm).catch(() => setForm({}));
    cargarMotos();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const p = preview?.venta;
  const f = p?.finanzas;
  const conDinero = C.tieneDinero(f);
  const bloqueoComprador = conDinero && !C.esGerente(user);
  const cambiaComprador = que === C.COMPRADOR || que === C.AMBOS;
  const cambiaMoto = que === C.MOTO || que === C.AMBOS;
  const actual = unidades?.find((u) => String(u.coduni) === String(p?.unidad?.coduni ?? unidad.coduni)) || unidad;
  const motos = unidades && p ? C.motosParaCorregir(unidades, { actual, venta: p, form, q: qMoto }) : [];
  const elegida = motos.find((m) => String(m.unidad.coduni) === String(coduni)) || null;
  const largoMotivo = C.normalizar(motivo).length;

  // Intercambio: cada venta queda con la moto de la otra
  const pB = otra?.preview?.venta;
  const motoDe = (cod) => unidades?.find((u) => String(u.coduni) === String(cod)) || null;
  const compatA = pB ? C.compatibilidadMoto(motoDe(pB.unidad?.coduni), { actual: motoDe(p?.unidad?.coduni) || unidad, venta: p, form }) : null;
  const compatB = pB ? C.compatibilidadMoto(motoDe(p?.unidad?.coduni) || unidad, { actual: motoDe(pB.unidad?.coduni), venta: pB, form }) : null;

  function calcularErrores() {
    const e = {};
    if (!que) e.que = "Elige qué hay que corregir.";
    if (cambiaComprador) {
      if (bloqueoComprador) e.que = "Esta venta ya tiene dinero recibido o comprobante: cambiar su comprador solo lo confirma el gerente.";
      Object.assign(e, Object.fromEntries(Object.entries(S.erroresComprador(nuevo)).map(([k, v]) => [`c_${k}`, v])));
    }
    if (cambiaMoto) {
      if (!elegida) e.moto = "Elige la moto a la que pasa la venta.";
      else if (!elegida.ok) e.moto = `No se puede elegir esa moto: ${elegida.motivo}`;
    }
    if (que === C.INTERCAMBIO) {
      if (!pB) e.otra = "Elige la otra venta.";
      else if (!compatA?.ok) e.otra = `Esta venta no puede quedarse con la moto de la otra: ${compatA.motivo}`;
      else if (!compatB?.ok) e.otra = `La otra venta no puede quedarse con esta moto: ${compatB.motivo}`;
    }
    const m = C.errorMotivo(motivo);
    if (m) e.motivo = m;
    return e;
  }
  const vivos = p ? calcularErrores() : {};
  const ver = (k) => err[k] || (intentado ? vivos[k] : undefined);
  const limpiarErr = (...ks) => setErr((x) => ({ ...x, general: bloqueada ? x.general : undefined, ...Object.fromEntries(ks.map((k) => [k, undefined])) }));
  const cambiarNuevo = (k, v) => { setNuevo((x) => ({ ...x, [k]: v })); limpiarErr(`c_${k}`, "comprador"); };

  function revisar(ev) {
    ev.preventDefault();
    setIntentado(true);
    const e = calcularErrores();
    setErr(e);
    if (Object.keys(e).length || bloqueada) return;
    setPaso("revision");
  }

  function terminar(r, nota = "") {
    const n = nota || (r?.reutilizada ? "Ya estaba registrada con estos mismos datos: no se corrigió dos veces." : "");
    setHecho({ ...r, nota: n });
    toast(r?.tipo === "Intercambio" ? "Motos intercambiadas" : "Venta corregida");
    onHecho?.(r);
  }
  // Algo cambió en el servidor: se vuelve a leer la venta; si ya no es de esta moto o no está registrada, se bloquea
  async function releer(texto) {
    const d = await cargarPreview();
    if (otra) await elegirOtra(otra.item, true);
    if (!d || String(d.venta?.unidad?.coduni) !== String(unidad.coduni) || d.venta?.estado !== "Registrada") {
      setBloqueada(true); onCambio?.();
      setErr({ general: "Esta venta ya cambió (otra persona la corrigió o la canceló). Cierra la ventana: la ficha se actualizó." });
    } else { setPaso("form"); setErr({ general: texto }); }
  }

  async function confirmar() {
    if (enviando || hecho || bloqueada) return;
    setErr({});
    let codcliNuevo = null;
    // 1) Comprador nuevo: se registra una vez (si ya existe con esos datos, la base lo reutiliza)
    if (cambiaComprador) {
      const firma = FIRMA_COMPRADOR(nuevo);
      let c = registrado?.firma === firma ? registrado.comprador : null;
      if (!c) {
        setEnviando("Registrando al comprador…");
        try {
          c = await S.registrarCompradorApi({ nombres: S.limpio(nuevo.nombres), apellidoPaterno: S.limpio(nuevo.apellidoPaterno), apellidoMaterno: S.limpio(nuevo.apellidoMaterno) || null, telefono: nuevo.telefono });
        } catch (er) {
          setEnviando("");
          setErr({ general: sinRespuesta(er) ? "No se pudo confirmar si el comprador se registró porque falló la conexión. Vuelve a intentarlo: no se duplicará." : `No se pudo registrar al comprador: ${mensajeError(er)}` });
          return;
        }
        setRegistrado({ firma, comprador: c });
      }
      if (c.activo === false) { setEnviando(""); setPaso("form"); setErr({ comprador: "Este comprador está inactivo: no se puede pasar la venta a su nombre." }); return; }
      if (String(c.codcli) === String(p.comprador?.codcli)) { setEnviando(""); setPaso("form"); setErr({ comprador: "Es el mismo comprador que ya tiene la venta. Revisa los datos." }); return; }
      codcliNuevo = String(c.codcli);
    }
    // 2) Corrección (una clave por intento)
    const intercambio = que === C.INTERCAMBIO;
    const datos = intercambio
      ? { motivo: C.normalizar(motivo), operaciones: [
          { codven: Number(p.codven), versionEsperada: Number(p.versionRelacion), coduniNuevo: Number(pB.unidad.coduni) },
          { codven: Number(pB.codven), versionEsperada: Number(pB.versionRelacion), coduniNuevo: Number(p.unidad.coduni) }] }
      : { motivo: C.normalizar(motivo), versionEsperada: Number(p.versionRelacion), ...(codcliNuevo ? { codcliNuevo: Number(codcliNuevo) } : {}), ...(cambiaMoto ? { coduniNuevo: Number(coduni) } : {}) };
    const clave = intento(C.firmaCorreccion([vta.codven, datos, renovar]));
    setEnviando(intercambio ? "Intercambiando…" : "Corrigiendo…");
    try {
      const r = intercambio ? await C.intercambiarApi(datos, clave) : await C.corregirVentaApi(vta.codven, datos, clave);
      terminar(r);
    } catch (er) {
      if (sinRespuesta(er)) {
        setEnviando("Revisando si la corrección se guardó…");
        const causa = er?.status >= 500 ? `El servidor respondió con un error (${er.status})` : "Se perdió la conexión con el servidor";
        const h = await C.historialVentaApi(vta.codven).catch(() => undefined);
        const ev = h && C.correccionYaGuardada(h, { codusu: user?.codusu, motivo, versionEsperada: p.versionRelacion, codven: p.codven,
          codcliNuevo, coduniNuevo: intercambio ? pB.unidad.coduni : cambiaMoto ? coduni : null });
        if (ev) terminar({ ...ev, operaciones: ev.operaciones }, `${causa}, pero la corrección sí quedó registrada en el servidor (se verificó). No se corrigió dos veces.`);
        else if (h) setErr({ general: `${causa} y la venta no se corrigió: sigue como estaba y tus datos siguen aquí. Vuelve a pulsar «Confirmar corrección».` });
        else setErr({ general: NO_CONFIRMADO });
      } else {
        const x = C.errorCorreccion(er);
        if (x.nuevaClave) setRenovar((n) => n + 1);
        if (x.recargar) await releer(x.texto);
        else if (x.bloquear) { setBloqueada(true); onCambio?.(); setErr({ general: x.texto }); }
        else {
          if (x.motos) { setCoduni(""); await cargarMotos(); }
          setPaso("form");
          setErr(x.campo ? { [x.campo]: x.texto } : { general: x.texto });
        }
      }
    } finally { setEnviando(""); }
  }

  async function elegirOtra(item, silencioso = false) {
    if (!item) { setOtra(null); return; }
    if (!silencioso) { setOtra({ item, preview: null }); limpiarErr("otra"); }
    try {
      const d = await C.previewIntercambioApi(vta.codven, item.codven);
      const [, b] = d?.operaciones || [];
      setOtra({ item, preview: { venta: b?.venta || b, advertencias: d?.advertencias || [] } });
    } catch (e) { setOtra({ item, preview: null, error: C.errorCorreccion(e).texto || mensajeError(e) }); }
  }

  // ---- Resultado ----
  if (hecho) {
    const ops = hecho.operaciones || [];
    return (
      <Modal abierto onClose={onClose} titulo={hecho.tipo === "Intercambio" ? "Motos intercambiadas" : "Venta corregida"} ancho="max-w-lg" sinAvisoCambios pie={<button className="btn btn-primary !py-2" onClick={onClose} data-listo-correccion>Listo</button>}>
        <div className="space-y-4" data-correccion-hecha={hecho.codcor || ""}>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><IconCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-[16px] font-bold text-marino dark:text-white">{hecho.tipo === "Intercambio" ? "Las dos ventas quedaron con sus motos" : "La venta quedó corregida"}</p>
              <p className="text-[13px] text-slate-500" data-nota-correccion={hecho.nota ? "verificada" : ""}>{hecho.nota || "Quedó registrado con tu nombre, la fecha y el motivo."}</p>
            </div>
          </div>
          {ops.map((o) => {
            const propia = String(o.codven) === String(vta.codven);
            const ant = propia ? p : pB;
            const nueva = motoInventario(motoDe(o.coduniNueva)) || motoPreview(o.venta?.unidad);
            const cambioMoto = String(o.coduniAnterior) !== String(o.coduniNueva);
            const cambioCli = String(o.codcliAnterior) !== String(o.codcliNuevo);
            return (
              <dl key={o.codven} className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 text-[13.5px] dark:divide-white/10 dark:border-white/10" data-operacion-corregida={o.codven}>
                <Dato k="Venta">N° {o.codven}</Dato>
                <Dato k="Comprador" data="comprador"><Cambio cambia={cambioCli} antes={ant?.comprador?.nombre || `Cliente N° ${o.codcliAnterior}`} despues={o.venta?.comprador?.nombre || S.nombreComprador(registrado?.comprador) || `Cliente N° ${o.codcliNuevo}`} /></Dato>
                <Dato k="Moto" data="moto"><Cambio cambia={cambioMoto} antes={C.textoMoto(motoPreview(ant?.unidad))} despues={C.textoMoto(nueva)} /></Dato>
                {cambioMoto && o.estadoUnidadOrigenResultante && hecho.tipo !== "Intercambio" && <Dato k="La moto anterior queda" data="moto-anterior"><span data-estado-origen={o.estadoUnidadOrigenResultante}>{C.textoEstado(o.estadoUnidadOrigenResultante)}</span></Dato>}
                {cambioMoto && <div className="py-2"><Link className="text-[13px] font-semibold text-marino-700 hover:underline dark:text-white" to={`/admin/inventario/${o.coduniNueva}`} onClick={onClose} data-ficha-nueva={o.coduniNueva}>Ver la ficha de la moto {nueva?.motor ? `con motor ${nueva.motor}` : `N° ${o.coduniNueva}`}</Link></div>}
              </dl>
            );
          })}
          <p className="text-[12.5px] text-slate-500">Los pagos, el adelanto, las evidencias, los importes y el comprobante siguen en la misma venta. La ubicación, la preparación y la configuración de techo de las motos no cambiaron.</p>
        </div>
      </Modal>
    );
  }

  const titulo = "Corregir comprador o moto";
  const pie = paso === "revision"
    ? <>
        <button type="button" className="btn btn-secondary !py-2" onClick={() => { setPaso("form"); setErr({}); }} disabled={Boolean(enviando)} data-editar-correccion>Volver a editar</button>
        <button type="button" className="btn btn-primary !py-2" onClick={confirmar} disabled={Boolean(enviando) || bloqueada} data-confirmar-correccion>{enviando || "Confirmar corrección"}</button>
      </>
    : <>
        <button type="button" className="btn btn-secondary !py-2" onClick={onClose} data-volver-correccion>Volver</button>
        <button form="f-corregir" className="btn btn-primary !py-2 disabled:opacity-60" disabled={!p || bloqueada} data-revisar-correccion>Revisar corrección</button>
      </>;

  return (
    <Modal abierto onClose={onClose} titulo={titulo} ancho="max-w-2xl" sinAvisoCambios={Boolean(enviando)} pie={pie}>
      <div className="space-y-4" data-corregir-modal={vta.codven}>
        {errCarga && !p && <Aviso tipo="error">{C.errorCorreccion(errCarga).texto}</Aviso>}
        {!p && !errCarga && <p className="text-[13.5px] text-slate-500">Cargando la venta…</p>}
        {p && (
          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
              <Dato k="Venta">N° {p.codven}</Dato>
              <Dato k="Comprador" data="comprador-actual">{p.comprador?.nombre || "Sin dato"}</Dato>
              <Dato k="Moto" data="moto-actual"><Moto m={motoPreview(p.unidad)} /></Dato>
              <Dato k="Total y recibido" data="dinero"><span className="cifra">{S.soles(f.total)}</span>{` · recibido `}<span className="cifra">{S.soles(f.totalRecibido)}</span>{f.tieneAdelanto ? " (incluye el adelanto de la separación)" : ""}{Number(vta.descuento) > 0 ? <span className="block text-[12px] font-normal text-slate-500">Incluye un descuento autorizado de {S.soles(vta.descuento)}.</span> : null}</Dato>
              <Dato k="Comprobante">{f.comprobanteExterno ? `${f.comprobanteExterno.referencia || f.comprobanteExterno.numero || "Registrado"}: sigue en esta venta` : "Sin comprobante registrado"}</Dato>
            </dl>
          </div>
        )}
        {p && paso === "form" && (
          <form id="f-corregir" onSubmit={revisar} className="space-y-4" noValidate>
            <Aviso tipo="info">La venta no se cancela ni se crea otra. Sus pagos, adelanto, evidencias, importes y comprobante siguen en ella. Solo cambia a nombre de quién está o qué moto se vendió.</Aviso>
            <fieldset>
              <legend className="field-label">¿Qué hay que corregir?</legend>
              <div className="grid gap-2 sm:grid-cols-2" data-que-corregir>
                <Opcion nombre="cor-que" valor={C.COMPRADOR} actual={que} onElegir={(v) => { setQue(v); limpiarErr("que"); }} titulo="El comprador" texto="La moto se queda; la venta pasa a nombre de otra persona." deshabilitada={bloqueoComprador} />
                <Opcion nombre="cor-que" valor={C.MOTO} actual={que} onElegir={(v) => { setQue(v); limpiarErr("que"); }} titulo="La moto" texto="El comprador se queda; la venta pasa a otra moto libre." />
                <Opcion nombre="cor-que" valor={C.AMBOS} actual={que} onElegir={(v) => { setQue(v); limpiarErr("que"); }} titulo="Comprador y moto" texto="Cambian los dos en la misma corrección." deshabilitada={bloqueoComprador} />
                <Opcion nombre="cor-que" valor={C.INTERCAMBIO} actual={que} onElegir={(v) => { setQue(v); limpiarErr("que"); }} titulo="Intercambiar con otra venta" texto="Dos ventas quedaron con las motos cruzadas: cada una pasa a la moto de la otra." />
              </div>
              {bloqueoComprador && <p className="mt-1.5 text-[12.5px] text-slate-500" data-nota-gerente>Esta venta ya tiene dinero recibido o comprobante: cambiar su comprador solo lo confirma el gerente.</p>}
              {ver("que") && <p className="mt-1 text-[12px] font-medium text-acento">{ver("que")}</p>}
            </fieldset>

            {cambiaComprador && (
              <section className="space-y-3" aria-labelledby="cor-comprador">
                <h3 id="cor-comprador" className="text-[15px] font-bold text-marino dark:text-white">Comprador correcto</h3>
                <BuscarInteresado id="cor-buscar-interesado" disabled={Boolean(enviando)} onElegir={(l) => { setNuevo({ ...S.separarNombreLead(l.nombre), telefono: S.filtrarTelefono(l.celular) }); setDesdeLead(l); limpiarErr("comprador", "c_nombres", "c_apellidoPaterno", "c_telefono"); }} />
                {desdeLead && <p className="text-[12.5px] text-slate-500" data-desde-interesado={desdeLead.codlead}>Datos tomados del interesado «{desdeLead.nombre}». Revisa nombres y apellidos.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Nombres" error={ver("c_nombres")}><input id="cor-nombres" className="field-input" value={nuevo.nombres} maxLength={100} autoComplete="off" onChange={(e) => cambiarNuevo("nombres", S.soloNombre(e.target.value))} /></Campo>
                  <Campo etiqueta="Apellido paterno" error={ver("c_apellidoPaterno")}><input id="cor-paterno" className="field-input" value={nuevo.apellidoPaterno} maxLength={100} autoComplete="off" onChange={(e) => cambiarNuevo("apellidoPaterno", S.soloNombre(e.target.value))} /></Campo>
                  <Campo etiqueta="Apellido materno" error={ver("c_apellidoMaterno")} ayuda="Déjalo vacío si tiene un solo apellido"><input id="cor-materno" className="field-input" value={nuevo.apellidoMaterno} maxLength={100} autoComplete="off" onChange={(e) => cambiarNuevo("apellidoMaterno", S.soloNombre(e.target.value))} /></Campo>
                  <Campo etiqueta="Celular" error={ver("c_telefono")} ayuda="9 dígitos, empieza con 9"><input id="cor-telefono" className="field-input cifra" inputMode="numeric" autoComplete="off" placeholder="9XXXXXXXX" value={nuevo.telefono} onChange={(e) => cambiarNuevo("telefono", S.filtrarTelefono(e.target.value))} /></Campo>
                </div>
                {err.comprador && <Aviso tipo="error"><span data-error-comprador>{err.comprador}</span></Aviso>}
              </section>
            )}

            {cambiaMoto && (
              <section className="space-y-2" aria-labelledby="cor-moto">
                <h3 id="cor-moto" className="text-[15px] font-bold text-marino dark:text-white">Moto correcta</h3>
                <input id="cor-buscar-moto" type="search" className="field-input" placeholder="Busca por motor, chasis, modelo, color o sede" maxLength={60} value={qMoto} onChange={(e) => setQMoto(e.target.value)} />
                {errMotos && <Aviso tipo="error">No se pudieron cargar las motos libres: {errMotos}</Aviso>}
                {!unidades && !errMotos && <p className="text-[13px] text-slate-500">Cargando las motos libres…</p>}
                {unidades && (motos.length ? (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1" data-motos-libres={motos.length}>
                    {motos.map(({ unidad: u, ok, motivo: porQue, aviso }) => (
                      <li key={u.coduni}>
                        <label className={`flex items-start gap-3 rounded-xl border-2 p-2.5 text-[13.5px] ${!ok ? "cursor-not-allowed border-slate-100 opacity-60 dark:border-white/5" : String(coduni) === String(u.coduni) ? "cursor-pointer border-marino-700 bg-marino-50 dark:border-white/50 dark:bg-white/10" : "cursor-pointer border-slate-200 hover:border-slate-300 dark:border-white/10"}`} data-moto-libre={u.coduni} data-compatible={ok ? "si" : "no"}>
                          <input type="radio" name="cor-moto" className="mt-1 accent-marino-700" checked={String(coduni) === String(u.coduni)} disabled={!ok} onChange={() => { setCoduni(String(u.coduni)); limpiarErr("moto"); }} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-marino dark:text-white">{u.nommod} · motor {u.nummotuni}</span>
                            <span className="block text-[12px] text-slate-500">{[u.coluni, `chasis ${u.chauni}`, u.ubicacion?.nomubi].filter(Boolean).join(" · ")}</span>
                            {!ok && <span className="block text-[12px] text-acento">{porQue}</span>}
                            {ok && aviso && <span className="block text-[12px] text-amber-700 dark:text-amber-300" data-aviso-techo>{aviso}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-[13px] text-slate-500" data-sin-motos>{qMoto ? "Ninguna moto libre coincide con la búsqueda." : "No hay otras motos libres con motor y chasis registrados."}</p>)}
                {ver("moto") && <p className="text-[12px] font-medium text-acento">{ver("moto")}</p>}
              </section>
            )}

            {que === C.INTERCAMBIO && <ElegirOtraVenta codven={vta.codven} otra={otra} onElegir={elegirOtra} compatA={compatA} compatB={compatB} venta={p} error={ver("otra")} />}

            <Campo etiqueta="Motivo de la corrección" error={ver("motivo") || err.motivo} ayuda={`${largoMotivo}/${C.MAX_MOTIVO}. Queda en el historial con tu nombre y la fecha.`}>
              <textarea id="cor-motivo" className="field-input" rows={2} value={motivo} maxLength={C.MAX_MOTIVO + 50} placeholder="Ej.: Se registró la moto con otro motor por error al digitar" onChange={(x) => { setMotivo(x.target.value); limpiarErr("motivo"); }} />
            </Campo>
          </form>
        )}

        {p && paso === "revision" && <Revision {...{ p, pB, que, nuevo, elegida, motivo, compatA, compatB }} />}
        {err.general && <div ref={refError}><Aviso tipo={bloqueada ? "aviso" : "error"}><span data-error-correccion>{err.general}</span></Aviso></div>}
      </div>
    </Modal>
  );
}

// Antes y después, para confirmar
function Revision({ p, pB, que, nuevo, elegida, motivo, compatA, compatB }) {
  const intercambio = que === C.INTERCAMBIO;
  const cambiaCli = que === C.COMPRADOR || que === C.AMBOS;
  const cambiaMoto = que === C.MOTO || que === C.AMBOS;
  const avisos = intercambio ? [compatA?.aviso && `Venta N° ${p.codven}: la moto que recibe ${compatA.aviso.charAt(0).toLowerCase()}${compatA.aviso.slice(1)}`, compatB?.aviso && `Venta N° ${pB.codven}: la moto que recibe ${compatB.aviso.charAt(0).toLowerCase()}${compatB.aviso.slice(1)}`].filter(Boolean) : [elegida?.aviso && `La moto nueva ${elegida.aviso.charAt(0).toLowerCase()}${elegida.aviso.slice(1)}`].filter(Boolean);
  return (
    <div className="space-y-3" data-revision-correccion={que}>
      <p className="text-[14px] font-semibold text-marino dark:text-white">Revisa la corrección antes de confirmarla</p>
      {intercambio ? (
        [[p, pB], [pB, p]].map(([a, b]) => (
          <dl key={a.codven} className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 text-[13.5px] dark:divide-white/10 dark:border-white/10" data-revision-venta={a.codven}>
            <Dato k="Venta">N° {a.codven} · {a.comprador?.nombre}</Dato>
            <Dato k="Moto" data="moto"><Cambio cambia antes={C.textoMoto(motoPreview(a.unidad))} despues={C.textoMoto(motoPreview(b.unidad))} /></Dato>
          </dl>
        ))
      ) : (
        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 text-[13.5px] dark:divide-white/10 dark:border-white/10" data-revision-venta={p.codven}>
          <Dato k="Comprador" data="comprador"><Cambio cambia={cambiaCli} antes={p.comprador?.nombre} despues={`${S.nombreComprador({ nombres: S.limpio(nuevo.nombres), apellidoPaterno: S.limpio(nuevo.apellidoPaterno), apellidoMaterno: S.limpio(nuevo.apellidoMaterno) })}, celular ${nuevo.telefono}`} /></Dato>
          <Dato k="Moto" data="moto"><Cambio cambia={cambiaMoto} antes={C.textoMoto(motoPreview(p.unidad))} despues={C.textoMoto(motoInventario(elegida?.unidad))} /></Dato>
          {cambiaMoto && <Dato k="La moto anterior">Vuelve a quedar libre si no tiene otro compromiso.</Dato>}
        </dl>
      )}
      <dl className="px-3 text-[13.5px]"><Dato k="Motivo">{C.normalizar(motivo)}</Dato></dl>
      {avisos.map((t) => <Aviso key={t} tipo="aviso"><span data-aviso-revision>{t}</span></Aviso>)}
      <p className="text-[12.5px] text-slate-500">Queda registrado con tu nombre y la fecha. Los pagos, el adelanto y el comprobante siguen en {intercambio ? "cada venta" : "esta venta"}; no se recalcula el precio pactado.</p>
      {(intercambio ? [p, pB] : [p]).filter((x) => x?.finanzas?.comprobanteExterno && (intercambio || cambiaCli || cambiaMoto)).map((x) => (
        <Aviso key={`comp-${x.codven}`} tipo="aviso"><span data-aviso-comprobante={x.codven}>La venta N° {x.codven} ya tiene la boleta o factura {x.finanzas.comprobanteExterno.referencia || ""} emitida{x.finanzas.comprobanteExterno.fecha ? ` el ${fechaLarga(String(x.finanzas.comprobanteExterno.fecha).slice(0, 10))}` : ""}. Esta corrección no la cambia: coordina con administración su corrección en SUNAT, porque fue emitida con el comprador y la moto anteriores.</span></Aviso>
      ))}
      <p className="text-[12.5px] text-slate-500" data-nota-entrega>La plataforma todavía no registra entregas: corrige solo si la moto no se entregó al comprador. Si ya se entregó, coordínalo antes con gerencia.</p>
    </div>
  );
}

// Intercambio: buscar la otra venta registrada
function ElegirOtraVenta({ codven, otra, onElegir, compatA, compatB, venta, error }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null); const [cargando, setCargando] = useState(false); const [falla, setFalla] = useState("");
  const turno = useRef(0);
  useEffect(() => {
    const n = ++turno.current;
    setCargando(true);
    const h = setTimeout(() => {
      V.ventasApi({ q, limite: 20 })
        .then((r) => { if (n === turno.current) { setRes((r.items || []).filter((v) => v.estado === "Registrada" && String(v.codven) !== String(codven))); setFalla(""); } })
        .catch((e) => { if (n === turno.current) setFalla(mensajeError(e)); })
        .finally(() => { if (n === turno.current) setCargando(false); });
    }, q ? 350 : 0);
    return () => clearTimeout(h);
  }, [q, codven]);
  const pB = otra?.preview?.venta;
  return (
    <section className="space-y-2" aria-labelledby="cor-otra">
      <h3 id="cor-otra" className="text-[15px] font-bold text-marino dark:text-white">Otra venta del intercambio</h3>
      {!otra && (
        <>
          <input id="cor-buscar-venta" type="search" className="field-input" placeholder="Busca por comprador, motor o chasis" maxLength={V.MAX_BUSQUEDA_VENTAS} value={q} onChange={(e) => setQ(e.target.value)} />
          {cargando && <p className="text-[12.5px] text-slate-500">Buscando…</p>}
          {falla && <p className="text-[12.5px] font-medium text-acento">No se pudo buscar: {falla}</p>}
          {res && !cargando && (res.length ? (
            <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-white/10 dark:border-white/10" data-ventas-intercambio={res.length}>
              {res.map((v) => (
                <li key={v.codven}><button type="button" className="flex w-full flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-left text-[13.5px] hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => onElegir(v)} data-venta-intercambio={v.codven}>
                  <span className="font-semibold text-marino dark:text-white">N° {v.codven} · {v.comprador?.nombre}</span>
                  <span className="text-[12.5px] text-slate-500">{v.modelo?.nombre} · motor {v.unidad?.motor}</span>
                </button></li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-slate-500" data-sin-ventas>No hay otras ventas registradas que coincidan.</p>)}
        </>
      )}
      {otra && (
        <div className="rounded-xl border border-slate-200 p-3 text-[13.5px] dark:border-white/10" data-otra-venta={otra.item.codven}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-marino dark:text-white">Venta N° {otra.item.codven} · {otra.item.comprador?.nombre}</p>
            <button type="button" className="text-[13px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => onElegir(null)} data-cambiar-otra>Elegir otra</button>
          </div>
          {!pB && !otra.error && <p className="mt-1 text-slate-500">Revisando las dos ventas…</p>}
          {otra.error && <p className="mt-1 font-medium text-acento">{otra.error}</p>}
          {pB && (
            <ul className="mt-2 space-y-1">
              <li data-intercambio-a={compatA?.ok ? "ok" : "no"}>Venta N° {venta.codven} pasa a la moto <b>{C.textoMoto(motoPreview(pB.unidad))}</b>{!compatA?.ok && <span className="block text-[12px] text-acento">{compatA?.motivo}</span>}</li>
              <li data-intercambio-b={compatB?.ok ? "ok" : "no"}>Venta N° {pB.codven} pasa a la moto <b>{C.textoMoto(motoPreview(venta.unidad))}</b>{!compatB?.ok && <span className="block text-[12px] text-acento">{compatB?.motivo}</span>}</li>
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-[12px] font-medium text-acento">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Botón en «Venta registrada» (solo gerente y administradora)
// ---------------------------------------------------------------------------------------------
export function BotonCorregir({ venta, onCorregir }) {
  const { user } = useAuth();
  if (!venta || !onCorregir || !C.puedeCorregir(user) || venta.estado === "Cancelada") return null;
  return <button className="btn btn-secondary !py-2 text-[13px]" onClick={() => onCorregir(venta)} data-corregir-venta>Corregir comprador o moto</button>;
}

// ---------------------------------------------------------------------------------------------
// Historial de correcciones de la moto (ficha; solo gerente y administradora)
// ---------------------------------------------------------------------------------------------
export function CorreccionesUnidadCard({ unidad, version = 0 }) {
  const { user } = useAuth();
  const activo = Boolean(unidad?.coduni) && C.puedeCorregir(user);
  const consulta = useConsultaCentral(() => C.correccionesDeUnidadApi(unidad.coduni), [unidad?.coduni, version], { activo, intervalo: 30000, clave: `correcciones:${unidad?.coduni}` });
  const lista = consulta.data || [];
  if (!activo || !lista.length) return null;
  return (
    <Card data-correcciones={lista.length}>
      <h2 className="text-lg font-bold text-marino dark:text-white">Correcciones de comprador o moto</h2>
      <p className="text-[13px] text-slate-500">Cambios hechos a ventas de esta moto: a nombre de quién quedaron y qué moto se vendió. No se pueden modificar.</p>
      <ul className="mt-3 space-y-3">
        {lista.map((c) => {
          const cambioMoto = c.unidadAnterior?.coduni !== c.unidadNueva?.coduni;
          const cambioCli = c.compradorAnterior?.codcli !== c.compradorNuevo?.codcli;
          const salio = String(c.unidadAnterior?.coduni) === String(unidad.coduni) && cambioMoto;
          return (
            <li key={`${c.codcor}-${c.codven}`} className="rounded-xl border border-slate-200 p-3 text-[13.5px] [overflow-wrap:anywhere] dark:border-white/10" data-correccion={`${c.codcor}-${c.codven}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-marino dark:text-white">{c.tipo === "Intercambio" ? "Intercambio de motos" : "Corrección"} · venta N° {c.codven}</p>
                <p className="text-[12.5px] text-slate-500">{fechaCompleta(c.fecha)}, por {c.actor?.nombre || "Sin dato"}</p>
              </div>
              {cambioCli && <p className="mt-1"><span className="text-slate-500">Comprador:</span> {c.compradorAnterior?.nombre} → {c.compradorNuevo?.nombre}</p>}
              {cambioMoto && <p className="mt-1"><span className="text-slate-500">Moto:</span> {C.textoMoto(c.unidadAnterior)} → {C.textoMoto(c.unidadNueva)}</p>}
              <p className="mt-0.5"><span className="text-slate-500">Motivo:</span> {c.motivo}</p>
              {salio && c.tipo !== "Intercambio" && <p className="mt-0.5 text-[12.5px] text-slate-500">Esta moto quedó {C.textoEstado(c.estadoUnidadOrigenResultante)}.</p>}
              {c.otrasVentas?.length ? <p className="mt-0.5 text-[12.5px] text-slate-500">En el mismo cambio: venta N° {c.otrasVentas.join(", ")}.</p> : null}
            </li>
          );
        })}
      </ul>
      {consulta.error && <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">No se pudo actualizar: {mensajeError(consulta.error)}</p>}
    </Card>
  );
}
