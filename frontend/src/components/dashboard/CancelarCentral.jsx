// HU-021 · Cancelar una separación o una venta sin borrar su información (base central)
// Desde la ficha de la moto, quien puede (gerente, administradora o el vendedor responsable vigente) registra el
// motivo y qué pasó con el dinero recibido. La operación queda «Cancelada» con su nombre y la fecha; se conservan el
// adelanto, los pagos, las evidencias y el comprobante. La moto queda libre solo si no tiene otro compromiso vigente ni un
// traslado en curso (con traslado queda «No disponible»);
// su ubicación, techo y preparación no cambian. No se registra ninguna devolución ni se anula ningún comprobante.
// Si la red falla, se revisa en el servidor si la cancelación quedó guardada antes de decir nada: no se anuncia un
// éxito que no ocurrió ni se cancela dos veces.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { mensajeError } from "../../lib/errores";
import { fechaLarga } from "../../lib/validar";
import { sinRespuesta, useConsultaCentral, useIntento } from "../../servicios/central";
import * as C from "../../servicios/cancelacionCentral";
import * as S from "../../servicios/separacionCentral";
import { Aviso, Campo, Card, Modal, useToast } from "../ui";
import { IconCheck } from "../Icons";
import { fechaCompleta } from "./Central";

const largo = (t) => C.normalizar(t).length;
const NO_CONFIRMADO = (tipo) => `No se pudo confirmar si la ${tipo} se canceló porque falló la conexión. Vuelve a pulsar «Cancelar ${tipo}»: este mismo envío no se registrará dos veces.`;

// Fila del resumen
function Dato({ k, children, data }) {
  return <div className="grid gap-1 py-1.5 sm:grid-cols-[11rem_1fr]" data-dato={data || k}><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-marino [overflow-wrap:anywhere] dark:text-white">{children}</dd></div>;
}

