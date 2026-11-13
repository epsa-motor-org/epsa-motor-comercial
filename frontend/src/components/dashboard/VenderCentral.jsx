// HU-006 · Registrar una venta con cliente y unidad (base central)
// Gerente, administradora y vendedores registran la venta de una moto identificada (motor y chasis):
//   · Venta directa de una moto libre: comprador (nombres, apellidos y celular, sin documento; se puede completar
//     desde un interesado), techo (por definir, sin techo o con techo) y pagos recibidos.
//   · Venta desde una separación del mismo comprador: se conserva su adelanto (no se vuelve a sumar como pago) y su
//     decisión de techo; la separación queda convertida y deja de bloquear la moto.
// Siempre se guardan responsable, sede de atención, fecha, modalidad (contado o crédito) y la entrega prevista.
// Desglose (contrato de Michelle del 12 de noviembre): precio base (lista del modelo, no se escribe) + adicional del
// techo (el referencial del tipo, o el que se acordó con el comprador) = total, que calcula el servidor. Los números
// cuadran a la vista: total − adelanto − pagos = saldo. «Sin techo» suma 0; «Por definir» no suma hasta elegirlo.
// Una moto con techo configurado o instalado solo se vende con ese techo (o por definir). El servidor vuelve a
// validar todo; si otra persona vendió o separó la moto antes, no se guarda nada y se avisa (409).
// La venta no mueve la moto, no confirma llegada, preparación ni entrega y no emite comprobantes: si ya se emitió la
// boleta o factura fuera de la plataforma, se registra su serie, número y fecha reales.
import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeError } from "../../lib/errores";
import { fechaLarga } from "../../lib/validar";
import { sinRespuesta, useConsultaCentral, useIntento } from "../../servicios/central";
import { etapaConTechoComercial, ubicacionDe } from "../../servicios/inventarioCentral";
import * as S from "../../servicios/separacionCentral";
import * as V from "../../servicios/ventaCentral";
import { Aviso, Campo, Card, Modal, useToast } from "../ui";
import { IconCheck } from "../Icons";
import { BuscarInteresado, CabeceraMoto, ElegirTechoModal, Opcion, VistaCaptura } from "./SepararCentral";
import { BotonCancelar, NotaPermisoCancelar } from "./CancelarCentral";
import { VENTA } from "../../servicios/cancelacionCentral";

const NO_CONFIRMADO = "No se pudo confirmar si la venta se guardó porque falló la conexión. Vuelve a pulsar «Registrar venta»: este mismo envío no se registrará dos veces.";
const COMPRADOR_VACIO = { nombres: "", apellidoPaterno: "", apellidoMaterno: "", telefono: "" };
const FIRMA_COMPRADOR = (c) => JSON.stringify([S.limpio(c.nombres), S.limpio(c.apellidoPaterno), S.limpio(c.apellidoMaterno), c.telefono]);
const ARCHIVO_DE = (a) => (a ? `${a.name}|${a.size}|${a.lastModified}` : "");
const largo = (t) => [...S.limpio(t)].length;
let siguientePago = 1;
const PAGO_VACIO = (monto = "") => ({ id: siguientePago++, monto, fecha: S.hoyLima(), medio: "", referencia: "", archivo: null, confirmador: "", confirmado: false, observacion: "" });
// Monto de un texto, o 0 si todavía no es un monto válido
const valor = (t) => { const n = S.leerMonto(t); return Number.isFinite(n) && n > 0 ? n : 0; };
const montoTexto = (n) => String(V.redondear(n)).replace(".", ",");

// Fila de un resumen
function Fila({ k, children, tono = "", data }) {
  return <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]" data-fila={data || k}><dt className="text-slate-500">{k}</dt><dd className={`font-semibold ${tono || "text-marino dark:text-white"}`}>{children}</dd></div>;
}

// Cuentas de la venta: siempre visibles mientras se llena el formulario (base + techo = total; total − recibido = saldo)
export function Cuentas({ precio, decision, techoNombre, adicional, total, adelanto, pagos, saldo, modalidad }) {
  const techo = decision === S.CON_TECHO
    ? [S.rotuloTecho(techoNombre), Number.isFinite(adicional) ? `+ ${S.soles(adicional)}` : "—"]
    : decision === S.SIN_TECHO ? ["Sin techo", `+ ${S.soles(0)}`] : ["Techo por definir", "Se suma al elegirlo"];
  const filas = [
    ["Precio de la moto (lista)", typeof precio === "number" ? S.soles(precio) : "Sin precio de lista", "base"],
    [...techo, "adicional"],
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13.5px] dark:border-white/10 dark:bg-white/5" data-cuentas>
      <dl className="space-y-1.5">
        {filas.map(([k, v, d]) => <div key={d} className="flex items-baseline justify-between gap-3" data-cuenta={d}><dt className="text-slate-500">{k}</dt><dd className="cifra font-semibold text-marino dark:text-white">{v}</dd></div>)}
        <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2 dark:border-white/10" data-cuenta="total" data-total={total ?? ""}><dt className="font-semibold text-marino dark:text-white">Total de la venta</dt><dd className="cifra font-bold text-marino dark:text-white">{total !== null && total !== undefined ? S.soles(total) : "—"}</dd></div>
        {adelanto > 0 && <div className="flex items-baseline justify-between gap-3" data-cuenta="adelanto"><dt className="text-slate-500">Adelanto de la separación</dt><dd className="cifra font-semibold text-marino dark:text-white">− {S.soles(adelanto)}</dd></div>}
        <div className="flex items-baseline justify-between gap-3" data-cuenta="pagos"><dt className="text-slate-500">Pagos que se registran</dt><dd className="cifra font-semibold text-marino dark:text-white">{pagos > 0 ? `− ${S.soles(pagos)}` : S.soles(0)}</dd></div>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2 dark:border-white/10" data-cuenta="recibido"><dt className="text-slate-500">Total recibido</dt><dd className="cifra font-semibold text-marino dark:text-white">{S.soles(adelanto + pagos)}</dd></div>
        <div className="flex items-baseline justify-between gap-3" data-cuenta="saldo" data-saldo={saldo ?? ""}>
          <dt className="font-semibold text-marino dark:text-white">{modalidad === "Crédito" ? "Saldo a crédito" : "Saldo pendiente"}</dt>
          <dd className={`cifra text-[17px] font-bold ${saldo === null || saldo === undefined ? "text-slate-400" : saldo < 0 ? "text-acento" : saldo === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-marino dark:text-white"}`}>{saldo === null || saldo === undefined ? "—" : S.soles(saldo)}</dd>
        </div>
      </dl>
      {decision === S.POR_DEFINIR && <p className="mt-2 text-[12px] text-slate-500">Con el techo por definir, el total es el precio de la moto. Cuando el comprador elija, el total y el saldo se recalculan en esta misma venta.</p>}
      {modalidad === "Crédito" && saldo > 0 && <p className="mt-2 text-[12px] text-slate-500">El saldo a crédito no se cobra ni se evalúa aquí: la venta a crédito no supone pago total ni aprobación crediticia.</p>}
      {modalidad === "Contado" && saldo > 0 && <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300" data-aviso-saldo-contado>Venta al contado con saldo pendiente: registra los pagos recibidos. Si el saldo se cobrará después, anótalo en la observación.</p>}
    </div>
  );
}

