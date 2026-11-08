// HU-005 · Separar una moto con adelanto confirmado (base central)
// Gerente, administradora y vendedores registran la separación en una sola ventana: comprador (se busca por su
// documento o se registra), adelanto (transferencia con captura y gerente que confirmó el ingreso, o efectivo con su
// observación de recepción), techo que eligió el cliente y responsable. El servidor vuelve a comprobar que la moto
// siga libre: si otra persona la separó o vendió antes, no se guarda nada y se avisa. La moto se vende con o sin
// techo: si el cliente elige uno, queda pendiente de armado en Preparación. La ubicación no cambia.
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
const COMPRADOR_VACIO = { nombres: "", apellidoPaterno: "", apellidoMaterno: "", telefono: "", correo: "" };
const largo = (t) => [...S.limpio(t)].length;

// Resumen de la moto en la cabecera
function CabeceraMoto({ unidad }) {
  const x = ubicacionDe(unidad);
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 text-[13.5px] dark:bg-white/5" data-cabecera-unidad={unidad.coduni}>
      <p className="font-semibold text-marino dark:text-white">{unidad.nommod} · motor {unidad.nummotuni}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-slate-500"><ColorUnidad color={unidad.coluni} /><span>Chasis {unidad.chauni}</span><span>{x.texto}</span></p>
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
  const [codtdo, setCodtdo] = useState(""); const [numero, setNumero] = useState("");
  const [busqueda, setBusqueda] = useState({ estado: "inicial" }); // inicial | buscando | encontrado | nuevo | error
  const [nuevo, setNuevo] = useState(COMPRADOR_VACIO);
  const [a, setA] = useState(ADELANTO_VACIO);
  const [responsable, setResponsable] = useState("");
  const [captura, setCaptura] = useState(null); // { firma, ruta } de la captura ya guardada
  const [err, setErr] = useState({}); const [enviando, setEnviando] = useState(""); const [bloqueada, setBloqueada] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [techo, setTecho] = useState(""); // codtte del techo que eligió el cliente
  const [tocados, setTocados] = useState({}); const [intentado, setIntentado] = useState(false);
  const [techoGuardando, setTechoGuardando] = useState(false);
  const busquedaVigente = useRef(0);
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
      setCodtdo((x) => x || f.tiposDocumento.find((t) => t.nombre === "DNI")?.codtdo || f.tiposDocumento[0]?.codtdo || "");
      setResponsable((x) => x || (f.responsables.some((r) => r.codusu === f.usuarioActual.codusu) ? f.usuarioActual.codusu : ""));
      const yoGerente = f.usuarioActual.rol === "Gerente";
      setA((x) => ({ ...x, confirmador: x.confirmador || (yoGerente ? f.usuarioActual.codusu : f.gerentes.length === 1 ? f.gerentes[0].codusu : "") }));
      setTecho((x) => x || f.tiposTecho?.[0]?.codtte || ""); // «Sin techo» viene primero
    }).catch(setErrCarga);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const tipo = form?.tiposDocumento.find((t) => t.codtdo === codtdo)?.nombre || "";
  const regla = S.REGLAS_DOCUMENTO[tipo] || { max: 20, ayuda: "" };
  const empresa = S.esEmpresa(tipo, busqueda.numero || numero);
  const comprador = busqueda.estado === "encontrado" ? busqueda.comprador : null;
  const transferencia = a.medio === "Transferencia";
  const efectivo = a.medio === "Efectivo";
  const gerente = form?.gerentes.find((g) => g.codusu === a.confirmador);
  const nombreDe = (codusu) => form?.responsables.find((r) => r.codusu === codusu)?.nombre || form?.gerentes.find((g) => g.codusu === codusu)?.nombre || "";
  const soyGerenteConfirmador = form?.usuarioActual.rol === "Gerente" && a.confirmador === form?.usuarioActual.codusu;
  const tipoTecho = form?.tiposTecho?.find((t) => t.codtte === techo) || null;
  const tocar = (k) => setTocados((p) => (p[k] ? p : { ...p, [k]: true }));
  const cambiarA = (k, v) => { setA((p) => ({ ...p, [k]: v })); tocar(k); setErr((e) => ({ ...e, [k]: undefined, general: undefined })); };
  const cambiarNuevo = (k, v) => { setNuevo((p) => ({ ...p, [k]: v })); tocar(`c_${k}`); setErr((e) => ({ ...e, [`c_${k}`]: undefined, comprador: undefined })); };

  // Buscar al comprador por su documento (único en la base)
  async function buscar(n = numero) {
    const e = S.errorDocumento(tipo, n);
    if (e) { setErr((p) => ({ ...p, documento: e })); return; }
    const vez = ++busquedaVigente.current;
    setErr((p) => ({ ...p, documento: undefined, comprador: undefined }));
    setBusqueda({ estado: "buscando", numero: n });
    try {
      const c = await S.buscarCompradorApi(n);
      if (vez !== busquedaVigente.current) return;
      setBusqueda(c ? { estado: "encontrado", comprador: c, numero: n } : { estado: "nuevo", numero: n });
      if (!c) setNuevo(COMPRADOR_VACIO);
    } catch (er) {
      if (vez !== busquedaVigente.current) return;
      setBusqueda({ estado: "error", numero: n, mensaje: S.faltaInstalar(er) ? S.FALTA_INSTALAR : mensajeError(er) });
    }
  }
  function escribirNumero(v) {
    const n = S.filtrarDocumento(tipo, v);
    setNumero(n);
    if (n !== busqueda.numero) { busquedaVigente.current++; setBusqueda({ estado: "inicial" }); }
    setErr((p) => ({ ...p, documento: undefined, comprador: undefined }));
    // DNI y RUC completos se buscan solos
    if ((tipo === "DNI" && n.length === 8) || (tipo === "RUC" && n.length === 11)) { if (!S.errorDocumento(tipo, n)) buscar(n); }
  }
  function cambiarTipo(v) { setCodtdo(v); setNumero(""); busquedaVigente.current++; setBusqueda({ estado: "inicial" }); setErr((p) => ({ ...p, documento: undefined, comprador: undefined })); }

  // Errores del formulario tal como está ahora (se muestran en vivo en los campos ya tocados)
  function calcularErrores() {
    const e = {};
    if (busqueda.estado === "nuevo") Object.assign(e, Object.fromEntries(Object.entries(S.erroresCompradorNuevo(tipo, busqueda.numero, nuevo)).map(([k, v]) => [`c_${k}`, v])));
    else if (busqueda.estado === "encontrado") { if (!comprador.activo) e.comprador = "Este comprador está inactivo: no se puede separar a su nombre."; }
    else e.documento = S.errorDocumento(tipo, numero) || (busqueda.estado === "buscando" ? "Espera a que termine la búsqueda del comprador." : "Busca al comprador por su documento.");
    const monto = Number(a.monto);
    if (!a.monto || !Number.isFinite(monto) || monto <= 0) e.monto = "Escribe el monto del adelanto (mayor que cero).";
    else if (monto > S.MAX_MONTO) e.monto = "El monto es demasiado alto.";
    if (!a.fecha) e.fecha = "Indica la fecha en que se recibió el adelanto.";
    else if (a.fecha > S.hoyLima()) e.fecha = "La fecha no puede ser posterior a hoy.";
    if (!a.medio) e.medio = "Elige cómo se pagó el adelanto.";
    if (transferencia) {
      if (!S.limpio(a.referencia)) e.referencia = "Escribe el número de operación de la transferencia.";
      else if (largo(a.referencia) > S.MAX_REFERENCIA) e.referencia = `Máximo ${S.MAX_REFERENCIA} caracteres.`;
      const yaGuardada = captura && captura.firma === CAPTURA_DE(a.archivo);
      if (!yaGuardada) { const c = S.errorCaptura(a.archivo); if (c) e.archivo = c; }
      if (!gerente) e.confirmador = "Elige al gerente que confirmó el ingreso.";
      if (!a.confirmado) e.confirmado = "La captura sola no confirma el pago. Marca esta casilla solo cuando el gerente haya confirmado que el dinero ingresó.";
      if (largo(a.observacion) > S.MAX_OBSERVACION) e.observacion = `Máximo ${S.MAX_OBSERVACION} caracteres.`;
    }
    if (efectivo) {
      if (!S.limpio(a.observacion)) e.observacion = "Describe la recepción: quién recibió el dinero, dónde y el N° de recibo si lo hay.";
      else if (largo(a.observacion) > S.MAX_OBSERVACION) e.observacion = `Máximo ${S.MAX_OBSERVACION} caracteres.`;
      if (!a.confirmado) e.confirmado = "Confirma que recibiste el dinero en efectivo.";
    }
    if (form?.tiposTecho?.length && !tipoTecho) e.techo = "Elige si la moto lleva techo y cuál.";
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
    let elegido = comprador;
    try {
      // 1) Comprador nuevo
      if (busqueda.estado === "nuevo") {
        setEnviando("Registrando al comprador…");
        try {
          elegido = await S.registrarCompradorApi({
            codtdo: Number(codtdo), numeroDocumento: busqueda.numero, nombres: S.limpio(nuevo.nombres),
            apellidoPaterno: empresa ? null : S.limpio(nuevo.apellidoPaterno) || null, apellidoMaterno: empresa ? null : S.limpio(nuevo.apellidoMaterno) || null,
            telefono: nuevo.telefono, correo: S.limpio(nuevo.correo).toLowerCase(),
          });
        } catch (er) {
          setErr({ comprador: S.faltaInstalar(er) ? S.FALTA_INSTALAR : sinRespuesta(er) ? "No se pudo confirmar si el comprador se registró porque falló la conexión. Vuelve a intentarlo: no se duplicará." : `No se pudo registrar al comprador: ${mensajeError(er)}` });
          return;
        }
        setBusqueda({ estado: "encontrado", comprador: elegido, numero: busqueda.numero, registrado: !elegido.existente });
        if (!elegido.activo) { setErr({ comprador: "Ese documento ya pertenece a un comprador inactivo: no se puede separar a su nombre." }); return; }
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
        codcli: Number(elegido.codcli), codusuResponsable: Number(responsable), monto: Number(Number(a.monto).toFixed(2)), fechaPago: a.fecha, medioPago: a.medio,
        referencia: transferencia ? S.limpio(a.referencia) : null, rutaEvidencia: ruta, observacion: S.limpio(a.observacion) || null, ingresoConfirmado: true,
        ...(transferencia ? { codusuConfirmador: Number(a.confirmador) } : {}),
      };
      setEnviando("Separando la moto…");
      const r = await S.separarMotoApi(unidad.coduni, cuerpo, intento(JSON.stringify({ u: unidad.coduni, ...cuerpo })));
      const sep = r.data || {};
      // 4) Techo que eligió el cliente (si falla, la separación ya quedó y se puede reintentar)
      let techoError = "";
      if (tipoTecho) {
        setEnviando("Guardando el techo…");
        try { await S.elegirTechoApi(unidad.coduni, tipoTecho.codtte); }
        catch (er) { techoError = S.faltaInstalar(er) ? S.FALTA_INSTALAR : mensajeError(er); }
      }
      setHecho({ ...sep, reutilizada: r.status === 200 || sep.reutilizada === true, comprador: elegido, techo: tipoTecho, techoError });
      toast(r.status === 200 ? "La separación ya estaba guardada" : "Moto separada");
      onHecho?.(sep);
    } catch (er) {
      if (S.faltaInstalar(er)) setErr({ general: S.FALTA_INSTALAR });
      else if (sinRespuesta(er)) setErr({ general: NO_CONFIRMADO });
      else if (er.status === 409) {
        setBloqueada(true); onConflicto?.();
        setErr({ general: `${mensajeError(er)}. No se guardó esta separación: alguien comprometió la moto antes (o ya quedó guardado un intento anterior). Revisa su ficha para ver a nombre de quién quedó.` });
      } else if (/captura/i.test(er.message || "")) { setCaptura(null); setErr({ archivo: `${mensajeError(er)}. Vuelve a adjuntarla.` }); }
      else if (/confirmador/i.test(er.message || "")) setErr({ confirmador: mensajeError(er) });
      else if (/comprador/i.test(er.message || "")) setErr({ comprador: mensajeError(er) });
      else if (/responsable/i.test(er.message || "")) setErr({ responsable: mensajeError(er) });
      else setErr({ general: mensajeError(er) });
    } finally { setEnviando(""); verError(); }
  }

  async function reintentarTecho() {
    setTechoGuardando(true);
    try { await S.elegirTechoApi(unidad.coduni, hecho.techo.codtte); setHecho((h) => ({ ...h, techoError: "" })); onHecho?.(); }
    catch (er) { setHecho((h) => ({ ...h, techoError: mensajeError(er) })); }
    finally { setTechoGuardando(false); }
  }

  // ---------------------------------------------------------------------------------------------
  // Separación guardada
  if (hecho) {
    const porArmar = Boolean(hecho.techo?.requiereInstalacion);
    const filas = [
      ["Comprador", `${S.nombreComprador(hecho.comprador)} (${hecho.comprador.tipoDocumento} ${hecho.comprador.numeroDocumento})`],
      ["Adelanto", `${S.soles(hecho.monto)} en ${String(hecho.medioPago).toLowerCase()}${hecho.referencia ? `, operación ${hecho.referencia}` : ""}, del ${fechaLarga(hecho.fechaPago)}`],
      [hecho.medioPago === "Transferencia" ? "Ingreso confirmado por" : "Recibido por", nombreDe(String(hecho.confirmadoPor))],
      ...(hecho.techo ? [["Techo", `${hecho.techo.nombre}${porArmar ? ", pendiente de armado en Preparación" : ""}`]] : []),
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
          <CabeceraMoto unidad={unidad} />
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            {filas.map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]"><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-marino dark:text-white">{v}</dd></div>)}
          </dl>
          {hecho.techoError && (
            <Aviso tipo="aviso"><span data-techo-error>La moto quedó separada, pero no se guardó el techo: {hecho.techoError}</span>{" "}
              <button type="button" className="font-semibold underline" onClick={reintentarTecho} disabled={techoGuardando}>{techoGuardando ? "Guardando…" : "Reintentar"}</button>
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
  const textoConfirmar = `${unidad.nommod} motor ${unidad.nummotuni} quedará separada para ${comprador ? S.nombreComprador(comprador) : S.limpio(nuevo.nombres) || "el comprador"} con un adelanto de ${a.monto ? S.soles(a.monto) : "S/ 0"}${transferencia && gerente ? ` (ingreso confirmado por ${gerente.nombre})` : efectivo ? " recibido en efectivo" : ""}${tipoTecho ? (tipoTecho.requiereInstalacion ? `, con techo ${tipoTecho.nombre} por armar` : ", sin techo") : ""}. Ya no figurará libre para los demás.`;

  return (
    <Modal abierto onClose={onClose} titulo="Separar moto" ancho="max-w-2xl" sinAvisoCambios={Boolean(enviando)}
      confirmarGuardar={{ titulo: "¿Separar esta moto?", texto: textoConfirmar, boton: "Sí, separar", validar }} pie={pie}>
      <form id="f-separar" ref={formRef} onSubmit={guardar} className="space-y-6" noValidate data-separar-modal={unidad.coduni}>
        <CabeceraMoto unidad={unidad} />
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
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <Campo etiqueta="Tipo de documento">
                  <select id="sep-tipo-doc" className="field-input" value={codtdo} onChange={(e) => cambiarTipo(e.target.value)} disabled={Boolean(enviando)}>
                    {form.tiposDocumento.map((t) => <option key={t.codtdo} value={t.codtdo}>{t.nombre}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Número de documento" error={ver("documento")} ayuda={regla.ayuda}>
                  <div className="flex gap-2">
                    <input id="sep-num-doc" className="field-input" value={numero} inputMode={regla.numerico ? "numeric" : "text"} autoComplete="off" maxLength={regla.max} disabled={Boolean(enviando)}
                      onChange={(e) => escribirNumero(e.target.value)} onBlur={() => tocar("documento")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }} placeholder={tipo === "DNI" ? "Ej. 45879632" : ""} />
                    <button type="button" className="btn btn-secondary shrink-0 !py-2" onClick={() => buscar()} disabled={busqueda.estado === "buscando" || Boolean(enviando)} data-buscar-comprador>{busqueda.estado === "buscando" ? "Buscando…" : "Buscar"}</button>
                  </div>
                </Campo>
              </div>

              {busqueda.estado === "error" && <Aviso tipo="error">No se pudo buscar al comprador: {busqueda.mensaje} <button type="button" className="font-semibold underline" onClick={() => buscar(busqueda.numero)}>Reintentar</button></Aviso>}
              {comprador && (
                <div className={`rounded-xl border p-3.5 text-[13.5px] ${comprador.activo ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"}`} data-comprador={comprador.codcli} data-comprador-estado={busqueda.registrado ? "registrado" : "encontrado"}>
                  <p className="font-semibold text-marino dark:text-white">{S.nombreComprador(comprador)}</p>
                  <p className="text-slate-500">{comprador.tipoDocumento} {comprador.numeroDocumento}{comprador.telefono ? `, teléfono ${comprador.telefono}` : ""}{comprador.correo ? `, ${comprador.correo}` : ""}</p>
                  <p className="mt-1 text-[12.5px] text-slate-500">{!comprador.activo ? "Comprador inactivo: no se puede separar a su nombre." : busqueda.registrado ? "Comprador registrado." : "Comprador ya registrado en el sistema."}</p>
                </div>
              )}
              {busqueda.estado === "nuevo" && (
                <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-3.5 dark:border-white/15" data-comprador-estado="nuevo">
                  <p className="text-[13px] text-slate-600 dark:text-slate-300">No hay un comprador con {tipo} {busqueda.numero}. Completa sus datos: se registrará al separar.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo etiqueta={empresa ? "Razón social" : "Nombres"} error={ver("c_nombres")} className={empresa ? "sm:col-span-2" : ""}>
                      <input id="sep-nombres" className="field-input" value={nuevo.nombres} maxLength={100} onChange={(e) => cambiarNuevo("nombres", empresa ? S.soloRazonSocial(e.target.value) : S.soloNombre(e.target.value))} />
                    </Campo>
                    {!empresa && (
                      <>
                        <Campo etiqueta="Apellido paterno" error={ver("c_apellidoPaterno")}><input id="sep-paterno" className="field-input" value={nuevo.apellidoPaterno} maxLength={100} onChange={(e) => cambiarNuevo("apellidoPaterno", S.soloNombre(e.target.value))} /></Campo>
                        <Campo etiqueta="Apellido materno (opcional)" error={ver("c_apellidoMaterno")}><input id="sep-materno" className="field-input" value={nuevo.apellidoMaterno} maxLength={100} onChange={(e) => cambiarNuevo("apellidoMaterno", S.soloNombre(e.target.value))} /></Campo>
                      </>
                    )}
                    <Campo etiqueta="Celular" error={ver("c_telefono")} ayuda="9 dígitos, empieza con 9"><input id="sep-telefono" className="field-input cifra" inputMode="numeric" autoComplete="off" placeholder="9XXXXXXXX" value={nuevo.telefono} maxLength={9} onChange={(e) => cambiarNuevo("telefono", S.filtrarTelefono(e.target.value))} /></Campo>
                    <Campo etiqueta="Correo" error={ver("c_correo")}><input id="sep-correo" type="email" className="field-input" placeholder="nombre@correo.com" value={nuevo.correo} maxLength={254} onChange={(e) => cambiarNuevo("correo", e.target.value.trim())} /></Campo>
                  </div>
                </div>
              )}
              {err.comprador && <Aviso tipo="error">{err.comprador}</Aviso>}
            </section>

            {/* Adelanto */}
            <section aria-labelledby="sep-adelanto" className="space-y-3">
              <h3 id="sep-adelanto" className="text-[15px] font-bold text-marino dark:text-white">Adelanto</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Monto (S/)" error={ver("monto")}>
                  <input id="sep-monto" className="field-input cifra" inputMode="decimal" value={a.monto} placeholder="0.00" onChange={(e) => cambiarA("monto", S.filtrarMonto(e.target.value))} />
                </Campo>
                <Campo etiqueta="Fecha en que se recibió" error={ver("fecha")}>
                  <input id="sep-fecha" type="date" className="field-input" value={a.fecha} max={S.hoyLima()} onChange={(e) => cambiarA("fecha", e.target.value)} />
                </Campo>
              </div>
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
                    <Campo etiqueta="N° de operación" error={ver("referencia")}><input id="sep-referencia" className="field-input" value={a.referencia} maxLength={S.MAX_REFERENCIA} onChange={(e) => cambiarA("referencia", e.target.value)} /></Campo>
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

            {/* Techo: lo elige el cliente. «Sin techo» viene marcado; con techo, la moto queda por armar en Preparación */}
            {form.tiposTecho?.length > 0 && (
              <section aria-labelledby="sep-techo" className="space-y-3">
                <h3 id="sep-techo" className="text-[15px] font-bold text-marino dark:text-white">Techo</h3>
                <fieldset>
                  <legend className="sr-only">Techo que eligió el cliente</legend>
                  <div className="grid gap-2 sm:grid-cols-2" data-techo-opciones>
                    {form.tiposTecho.map((t) => (
                      <Opcion key={t.codtte} nombre="sep-techo" valor={t.codtte} actual={techo} titulo={t.nombre}
                        texto={t.requiereInstalacion ? "Queda pendiente de armado en Preparación hasta instalarlo." : "Se entrega sin techo, sin armado pendiente."}
                        onElegir={(v) => { setTecho(v); tocar("techo"); setErr((p) => ({ ...p, techo: undefined })); }} />
                    ))}
                  </div>
                  {ver("techo") && <p className="mt-1 text-[12px] font-medium text-acento">{ver("techo")}</p>}
                </fieldset>
              </section>
            )}

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
// Ficha de la moto: separación activa con su comprador, adelanto, confirmación y captura
// ---------------------------------------------------------------------------------------------
export function SeparacionActivaCard({ unidad }) {
  const toast = useToast();
  const activo = unidad?.comercial === "Separada";
  const consulta = useConsultaCentral(() => S.separacionActivaApi(unidad.coduni), [unidad?.coduni], { activo, intervalo: 15000, clave: `separacion:${unidad?.coduni}` });
  if (!activo) return null;
  const s = consulta.data;
  async function verCaptura() {
    const ventana = window.open("", "_blank");
    try { const url = await S.urlCapturaApi(s.rutaEvidencia); if (ventana) ventana.location.href = url; else window.open(url, "_blank"); }
    catch (e) { ventana?.close(); toast(mensajeError(e), "error"); }
  }
  const filas = s ? [
    ["Comprador", `${S.nombreComprador(s.comprador)} (${s.comprador?.tipoDocumento} ${s.comprador?.numeroDocumento})${s.comprador?.telefono ? `, teléfono ${s.comprador.telefono}` : ""}`],
    ["Adelanto", `${S.soles(s.monto)} en ${String(s.medioPago).toLowerCase()}${s.referencia ? `, operación ${s.referencia}` : ""}${s.fechaPago ? `, del ${fechaLarga(s.fechaPago)}` : ""}`],
    ["Techo", s.techo?.nombre ? `${s.techo.nombre}${s.techo.requiereInstalacion ? (s.techo.estado === "Instalado" ? ", instalado" : s.techo.estado === "En proceso" ? ", en armado" : ", por armar") : ""}${s.techo.proveedor ? ` con ${s.techo.proveedor}` : ""}` : "Sin techo"],
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
          {filas.map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]"><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-marino dark:text-white">{v}</dd></div>)}
        </dl>
      )}
    </Card>
  );
}