// Lo que se conserva de la operación (lo que se cobró y sus evidencias)
function DineroOperacion({ tipo, op }) {
  if (tipo === C.SEPARACION) {
    return (
      <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10" data-dinero-operacion>
        <Dato k="Adelanto" data="adelanto"><span className="cifra">{S.soles(op.monto)}</span>{` en ${String(op.medioPago || "").toLowerCase()}${op.referencia ? `, operación ${op.referencia}` : ""}${op.fechaPago ? `, del ${fechaLarga(op.fechaPago)}` : ""}`}</Dato>
        <Dato k="Evidencia">{op.rutaEvidencia ? "Captura guardada: se conserva" : op.medioPago === "Efectivo" ? "Recepción en caja anotada" : "Sin captura"}</Dato>
      </dl>
    );
  }
  const pagos = (op.pagos || []).reduce((n, p) => n + Number(p.monto || 0), 0);
  const adelanto = Number(op.adelantoSeparacion?.monto || 0) && op.adelantoSeparacion?.ingresoConfirmado !== false ? Number(op.adelantoSeparacion.monto) : 0;
  return (
    <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10" data-dinero-operacion>
      <Dato k="Total de la venta" data="total"><span className="cifra">{S.soles(op.importe)}</span>{Number(op.descuento) > 0 ? <span className="font-normal text-slate-500">{` (incluye descuento autorizado de ${S.soles(op.descuento)})`}</span> : null}</Dato>
      {adelanto > 0 && <Dato k="Adelanto de la separación" data="adelanto"><span className="cifra">{S.soles(adelanto)}</span></Dato>}
      <Dato k="Pagos" data="pagos">{op.pagos?.length ? <><span className="cifra">{S.soles(pagos)}</span>{` en ${op.pagos.length} pago${op.pagos.length === 1 ? "" : "s"}`}</> : "Ninguno"}</Dato>
      <Dato k="Total recibido" data="recibido"><span className="cifra" data-recibido={op.totalRecibido}>{S.soles(op.totalRecibido)}</span></Dato>
      <Dato k="Comprobante">{op.comprobanteExterno ? `${op.comprobanteExterno.referencia}: se conserva, no se anula` : "Sin comprobante registrado"}</Dato>
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// Cancelar (ventana)
// ---------------------------------------------------------------------------------------------
// tipo: C.SEPARACION (operacion = separación activa de la ficha) o C.VENTA (operacion = venta registrada)
export function CancelarOperacionModal({ tipo, operacion: op, unidad, onClose, onHecho, onCambio }) {
  const { user } = useAuth();
  const toast = useToast();
  const intento = useIntento();
  const [motivo, setMotivo] = useState("");
  const [observacion, setObservacion] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState("");
  const [err, setErr] = useState({});
  const [hecho, setHecho] = useState(null);
  const [bloqueada, setBloqueada] = useState(false);
  // El aviso de error queda al final de la ventana: se lleva a la vista para que no pase desapercibido
  const refError = useRef(null);
  useEffect(() => { if (err.general) refError.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [err.general]);
  const esVenta = tipo === C.VENTA;
  const cod = esVenta ? op.codven : op.codsep;
  const recibido = esVenta ? Number(op.totalRecibido) || 0 : Number(op.monto) || 0;
  const exige = C.exigeObservacion(tipo, recibido);
  const e = C.erroresCancelacion(motivo, observacion, exige);
  // Errores mientras se escribe (largo o caracteres no permitidos); el campo vacío se marca al intentar cancelar
  const ver = (k, texto) => err[k] || (e[k] && (intentado || C.normalizar(texto)) ? e[k] : undefined);
  const titulo = esVenta ? "Cancelar venta" : "Cancelar separación";
  const moto = `${unidad?.nommod || "Moto"}${unidad?.nummotuni ? ` · motor ${unidad.nummotuni}` : ""}`;

  // nota: por qué se muestra un resultado ya guardado (reintento o verificación después de una falla)
  function terminar(r, nota = "") {
    const n = nota || (r?.reutilizada ? "Ya estaba registrada con estos mismos datos: no se canceló dos veces." : "");
    setHecho({ ...r, nota: n });
    toast(n ? `La ${tipo} quedó cancelada` : `${esVenta ? "Venta" : "Separación"} cancelada`);
    onHecho?.(r);
  }
  // Tras una falla o un conflicto: ¿quedó cancelada? ¿por quién?
  async function revisar(nota) {
    const c = await C.cancelacionDeApi(tipo, cod).catch(() => undefined);
    if (c && C.esMiCancelacion(c, user?.codusu, motivo)) {
      terminar({ estado: "Cancelada", fechaCancelacion: c.fecha, motivo: c.motivo, observacionDinero: c.observacionFinanciera, estadoComercialUnidad: c.estadoComercialResultante, unidadLiberada: c.estadoComercialResultante === "Disponible" }, nota);
      return "mia";
    }
    if (c) {
      setBloqueada(true); onCambio?.();
      setErr({ general: `Esta ${tipo} ya fue cancelada por ${c.actor?.nombre || "otra persona"} el ${fechaCompleta(c.fecha)}, con el motivo «${c.motivo}». No se registró otra cancelación.` });
      return "otra";
    }
    return c; // null: sigue vigente; undefined: no se pudo consultar
  }

  async function enviar(ev) {
    ev.preventDefault();
    setIntentado(true);
    if (e.motivo || e.observacion || enviando || hecho || bloqueada) return;
    const clave = intento(C.firmaCancelacion(cod, motivo, observacion));
    setEnviando("Cancelando…"); setErr({});
    try {
      const r = esVenta ? await C.cancelarVentaApi(cod, motivo, observacion, clave) : await C.cancelarSeparacionApi(cod, motivo, observacion, clave);
      terminar(r);
    } catch (er) {
      if (sinRespuesta(er)) {
        setEnviando("Revisando si la cancelación se guardó…");
        const causa = er?.status >= 500 ? `El servidor respondió con un error (${er.status})` : "Se perdió la conexión con el servidor";
        const r = await revisar(`${causa}, pero la cancelación sí quedó registrada en el servidor (se verificó). No se canceló dos veces.`);
        if (r === null) setErr({ general: `${causa} y la ${tipo} no se canceló: sigue vigente y tus datos siguen aquí. Vuelve a pulsar «${titulo}». Si se repite, avisa a soporte con la hora y la moto.` });
        else if (r === undefined) setErr({ general: NO_CONFIRMADO(tipo) });
      } else {
        const x = C.errorCancelacion(er, tipo);
        if (x.campo) setErr({ [x.campo]: x.texto });
        else if (x.cambio) {
          setEnviando("Revisando la operación…");
          const r = await revisar("Ya la habías cancelado con este motivo: se muestra lo que quedó registrado.");
          if (r !== "mia" && r !== "otra") { setBloqueada(true); onCambio?.(); setErr({ general: x.texto }); }
        } else setErr({ general: x.texto });
      }
    } finally { setEnviando(""); }
  }

  if (hecho) {
    const f = hecho.finanzasConservadas || {};
    return (
      <Modal abierto onClose={onClose} titulo={titulo} ancho="max-w-lg" sinAvisoCambios pie={<button className="btn btn-primary !py-2" onClick={onClose} data-listo-cancelacion>Listo</button>}>
        <div className="space-y-4" data-cancelacion-hecha={cod}>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><IconCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-[16px] font-bold text-marino dark:text-white">{esVenta ? "Venta cancelada" : "Separación cancelada"}</p>
              <p className="text-[13px] text-slate-500" data-nota-cancelacion={hecho.nota ? "verificada" : ""}>{hecho.nota || `Quedó registrada con tu nombre${hecho.fechaCancelacion ? `, ${fechaCompleta(hecho.fechaCancelacion)}` : ""}.`}</p>
            </div>
          </div>
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            <Dato k="Moto">{moto}</Dato>
            <Dato k="La moto queda" data="estado-moto"><span data-estado-moto={hecho.estadoComercialUnidad}>{C.textoEstadoMoto(hecho.estadoComercialUnidad)}</span></Dato>
            <Dato k="Motivo">{hecho.motivo}</Dato>
            {hecho.observacionDinero && <Dato k="Dinero recibido">{hecho.observacionDinero}</Dato>}
            {esVenta && f.totalRecibido !== undefined && <Dato k="Se conserva" data="conserva"><span className="cifra">{S.soles(f.totalRecibido)}</span> recibido{f.comprobanteExternoConservado ? " y el comprobante" : ""}</Dato>}
            {!esVenta && f.adelanto !== undefined && <Dato k="Se conserva" data="conserva">Adelanto de <span className="cifra">{S.soles(f.adelanto)}</span>{f.evidenciaConservada ? " y su captura" : ""}</Dato>}
          </dl>
          <p className="text-[12.5px] text-slate-500">La ubicación, el techo y la preparación de la moto no cambiaron. No se registró ninguna devolución{esVenta ? " ni se anuló el comprobante" : ""}: si corresponde devolver dinero, se hace fuera de la plataforma.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal abierto onClose={onClose} titulo={titulo} ancho="max-w-xl" sinAvisoCambios={Boolean(enviando)}
      confirmarGuardar={{ titulo: `¿${titulo}?`, texto: `Queda cancelada con tu nombre y la fecha, y no se puede deshacer. ${esVenta ? "La venta" : "La separación"} y su dinero se conservan; la moto queda libre si no tiene otro compromiso ni un traslado en curso.`, boton: `Sí, ${titulo.toLowerCase()}`, validar: () => { setIntentado(true); return !e.motivo && !e.observacion && !bloqueada; } }}
      pie={<>
        <button type="button" className="btn btn-secondary !py-2" onClick={onClose} data-volver-cancelacion>Volver</button>
        <button form="f-cancelar" className="btn !py-2 bg-acento text-white hover:bg-acento-600 disabled:opacity-60" disabled={Boolean(enviando) || bloqueada} data-confirmar-cancelacion>{enviando || titulo}</button>
      </>}>
      <form id="f-cancelar" onSubmit={enviar} className="space-y-4" noValidate data-cancelar-modal={tipo} data-cod={cod}>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            <Dato k="Moto">{moto}</Dato>
            <Dato k="Comprador">{S.textoComprador(op.comprador) || "Sin dato"}</Dato>
            <Dato k="Responsable" data="responsable">{op.responsable?.nombre || "Sin responsable asignado"}</Dato>
          </dl>
          <div className="mt-2 border-t border-slate-100 pt-2 dark:border-white/10"><DineroOperacion tipo={tipo} op={op} /></div>
        </div>
        <Aviso tipo="info">
          Se conserva todo lo registrado: {esVenta ? "pagos, adelanto, evidencias y comprobante" : "el adelanto y su evidencia"}. La moto no se mueve y su techo y preparación siguen igual. No se registra una devolución{esVenta ? " ni se anula el comprobante" : ""}.
        </Aviso>
        <Campo etiqueta="Motivo de la cancelación" error={ver("motivo", motivo)} ayuda={`${largo(motivo)}/${C.MAX_MOTIVO}. Queda con tu nombre y la fecha.`}>
          <textarea id="can-motivo" className="field-input" rows={2} value={motivo} maxLength={C.MAX_MOTIVO + 50} placeholder={esVenta ? "Ej.: El comprador desistió de la compra" : "Ej.: El comprador ya no comprará la moto"} onChange={(x) => { setMotivo(x.target.value); setErr((p) => ({ ...p, motivo: undefined, general: bloqueada ? p.general : undefined })); }} />
        </Campo>
        <Campo etiqueta={`Qué pasó con el dinero recibido${exige ? "" : " (opcional)"}`} error={ver("observacion", observacion)} ayuda={`${largo(observacion)}/${C.MAX_OBS_DINERO}. ${exige ? `Se recibió ${S.soles(recibido)}: anota dónde está y qué evidencia hay. ` : "No se recibió dinero. "}No ejecuta ni registra una devolución.`}>
          <textarea id="can-observacion" className="field-input" rows={3} value={observacion} maxLength={C.MAX_OBS_DINERO + 50} placeholder="Ej.: El adelanto sigue en caja; el comprador pedirá su devolución con su voucher" onChange={(x) => { setObservacion(x.target.value); setErr((p) => ({ ...p, observacion: undefined, general: bloqueada ? p.general : undefined })); }} />
        </Campo>
        {err.general && <div ref={refError}><Aviso tipo={bloqueada ? "aviso" : "error"}><span data-error-cancelacion>{err.general}</span></Aviso></div>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Botón y aviso de permiso dentro de la tarjeta de la operación
// ---------------------------------------------------------------------------------------------
export function BotonCancelar({ tipo, operacion, onCancelar }) {
  const { user } = useAuth();
  if (!operacion || !onCancelar) return null;
  const p = C.permisoCancelar(user, operacion);
  if (!p.puede) return null;
  return <button className="btn !py-2 text-[13px] border border-acento/40 bg-white text-acento hover:bg-red-50 dark:bg-transparent dark:hover:bg-red-500/10" onClick={() => onCancelar(operacion)} data-cancelar={tipo}>{tipo === C.VENTA ? "Cancelar venta" : "Cancelar separación"}</button>;
}
export function NotaPermisoCancelar({ operacion }) {
  const { user } = useAuth();
  if (!operacion || String(user?.rol || "").toLowerCase() !== "vendedor") return null;
  const p = C.permisoCancelar(user, operacion);
  return p.puede ? null : <p className="mt-3 text-[12px] text-slate-500" data-nota-cancelar>Cancelación: {p.texto}</p>;
}

// ---------------------------------------------------------------------------------------------
// Historial de cancelaciones de la moto (ficha)
// ---------------------------------------------------------------------------------------------
export function CancelacionesUnidadCard({ unidad, version = 0 }) {
  const consulta = useConsultaCentral(() => C.cancelacionesDeUnidadApi(unidad.coduni), [unidad?.coduni, version], { activo: Boolean(unidad?.coduni), intervalo: 30000, clave: `cancelaciones:${unidad?.coduni}` });
  const lista = consulta.data || [];
  if (!lista.length) return null;
  return (
    <Card data-cancelaciones={lista.length}>
      <h2 className="text-lg font-bold text-marino dark:text-white">Cancelaciones</h2>
      <p className="text-[13px] text-slate-500">Separaciones y ventas de esta moto que se cancelaron. Se conservan con su motivo y su dinero; no se pueden modificar.</p>
      <ul className="mt-3 space-y-3">
        {lista.map((c) => {
          const f = c.finanzasConservadas || {};
          const recibido = c.tipoOperacion === "Venta" ? f.totalRecibido : f.adelanto;
          return (
            <li key={`${c.tipoOperacion}-${c.codOperacion}`} className="rounded-xl border border-slate-200 p-3 text-[13.5px] [overflow-wrap:anywhere] dark:border-white/10" data-cancelacion={`${c.tipoOperacion}-${c.codOperacion}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-marino dark:text-white">{C.textoTipo(c.tipoOperacion)} cancelada{c.comprador ? ` · ${c.comprador}` : ""}</p>
                <p className="text-[12.5px] text-slate-500">{fechaCompleta(c.fecha)}, por {c.actor?.nombre || "Sin dato"}</p>
              </div>
              <p className="mt-1"><span className="text-slate-500">Motivo:</span> {c.motivo}</p>
              {c.observacionFinanciera && <p className="mt-0.5"><span className="text-slate-500">Dinero:</span> {c.observacionFinanciera}</p>}
              <p className="mt-0.5 text-[12.5px] text-slate-500">
                {recibido !== undefined && recibido !== null ? <>Recibido que se conserva: <span className="cifra">{S.soles(recibido)}</span>. </> : null}
                {c.fechaOperacion ? `${C.textoTipo(c.tipoOperacion)} del ${fechaLarga(String(c.fechaOperacion).slice(0, 10))}. ` : ""}
                {c.responsable?.nombre ? `Responsable: ${c.responsable.nombre}. ` : ""}La moto quedó: {C.textoEstadoMoto(c.estadoComercialResultante).toLowerCase()}.
              </p>
            </li>
          );
        })}
      </ul>
      {consulta.error && <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">No se pudo actualizar: {mensajeError(consulta.error)}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Detalle de una venta cancelada (Ventas a clientes)
// ---------------------------------------------------------------------------------------------
export function DetalleCancelacionModal({ tipo = C.VENTA, cod, titulo, onClose }) {
  const consulta = useConsultaCentral(() => C.cancelacionDeApi(tipo, cod), [tipo, cod], { clave: `cancelacion:${tipo}:${cod}` });
  const c = consulta.data;
  const e = consulta.error;
  return (
    <Modal abierto onClose={onClose} titulo={titulo || "Cancelación"} ancho="max-w-lg" sinAvisoCambios pie={<button className="btn btn-secondary !py-2" onClick={onClose}>Cerrar</button>}>
      <div data-detalle-cancelacion={cod}>
        {e && <Aviso tipo={e.status === 403 ? "info" : "error"}>{e.status === 403 ? "El detalle de esta cancelación lo ven su responsable vigente, el gerente y la administradora." : S.faltaInstalar(e) ? "La API conectada todavía no tiene la cancelación (HU-021)." : `No se pudo cargar: ${mensajeError(e)}`}</Aviso>}
        {!e && consulta.cargando && !c && <p className="text-[13.5px] text-slate-500">Cargando…</p>}
        {!e && !consulta.cargando && c === null && <p className="text-[13.5px] text-slate-500">No tiene una cancelación registrada.</p>}
        {c && (
          <dl className="divide-y divide-slate-100 text-[13.5px] dark:divide-white/10">
            <Dato k="Cancelada por">{c.actor?.nombre || "Sin dato"}</Dato>
            <Dato k="Fecha">{fechaCompleta(c.fecha)}</Dato>
            <Dato k="Motivo">{c.motivo}</Dato>
            <Dato k="Dinero recibido">{c.observacionFinanciera || "Sin dinero recibido"}</Dato>
            <Dato k="La moto quedó">{C.textoEstadoMoto(c.estadoComercialResultante)}</Dato>
          </dl>
        )}
      </div>
    </Modal>
  );
}