export default function VenderMotoCentral({ unidad, onClose, onHecho, onConflicto }) {
  const toast = useToast();
  const intento = useIntento();
  const conversion = unidad.comercial === "Separada";
  const [form, setForm] = useState(null); const [sedes, setSedes] = useState(null); const [sep, setSep] = useState(null);
  const [errCarga, setErrCarga] = useState(null);
  const [nuevo, setNuevo] = useState(COMPRADOR_VACIO); const [registrado, setRegistrado] = useState(null); const [desdeLead, setDesdeLead] = useState(null);
  const [v, setV] = useState({ responsable: "", sedeAtencion: "", fecha: S.hoyLima(), modalidad: "", adicional: "", sedeEntrega: "", entrega: "", observacion: "" });
  const [decision, setDecision] = useState(S.POR_DEFINIR); const [codtteCon, setCodtteCon] = useState("");
  const [pagos, setPagos] = useState([]);
  const [evidencias, setEvidencias] = useState({}); // id del pago → { firma, ruta } ya guardada
  const [comp, setComp] = useState({ tiene: false, referencia: "", fecha: "" });
  const [err, setErr] = useState({}); const [tocados, setTocados] = useState({}); const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(""); const [bloqueada, setBloqueada] = useState(false);
  const [revisando, setRevisando] = useState(false); const [hecho, setHecho] = useState(null); const [eligiendoTecho, setEligiendoTecho] = useState(false);
  const formRef = useRef(null);
  const verError = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    formRef.current?.querySelector("p.text-acento, [data-error-general], .bg-red-50")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }));

  const cargar = useCallback(() => {
    setErrCarga(null);
    Promise.all([S.formularioSeparacionApi(), V.sedesVentaApi(), conversion ? S.separacionActivaApi(unidad.coduni) : Promise.resolve(null)]).then(([f, ss, s]) => {
      if (conversion && !s) throw Object.assign(new Error("La moto figura separada, pero no se encontró su separación activa. Actualiza la página."), { status: 409 });
      setForm(f); setSedes(ss); setSep(s);
      const lugar = unidad.ubicacion?.tipubi === "Sede" ? ss.find((x) => x.nombre === unidad.ubicacion.nomubi) : null;
      // Adicional propuesto: el referencial del techo (de la separación o el de la moto)
      const tipos = f.tiposTecho || [];
      let tipoIni = null;
      if (s) tipoIni = s.decisionTecho?.decision === S.CON_TECHO ? tipos.find((t) => t.codtte === String(s.decisionTecho.codtte)) || null : null;
      else {
        const ini = S.decisionInicial(tipos, unidad?.preparacion?.techo?.configuracion || "");
        setDecision(ini.decision); setCodtteCon(ini.codtte);
        if (ini.decision === S.CON_TECHO) tipoIni = tipos.find((t) => t.codtte === ini.codtte) || null;
        // Con un techo configurado o instalado, ese techo es el único que se puede vender (además de «Por definir»)
        const fijo = S.techoDeLaMoto(unidad, tipos);
        const tipoFijo = fijo ? S.tiposConTecho(tipos).find((t) => t.codtte === fijo.codtte) : null;
        if (tipoFijo) { setDecision(S.CON_TECHO); setCodtteCon(tipoFijo.codtte); tipoIni = tipoFijo; }
      }
      setV((x) => ({
        ...x,
        responsable: x.responsable || (f.responsables.some((r) => r.codusu === f.usuarioActual.codusu) ? f.usuarioActual.codusu : ""),
        sedeAtencion: x.sedeAtencion || lugar?.codsed || "",
        adicional: x.adicional || (S.adicionalDe(tipoIni) !== null ? montoTexto(S.adicionalDe(tipoIni)) : ""),
      }));
    }).catch(setErrCarga);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [cargar]);

  // ---------------------------------------------------------------------------------------------
  // Cuentas
  const precio = S.precioListaDe(form, unidad);
  const adelanto = conversion && sep?.ingresoConfirmado ? V.redondear(Number(sep.monto) || 0) : 0;
  const totalPagos = V.redondear(pagos.reduce((a, p) => a + valor(p.monto), 0));

  // Techo (en venta directa se elige; desde una separación se mantiene su decisión)
  const tipoTecho = S.tipoDeDecision(form?.tiposTecho, decision, codtteCon);
  const tipoSin = S.tipoSinTecho(form?.tiposTecho);
  const tiposCon = S.tiposConTecho(form?.tiposTecho);
  const instaladoBase = S.techoDeLaMoto(unidad, form?.tiposTecho || []);
  const instalado = instaladoBase && tiposCon.some((t) => t.codtte === instaladoBase.codtte) ? instaladoBase : null;
  const tiposConOfrecidos = instalado ? tiposCon.filter((t) => t.codtte === instalado.codtte) : tiposCon;
  const decisionFinal = conversion ? sep?.decisionTecho?.decision || "" : decision;
  const tipoFinal = conversion ? (decisionFinal === S.CON_TECHO ? (form?.tiposTecho || []).find((t) => t.codtte === String(sep?.decisionTecho?.codtte)) || null : null) : tipoTecho;
  const nombreTechoFinal = tipoFinal?.nombre || (conversion ? sep?.decisionTecho?.nombre : "") || "";
  const referencial = decisionFinal === S.CON_TECHO ? V.adicionalReferencialDe(tipoFinal) : null;
  // Desglose: base + adicional = total (el servidor lo vuelve a calcular)
  const nAdicional = decisionFinal === S.CON_TECHO ? S.leerMonto(v.adicional) : 0;
  const adicionalValido = decisionFinal !== S.CON_TECHO || (!V.errorAdicional(v.adicional, referencial) && Number.isFinite(nAdicional));
  const { total, saldo } = V.cuentasVenta({ base: precio, adicional: adicionalValido ? nAdicional : NaN, adelanto, pagos: totalPagos });
  const totalVista = adicionalValido ? total : null;
  const saldoVista = adicionalValido ? saldo : null;
  const disponiblePara = (id) => (totalVista !== null ? V.redondear(totalVista - adelanto - pagos.filter((p) => p.id !== id).reduce((a, p) => a + valor(p.monto), 0)) : undefined);
  const elegirTipo = (codtte) => { setCodtteCon(codtte); const t = tiposCon.find((x) => x.codtte === codtte); setV((p) => ({ ...p, adicional: S.adicionalDe(t) !== null ? montoTexto(S.adicionalDe(t)) : "" })); setErr((p) => ({ ...p, techo: undefined, adicional: undefined })); };
  const gerentes = form?.gerentes || [];
  const yo = form?.usuarioActual;
  const nombreSede = (codsed) => sedes?.find((x) => x.codsed === codsed)?.nombre || "";
  const nombreDe = (codusu) => form?.responsables.find((r) => r.codusu === codusu)?.nombre || gerentes.find((g) => g.codusu === codusu)?.nombre || "";
  const comprador = conversion ? sep?.comprador : { nombres: S.limpio(nuevo.nombres), apellidoPaterno: S.limpio(nuevo.apellidoPaterno), apellidoMaterno: S.limpio(nuevo.apellidoMaterno), telefono: nuevo.telefono };

  const tocar = (k) => setTocados((p) => (p[k] ? p : { ...p, [k]: true }));
  const cambiarV = (k, val) => { setV((p) => ({ ...p, [k]: val })); tocar(k); setErr((e) => ({ ...e, [k]: undefined, general: undefined })); };
  const cambiarNuevo = (k, val) => { setNuevo((p) => ({ ...p, [k]: val })); tocar(`c_${k}`); setErr((e) => ({ ...e, [`c_${k}`]: undefined, comprador: undefined })); };
  // Al cambiar el medio de un pago se borran los avisos del medio anterior
  const cambiarPago = (id, k, val) => {
    setPagos((ps) => ps.map((p) => (p.id === id ? { ...p, [k]: val } : p))); tocar(`p${id}_${k}`);
    setErr((e) => (k === "medio"
      ? Object.fromEntries(Object.entries(e).filter(([x]) => !x.startsWith(`p${id}_`) && x !== "pagos"))
      : { ...e, [`p${id}_${k}`]: undefined, pagos: undefined }));
  };
  const agregarPago = () => {
    // Al contado se propone el saldo pendiente; a crédito, el monto se escribe (por ejemplo, la cuota inicial)
    const resto = v.modalidad === "Contado" && saldoVista !== null && saldoVista > 0 ? montoTexto(saldoVista) : "";
    const p = PAGO_VACIO(resto);
    setPagos((ps) => [...ps, { ...p, confirmador: yo?.rol === "Gerente" ? yo.codusu : gerentes.length === 1 ? gerentes[0].codusu : "" }]);
    setErr((e) => ({ ...e, pagos: undefined }));
  };
  const quitarPago = (id) => { setPagos((ps) => ps.filter((p) => p.id !== id)); setEvidencias((x) => { const y = { ...x }; delete y[id]; return y; }); };

  // ---------------------------------------------------------------------------------------------
  // Errores del formulario (en vivo en los campos ya tocados)
  function calcularErrores() {
    const e = {};
    if (!conversion) Object.assign(e, Object.fromEntries(Object.entries(S.erroresComprador(nuevo)).map(([k, x]) => [`c_${k}`, x])));
    if (!form?.responsables.some((r) => r.codusu === v.responsable)) e.responsable = "Elige quién es responsable de esta venta.";
    if (!sedes?.some((x) => x.codsed === v.sedeAtencion)) e.sedeAtencion = "Elige la sede donde se atendió la venta.";
    const eFecha = V.errorFechaVenta(v.fecha, conversion ? V.fechaLima(sep?.fechaRegistro) : "");
    if (eFecha) e.fecha = eFecha;
    if (!V.MODALIDADES.includes(v.modalidad)) e.modalidad = "Elige si la venta es al contado o a crédito.";
    if (precio === null) e.precio = "Esta moto no tiene precio de lista registrado. Pide a gerencia que lo registre en Modelos antes de venderla.";
    if (!conversion) {
      if (decision === S.CON_TECHO && !tipoTecho) e.techo = "Elige el tipo de techo que eligió el comprador.";
      if (decision === S.SIN_TECHO && !tipoTecho) e.techo = "No hay un tipo «Sin techo» activo: elige otra opción.";
      if (!e.techo && !S.compatibleConInstalado(instalado, decision, tipoTecho)) e.techo = S.errorTechoMoto(instalado);
    }
    if (decisionFinal === S.CON_TECHO && (conversion || tipoTecho)) {
      const eA = V.errorAdicional(v.adicional, referencial);
      if (eA) e.adicional = eA;
    }
    pagos.forEach((p) => {
      const k = (x) => `p${p.id}_${x}`;
      const eM = V.errorMontoPago(p.monto, disponiblePara(p.id));
      if (eM) e[k("monto")] = eM;
      const eF = V.errorFechaPago(p.fecha);
      if (eF) e[k("fecha")] = eF;
      if (!p.medio) e[k("medio")] = "Elige cómo se pagó.";
      if (p.medio === "Transferencia") {
        const eR = S.errorReferencia(p.referencia); if (eR) e[k("referencia")] = eR;
        if (evidencias[p.id]?.firma !== ARCHIVO_DE(p.archivo)) { const c = S.errorCaptura(p.archivo); if (c) e[k("archivo")] = c.replace("captura de la transferencia", "evidencia de la transferencia"); }
        if (!gerentes.some((g) => g.codusu === p.confirmador)) e[k("confirmador")] = "Elige al gerente que confirmó el ingreso.";
        if (!p.confirmado) e[k("confirmado")] = "La evidencia sola no confirma el pago. Marca esta casilla solo cuando el gerente haya confirmado que el dinero ingresó.";
        const eO = S.errorObservacion(p.observacion, false); if (eO) e[k("observacion")] = eO;
      }
      if (p.medio === "Efectivo") {
        const eO = S.errorObservacion(p.observacion, true); if (eO) e[k("observacion")] = eO;
        if (!p.confirmado) e[k("confirmado")] = "Confirma que recibiste el dinero en efectivo.";
      }
    });
    const eObs = V.errorTextoLibre(v.observacion, V.MAX_OBS_VENTA);
    if (eObs) e.observacion = eObs;
    if (comp.tiene) {
      const c = V.errorComprobante(comp.referencia, comp.fecha, v.fecha);
      if (c.referencia) e.compReferencia = c.referencia;
      if (c.fecha) e.compFecha = c.fecha;
    }
    return e;
  }
  const vivos = form && sedes ? calcularErrores() : {};
  const ver = (k) => err[k] || ((intentado || tocados[k]) ? vivos[k] : undefined);
  function validar() {
    const e = calcularErrores();
    setIntentado(true); setErr(e);
    if (Object.keys(e).length) verError();
    return Object.keys(e).length === 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Registrar
  const obsCompuesta = [V.textoEntrega(v.entrega, nombreSede(v.sedeEntrega)), S.limpio(v.observacion)].filter(Boolean).join(" ");
  function revisar(ev) {
    ev.preventDefault();
    if (enviando || bloqueada || hecho || !validar()) return;
    setRevisando(true);
  }
  async function guardar() {
    if (enviando || bloqueada || hecho) return;
    if (!validar()) { setRevisando(false); return; }
    let codcli = conversion ? sep?.comprador?.codcli : null;
    try {
      // 1) Comprador (venta directa): se registra una vez; si sus datos no cambiaron, se reutiliza
      if (!conversion) {
        const firma = FIRMA_COMPRADOR(nuevo);
        let elegido = registrado?.firma === firma ? registrado.comprador : null;
        if (!elegido) {
          setEnviando("Registrando al comprador…");
          try {
            elegido = await S.registrarCompradorApi({ nombres: S.limpio(nuevo.nombres), apellidoPaterno: S.limpio(nuevo.apellidoPaterno), apellidoMaterno: S.limpio(nuevo.apellidoMaterno) || null, telefono: nuevo.telefono });
          } catch (er) {
            setRevisando(false);
            setErr({ comprador: sinRespuesta(er) ? "No se pudo confirmar si el comprador se registró porque falló la conexión. Vuelve a intentarlo: no se duplicará." : `No se pudo registrar al comprador: ${mensajeError(er)}` });
            return;
          }
          setRegistrado({ firma, comprador: elegido });
          if (!elegido.activo) { setRevisando(false); setErr({ comprador: "Este comprador está inactivo: no se puede vender a su nombre." }); return; }
        }
        codcli = elegido.codcli;
      }
      // 2) Evidencias de las transferencias (una vez por archivo)
      const rutas = {};
      for (const p of pagos.filter((x) => x.medio === "Transferencia")) {
        const firma = ARCHIVO_DE(p.archivo);
        if (evidencias[p.id]?.firma === firma) { rutas[p.id] = evidencias[p.id].ruta; continue; }
        setEnviando("Guardando la evidencia del pago…");
        try {
          const d = await V.subirEvidenciaVentaApi(unidad.coduni, p.archivo);
          rutas[p.id] = d.rutaEvidencia;
          setEvidencias((x) => ({ ...x, [p.id]: { firma, ruta: d.rutaEvidencia } }));
        } catch (er) {
          setRevisando(false);
          setErr({ [`p${p.id}_archivo`]: sinRespuesta(er) ? "No se pudo guardar la evidencia porque falló la conexión. Vuelve a intentarlo." : mensajeError(er) });
          return;
        }
      }
      // 3) Venta: el servidor comprueba que la moto siga libre (o separada para este comprador) y la guarda una vez
      const cuerpo = {
        codcli: Number(codcli), codusuResponsable: Number(v.responsable), codsedAtencion: Number(v.sedeAtencion), fechaVenta: v.fecha,
        modalidad: v.modalidad,
        // El total no se envía: el servidor suma el precio base y el adicional acordado del techo
        ...(decisionFinal === S.CON_TECHO ? { adicionalTechoAcordado: S.montoParaEnviar(v.adicional) } : {}),
        ...(v.sedeEntrega ? { codsedEntregaPrevista: Number(v.sedeEntrega) } : {}),
        pagos: pagos.map((p) => (p.medio === "Transferencia"
          ? { monto: S.montoParaEnviar(p.monto), fecha: p.fecha, medioPago: "Transferencia", referencia: S.limpio(p.referencia), rutaEvidencia: rutas[p.id], observacion: S.limpio(p.observacion) || null, ingresoConfirmado: true, codusuConfirmador: Number(p.confirmador) }
          : { monto: S.montoParaEnviar(p.monto), fecha: p.fecha, medioPago: "Efectivo", observacion: S.limpio(p.observacion), ingresoConfirmado: true })),
        techo: conversion ? null : S.techoParaEnviar(decision, tipoTecho),
        ...(comp.tiene ? { comprobanteExterno: { referencia: comp.referencia, fecha: comp.fecha } } : {}),
        observacion: obsCompuesta || null,
      };
      setEnviando("Registrando la venta…");
      const r = await V.crearVentaApi(unidad.coduni, cuerpo, intento(JSON.stringify({ u: unidad.coduni, ...cuerpo })));
      const venta = r.data || {};
      setHecho({ ...venta, reutilizada: r.status === 200 || venta.reutilizada === true, comprador });
      toast(r.status === 200 ? "La venta ya estaba guardada" : "Venta registrada");
      onHecho?.(venta);
    } catch (er) {
      setRevisando(false);
      const campo = V.campoDelError(er);
      if (sinRespuesta(er)) {
        // Sin respuesta clara (conexión cortada o error del servidor): se revisa en la base si la venta quedó o no,
        // para no dar un éxito falso ni pedir un reintento a ciegas (QA 12/11)
        setEnviando("Revisando si la venta se guardó…");
        const ahora = await V.ventaDeUnidadApi(unidad.coduni).catch(() => undefined);
        const motivo = er.status >= 500 ? `El servidor respondió con un error (${er.status})` : "Se perdió la conexión con el servidor";
        if (ahora && codcli && String(ahora.comprador?.codcli ?? "") === String(codcli) && ahora.estado !== "Cancelada") {
          setHecho({ ...ahora, reutilizada: true, comprador: ahora.comprador || null });
          toast("La venta sí quedó guardada");
          onHecho?.(ahora);
        } else if (ahora && ahora.estado !== "Cancelada") {
          setBloqueada(true); onConflicto?.();
          setErr({ general: `${motivo}. No se guardó esta venta: la moto ya tiene otra venta registrada (otra persona la vendió). Revisa su ficha.` });
        } else if (ahora === null || ahora?.estado === "Cancelada") {
          setErr({ general: `${motivo} y la venta no se guardó: la moto sigue sin vender y tus datos siguen aquí. Vuelve a pulsar «Registrar venta». Si se repite, avisa a soporte con la hora y la moto.` });
        } else setErr({ general: NO_CONFIRMADO });
      } else if (er.status === 409 && !["techo", "comprobante"].includes(campo)) {
        setBloqueada(true); onConflicto?.();
        setErr({ general: `${mensajeError(er)}. No se guardó esta venta: la moto cambió antes (otra persona la vendió o la separó, se canceló su separación o ya quedó guardado un intento anterior). Revisa su ficha.` });
      } else if (campo === "adicional") setErr({ adicional: mensajeError(er) });
      else if (campo === "techo") setErr({ techo: mensajeError(er) });
      else if (campo === "comprobante") setErr({ compReferencia: mensajeError(er) });
      else if (campo === "responsable") setErr({ responsable: mensajeError(er) });
      else if (campo === "sede") setErr({ sedeAtencion: mensajeError(er) });
      else if (campo === "comprador") setErr({ comprador: mensajeError(er) });
      else if (campo === "pagos") { if (/evidencia/i.test(er.message || "")) setEvidencias({}); setErr({ pagos: mensajeError(er) }); }
      else setErr({ general: mensajeError(er) });
    } finally { setEnviando(""); verError(); }
  }

  // ---------------------------------------------------------------------------------------------
  // Venta guardada
  if (hecho) {
    const t = hecho.techo || {};
    const techoNombreHecho = (form?.tiposTecho || []).find((x) => x.codtte === String(t.codtte))?.nombre || nombreTechoFinal;
    const techoTexto = S.textoDecision({ ...t, nombre: techoNombreHecho }, form?.tiposTecho);
    const entrega = hecho.sedeEntregaPrevista?.nombre || "";
    return (
      <Modal abierto onClose={onClose} titulo="Registrar venta" ancho="max-w-xl" sinAvisoCambios pie={<>
        {t.decision === S.POR_DEFINIR && <button className="btn btn-secondary !py-2" onClick={() => setEligiendoTecho(true)} data-elegir-techo-venta>Elegir techo ahora</button>}
        <button className="btn btn-primary !py-2" onClick={onClose} autoFocus>Listo</button>
      </>}>
        <div className="space-y-4" data-venta-guardada={hecho.codven} data-reutilizada={hecho.reutilizada ? "si" : "no"}>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><IconCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-[17px] font-bold text-marino dark:text-white">{hecho.reutilizada ? "Esta venta ya estaba guardada" : "Venta registrada"}</p>
              <p className="text-[13.5px] text-slate-500">{hecho.reutilizada ? "Era el mismo envío: no se registró dos veces." : `La moto queda vendida, pendiente de entrega.${hecho.codsep ? " La separación quedó convertida en esta venta." : ""} Su ubicación y preparación no cambian.`}</p>
            </div>
          </div>
          <CabeceraMoto unidad={unidad} precio={precio} />
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            <Fila k="Comprador">{S.textoComprador(hecho.comprador) || "Sin dato"}</Fila>
            <Fila k="Modalidad">{hecho.modalidad}</Fila>
            <Fila k="Precio base" data="base"><span className="cifra">{S.soles(hecho.precioBaseAcordado ?? precio)}</span></Fila>
            <Fila k="Techo" data="adicional">{`${V.textoAdicional(t.decision, techoNombreHecho, Number(hecho.adicionalTechoAcordado), Number(hecho.adicionalTechoReferencial))}${t.decision === S.CON_TECHO ? ` + ${S.soles(hecho.adicionalTechoAcordado)}` : ""}`}</Fila>
            <Fila k="Total de la venta" data="total"><span className="cifra" data-total-guardado={hecho.importe}>{S.soles(hecho.importe)}</span></Fila>
            {adelanto > 0 && <Fila k="Adelanto de la separación"><span className="cifra">{S.soles(adelanto)}</span>, ya recibido al separar (no se suma otra vez)</Fila>}
            <Fila k="Pagos registrados">{hecho.pagos?.length ? hecho.pagos.map((p) => `${S.soles(p.monto)} en ${String(p.medioPago).toLowerCase()}`).join(", ") : "Ninguno"}</Fila>
            <Fila k="Total recibido"><span className="cifra">{S.soles(hecho.totalRecibido)}</span></Fila>
            <Fila k={hecho.modalidad === "Crédito" ? "Saldo a crédito" : "Saldo pendiente"} data="saldo"><span className="cifra" data-saldo-guardado={hecho.saldo}>{S.soles(hecho.saldo)}</span></Fila>
            <Fila k="Techo">{techoTexto}</Fila>
            <Fila k="Sede de atención">{hecho.sedeAtencion?.nombre}</Fila>
            <Fila k="Ubicación de la moto">{ubicacionDe(unidad).texto} (no cambia con la venta)</Fila>
            <Fila k="Entrega pactada">{[v.entrega ? `Se entregará ${v.entrega}` : "", entrega ? `en ${entrega}` : ""].filter(Boolean).join(" ") || "Por acordar"}{(v.entrega || entrega) ? ". Pendiente: la venta no arma ni entrega la moto." : ""}</Fila>
            <Fila k="Comprobante">{hecho.comprobanteExterno ? `${hecho.comprobanteExterno.referencia}, emitido el ${fechaLarga(hecho.comprobanteExterno.fecha)}` : "Sin comprobante registrado: regístralo desde la ficha cuando se emita."}</Fila>
            <Fila k="Responsable">{hecho.responsable?.nombre}</Fila>
            <Fila k="Registrada">{`${fechaLarga(V.soloFecha(hecho.fechaVenta))}, por ${hecho.autor?.nombre || ""}`}</Fila>
          </dl>
          {t.decision === S.POR_DEFINIR && <Aviso tipo="aviso">El techo quedó por definir. Cuando el comprador decida, regístralo con «Elegir techo» (aquí o en la ficha de la moto): el total y el saldo se recalculan en esta misma venta.</Aviso>}
          {t.decision === S.CON_TECHO && !(instalado && instalado.codtte === String(t.codtte)) && <Aviso tipo="info"><span data-techo-por-programar>El comprador eligió {techoNombreHecho || "un techo"}. La venta no configura ni instala el techo: prográmalo desde «Configuración de techo» en la ficha de la moto.</span></Aviso>}
        </div>
        {eligiendoTecho && <ElegirTechoModal unidad={unidad} comprador={hecho.comprador} que="venta" venta={{ precioBaseAcordado: hecho.precioBaseAcordado ?? precio, totalRecibido: hecho.totalRecibido }} guardar={(d, tipo, adicional) => V.guardarTechoVentaApi(hecho.codven, d, tipo, adicional)} onClose={() => setEligiendoTecho(false)}
          onGuardado={() => { setEligiendoTecho(false); onHecho?.(); onClose(); }} />}
      </Modal>
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Revisión antes de registrar (los números tal como quedarán)
  if (revisando) {
    const pie = (
      <>
        <button type="button" className="btn btn-secondary !py-2" onClick={() => setRevisando(false)} disabled={Boolean(enviando)}>Volver a editar</button>
        <button type="button" className="btn btn-primary !py-2" onClick={guardar} disabled={Boolean(enviando) || bloqueada} data-confirmar-venta>{enviando || "Sí, registrar venta"}</button>
      </>
    );
    return (
      <Modal abierto onClose={onClose} titulo="Revisa la venta" ancho="max-w-xl" sinAvisoCambios={Boolean(enviando)} confirmarGuardar={false} pie={pie}>
        <div className="space-y-4" data-revision-venta>
          <CabeceraMoto unidad={unidad} precio={precio} />
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            <Fila k="Comprador">{S.textoComprador(comprador)}</Fila>
            <Fila k="Modalidad">{v.modalidad}</Fila>
            <Fila k="Techo">{conversion ? `${S.textoDecision(sep?.decisionTecho)} (de la separación)` : S.textoDecision({ decision, codtte: tipoTecho?.codtte, nombre: tipoTecho?.nombre })}</Fila>
            {decisionFinal === S.CON_TECHO && <Fila k="Adicional del techo" data="adicional-revision">{S.soles(nAdicional)}{typeof referencial === "number" && V.redondear(nAdicional) !== referencial ? `, acordado con el comprador (referencial ${S.soles(referencial)})` : ", referencial del catálogo"}</Fila>}
            <Fila k="Sede de atención">{nombreSede(v.sedeAtencion)}</Fila>
            <Fila k="Entrega pactada">{[v.entrega ? `Se entregará ${v.entrega}` : "", v.sedeEntrega ? `en ${nombreSede(v.sedeEntrega)}` : ""].filter(Boolean).join(" ") || "Por acordar"}</Fila>
            <Fila k="Fecha de la venta">{fechaLarga(v.fecha)}</Fila>
            <Fila k="Responsable">{nombreDe(v.responsable)}</Fila>
            {pagos.map((p, i) => <Fila key={p.id} k={`Pago ${i + 1}`}>{`${S.soles(valor(p.monto))} en ${p.medio.toLowerCase()}${p.referencia ? `, operación ${S.limpio(p.referencia)}` : ""}, del ${fechaLarga(p.fecha)}`}</Fila>)}
            <Fila k="Comprobante">{comp.tiene ? `${comp.referencia}, emitido el ${fechaLarga(comp.fecha)}` : "Sin comprobante todavía"}</Fila>
            {S.limpio(v.observacion) && <Fila k="Observación">{S.limpio(v.observacion)}</Fila>}
          </dl>
          <Cuentas precio={precio} decision={decisionFinal} techoNombre={nombreTechoFinal} adicional={adicionalValido ? nAdicional : NaN} total={totalVista} adelanto={adelanto} pagos={totalPagos} saldo={saldoVista} modalidad={v.modalidad} />
          <p className="text-[12.5px] text-slate-500">Al registrar, la moto queda vendida para este comprador y deja de figurar libre. La venta no mueve la moto ni confirma su entrega.</p>
          {err.general && <Aviso tipo={bloqueada ? "aviso" : "error"}><span data-error-general>{err.general}</span></Aviso>}
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Formulario
  const pie = (
    <>
      <button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button>
      <button form="f-vender" className="btn btn-primary !py-2" disabled={Boolean(enviando) || bloqueada || !form || !sedes} data-vender-enviar>Revisar y registrar</button>
    </>
  );
  return (
    <Modal abierto onClose={onClose} titulo={conversion ? "Registrar venta de la separación" : "Registrar venta"} ancho="max-w-2xl" sinAvisoCambios={Boolean(enviando)} confirmarGuardar={false} pie={pie}>
      <form id="f-vender" ref={formRef} onSubmit={revisar} className="space-y-6" noValidate data-vender-modal={unidad.coduni} data-conversion={conversion ? "si" : "no"}>
        <CabeceraMoto unidad={unidad} precio={precio} />
        {errCarga && (
          <Aviso tipo="error">
            {S.faltaInstalar(errCarga) ? "La API conectada todavía no tiene las ventas: falta desplegar su versión nueva." : `No se pudo preparar el formulario: ${mensajeError(errCarga)}`}{" "}
            {!S.faltaInstalar(errCarga) && <button type="button" className="font-semibold underline" onClick={cargar}>Reintentar</button>}
          </Aviso>
        )}
        {(!form || !sedes) && !errCarga && <p className="text-[13.5px] text-slate-500">Cargando el formulario…</p>}

        {form && sedes && (
          <>
            {/* Comprador */}
            <section aria-labelledby="ven-comprador" className="space-y-3">
              <h3 id="ven-comprador" className="text-[15px] font-bold text-marino dark:text-white">Comprador</h3>
              {conversion ? (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-[13.5px] dark:bg-amber-500/10" data-comprador-separacion={sep?.comprador?.codcli || ""}>
                  <p className="font-semibold text-marino dark:text-white">{S.textoComprador(sep?.comprador)}</p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">Es el comprador de la separación. La venta se registra a su nombre y conserva su adelanto de <span className="cifra font-semibold">{S.soles(adelanto)}</span>{sep?.fechaPago ? ` del ${fechaLarga(sep.fechaPago)}` : ""}: no se vuelve a sumar como pago.</p>
                </div>
              ) : (
                <>
                  <BuscarInteresado id="ven-buscar-interesado" disabled={Boolean(enviando)} onElegir={(l) => {
                    setNuevo({ ...S.separarNombreLead(l.nombre), telefono: S.filtrarTelefono(l.celular) });
                    setDesdeLead(l); setErr((e) => ({ ...e, comprador: undefined }));
                    setTocados((p) => ({ ...p, c_nombres: true, c_apellidoPaterno: true, c_telefono: true }));
                  }} />
                  {desdeLead && <p className="text-[12.5px] text-slate-500" data-desde-interesado={desdeLead.codlead}>Datos tomados del interesado «{desdeLead.nombre}». Revisa nombres y apellidos antes de registrar.</p>}
                  <div className="grid gap-3 sm:grid-cols-2" data-comprador-datos>
                    <Campo etiqueta="Nombres" error={ver("c_nombres")}><input id="ven-nombres" className="field-input" value={nuevo.nombres} maxLength={100} autoComplete="off" placeholder="Ej. Rosa María" onChange={(e) => cambiarNuevo("nombres", S.soloNombre(e.target.value))} onBlur={() => tocar("c_nombres")} /></Campo>
                    <Campo etiqueta="Apellido paterno" error={ver("c_apellidoPaterno")}><input id="ven-paterno" className="field-input" value={nuevo.apellidoPaterno} maxLength={100} autoComplete="off" onChange={(e) => cambiarNuevo("apellidoPaterno", S.soloNombre(e.target.value))} onBlur={() => tocar("c_apellidoPaterno")} /></Campo>
                    <Campo etiqueta="Apellido materno" error={ver("c_apellidoMaterno")} ayuda="Déjalo vacío si el comprador tiene un solo apellido"><input id="ven-materno" className="field-input" value={nuevo.apellidoMaterno} maxLength={100} autoComplete="off" onChange={(e) => cambiarNuevo("apellidoMaterno", S.soloNombre(e.target.value))} /></Campo>
                    <Campo etiqueta="Celular" error={ver("c_telefono")} ayuda="9 dígitos, empieza con 9"><input id="ven-telefono" className="field-input cifra" inputMode="numeric" autoComplete="off" placeholder="9XXXXXXXX" value={nuevo.telefono} onChange={(e) => cambiarNuevo("telefono", S.filtrarTelefono(e.target.value))} onPaste={(e) => { e.preventDefault(); cambiarNuevo("telefono", S.filtrarTelefono(e.clipboardData.getData("text"))); }} onBlur={() => tocar("c_telefono")} /></Campo>
                  </div>
                </>
              )}
              {err.comprador && <Aviso tipo="error">{err.comprador}</Aviso>}
            </section>

            {/* Venta */}
            <section aria-labelledby="ven-datos" className="space-y-3">
              <h3 id="ven-datos" className="text-[15px] font-bold text-marino dark:text-white">Venta</h3>
              <fieldset>
                <legend className="field-label">Modalidad</legend>
                <div className="grid gap-2 sm:grid-cols-2" data-modalidad>
                  <Opcion nombre="ven-modalidad" valor="Contado" actual={v.modalidad} onElegir={(x) => cambiarV("modalidad", x)} titulo="Contado" texto="El comprador paga el total; registra abajo lo que ya pagó." />
                  <Opcion nombre="ven-modalidad" valor="Crédito" actual={v.modalidad} onElegir={(x) => cambiarV("modalidad", x)} titulo="Crédito" texto="Se registra lo recibido; el saldo no se evalúa ni se cobra aquí." />
                </div>
                {ver("modalidad") && <p className="mt-1 text-[12px] font-medium text-acento">{ver("modalidad")}</p>}
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Fecha de la venta" error={ver("fecha")}>
                  <input id="ven-fecha" type="date" className="field-input" value={v.fecha} min={[V.fechaMinimaVenta(), conversion ? V.fechaLima(sep?.fechaRegistro) : ""].sort().pop()} max={S.hoyLima()} onChange={(e) => cambiarV("fecha", e.target.value)} />
                </Campo>
                <Campo etiqueta="Sede de atención" error={ver("sedeAtencion")} ayuda="Dónde se atendió al comprador. Puede ser distinta de donde está la moto.">
                  <select id="ven-sede" className="field-input" value={v.sedeAtencion} onChange={(e) => cambiarV("sedeAtencion", e.target.value)}>
                    <option value="">Elige la sede</option>
                    {sedes.map((x) => <option key={x.codsed} value={x.codsed}>{x.nombre}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Responsable" error={ver("responsable")}>
                  <select id="ven-responsable" className="field-input" value={v.responsable} onChange={(e) => cambiarV("responsable", e.target.value)}>
                    <option value="">Elige al responsable</option>
                    {form.responsables.map((r) => <option key={r.codusu} value={r.codusu}>{r.nombre} ({r.rol}){r.codusu === yo.codusu ? ", tú" : ""}</option>)}
                  </select>
                </Campo>
              </div>
              {precio === null && <Aviso tipo="aviso">Esta moto no tiene precio de lista registrado. Pide a gerencia que lo registre en Modelos antes de venderla.</Aviso>}
            </section>

            {/* Techo */}
            <section aria-labelledby="ven-techo" className="space-y-3">
              <h3 id="ven-techo" className="text-[15px] font-bold text-marino dark:text-white">Techo</h3>
              {conversion ? (
                <p className="text-[13.5px] text-slate-600 dark:text-slate-300" data-techo-de-separacion={sep?.decisionTecho?.decision || ""}>
                  Se mantiene la decisión de la separación: <span className="font-semibold text-marino dark:text-white">{S.textoDecision(sep?.decisionTecho)}</span>.{sep?.decisionTecho?.decision === S.POR_DEFINIR ? " Cuando el comprador decida, regístralo desde la ficha de la moto: el total se recalcula en esta venta." : sep?.decisionTecho?.decision === S.SIN_TECHO ? " No suma al precio." : ""}
                </p>
              ) : (
                <>
                  {instalado && <Aviso tipo="info"><span data-techo-instalado={instalado.nombre}>{S.textoInstalado(instalado)}</span></Aviso>}
                  <fieldset>
                    <legend className="field-label">¿Qué decidió el comprador?</legend>
                    <div className="grid gap-2 sm:grid-cols-3" data-techo-opciones>
                      <Opcion nombre="ven-techo" valor={S.POR_DEFINIR} actual={decision} titulo="Por definir" texto="Aún no decide. Se registra después, desde la ficha." onElegir={(x) => { setDecision(x); setErr((p) => ({ ...p, techo: undefined })); }} />
                      {tipoSin && <Opcion nombre="ven-techo" valor={S.SIN_TECHO} actual={decision} titulo="Sin techo" texto={instalado ? `No disponible: esta moto ya tiene un techo ${instalado.instalado ? "instalado" : "configurado"}.` : "Eligió la moto sin techo. No suma al precio."} deshabilitada={Boolean(instalado)} onElegir={(x) => { setDecision(x); setErr((p) => ({ ...p, techo: undefined, adicional: undefined })); }} />}
                      {tiposConOfrecidos.length > 0 && <Opcion nombre="ven-techo" valor={S.CON_TECHO} actual={decision} titulo="Con techo" texto={instalado ? `Con el techo que ya tiene ${instalado.instalado ? "instalado" : "configurado"} («${instalado.nombre}»).` : "Eligió un techo: su adicional se suma al total."} onElegir={(x) => { setDecision(x); if (instalado) elegirTipo(instalado.codtte); setErr((p) => ({ ...p, techo: undefined })); }} />}
                    </div>
                  </fieldset>
                  {decision === S.CON_TECHO && (
                    <Campo etiqueta="Tipo de techo" error={ver("techo")}>
                      <select id="ven-tipo-techo" className="field-input" value={codtteCon} onChange={(e) => { elegirTipo(e.target.value); tocar("techo"); }}>
                        <option value="">Elige el tipo de techo</option>
                        {tiposConOfrecidos.map((t) => <option key={t.codtte} value={t.codtte}>{S.etiquetaTipoTecho(t)}</option>)}
                      </select>
                    </Campo>
                  )}
                </>
              )}
              {(conversion || decision !== S.CON_TECHO) && ver("techo") && <p className="text-[12px] font-medium text-acento">{ver("techo")}</p>}
              {decisionFinal === S.CON_TECHO && (conversion || tipoTecho) && (
                <Campo etiqueta={`Adicional del techo${nombreTechoFinal ? ` ${nombreTechoFinal}` : ""} (S/)`} error={ver("adicional")} ayuda={V.ayudaAdicional(referencial)}>
                  <input id="ven-adicional" className="field-input cifra" inputMode="decimal" autoComplete="off" value={v.adicional} onChange={(e) => cambiarV("adicional", S.filtrarMonto(e.target.value, V.MAX_ENTEROS_ADICIONAL, v.adicional))} data-referencial={referencial ?? ""} />
                </Campo>
              )}
            </section>

            {/* Pagos */}
            <section aria-labelledby="ven-pagos" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="ven-pagos" className="text-[15px] font-bold text-marino dark:text-white">Pagos recibidos</h3>
                <button type="button" className="btn btn-secondary !py-1.5 text-[13px]" onClick={agregarPago} disabled={pagos.length >= 10 || (saldoVista !== null && saldoVista <= 0)} data-agregar-pago>+ Agregar pago</button>
              </div>
              <p className="text-[12.5px] text-slate-500">{adelanto > 0 ? "El adelanto de la separación ya está contado. " : ""}Registra solo el dinero que ya se recibió. Las transferencias llevan su evidencia y la confirmación del gerente; el efectivo, su recepción.</p>
              {pagos.length === 0 && <p className="text-[13px] text-slate-400" data-sin-pagos>Sin pagos en esta venta.</p>}
              {pagos.map((p, i) => {
                const k = (x) => `p${p.id}_${x}`;
                const gerente = gerentes.find((g) => g.codusu === p.confirmador);
                const soyGerente = yo?.rol === "Gerente" && p.confirmador === yo.codusu;
                return (
                  <div key={p.id} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-white/10" data-pago={i + 1}>
                    <div className="flex items-center justify-between"><p className="text-[13.5px] font-semibold text-marino dark:text-white">Pago {i + 1}</p><button type="button" className="text-[13px] font-semibold text-acento hover:underline" onClick={() => quitarPago(p.id)} data-quitar-pago>Quitar</button></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Campo etiqueta="Monto (S/)" error={ver(k("monto"))} ayuda={disponiblePara(p.id) > 0 ? `Hasta ${S.soles(disponiblePara(p.id))}, el saldo pendiente` : undefined}>
                        <input id={`ven-pago-monto-${i + 1}`} className="field-input cifra" inputMode="decimal" autoComplete="off" value={p.monto} onChange={(e) => cambiarPago(p.id, "monto", S.filtrarMonto(e.target.value, S.cifrasEnteras(totalVista > 0 ? totalVista : (precio || 0) * 2), p.monto))} />
                      </Campo>
                      <Campo etiqueta="Fecha en que se recibió" error={ver(k("fecha"))}>
                        <input id={`ven-pago-fecha-${i + 1}`} type="date" className="field-input" value={p.fecha} min={V.fechaMinimaVenta()} max={S.hoyLima()} onChange={(e) => cambiarPago(p.id, "fecha", e.target.value)} />
                      </Campo>
                    </div>
                    <fieldset>
                      <legend className="field-label">¿Cómo se pagó?</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Opcion nombre={`ven-medio-${p.id}`} valor="Transferencia" actual={p.medio} onElegir={(x) => cambiarPago(p.id, "medio", x)} titulo="Transferencia" texto="Con su evidencia y el gerente que confirmó el ingreso." />
                        <Opcion nombre={`ven-medio-${p.id}`} valor="Efectivo" actual={p.medio} onElegir={(x) => cambiarPago(p.id, "medio", x)} titulo="Efectivo" texto="Recibido en mano. Se anota cómo se recibió." />
                      </div>
                      {ver(k("medio")) && <p className="mt-1 text-[12px] font-medium text-acento">{ver(k("medio"))}</p>}
                    </fieldset>
                    {p.medio === "Transferencia" && (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Campo etiqueta="N° de operación" error={ver(k("referencia"))}><input id={`ven-pago-referencia-${i + 1}`} className="field-input cifra" value={p.referencia} autoComplete="off" placeholder="Ej. 00123456" onChange={(e) => cambiarPago(p.id, "referencia", S.filtrarReferencia(e.target.value))} /></Campo>
                          <Campo etiqueta="Gerente que confirmó el ingreso" error={ver(k("confirmador"))}>
                            <select id={`ven-pago-confirmador-${i + 1}`} className="field-input" value={p.confirmador} onChange={(e) => cambiarPago(p.id, "confirmador", e.target.value)}>
                              <option value="">Elige al gerente</option>
                              {gerentes.map((g) => <option key={g.codusu} value={g.codusu}>{g.nombre}</option>)}
                            </select>
                          </Campo>
                        </div>
                        <Campo etiqueta="Evidencia de la transferencia" error={ver(k("archivo"))} ayuda="Imagen JPG, PNG o WEBP, o PDF, de hasta 5 MB. Por sí sola no confirma el pago.">
                          {p.archivo
                            ? <VistaCaptura archivo={p.archivo} guardada={evidencias[p.id]?.firma === ARCHIVO_DE(p.archivo)} onQuitar={() => cambiarPago(p.id, "archivo", null)} />
                            : <input id={`ven-pago-evidencia-${i + 1}`} type="file" accept={S.TIPOS_CAPTURA.join(",")} className="field-input" onChange={(e) => cambiarPago(p.id, "archivo", e.target.files?.[0] || null)} />}
                        </Campo>
                        <label className="flex items-start gap-2.5 text-[13.5px]">
                          <input id={`ven-pago-confirmado-${i + 1}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-marino-700" checked={p.confirmado} onChange={(e) => cambiarPago(p.id, "confirmado", e.target.checked)} />
                          <span>{soyGerente ? "Confirmé que el pago ingresó a la cuenta de la empresa." : `${gerente ? gerente.nombre : "El gerente"} confirmó que el pago ingresó a la cuenta de la empresa.`}</span>
                        </label>
                        {ver(k("confirmado")) && <p className="text-[12px] font-medium text-acento">{ver(k("confirmado"))}</p>}
                      </div>
                    )}
                    {p.medio === "Efectivo" && (
                      <>
                        <label className="flex items-start gap-2.5 text-[13.5px]">
                          <input id={`ven-pago-confirmado-${i + 1}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-marino-700" checked={p.confirmado} onChange={(e) => cambiarPago(p.id, "confirmado", e.target.checked)} />
                          <span>Recibí el dinero en efectivo. La recepción queda registrada a mi nombre.</span>
                        </label>
                        {ver(k("confirmado")) && <p className="text-[12px] font-medium text-acento">{ver(k("confirmado"))}</p>}
                      </>
                    )}
                    {p.medio && (
                      <Campo etiqueta={p.medio === "Efectivo" ? "Observación de la recepción" : "Observación (opcional)"} error={ver(k("observacion"))} ayuda={`${largo(p.observacion)}/${S.MAX_OBSERVACION}${p.medio === "Efectivo" ? ". Ej.: recibido en caja de Comas, recibo N° 0045" : ""}`}>
                        <textarea id={`ven-pago-observacion-${i + 1}`} className="field-input" rows={2} maxLength={S.MAX_OBSERVACION + 20} value={p.observacion} onChange={(e) => cambiarPago(p.id, "observacion", e.target.value)} />
                      </Campo>
                    )}
                  </div>
                );
              })}
              {err.pagos && <Aviso tipo="error"><span data-error-pagos>{err.pagos}</span></Aviso>}
              <Cuentas precio={precio} decision={decisionFinal} techoNombre={nombreTechoFinal} adicional={adicionalValido ? nAdicional : NaN} total={totalVista} adelanto={adelanto} pagos={totalPagos} saldo={saldoVista} modalidad={v.modalidad} />
            </section>

            {/* Entrega prevista */}
            <section aria-labelledby="ven-entrega" className="space-y-3">
              <h3 id="ven-entrega" className="text-[15px] font-bold text-marino dark:text-white">Entrega pactada</h3>
              <p className="text-[12.5px] text-slate-500">Lo que se acordó con el comprador para cuando se entregue. Queda pendiente: no marca la moto armada ni entregada, no cambia su preparación y no genera un traslado.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Sede de entrega">
                  <select id="ven-sede-entrega" className="field-input" value={v.sedeEntrega} onChange={(e) => cambiarV("sedeEntrega", e.target.value)}>
                    <option value="">Aún no se acuerda</option>
                    {sedes.map((x) => <option key={x.codsed} value={x.codsed}>{x.nombre}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Cómo se entregará">
                  <select id="ven-modo-entrega" className="field-input" value={v.entrega} onChange={(e) => cambiarV("entrega", e.target.value)}>
                    {V.ENTREGAS.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
                  </select>
                </Campo>
              </div>
            </section>

            {/* Comprobante externo */}
            <section aria-labelledby="ven-comprobante" className="space-y-3">
              <h3 id="ven-comprobante" className="text-[15px] font-bold text-marino dark:text-white">Comprobante</h3>
              <label className="flex items-start gap-2.5 text-[13.5px]">
                <input id="ven-tiene-comprobante" type="checkbox" className="mt-0.5 h-4 w-4 accent-marino-700" checked={comp.tiene} onChange={(e) => { setComp((c) => ({ ...c, tiene: e.target.checked })); setErr((x) => ({ ...x, compReferencia: undefined, compFecha: undefined })); }} />
                <span>La boleta o factura ya se emitió fuera de la plataforma. <span className="text-slate-500">Si todavía no, déjalo sin marcar y regístralo después desde la ficha.</span></span>
              </label>
              {comp.tiene && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Serie y número" error={ver("compReferencia")} ayuda="Tal como figura en el comprobante. Ej.: B001-00012345">
                    <input id="ven-comprobante-referencia" className="field-input cifra" value={comp.referencia} autoComplete="off" placeholder="B001-00012345" onChange={(e) => { setComp((c) => ({ ...c, referencia: V.filtrarComprobante(e.target.value) })); tocar("compReferencia"); setErr((x) => ({ ...x, compReferencia: undefined })); }} />
                  </Campo>
                  <Campo etiqueta="Fecha de emisión" error={ver("compFecha")}>
                    <input id="ven-comprobante-fecha" type="date" className="field-input" value={comp.fecha} min={v.fecha} max={S.hoyLima()} onChange={(e) => { setComp((c) => ({ ...c, fecha: e.target.value })); tocar("compFecha"); setErr((x) => ({ ...x, compFecha: undefined })); }} />
                  </Campo>
                </div>
              )}
            </section>

            {/* Observación */}
            <section aria-labelledby="ven-observacion-titulo" className="space-y-3">
              <h3 id="ven-observacion-titulo" className="text-[15px] font-bold text-marino dark:text-white">Observación</h3>
              <Campo etiqueta="Documentos o condiciones comerciales (opcional)" error={ver("observacion")} ayuda={`${largo(v.observacion)}/${V.MAX_OBS_VENTA}. Queda con tu nombre y la fecha; no certifica pagos, entregas ni trámites.`}>
                <textarea id="ven-observacion" className="field-input" rows={2} maxLength={V.MAX_OBS_VENTA + 20} value={v.observacion} onChange={(e) => cambiarV("observacion", e.target.value)} />
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
// Ficha de la moto: venta registrada
// ---------------------------------------------------------------------------------------------
// HU-021: «Cancelar venta» (onCancelar) para el gerente, la administradora o el vendedor responsable vigente
export function VentaCard({ unidad, puedeEditar = true, onCambio, onCancelar }) {
  const toast = useToast();
  const activo = unidad?.comercial === "Vendida";
  const consulta = useConsultaCentral(() => V.ventaDeUnidadApi(unidad.coduni), [unidad?.coduni], { activo, intervalo: 20000, clave: `venta:${unidad?.coduni}` });
  const [eligiendo, setEligiendo] = useState(false);
  const [comprobante, setComprobante] = useState(false);
  const vta = consulta.data;
  if (!activo) return null;
  async function verEvidencia(ruta) {
    const ventana = window.open("", "_blank");
    try { const url = await V.urlEvidenciaVentaApi(ruta); if (ventana) ventana.location.href = url; else window.open(url, "_blank"); }
    catch (e) { ventana?.close(); toast(mensajeError(e), "error"); }
  }
  const listo = () => { consulta.refrescar(true); onCambio?.(); };
  const t = vta?.techo || {};
  const a = vta?.adelantoSeparacion;
  const x = ubicacionDe(unidad);
  const obs = V.partirObservacion(vta?.observacion);
  const base = vta?.precioBaseAcordado;
  const acordado = Number(vta?.adicionalTechoAcordado);
  const referencial = Number(vta?.adicionalTechoReferencial);
  const prep = etapaConTechoComercial(unidad);
  return (
    <Card data-venta={vta?.codven || ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-marino dark:text-white">Venta registrada</h2>
          <p className="text-[13px] text-slate-500">Vendida, pendiente de entrega. La venta no confirma llegada, preparación ni entrega.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {vta && puedeEditar && !vta.comprobanteExterno && <button className="btn btn-secondary !py-2 text-[13px]" onClick={() => setComprobante(true)} data-registrar-comprobante>Registrar comprobante</button>}
          {vta && <BotonCancelar tipo={VENTA} operacion={vta} onCancelar={onCancelar} />}
        </div>
      </div>
      {consulta.error && !vta && <div className="mt-3"><Aviso tipo="error">{S.faltaInstalar(consulta.error) ? "La API conectada todavía no muestra la venta: falta desplegar su versión nueva." : `No se pudo cargar la venta: ${mensajeError(consulta.error)}`}</Aviso></div>}
      {!vta && !consulta.error && <p className="mt-3 text-[13px] text-slate-500">{consulta.cargando ? "Cargando la venta…" : "La moto figura vendida, pero no se encontró su registro de venta."}</p>}
      {vta && (
        <dl className="mt-3 divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
          <Fila k="Comprador">{S.textoComprador(vta.comprador) || "Sin dato"}</Fila>
          <Fila k="Modalidad">{vta.modalidad}</Fila>
          {base !== null && base !== undefined && <Fila k="Precio base" data="base"><span className="cifra">{S.soles(base)}</span></Fila>}
          <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]" data-techo-venta={t.decision || ""}>
            <dt className="text-slate-500">Techo</dt>
            <dd>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className={`font-semibold ${t.decision === S.POR_DEFINIR ? "text-amber-700 dark:text-amber-300" : "text-marino dark:text-white"}`}>{S.textoDecision({ ...t, nombre: vta.techoNombre })}{t.decision === S.CON_TECHO && Number.isFinite(acordado) ? <> · <span className="cifra" data-adicional-venta={acordado}>+ {S.soles(acordado)}</span></> : t.decision === S.SIN_TECHO ? <> · <span className="cifra" data-adicional-venta="0">+ {S.soles(0)}</span></> : null}</span>
                {puedeEditar && t.decision === S.POR_DEFINIR && <button type="button" className="text-[13px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => setEligiendo(true)} data-elegir-techo-venta>Elegir techo</button>}
              </div>
              {t.decision === S.CON_TECHO && Number.isFinite(acordado) && Number.isFinite(referencial) && V.redondear(acordado) !== V.redondear(referencial) && <p className="mt-0.5 text-[12px] text-slate-500" data-adicional-acordado>Adicional acordado con el comprador. Referencial del catálogo: {S.soles(referencial)}.</p>}
              {t.decision === S.POR_DEFINIR && <p className="mt-0.5 text-[12px] text-slate-500">No suma al total hasta que el comprador lo elija; entonces se recalculan el total y el saldo de esta venta.</p>}
              {t.decision !== S.POR_DEFINIR && <p className="mt-0.5 text-[12px] text-slate-500">La decisión ya no se cambia.</p>}
            </dd>
          </div>
          <Fila k="Total de la venta" data="total"><span className="cifra" data-total-venta={vta.importe}>{S.soles(vta.importe)}</span></Fila>
          {a && <Fila k="Adelanto de la separación"><span className="cifra">{S.soles(a.monto)}</span>{` en ${String(a.medioPago).toLowerCase()}${a.fechaPago ? `, del ${fechaLarga(a.fechaPago)}` : ""}. Se cuenta una sola vez.`}</Fila>}
          <Fila k="Pagos">
            {vta.pagos?.length ? (
              <ul className="space-y-1">
                {vta.pagos.map((p) => (
                  <li key={p.codpagven} data-pago-venta={p.numero}>
                    <span className="cifra">{S.soles(p.monto)}</span>{` en ${String(p.medioPago).toLowerCase()}${p.referencia ? `, operación ${p.referencia}` : ""}, del ${fechaLarga(p.fecha)}`}
                    {p.rutaEvidencia && <button type="button" className="ml-2 text-[12.5px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => verEvidencia(p.rutaEvidencia)} data-ver-evidencia>Ver evidencia</button>}
                    {p.observacion && <span className="block text-[12px] font-normal text-slate-500">{p.observacion}</span>}
                  </li>
                ))}
              </ul>
            ) : "Ninguno"}
          </Fila>
          <Fila k="Total recibido"><span className="cifra">{S.soles(vta.totalRecibido)}</span></Fila>
          <Fila k={vta.modalidad === "Crédito" ? "Saldo a crédito" : "Saldo pendiente"} data="saldo"><span className="cifra" data-saldo-venta={vta.saldo}>{S.soles(vta.saldo)}</span></Fila>
          <Fila k="Sede de atención">{vta.sedeAtencion?.nombre}</Fila>
          <Fila k="Ubicación de la moto">{x.texto}</Fila>
          <Fila k="Entrega pactada" data="entrega">{obs.entrega ? `Se entregará ${obs.entrega}${vta.sedeEntregaPrevista && !/\ben\b/.test(obs.entrega) ? ` en ${vta.sedeEntregaPrevista.nombre}` : ""}` : vta.sedeEntregaPrevista ? `En ${vta.sedeEntregaPrevista.nombre}` : "Por acordar"}<span className="block text-[12px] font-normal text-slate-500">Acuerdo pendiente: la moto no está armada ni entregada por registrar la venta.</span></Fila>
          <Fila k="Preparación actual" data="preparacion"><span data-etapa-preparacion={prep.etapa}>{prep.etapa}</span>{prep.nota && <span className="block text-[12px] font-normal text-slate-500">{prep.nota}</span>}</Fila>
          <Fila k="Comprobante">{vta.comprobanteExterno ? `${vta.comprobanteExterno.referencia}, emitido el ${fechaLarga(vta.comprobanteExterno.fecha)}` : <span className="text-amber-700 dark:text-amber-300">Sin comprobante registrado</span>}</Fila>
          <Fila k="Responsable">{vta.responsable?.nombre || "Sin responsable asignado"}</Fila>
          <Fila k="Fecha de la venta">{`${fechaLarga(V.soloFecha(vta.fechaVenta))}, registrada por ${vta.autor?.nombre || ""}`}</Fila>
          {obs.resto && <Fila k="Observación">{obs.resto}</Fila>}
        </dl>
      )}
      {vta && onCancelar && <NotaPermisoCancelar operacion={vta} />}
      {eligiendo && vta && <ElegirTechoModal unidad={unidad} comprador={vta.comprador} que="venta" venta={vta} guardar={(d, tipo, adicional) => V.guardarTechoVentaApi(vta.codven, d, tipo, adicional)} onClose={() => setEligiendo(false)} onGuardado={() => { setEligiendo(false); listo(); }} />}
      {comprobante && vta && <ComprobanteModal venta={vta} onClose={() => setComprobante(false)} onGuardado={() => { setComprobante(false); listo(); }} />}
    </Card>
  );
}

// Referencia y fecha reales del comprobante emitido fuera de la plataforma
function ComprobanteModal({ venta, onClose, onGuardado }) {
  const toast = useToast();
  const [referencia, setReferencia] = useState(""); const [fecha, setFecha] = useState("");
  const [intentado, setIntentado] = useState(false); const [guardando, setGuardando] = useState(false); const [error, setError] = useState("");
  const fechaVenta = V.soloFecha(venta.fechaVenta);
  const e = V.errorComprobante(referencia, fecha, fechaVenta);
  async function enviar(ev) {
    ev.preventDefault();
    setIntentado(true);
    if (e.referencia || e.fecha || guardando) return;
    setGuardando(true); setError("");
    try { await V.guardarComprobanteVentaApi(venta.codven, referencia, fecha); toast("Comprobante registrado"); onGuardado(); }
    catch (er) { setError(sinRespuesta(er) ? "No se pudo confirmar si el comprobante se guardó porque falló la conexión. Vuelve a pulsar «Guardar comprobante»: no se duplica." : `No se pudo guardar el comprobante: ${mensajeError(er)}`); }
    finally { setGuardando(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo="Registrar comprobante" ancho="max-w-md" sinAvisoCambios={guardando}
      confirmarGuardar={{ titulo: "¿Registrar este comprobante?", texto: `Se registra ${referencia || "el comprobante"} del ${fecha ? fechaLarga(fecha) : ""} como emitido fuera de la plataforma. No se emite ni modifica ningún documento y después no se puede cambiar.`, boton: "Sí, registrar", validar: () => { setIntentado(true); return !e.referencia && !e.fecha; } }}
      pie={<><button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button><button form="f-comprobante" className="btn btn-primary !py-2" disabled={guardando} data-guardar-comprobante>{guardando ? "Guardando…" : "Guardar comprobante"}</button></>}>
      <form id="f-comprobante" onSubmit={enviar} className="space-y-4" noValidate data-comprobante-modal={venta.codven}>
        <p className="text-[13.5px] text-slate-600 dark:text-slate-300">Registra la boleta o factura que ya se emitió fuera de la plataforma, tal como figura en el documento.</p>
        <Campo etiqueta="Serie y número" error={intentado ? e.referencia : undefined} ayuda="Ej.: B001-00012345 o F001-123">
          <input id="comp-referencia" className="field-input cifra" value={referencia} autoComplete="off" placeholder="B001-00012345" onChange={(x) => setReferencia(V.filtrarComprobante(x.target.value))} />
        </Campo>
        <Campo etiqueta="Fecha de emisión" error={intentado ? e.fecha : undefined} ayuda={`Desde la fecha de la venta (${fechaLarga(fechaVenta)}) hasta hoy.`}>
          <input id="comp-fecha" type="date" className="field-input" value={fecha} min={fechaVenta} max={S.hoyLima()} onChange={(x) => setFecha(x.target.value)} />
        </Campo>
        {error && <Aviso tipo="error"><span data-error-comprobante>{error}</span></Aviso>}
      </form>
    </Modal>
  );
}
