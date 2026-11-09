// HU-005 · Separar una moto con adelanto confirmado (base central)
// Gerente, administradora y vendedores registran la separación en una sola ventana: comprador (nombres, apellidos y
// celular; ya no se pide ni se busca documento), adelanto (transferencia con captura y gerente que confirmó el
// ingreso, o efectivo con su observación de recepción), techo y responsable. El servidor vuelve a comprobar que la moto siga libre: si otra
// persona la separó o vendió antes, no se guarda nada y se avisa. La ubicación no cambia.
// Adelanto: se valida el texto antes de convertirlo (el signo se conserva; cero y negativos no se envían; coma o
// punto decimal) y no puede superar el precio de lista de la moto (DEF-S3-001); la base lo vuelve a comprobar.
// Techo: «Por definir» (el comprador aún no decide), «Sin techo» (lo eligió así) o «Con techo» y su tipo (si
// requiere instalación, queda pendiente en Preparación). Primero se guarda la separación y luego el techo elegido:
// si ese segundo paso falla, la separación sigue activa, se muestra que el techo quedó pendiente de guardar y se
// reintenta solo el techo, sin duplicar la separación ni el adelanto.
// Los errores se muestran mientras se escribe.
import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeError } from "../../lib/errores";
import { pesoLegible } from "../../lib/archivos";
import { fechaLarga } from "../../lib/validar";
import { sinRespuesta, useConsultaCentral, useIntento } from "../../servicios/central";
import { ubicacionDe } from "../../servicios/inventarioCentral";
import * as S from "../../servicios/separacionCentral";
import { Aviso, Campo, Card, Modal, useToast } from "../ui";
import { Link } from "./LinkPanel";
import { IconCheck } from "../Icons";
import { ColorUnidad, fechaCompleta } from "./Central";

const NO_CONFIRMADO = "No se pudo confirmar si la separación se guardó porque falló la conexión. Vuelve a pulsar «Separar moto»: este mismo envío no se registrará dos veces.";
const CAPTURA_DE = (a) => (a ? `${a.name}|${a.size}|${a.lastModified}` : "");
const ADELANTO_VACIO = () => ({ monto: "", fecha: S.hoyLima(), medio: "", referencia: "", archivo: null, confirmador: "", confirmado: false, observacion: "" });
const COMPRADOR_VACIO = { nombres: "", apellidoPaterno: "", apellidoMaterno: "", telefono: "" };
// Datos del comprador tal como se registran (para no volver a registrarlo si no cambiaron)
const FIRMA_COMPRADOR = (c) => JSON.stringify([S.limpio(c.nombres), S.limpio(c.apellidoPaterno), S.limpio(c.apellidoMaterno), c.telefono]);
const largo = (t) => [...S.limpio(t)].length;

// Resumen de la moto en la cabecera
function CabeceraMoto({ unidad, precio }) {
  const x = ubicacionDe(unidad);
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 text-[13.5px] dark:bg-white/5" data-cabecera-unidad={unidad.coduni}>
      <p className="font-semibold text-marino dark:text-white">{unidad.nommod} · motor {unidad.nummotuni}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-slate-500"><ColorUnidad color={unidad.coluni} /><span>Chasis {unidad.chauni}</span><span>{x.texto}</span></p>
      {precio !== undefined && <p className="mt-0.5 text-slate-500" data-precio-lista={precio ?? ""}>{precio ? <>Precio de lista <span className="cifra font-semibold text-marino dark:text-white">{S.soles(precio)}</span></> : "Sin precio de lista registrado"}</p>}
    </div>
  );
}

// Vista previa de la captura elegida
function VistaCaptura({ archivo, guardada, onQuitar }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!archivo?.type?.startsWith("image/")) { setUrl(""); return undefined; }
    const u = URL.createObjectURL(archivo); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [archivo]);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-white/10" data-captura-elegida>
      {url ? <img src={url} alt="Captura elegida" className="h-14 w-14 rounded-lg object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-lg bg-red-50 text-[12px] font-bold text-acento dark:bg-red-500/10">PDF</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-marino dark:text-white">{archivo.name}</p>
        <p className="text-[12px] text-slate-500">{pesoLegible(archivo.size)}{guardada ? ", ya guardada" : ""}</p>
      </div>
      <button type="button" className="text-[13px] font-semibold text-acento hover:underline" onClick={onQuitar}>Quitar</button>
    </div>
  );
}

