import { useEffect, useRef, useState } from "react";
import { Aviso, Campo, Modal } from "../ui";
import { inventarioApi } from "../../servicios/central";
import * as S from "../../servicios/separacionCentral";
import * as P from "../../servicios/pedidoCentral";
import { mensajeError } from "../../lib/errores";

const TITULOS = { adelanto: "Registrar adelanto del pedido", acuerdo: "Actualizar acuerdo comercial", proponer: "Proponer unidad real", continuar: "Continuar pedido", cancelar: "Cancelar pedido" };
export default function AccionPedido({ pedido: p, accion, onClose, onHecho }) {
  const [form, setForm] = useState(null); const [unidades, setUnidades] = useState([]);
  const [error, setError] = useState(""); const [enviando, setEnviando] = useState(false); const [incierto, setIncierto] = useState(false);
  const intento = useRef(null); const evidencia = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [f, setF] = useState({ monto: "", fecha: S.hoyLima(), medio: "Efectivo", referencia: "", observacion: "", confirmado: false, gerente: "", codmod: p.modelo.codmod,
    color: p.color || "", decision: p.techo.decision, tipo: p.techo.codtte || "", adicional: String(p.precioReferencia.adicional), motivo: "", coduni: "", adecuacion: false,
    destino: "Venta", modalidad: "Crédito", descuento: "0", autorizador: "", telefono: false, dinero: "" });
  const set = (k, v) => setF(a => ({ ...a, [k]: v }));
  useEffect(() => { let vivo = true; Promise.all([P.formularioPedidoApi(), accion === "proponer" ? inventarioApi() : Promise.resolve(null)])
    .then(([d, inv]) => { if (vivo) { setForm(d); setUnidades(inv?.unidades || []); } }).catch(e => { if (vivo) setError(mensajeError(e)); }); return () => { vivo = false; }; }, [accion]);
  const candidatos = unidades.filter(u => u.comercial === "Libre" && String(u.codmod) === String(p.modelo.codmod) && (!p.color || u.coluni?.trim().toLowerCase() === p.color.trim().toLowerCase()));
  const elegida = candidatos.find(u => u.coduni === f.coduni);
  const techoElegida = elegida ? S.techoConfiguradoDe(elegida, form?.tiposTecho || []) : null;
  const totalNeto = Number(p.precioReferencia.total) - Number(f.descuento || 0);
  async function guardar(e) {
    e.preventDefault(); if (enviando) return; setError(""); setEnviando(true);
    try {
      if (!intento.current) {
        let datos = { versionEsperada: p.version };
        if (accion === "adelanto") {
          if (!f.confirmado) throw new Error("Confirma la recepción del adelanto.");
          datos = { ...datos, monto: Number(f.monto), fecha: f.fecha, medioPago: f.medio, ingresoConfirmado: true, observacion: S.limpio(f.observacion) || null };
          if (f.medio === "Transferencia") {
            if (!archivo || !f.gerente || !f.referencia.trim()) throw new Error("Adjunta evidencia, número de operación y gerente que confirmó el depósito por llamada.");
            evidencia.current ||= await P.evidenciaPedidoApi(p.codped, archivo);
            datos = { ...datos, referencia: f.referencia.trim(), rutaEvidencia: evidencia.current.rutaEvidencia, codusuConfirmador: Number(f.gerente) };
          }
        } else if (accion === "acuerdo") {
          datos = { ...datos, codmod: Number(f.codmod), color: S.limpio(f.color) || null, techo: f.decision === "Con techo" ? { decision: f.decision, codtte: Number(f.tipo) } : { decision: f.decision },
            adicionalTechoAcordado: f.decision === "Con techo" ? Number(f.adicional) : 0, motivo: f.motivo.trim() };
        } else if (accion === "proponer") datos = { ...datos, coduni: Number(f.coduni), adecuacionAceptada: f.adecuacion };
        else if (accion === "continuar") {
          datos = { ...datos, destino: f.destino, adecuacionAceptada: f.adecuacion };
          if (f.destino === "Venta") {
            datos = { ...datos, modalidad: f.modalidad, descuento: Number(f.descuento || 0) };
            if (Number(f.descuento) > 0) datos = { ...datos, motivoDescuento: f.motivo.trim(), codusuAutorizadorDescuento: Number(f.autorizador), confirmacionTelefonicaRecibida: f.telefono };
          }
        } else datos = { ...datos, motivo: f.motivo.trim(), observacionDinero: f.dinero.trim() || null };
        intento.current = await P.intentoPedido(`${accion}:${p.codped}`, datos);
      }
      await P.actuarPedidoApi(p.codped, accion, intento.current.cuerpo, intento.current.clave);
      P.olvidarIntentoPedido(intento.current); onHecho();
    } catch (e) {
      const desconocido = (!e.status || e.status >= 500) && Boolean(intento.current);
      setIncierto(desconocido);
      if (!desconocido) { P.olvidarIntentoPedido(intento.current); intento.current = null; }
      setError(mensajeError(e) + (desconocido ? " Repite el mismo envío para recuperar su resultado sin duplicarlo." : e.status === 409 ? " Cierra y actualiza el pedido antes de volver a intentarlo." : ""));
    } finally { setEnviando(false); }
  }
  const motivo = <Campo etiqueta="Motivo"><textarea id="pedido-accion-motivo" className="field-input" maxLength={500} required value={f.motivo} onChange={e => set("motivo", e.target.value)} /></Campo>;
  const adecuacion = <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.adecuacion} onChange={e => set("adecuacion", e.target.checked)} />Revisé el techo físico y el solicitado; el cliente acepta la adecuación pendiente. Esto no registra instalación ni permite entregar antes de cumplir el acuerdo.</label>;
  return <Modal abierto onClose={onClose} titulo={TITULOS[accion]} ancho="max-w-2xl" sinAvisoCambios={enviando || incierto} pie={<>
    <button className="btn btn-secondary" disabled={enviando} onClick={onClose}>Volver</button>
    <button form="pedido-accion" className="btn btn-primary" type="submit" disabled={!form || enviando}>{enviando ? "Guardando…" : incierto ? "Reintentar el mismo envío" : "Confirmar"}</button>
  </>}>
    {error && <Aviso tipo="error">{error}</Aviso>}
    {!form && !error && <p>Cargando datos…</p>}
    <form id="pedido-accion" onSubmit={guardar} className="space-y-4"><fieldset disabled={!form || enviando || incierto} className="space-y-4">
      {accion === "adelanto" && <>
        <p>Recibido: {S.soles(p.totalRecibido)} · Referencia vigente: {S.soles(p.precioReferencia.total)}. El primer adelanto debe ser al menos S/100.</p>
        <Campo etiqueta="Monto recibido"><input id="pedido-pago-monto" className="field-input" type="number" min={p.totalRecibido ? "0.01" : "100"} max={p.saldoReferencial} step="0.01" required value={f.monto} onChange={e => set("monto", e.target.value)} /></Campo>
        <Campo etiqueta="Fecha de recepción"><input id="pedido-pago-fecha" className="field-input" type="date" required min={S.fechaMinimaAdelanto()} max={S.hoyLima()} value={f.fecha} onChange={e => set("fecha", e.target.value)} /></Campo>
        <Campo etiqueta="Medio de pago"><select id="pedido-pago-medio" className="field-input" value={f.medio} onChange={e => set("medio", e.target.value)}><option>Efectivo</option><option>Transferencia</option></select></Campo>
        <Campo etiqueta="Observación de recepción"><textarea id="pedido-pago-observacion" className="field-input" maxLength={2000} required={f.medio === "Efectivo"} value={f.observacion} onChange={e => set("observacion", e.target.value)} /></Campo>
        {f.medio === "Transferencia" && <>
          <Campo etiqueta="Número de operación"><input id="pedido-pago-referencia" className="field-input" required maxLength={200} value={f.referencia} onChange={e => set("referencia", e.target.value)} /></Campo>
          <Campo etiqueta="Evidencia del depósito"><input id="pedido-pago-archivo" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={e => { setArchivo(e.target.files?.[0] || null); evidencia.current = null; }} /></Campo>
          <Campo etiqueta="Gerente que confirmó por llamada"><select id="pedido-pago-gerente" className="field-input" required value={f.gerente} onChange={e => set("gerente", e.target.value)}><option value="">Selecciona gerente</option>{form?.gerentes.map(g => <option key={g.codusu} value={g.codusu}>{g.nombre}</option>)}</select></Campo>
        </>}
        <label className="flex gap-2"><input required type="checkbox" checked={f.confirmado} onChange={e => set("confirmado", e.target.checked)} />{f.medio === "Efectivo" ? "Confirmo que recibí el efectivo." : "El gerente confirmó por llamada el ingreso del depósito; el comprobante por sí solo no lo confirma."}</label>
      </>}
      {accion === "acuerdo" && <>
        <Aviso>El cambio conserva lo recibido y deja sin efecto la propuesta anterior. No modifica la moto ni su techo físico.</Aviso>
        <Campo etiqueta="Modelo acordado"><select id="pedido-acuerdo-modelo" className="field-input" value={f.codmod} onChange={e => set("codmod", e.target.value)}>{form?.modelos.map(m => <option key={m.codmod} value={m.codmod}>{m.nombre} · {S.soles(m.precio)}</option>)}</select></Campo>
        <Campo etiqueta="Color (vacío: Por definir)"><input id="pedido-acuerdo-color" className="field-input" maxLength={50} value={f.color} onChange={e => set("color", e.target.value)} /></Campo>
        <Campo etiqueta="Techo solicitado"><select id="pedido-acuerdo-techo" className="field-input" value={f.decision} onChange={e => { set("decision", e.target.value); set("tipo", ""); set("adicional", "0"); }}><option>Por definir</option><option>Sin techo</option><option>Con techo</option></select></Campo>
        {f.decision === "Con techo" && <><Campo etiqueta="Tipo de techo"><select id="pedido-acuerdo-tipo" className="field-input" required value={f.tipo} onChange={e => { set("tipo", e.target.value); set("adicional", String(form.tiposTecho.find(t => t.codtte === e.target.value)?.adicionalReferencial || 0)); }}><option value="">Selecciona tipo</option>{form?.tiposTecho.filter(t => t.nombre !== "Sin techo").map(t => <option key={t.codtte} value={t.codtte}>{t.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Adicional de techo acordado"><input id="pedido-acuerdo-adicional" className="field-input" type="number" min="0" step="0.01" required value={f.adicional} onChange={e => set("adicional", e.target.value)} /></Campo></>}
        {motivo}
      </>}
      {accion === "proponer" && <>
        <Aviso>Esta propuesta no reserva la moto. La disponibilidad se comprueba otra vez al constituir una separación o venta. Si modelo/color cambian, actualiza primero el acuerdo.</Aviso>
        <Campo etiqueta="Unidad real compatible"><select id="pedido-unidad" className="field-input" required value={f.coduni} onChange={e => set("coduni", e.target.value)}><option value="">Selecciona por motor y chasis</option>{candidatos.map(u => <option key={u.coduni} value={u.coduni}>{u.nommod} · {u.coluni} · Motor {u.nummotuni} · Chasis {u.chauni}</option>)}</select></Campo>
        {form && !candidatos.length && <p>No hay una unidad libre que coincida con el acuerdo actual.</p>}
        {elegida && <p>Techo de la unidad: {techoElegida ? `${techoElegida.nombre}, ${S.estadoTechoMoto(techoElegida)}` : "sin techo configurado"}. Solicitud: {p.techo.nombre || p.techo.decision}. La elección comercial no modifica el estado físico.</p>}
        {adecuacion}
      </>}
      {accion === "continuar" && <>
        <Aviso>Se revalidará la unidad y se conservarán los recibos originales. No registres otra vez el adelanto del pedido como un pago nuevo.</Aviso>
        <p>Motor {p.unidadPropuesta?.motor} · Chasis {p.unidadPropuesta?.chasis}. Techo configurado: {p.unidadPropuesta?.techoConfigurado || "ninguno"} ({p.unidadPropuesta?.estadoTecho || "pendiente"}); solicitado: {p.techo.nombre || p.techo.decision}.</p>
        <Campo etiqueta="Continuar como"><select id="pedido-destino" className="field-input" value={f.destino} onChange={e => set("destino", e.target.value)}><option value="Venta">Venta</option><option value="Separacion" disabled={!p.totalRecibido}>Separación con adelanto</option></select></Campo>
        {f.destino === "Venta" && <>
          <Campo etiqueta="Modalidad"><select id="pedido-modalidad" className="field-input" value={f.modalidad} onChange={e => set("modalidad", e.target.value)}><option>Crédito</option><option>Contado</option></select></Campo>
          <Campo etiqueta="Descuento autorizado"><input id="pedido-descuento" className="field-input" type="number" min="0" max={Number(p.precioReferencia.total) - Number(p.totalRecibido)} step="0.01" value={f.descuento} onChange={e => set("descuento", e.target.value)} /></Campo>
          {Number(f.descuento) > 0 && <>{motivo}<Campo etiqueta="Gerente o administradora que autorizó por llamada"><select id="pedido-descuento-autorizador" className="field-input" required value={f.autorizador} onChange={e => set("autorizador", e.target.value)}><option value="">Selecciona autorizador</option>{form?.responsables.filter(r => ["Gerente", "Administradora"].includes(r.rol)).map(r => <option key={r.codusu} value={r.codusu}>{r.nombre}</option>)}</select></Campo><label className="flex gap-2"><input type="checkbox" required checked={f.telefono} onChange={e => set("telefono", e.target.checked)} />Confirmo la autorización previa por llamada.</label></>}
          <p>{S.soles(p.precioReferencia.base)} + techo {S.soles(p.precioReferencia.adicional)} − descuento {S.soles(f.descuento || 0)} = <strong>{S.soles(totalNeto)}</strong>. Recibido {S.soles(p.totalRecibido)}; saldo {S.soles(totalNeto - Number(p.totalRecibido))}.</p>
        </>}{adecuacion}
      </>}
      {accion === "cancelar" && <><Aviso>El pedido, sus recibos e historial se conservan. Esta acción no devuelve dinero ni modifica stock.</Aviso>{motivo}{p.totalRecibido > 0 && <Campo etiqueta="Tratamiento conocido del dinero"><textarea id="pedido-cancelar-dinero" className="field-input" required maxLength={2000} value={f.dinero} onChange={e => set("dinero", e.target.value)} /></Campo>}</>}
    </fieldset></form>
  </Modal>;
}