// Elección con apariencia de tarjeta (medio de pago)
function Opcion({ nombre, valor, actual, onElegir, titulo, texto }) {
  const activa = actual === valor;
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${activa ? "border-marino-700 bg-marino-50 dark:border-white/50 dark:bg-white/10" : "border-slate-200 hover:border-slate-300 dark:border-white/10"}`}>
      <input type="radio" name={nombre} className="mt-1 accent-marino-700" checked={activa} onChange={() => onElegir(valor)} />
      <span className="min-w-0"><span className="block text-[14px] font-semibold text-marino dark:text-white">{titulo}</span><span className="block text-[12.5px] leading-snug text-slate-500">{texto}</span></span>
    </label>
  );
}

export default function SepararMotoCentral({ unidad, onClose, onHecho, onConflicto }) {
  const toast = useToast();
  const intento = useIntento();
  const [form, setForm] = useState(null); const [errCarga, setErrCarga] = useState(null);
  const [nuevo, setNuevo] = useState(COMPRADOR_VACIO);
  const [registrado, setRegistrado] = useState(null); // { firma, comprador } ya guardado en la base
  const [a, setA] = useState(ADELANTO_VACIO);
  const [responsable, setResponsable] = useState("");
  const [captura, setCaptura] = useState(null); // { firma, ruta } de la captura ya guardada
  const [err, setErr] = useState({}); const [enviando, setEnviando] = useState(""); const [bloqueada, setBloqueada] = useState(false);
  const [hecho, setHecho] = useState(null);
  // Techo: decisión del comprador y, si eligió techo, su tipo. «configurado»: el que la moto ya tenía (HU-004)
  const [decision, setDecision] = useState(S.POR_DEFINIR); const [codtteCon, setCodtteCon] = useState(""); const [configurado, setConfigurado] = useState(null);
  const [tocados, setTocados] = useState({}); const [intentado, setIntentado] = useState(false);
  const [techoGuardando, setTechoGuardando] = useState(false);
  const archivoRef = useRef(null);
  const formRef = useRef(null);
  // Tras un intento fallido se lleva la vista al primer error (puede quedar fuera de pantalla)
  const verError = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    formRef.current?.querySelector("p.text-acento, [data-error-general], .bg-red-50")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }));

  const cargar = useCallback(() => {
    setErrCarga(null);
    S.formularioSeparacionApi().then((f) => {
      setForm(f);
      setResponsable((x) => x || (f.responsables.some((r) => r.codusu === f.usuarioActual.codusu) ? f.usuarioActual.codusu : ""));
      const yoGerente = f.usuarioActual.rol === "Gerente";
      setA((x) => ({ ...x, confirmador: x.confirmador || (yoGerente ? f.usuarioActual.codusu : f.gerentes.length === 1 ? f.gerentes[0].codusu : "") }));
      const ini = S.decisionInicial(f.tiposTecho || [], unidad?.preparacion?.techo?.configuracion || "");
      setDecision(ini.decision); setCodtteCon(ini.codtte); setConfigurado(ini.configurado);
    }).catch(setErrCarga);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const transferencia = a.medio === "Transferencia";
  const efectivo = a.medio === "Efectivo";
  const gerente = form?.gerentes.find((g) => g.codusu === a.confirmador);
  const nombreDe = (codusu) => form?.responsables.find((r) => r.codusu === codusu)?.nombre || form?.gerentes.find((g) => g.codusu === codusu)?.nombre || "";
  const soyGerenteConfirmador = form?.usuarioActual.rol === "Gerente" && a.confirmador === form?.usuarioActual.codusu;
  const tipoTecho = S.tipoDeDecision(form?.tiposTecho, decision, codtteCon); // null con «Por definir»
  const tipoSin = S.tipoSinTecho(form?.tiposTecho);
  const tiposCon = S.tiposConTecho(form?.tiposTecho);
  const precio = S.precioListaDe(form, unidad);
  const cambiaConfigurado = Boolean(configurado && tipoTecho && tipoTecho.codtte !== configurado.codtte);
  const tocar = (k) => setTocados((p) => (p[k] ? p : { ...p, [k]: true }));
  const cambiarA = (k, v) => { setA((p) => ({ ...p, [k]: v })); tocar(k); setErr((e) => ({ ...e, [k]: undefined, general: undefined })); };
  const cambiarNuevo = (k, v) => { setNuevo((p) => ({ ...p, [k]: v })); tocar(`c_${k}`); setErr((e) => ({ ...e, [`c_${k}`]: undefined, comprador: undefined })); };

  // Errores del formulario tal como está ahora (se muestran en vivo en los campos ya tocados)
  function calcularErrores() {
    const e = {};
    Object.assign(e, Object.fromEntries(Object.entries(S.erroresComprador(nuevo)).map(([k, v]) => [`c_${k}`, v])));
    const eMonto = S.errorMonto(a.monto, precio);
    if (eMonto) e.monto = eMonto;
    const eFecha = S.errorFechaAdelanto(a.fecha);
    if (eFecha) e.fecha = eFecha;
    if (!a.medio) e.medio = "Elige cómo se pagó el adelanto.";
    if (transferencia) {
      const eRef = S.errorReferencia(a.referencia);
      if (eRef) e.referencia = eRef;
      const yaGuardada = captura && captura.firma === CAPTURA_DE(a.archivo);
      if (!yaGuardada) { const c = S.errorCaptura(a.archivo); if (c) e.archivo = c; }
      if (!gerente) e.confirmador = "Elige al gerente que confirmó el ingreso.";
      if (!a.confirmado) e.confirmado = "La captura sola no confirma el pago. Marca esta casilla solo cuando el gerente haya confirmado que el dinero ingresó.";
      const eObs = S.errorObservacion(a.observacion, false);
      if (eObs) e.observacion = eObs;
    }
    if (efectivo) {
      const eObs = S.errorObservacion(a.observacion, true);
      if (eObs) e.observacion = eObs;
      if (!a.confirmado) e.confirmado = "Confirma que recibiste el dinero en efectivo.";
    }
    if (decision === S.CON_TECHO && !tipoTecho) e.techo = "Elige el tipo de techo que eligió el comprador.";
    if (decision === S.SIN_TECHO && !tipoTecho) e.techo = "No hay un tipo «Sin techo» activo: elige otra opción.";
    if (!form?.responsables.some((r) => r.codusu === responsable)) e.responsable = "Elige quién será responsable de esta separación.";
    return e;
  }
  const vivos = form ? calcularErrores() : {};
  const ver = (k) => err[k] || ((intentado || tocados[k]) ? vivos[k] : undefined);
  function validar() {
    const e = calcularErrores();
    setIntentado(true);
    setErr(e);
    if (Object.keys(e).length) verError();
    return Object.keys(e).length === 0;
  }

  async function guardar(ev) {
    ev.preventDefault();
    if (enviando || bloqueada || hecho || !validar()) return;
    let elegido = null;
    try {
      // 1) Comprador: se registra una vez; si sus datos no cambiaron, se reutiliza (la base tampoco lo duplica)
      const firma = FIRMA_COMPRADOR(nuevo);
      if (registrado?.firma === firma) elegido = registrado.comprador;
      else {
        setEnviando("Registrando al comprador…");
        try {
          elegido = await S.registrarCompradorApi({
            nombres: S.limpio(nuevo.nombres), apellidoPaterno: S.limpio(nuevo.apellidoPaterno),
            apellidoMaterno: S.limpio(nuevo.apellidoMaterno) || null, telefono: nuevo.telefono,
          });
        } catch (er) {
          setErr({ comprador: S.faltaInstalar(er) ? S.FALTA_INSTALAR : sinRespuesta(er) ? "No se pudo confirmar si el comprador se registró porque falló la conexión. Vuelve a intentarlo: no se duplicará." : `No se pudo registrar al comprador: ${mensajeError(er)}` });
          return;
        }
        setRegistrado({ firma, comprador: elegido });
        if (!elegido.activo) { setErr({ comprador: "Este comprador está inactivo: no se puede separar a su nombre." }); return; }
      }
      // 2) Captura de la transferencia (una sola vez por archivo; queda guardada aunque la separación no se complete)
      let ruta = null;
      if (transferencia) {
        const firma = CAPTURA_DE(a.archivo);
        if (captura?.firma === firma) ruta = captura.ruta;
        else {
          setEnviando("Guardando la captura…");
          try { const d = await S.subirCapturaApi(unidad.coduni, a.archivo); ruta = d.rutaEvidencia; setCaptura({ firma, ruta }); }
          catch (er) { setErr({ archivo: S.faltaInstalar(er) ? S.FALTA_INSTALAR : sinRespuesta(er) ? "No se pudo guardar la captura porque falló la conexión. Vuelve a intentarlo." : mensajeError(er) }); return; }
        }
      }
      // 3) Separación: el servidor comprueba que la moto siga libre y la guarda una sola vez
      const cuerpo = {
        codcli: Number(elegido.codcli), codusuResponsable: Number(responsable), monto: S.montoParaEnviar(a.monto), fechaPago: a.fecha, medioPago: a.medio,
        referencia: transferencia ? S.limpio(a.referencia) : null, rutaEvidencia: ruta, observacion: S.limpio(a.observacion) || null, ingresoConfirmado: true,
        ...(transferencia ? { codusuConfirmador: Number(a.confirmador) } : {}),
      };
      setEnviando("Separando la moto…");
      const r = await S.separarMotoApi(unidad.coduni, cuerpo, intento(JSON.stringify({ u: unidad.coduni, ...cuerpo })));
      const sep = r.data || {};
      // 4) Techo elegido (no con «Por definir»). Si falla, la separación ya quedó: se avisa y se reintenta solo el techo
      let techoError = "";
      if (tipoTecho) {
        setEnviando("Guardando el techo elegido…");
        try { await S.elegirTechoApi(unidad.coduni, tipoTecho.codtte); S.borrarTechoPendiente(unidad.coduni); }
        catch (er) {
          techoError = S.faltaInstalar(er) ? S.FALTA_INSTALAR : sinRespuesta(er) ? "falló la conexión" : mensajeError(er);
          S.guardarTechoPendiente(unidad.coduni, { codsep: String(sep.codsep ?? ""), codtte: tipoTecho.codtte, nombre: tipoTecho.nombre, requiereInstalacion: tipoTecho.requiereInstalacion });
        }
      }
      setHecho({ ...sep, reutilizada: r.status === 200 || sep.reutilizada === true, comprador: elegido, decision, techo: tipoTecho, techoError });
      toast(r.status === 200 ? "La separación ya estaba guardada" : "Moto separada");
      onHecho?.(sep);
    } catch (er) {
      if (S.faltaInstalar(er)) setErr({ general: S.FALTA_INSTALAR });
      else if (sinRespuesta(er)) setErr({ general: NO_CONFIRMADO });
      else if (er.status === 409) {
        setBloqueada(true); onConflicto?.();
        setErr({ general: `${mensajeError(er)}. No se guardó esta separación: alguien comprometió la moto antes (o ya quedó guardado un intento anterior). Revisa su ficha para ver a nombre de quién quedó.` });
      } else if (/precio de lista|^monto/i.test(er.message || "")) setErr({ monto: mensajeError(er) });
      else if (/captura/i.test(er.message || "")) { setCaptura(null); setErr({ archivo: `${mensajeError(er)}. Vuelve a adjuntarla.` }); }
      else if (/confirmador/i.test(er.message || "")) setErr({ confirmador: mensajeError(er) });
      else if (/comprador/i.test(er.message || "")) setErr({ comprador: mensajeError(er) });
      else if (/responsable/i.test(er.message || "")) setErr({ responsable: mensajeError(er) });
      else setErr({ general: mensajeError(er) });
    } finally { setEnviando(""); verError(); }
  }

  // Solo vuelve a guardar el techo elegido: la separación y el adelanto ya están guardados y no se reenvían
  async function reintentarTecho() {
    setTechoGuardando(true);
    try {
      await S.elegirTechoApi(unidad.coduni, hecho.techo.codtte);
      S.borrarTechoPendiente(unidad.coduni);
      setHecho((h) => ({ ...h, techoError: "" })); toast("Techo guardado"); onHecho?.();
    } catch (er) { setHecho((h) => ({ ...h, techoError: sinRespuesta(er) ? "falló la conexión" : mensajeError(er) })); }
    finally { setTechoGuardando(false); }
  }

  // ---------------------------------------------------------------------------------------------
  // Separación guardada
  if (hecho) {
    const porArmar = Boolean(hecho.techo?.requiereInstalacion);
    const textoTecho = hecho.techoError
      ? `${hecho.techo.nombre}, elegido por el comprador: pendiente de guardar`
      : hecho.decision === S.POR_DEFINIR ? "Por definir: el comprador aún no decide. Se registra después desde la ficha de la moto."
      : hecho.decision === S.SIN_TECHO ? "Sin techo, elegido por el comprador"
      : `${hecho.techo.nombre}, elegido por el comprador${porArmar ? ". Queda pendiente de armado en Preparación" : ""}`;
    const filas = [
      ["Comprador", S.textoComprador(hecho.comprador)],
      ["Adelanto", `${S.soles(hecho.monto)} en ${String(hecho.medioPago).toLowerCase()}${hecho.referencia ? `, operación ${hecho.referencia}` : ""}, del ${fechaLarga(hecho.fechaPago)}`],
      [hecho.medioPago === "Transferencia" ? "Ingreso confirmado por" : "Recibido por", nombreDe(String(hecho.confirmadoPor))],
      ["Techo", textoTecho],
      ["Responsable", nombreDe(String(hecho.codusuResponsable))],
      ["Registrada", `${fechaCompleta(hecho.fechaRegistro)}, por ${nombreDe(String(hecho.codusuAutor))}`],
    ];
    return (
      <Modal abierto onClose={onClose} titulo="Separar moto" ancho="max-w-xl" sinAvisoCambios pie={<>
        {porArmar && !hecho.techoError && <Link className="btn btn-secondary !py-2" to="/admin/preparacion" onClick={onClose} data-ir-preparacion>Ir a Preparación</Link>}
        <button className="btn btn-primary !py-2" onClick={onClose} autoFocus>Listo</button>
      </>}>
        <div className="space-y-4" data-separacion-guardada={hecho.codsep} data-reutilizada={hecho.reutilizada ? "si" : "no"}>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><IconCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-[17px] font-bold text-marino dark:text-white">{hecho.reutilizada ? "Esta separación ya estaba guardada" : "Moto separada"}</p>
              <p className="text-[13.5px] text-slate-500">{hecho.reutilizada ? "Era el mismo envío: no se registró dos veces." : "Ya no figura libre en Disponibilidad. Su ubicación no cambió."}</p>
            </div>
          </div>
          <CabeceraMoto unidad={unidad} precio={precio} />
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            {filas.map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]" data-fila={k}><dt className="text-slate-500">{k}</dt><dd className={`font-semibold ${k === "Techo" && hecho.techoError ? "text-amber-700 dark:text-amber-300" : "text-marino dark:text-white"}`}>{v}</dd></div>)}
          </dl>
          {hecho.techoError && (
            <Aviso tipo="aviso">
              <span data-techo-error>La moto quedó separada, pero el techo elegido ({hecho.techo.nombre}) no se guardó: {hecho.techoError}. Reintenta: solo se guarda el techo, la separación y el adelanto no se registran otra vez.</span>{" "}
              <button type="button" className="font-semibold underline" onClick={reintentarTecho} disabled={techoGuardando} data-reintentar-techo>{techoGuardando ? "Guardando…" : "Reintentar"}</button>
            </Aviso>
          )}
        </div>
      </Modal>
    );
  }

  const pie = (
    <>
      <button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button>
      <button form="f-separar" className="btn btn-primary !py-2" disabled={Boolean(enviando) || bloqueada || !form} data-separar-enviar>{enviando || "Separar moto"}</button>
    </>
  );
  const textoConfirmar = `${unidad.nommod} motor ${unidad.nummotuni} quedará separada para ${S.nombreComprador({ nombres: S.limpio(nuevo.nombres), apellidoPaterno: S.limpio(nuevo.apellidoPaterno), apellidoMaterno: S.limpio(nuevo.apellidoMaterno) }) || "el comprador"} con un adelanto de ${S.soles(S.montoParaEnviar(a.monto) || 0)}${transferencia && gerente ? ` (ingreso confirmado por ${gerente.nombre})` : efectivo ? " recibido en efectivo" : ""}${decision === S.POR_DEFINIR ? ", con el techo por definir" : decision === S.SIN_TECHO ? ", sin techo" : tipoTecho ? `, con techo ${tipoTecho.nombre}${tipoTecho.requiereInstalacion ? " por armar" : ""}` : ""}. Ya no figurará libre para los demás.`;

  return (
    <Modal abierto onClose={onClose} titulo="Separar moto" ancho="max-w-2xl" sinAvisoCambios={Boolean(enviando)}
      confirmarGuardar={{ titulo: "¿Separar esta moto?", texto: textoConfirmar, boton: "Sí, separar", validar }} pie={pie}>
      <form id="f-separar" ref={formRef} onSubmit={guardar} className="space-y-6" noValidate data-separar-modal={unidad.coduni}>
        <CabeceraMoto unidad={unidad} precio={precio} />
        {errCarga && (
          <Aviso tipo="error">
            {S.faltaInstalar(errCarga) ? S.FALTA_INSTALAR : `No se pudo preparar el formulario: ${mensajeError(errCarga)}`}{" "}
            {!S.faltaInstalar(errCarga) && <button type="button" className="font-semibold underline" onClick={cargar}>Reintentar</button>}
          </Aviso>
        )}
        {!form && !errCarga && <p className="text-[13.5px] text-slate-500">Cargando el formulario…</p>}

        {form && (
          <>
            {/* Comprador */}
            <section aria-labelledby="sep-comprador" className="space-y-3">
              <h3 id="sep-comprador" className="text-[15px] font-bold text-marino dark:text-white">Comprador</h3>
              <div className="grid gap-3 sm:grid-cols-2" data-comprador-datos>
                <Campo etiqueta="Nombres" error={ver("c_nombres")}>
                  <input id="sep-nombres" className="field-input" value={nuevo.nombres} maxLength={100} autoComplete="off" disabled={Boolean(enviando)} placeholder="Ej. Rosa María" onChange={(e) => cambiarNuevo("nombres", S.soloNombre(e.target.value))} onBlur={() => tocar("c_nombres")} />
                </Campo>
                <Campo etiqueta="Apellido paterno" error={ver("c_apellidoPaterno")}>
                  <input id="sep-paterno" className="field-input" value={nuevo.apellidoPaterno} maxLength={100} autoComplete="off" disabled={Boolean(enviando)} onChange={(e) => cambiarNuevo("apellidoPaterno", S.soloNombre(e.target.value))} onBlur={() => tocar("c_apellidoPaterno")} />
                </Campo>
                <Campo etiqueta="Apellido materno" error={ver("c_apellidoMaterno")} ayuda="Déjalo vacío si el comprador tiene un solo apellido">
                  <input id="sep-materno" className="field-input" value={nuevo.apellidoMaterno} maxLength={100} autoComplete="off" disabled={Boolean(enviando)} onChange={(e) => cambiarNuevo("apellidoMaterno", S.soloNombre(e.target.value))} />
                </Campo>
                <Campo etiqueta="Celular" error={ver("c_telefono")} ayuda="9 dígitos, empieza con 9">
                  <input id="sep-telefono" className="field-input cifra" inputMode="numeric" autoComplete="off" placeholder="9XXXXXXXX" value={nuevo.telefono} disabled={Boolean(enviando)} onChange={(e) => cambiarNuevo("telefono", S.filtrarTelefono(e.target.value))} onPaste={(e) => { e.preventDefault(); cambiarNuevo("telefono", S.filtrarTelefono(e.clipboardData.getData("text"))); }} onBlur={() => tocar("c_telefono")} />
                </Campo>
              </div>
              {registrado && !registrado.comprador.existente && registrado.firma === FIRMA_COMPRADOR(nuevo) && <p className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-comprador-estado="registrado">Comprador registrado.</p>}
              {err.comprador && <Aviso tipo="error">{err.comprador}</Aviso>}
            </section>

            {/* Adelanto */}
            <section aria-labelledby="sep-adelanto" className="space-y-3">
              <h3 id="sep-adelanto" className="text-[15px] font-bold text-marino dark:text-white">Adelanto</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Monto (S/)" error={ver("monto")} ayuda={typeof precio === "number" ? `Hasta ${S.soles(precio)}, el precio de lista` : undefined}>
                  <input id="sep-monto" className="field-input cifra" inputMode="decimal" autoComplete="off" value={a.monto} placeholder="Ej. 300,50" onChange={(e) => cambiarA("monto", S.filtrarMonto(e.target.value))} />
                </Campo>
                <Campo etiqueta="Fecha en que se recibió" error={ver("fecha")}>
                  <input id="sep-fecha" type="date" className="field-input" value={a.fecha} min={S.fechaMinimaAdelanto()} max={S.hoyLima()} onChange={(e) => cambiarA("fecha", e.target.value)} />
                </Campo>
              </div>
              {precio === null && <Aviso tipo="aviso"><span data-sin-precio>{S.SIN_PRECIO}</span></Aviso>}
              <fieldset>
                <legend className="field-label">¿Cómo se pagó?</legend>
                <div className="grid gap-2 sm:grid-cols-2" data-medio-pago>
                  <Opcion nombre="sep-medio" valor="Transferencia" actual={a.medio} onElegir={(v) => cambiarA("medio", v)} titulo="Transferencia" texto="Con la captura y el gerente que confirmó que el dinero ingresó." />
                  <Opcion nombre="sep-medio" valor="Efectivo" actual={a.medio} onElegir={(v) => cambiarA("medio", v)} titulo="Efectivo" texto="Recibido en mano. Se anota cómo se recibió; no pide captura." />
                </div>
                {ver("medio") && <p className="mt-1 text-[12px] font-medium text-acento">{ver("medio")}</p>}
              </fieldset>

              {transferencia && (
                <div className="space-y-3" data-detalle-medio="Transferencia">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo etiqueta="N° de operación" error={ver("referencia")}><input id="sep-referencia" className="field-input cifra" value={a.referencia} autoComplete="off" placeholder="Ej. 00123456" onChange={(e) => cambiarA("referencia", S.filtrarReferencia(e.target.value))} /></Campo>
                    <Campo etiqueta="Gerente que confirmó el ingreso" error={ver("confirmador")}>
                      <select id="sep-confirmador" className="field-input" value={a.confirmador} onChange={(e) => cambiarA("confirmador", e.target.value)}>
                        <option value="">Elige al gerente</option>
                        {form.gerentes.map((g) => <option key={g.codusu} value={g.codusu}>{g.nombre}</option>)}
                      </select>
                    </Campo>
                  </div>
                  <Campo etiqueta="Captura de la transferencia" error={ver("archivo")} ayuda="Imagen JPG, PNG o WEBP, o PDF, de hasta 5 MB. Se guarda como evidencia; por sí sola no confirma el pago.">
                    {a.archivo
                      ? <VistaCaptura archivo={a.archivo} guardada={captura?.firma === CAPTURA_DE(a.archivo)} onQuitar={() => { cambiarA("archivo", null); if (archivoRef.current) archivoRef.current.value = ""; }} />
                      : <input id="sep-captura" ref={archivoRef} type="file" accept={S.TIPOS_CAPTURA.join(",")} className="field-input" onChange={(e) => { const f = e.target.files?.[0] || null; cambiarA("archivo", f); if (f) setErr((p) => ({ ...p, archivo: S.errorCaptura(f) || undefined })); }} />}
                  </Campo>
                  <label className="flex items-start gap-2.5 text-[13.5px]" data-casilla-confirmado>
                    <input id="sep-confirmado" type="checkbox" className="mt-0.5 h-4 w-4 accent-marino-700" checked={a.confirmado} onChange={(e) => cambiarA("confirmado", e.target.checked)} />
                    <span>{soyGerenteConfirmador ? "Confirmé que el adelanto ingresó a la cuenta de la empresa." : `${gerente ? gerente.nombre : "El gerente"} confirmó que el adelanto ingresó a la cuenta de la empresa.`}</span>
                  </label>
                  {ver("confirmado") && <p className="text-[12px] font-medium text-acento">{ver("confirmado")}</p>}
                </div>
              )}
              {efectivo && (
                <label className="flex items-start gap-2.5 text-[13.5px]" data-casilla-confirmado>
                  <input id="sep-confirmado" type="checkbox" className="mt-0.5 h-4 w-4 accent-marino-700" checked={a.confirmado} onChange={(e) => cambiarA("confirmado", e.target.checked)} />
                  <span>Recibí el dinero en efectivo. La recepción queda registrada a mi nombre.</span>
                </label>
              )}
              {efectivo && ver("confirmado") && <p className="text-[12px] font-medium text-acento">{ver("confirmado")}</p>}
              {a.medio && (
                <Campo etiqueta={efectivo ? "Observación de la recepción" : "Observación (opcional)"} error={ver("observacion")} ayuda={`${largo(a.observacion)}/${S.MAX_OBSERVACION}${efectivo ? ". Ej.: recibido en la sede Ancón, recibo N° 0012" : ""}`}>
                  <textarea id="sep-observacion" className="field-input" rows={2} maxLength={S.MAX_OBSERVACION + 20} value={a.observacion} onChange={(e) => cambiarA("observacion", e.target.value)} />
                </Campo>
              )}
            </section>

            {/* Techo: decisión del comprador. «Por definir» no deja nada pendiente en Preparación */}
            <section aria-labelledby="sep-techo" className="space-y-3">
              <h3 id="sep-techo" className="text-[15px] font-bold text-marino dark:text-white">Techo</h3>
              <fieldset>
                <legend className="field-label">¿Qué decidió el comprador?</legend>
                <div className="grid gap-2 sm:grid-cols-3" data-techo-opciones>
                  <Opcion nombre="sep-techo" valor={S.POR_DEFINIR} actual={decision} titulo="Por definir" texto="Aún no decide. La separación queda activa y el techo se registra después."
                    onElegir={(v) => { setDecision(v); setErr((p) => ({ ...p, techo: undefined })); }} />
                  {tipoSin && <Opcion nombre="sep-techo" valor={S.SIN_TECHO} actual={decision} titulo="Sin techo" texto="Eligió la moto sin techo. No queda armado pendiente."
                    onElegir={(v) => { setDecision(v); setErr((p) => ({ ...p, techo: undefined })); }} />}
                  {tiposCon.length > 0 && <Opcion nombre="sep-techo" valor={S.CON_TECHO} actual={decision} titulo="Con techo" texto="Eligió un techo. Si requiere instalación, queda pendiente en Preparación."
                    onElegir={(v) => { setDecision(v); setErr((p) => ({ ...p, techo: undefined })); }} />}
                </div>
              </fieldset>
              {decision === S.CON_TECHO && (
                <Campo etiqueta="Tipo de techo" error={ver("techo")}>
                  <select id="sep-tipo-techo" className="field-input" value={codtteCon} onChange={(e) => { setCodtteCon(e.target.value); tocar("techo"); setErr((p) => ({ ...p, techo: undefined })); }}>
                    <option value="">Elige el tipo de techo</option>
                    {tiposCon.map((t) => <option key={t.codtte} value={t.codtte}>{t.nombre}{t.requiereInstalacion ? " (requiere instalación)" : ""}</option>)}
                  </select>
                </Campo>
              )}
              {decision !== S.CON_TECHO && ver("techo") && <p className="text-[12px] font-medium text-acento">{ver("techo")}</p>}
              {configurado && (
                <p className="text-[12.5px] text-slate-500" data-techo-configurado={configurado.nombre}>
                  Esta moto ya tiene configurado «{configurado.nombre}».{cambiaConfigurado ? " Al guardar se reemplaza por el que eligió el comprador; si lleva proveedor, se asigna en su ficha." : decision === S.POR_DEFINIR ? " Se mantiene así hasta que el comprador decida." : ""}
                </p>
              )}
            </section>

            {/* Responsable */}
            <section aria-labelledby="sep-responsable-titulo" className="space-y-3">
              <h3 id="sep-responsable-titulo" className="text-[15px] font-bold text-marino dark:text-white">Responsable</h3>
              <Campo etiqueta="Quién atiende esta separación" error={ver("responsable")}>
                <select id="sep-responsable" className="field-input" value={responsable} onChange={(e) => { setResponsable(e.target.value); tocar("responsable"); setErr((p) => ({ ...p, responsable: undefined })); }}>
                  <option value="">Elige al responsable</option>
                  {form.responsables.map((r) => <option key={r.codusu} value={r.codusu}>{r.nombre} ({r.rol}){r.codusu === form.usuarioActual.codusu ? ", tú" : ""}</option>)}
                </select>
              </Campo>
            </section>
          </>
        )}
        {err.general && <Aviso tipo={bloqueada ? "aviso" : "error"}><span data-error-general>{err.general}</span></Aviso>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Ficha de la moto: separación activa con su comprador, adelanto, confirmación, techo y captura
// ---------------------------------------------------------------------------------------------
// Texto del techo de la separación: decisión del comprador y, si eligió techo, cómo va su armado
function textoTechoSeparacion(s) {
  const d = s.decisionTecho;
  if (!d) return s.techo?.nombre ? s.techo.nombre : "Sin dato"; // base sin la versión del 8 de noviembre
  if (d.decision === S.POR_DEFINIR) return `Por definir: el comprador aún no decide${s.techo?.nombre ? `. La moto tiene configurado «${s.techo.nombre}»` : ""}`;
  if (d.decision === S.SIN_TECHO) return "Sin techo, elegido por el comprador";
  const mismo = s.techo?.codtte === d.codtte;
  const avance = mismo && d.requiereInstalacion ? S.ESTADO_TECHO[s.techo.estado] || "por armar" : "";
  return `${d.nombre}, elegido por el comprador${avance ? `, ${avance}` : ""}${mismo && s.techo?.proveedor ? ` con ${s.techo.proveedor}` : ""}`;
}

export function SeparacionActivaCard({ unidad, puedeTecho = true, onCambio }) {
  const toast = useToast();
  const activo = unidad?.comercial === "Separada";
  const configTecho = unidad?.preparacion?.techo?.configuracion || "";
  const consulta = useConsultaCentral(() => S.separacionActivaApi(unidad.coduni), [unidad?.coduni, configTecho], { activo, intervalo: 15000, clave: `separacion:${unidad?.coduni}` });
  const [eligiendo, setEligiendo] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [pendiente, setPendiente] = useState(() => S.leerTechoPendiente(unidad?.coduni));
  const s = consulta.data;
  const d = s?.decisionTecho;
  // Techo elegido al separar que no se llegó a guardar: vale mientras la separación siga «Por definir»
  const pendienteVigente = Boolean(s && d && pendiente && pendiente.codsep === String(s.codsep) && d.decision === S.POR_DEFINIR);
  useEffect(() => {
    if (s && pendiente && !pendienteVigente) { S.borrarTechoPendiente(unidad.coduni); setPendiente(null); }
  }, [s, pendiente, pendienteVigente, unidad?.coduni]);
  if (!activo) return null;
  async function verCaptura() {
    const ventana = window.open("", "_blank");
    try { const url = await S.urlCapturaApi(s.rutaEvidencia); if (ventana) ventana.location.href = url; else window.open(url, "_blank"); }
    catch (e) { ventana?.close(); toast(mensajeError(e), "error"); }
  }
  const guardado = () => { S.borrarTechoPendiente(unidad.coduni); setPendiente(null); consulta.refrescar(true); onCambio?.(); };
  async function reintentarPendiente() {
    setReintentando(true);
    try { await S.elegirTechoApi(unidad.coduni, pendiente.codtte); toast("Techo guardado"); guardado(); }
    catch (e) { toast(`No se pudo guardar el techo: ${sinRespuesta(e) ? "falló la conexión" : mensajeError(e)}`, "error"); }
    finally { setReintentando(false); }
  }
  const filas = s ? [
    ["Comprador", S.textoComprador(s.comprador) || "Sin dato"],
    ["Adelanto", `${S.soles(s.monto)} en ${String(s.medioPago).toLowerCase()}${s.referencia ? `, operación ${s.referencia}` : ""}${s.fechaPago ? `, del ${fechaLarga(s.fechaPago)}` : ""}`],
    [s.medioPago === "Transferencia" ? "Ingreso confirmado por" : "Recibido por", s.confirmador ? `${s.confirmador.nombre}${s.fechaConfirmacion ? `, ${fechaCompleta(s.fechaConfirmacion)}` : ""}` : "Sin constancia"],
    ["Responsable", s.responsable?.nombre || "Sin responsable"],
    ["Registrada", `${fechaCompleta(s.fechaRegistro)}${s.autor ? `, por ${s.autor.nombre}` : ""}`],
    ...(s.observacion ? [["Observación", s.observacion]] : []),
  ] : [];
  return (
    <Card data-separacion-activa={s?.codsep || ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-marino dark:text-white">Separación activa</h2>
          <p className="text-[13px] text-slate-500">La moto está comprometida para este comprador. Su ubicación y preparación siguen su curso.</p>
        </div>
        {s?.rutaEvidencia && <button className="btn btn-secondary !py-2 text-[13px]" onClick={verCaptura} data-ver-captura>Ver captura</button>}
      </div>
      {consulta.error && !s && <div className="mt-3"><Aviso tipo="error">{S.faltaInstalar(consulta.error) ? S.FALTA_INSTALAR : `No se pudo cargar la separación: ${mensajeError(consulta.error)}`}</Aviso></div>}
      {!s && !consulta.error && <p className="mt-3 text-[13px] text-slate-500">{consulta.cargando ? "Cargando la separación…" : "La moto figura separada, pero no se encontró su registro de separación."}</p>}
      {s && (
        <dl className="mt-3 divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
          {filas.slice(0, 2).map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]"><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-marino dark:text-white">{v}</dd></div>)}
          <div className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]" data-techo-separacion={pendienteVigente ? "pendiente de guardar" : d?.decision || ""}>
            <dt className="text-slate-500">Techo</dt>
            <dd>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className={`font-semibold ${d?.decision === S.POR_DEFINIR ? "text-amber-700 dark:text-amber-300" : "text-marino dark:text-white"}`}>{pendienteVigente ? `${pendiente.nombre}, elegido por el comprador: pendiente de guardar` : textoTechoSeparacion(s)}</span>
                {puedeTecho && d && <button type="button" className="text-[13px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => setEligiendo(true)} data-elegir-techo>{d.decision === S.POR_DEFINIR ? "Elegir techo" : "Cambiar techo"}</button>}
              </div>
              {d?.por && d.decision !== S.POR_DEFINIR && <p className="mt-0.5 text-[12px] text-slate-500">Registrado por {d.por}{d.fecha ? `, ${fechaCompleta(d.fecha)}` : ""}</p>}
              {pendienteVigente && (
                <div className="mt-2"><Aviso tipo="aviso">
                  <span data-techo-pendiente>La separación está activa, pero el techo que eligió el comprador no se llegó a guardar. Reintenta: solo se guarda el techo.</span>{" "}
                  {puedeTecho && <button type="button" className="font-semibold underline" onClick={reintentarPendiente} disabled={reintentando} data-reintentar-techo>{reintentando ? "Guardando…" : "Reintentar"}</button>}
                </Aviso></div>
              )}
            </dd>
          </div>
          {filas.slice(2).map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]"><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-marino dark:text-white">{v}</dd></div>)}
        </dl>
      )}
      {eligiendo && s && <ElegirTechoModal unidad={unidad} separacion={s} pendiente={pendienteVigente ? pendiente : null} onClose={() => setEligiendo(false)} onGuardado={() => { setEligiendo(false); guardado(); }} />}
    </Card>
  );
}

// Elegir o cambiar el techo de una moto ya separada (los tres roles comerciales). Una vez que el comprador decidió,
// se puede cambiar de techo, pero no volver a «Por definir».
function ElegirTechoModal({ unidad, separacion, pendiente, onClose, onGuardado }) {
  const toast = useToast();
  const d = separacion.decisionTecho || {};
  const [tipos, setTipos] = useState(null); const [errCarga, setErrCarga] = useState(null);
  const [decision, setDecision] = useState(""); const [codtteCon, setCodtteCon] = useState("");
  const [error, setError] = useState(""); const [guardando, setGuardando] = useState(false); const [intentado, setIntentado] = useState(false);
  const cargar = useCallback(() => {
    setErrCarga(null);
    S.formularioSeparacionApi().then((f) => {
      const lista = f.tiposTecho || [];
      setTipos(lista);
      const base = pendiente?.codtte || (d.decision !== S.POR_DEFINIR ? d.codtte : "");
      const t = lista.find((x) => x.codtte === base);
      if (t) { const sin = t === S.tipoSinTecho(lista); setDecision(sin ? S.SIN_TECHO : S.CON_TECHO); setCodtteCon(sin ? "" : t.codtte); }
    }).catch(setErrCarga);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [cargar]);
  const tipoSin = S.tipoSinTecho(tipos || []);
  const tiposCon = S.tiposConTecho(tipos || []);
  const elegido = S.tipoDeDecision(tipos || [], decision, codtteCon);
  const instalado = separacion.techo?.estado === "Instalado" || separacion.techo?.estado === "En proceso";
  const cambiaArmado = Boolean(elegido && instalado && separacion.techo?.codtte && elegido.codtte !== separacion.techo.codtte);
  const falta = !decision ? "Elige qué decidió el comprador." : decision === S.CON_TECHO && !elegido ? "Elige el tipo de techo." : "";
  async function guardar(ev) {
    ev.preventDefault();
    setIntentado(true);
    if (falta || guardando) return;
    setGuardando(true); setError("");
    try { await S.elegirTechoApi(unidad.coduni, elegido.codtte); toast("Techo guardado"); onGuardado(); }
    catch (e) { setError(S.faltaInstalar(e) ? S.FALTA_INSTALAR : sinRespuesta(e) ? "No se pudo confirmar si el techo se guardó porque falló la conexión. Vuelve a pulsar «Guardar techo»: no se duplica nada." : `No se pudo guardar el techo: ${mensajeError(e)}`); }
    finally { setGuardando(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo={d.decision === S.POR_DEFINIR ? "Elegir techo" : "Cambiar techo"} ancho="max-w-lg" sinAvisoCambios pie={<>
      <button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button>
      <button form="f-elegir-techo" className="btn btn-primary !py-2" disabled={guardando || !tipos} data-guardar-techo>{guardando ? "Guardando…" : "Guardar techo"}</button>
    </>}>
      <form id="f-elegir-techo" onSubmit={guardar} className="space-y-4" noValidate data-elegir-techo-modal={unidad.coduni}>
        <p className="text-[13.5px] text-slate-600 dark:text-slate-300">Registra lo que decidió {S.nombreComprador(separacion.comprador) || "el comprador"}. Si todavía no decide, cierra esta ventana: la separación sigue con el techo por definir.</p>
        {errCarga && <Aviso tipo="error">No se pudieron cargar los tipos de techo: {mensajeError(errCarga)} <button type="button" className="font-semibold underline" onClick={cargar}>Reintentar</button></Aviso>}
        {!tipos && !errCarga && <p className="text-[13.5px] text-slate-500">Cargando los tipos de techo…</p>}
        {tipos && (
          <>
            <fieldset>
              <legend className="field-label">¿Qué decidió el comprador?</legend>
              <div className="grid gap-2 sm:grid-cols-2" data-techo-opciones>
                {tipoSin && <Opcion nombre="ficha-techo" valor={S.SIN_TECHO} actual={decision} titulo="Sin techo" texto="Eligió la moto sin techo. No queda armado pendiente." onElegir={(v) => { setDecision(v); setError(""); }} />}
                {tiposCon.length > 0 && <Opcion nombre="ficha-techo" valor={S.CON_TECHO} actual={decision} titulo="Con techo" texto="Si requiere instalación, queda pendiente en Preparación." onElegir={(v) => { setDecision(v); setError(""); }} />}
              </div>
            </fieldset>
            {decision === S.CON_TECHO && (
              <Campo etiqueta="Tipo de techo" error={intentado && !elegido ? "Elige el tipo de techo." : undefined}>
                <select id="ficha-tipo-techo" className="field-input" value={codtteCon} onChange={(e) => { setCodtteCon(e.target.value); setError(""); }}>
                  <option value="">Elige el tipo de techo</option>
                  {tiposCon.map((t) => <option key={t.codtte} value={t.codtte}>{t.nombre}{t.requiereInstalacion ? " (requiere instalación)" : ""}</option>)}
                </select>
              </Campo>
            )}
            {intentado && !decision && <p className="text-[12px] font-medium text-acento">{falta}</p>}
            {cambiaArmado && <Aviso tipo="aviso">La moto ya tiene «{separacion.techo.nombre}» {separacion.techo.estado === "Instalado" ? "instalado" : "en armado"}. Si cambias el techo, su preparación vuelve a empezar.</Aviso>}
          </>
        )}
        {error && <Aviso tipo="error"><span data-error-techo>{error}</span></Aviso>}
      </form>
    </Modal>
  );
}
