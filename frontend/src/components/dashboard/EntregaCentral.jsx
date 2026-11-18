// HU-032 · Entrega efectiva de una moto vendida (contrato de Michelle del 15/11, docs/HU-032.md)
// En la tarjeta «Venta registrada» de la ficha se ve si la moto está pendiente de entrega (con lo que falta: sede
// acordada, traslado, armado, techo por definir o el techo acordado sin instalar), lista para entrega (armada o
// embalada) o entregada (fecha real, sede, quién recibió, quién registró, documentos pendientes y guía).
// «Registrar entrega» aparece solo cuando el servidor dice que está lista y para quien puede registrarla (gerente,
// administradora o el vendedor responsable vigente); el servidor vuelve a comprobar todo al confirmar.
// La entrega no cambia la venta, los pagos, la ubicación, el techo ni la preparación: una entrega embalada no
// acredita el armado. Un reintento por falla de red no la duplica (clave de intento).
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { mensajeError } from "../../lib/errores";
import { fechaLarga } from "../../lib/validar";
import { sinRespuesta, useIntento } from "../../servicios/central";
import * as E from "../../servicios/entregaCentral";
import * as S from "../../servicios/separacionCentral";
import * as V from "../../servicios/ventaCentral";
import { Aviso, Campo, Card, Modal, useToast } from "../ui";
import { fechaCompleta } from "./Central";

const TONOS = {
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  ambar: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  gris: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-white/10 dark:text-slate-300",
};
export const PillEntrega = ({ estado }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${TONOS[E.TONO_ENTREGA[estado]] || TONOS.gris}`} data-estado-entrega={estado}>{estado}</span>
);

function Dato({ k, children, data }) {
  return <div className="grid gap-0.5 py-1.5 sm:grid-cols-[11rem_1fr]" data-dato-entrega={data || k}><dt className="text-slate-500">{k}</dt><dd className="font-medium text-marino dark:text-white">{children}</dd></div>;
}
const textoModalidad = (m, sede) => (m ? `${m === "Embalada" ? "Embalada" : "Armada"}${sede?.nombre ? ` en ${sede.nombre}` : ""}` : "No se acordó si se entrega armada o embalada");

// Sección de entrega dentro de «Venta registrada». consulta = useConsultaCentral de GET /api/ventas/:codven/entrega
export function EntregaVenta({ venta, unidad, consulta, puedeEditar = true, onCambio }) {
  const { user } = useAuth();
  const [registrando, setRegistrando] = useState(false);
  const est = consulta?.data;
  if (!venta) return null;
  if (consulta?.error && !est) {
    // El servidor solo muestra la entrega al responsable vigente, al gerente y a la administradora (PT697)
    if (consulta.error.status === 403) {
      return (
        <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-white/10" data-entrega-venta="sin-permiso">
          <h3 className="text-[15px] font-bold text-marino dark:text-white">Entrega</h3>
          <p className="mt-1 text-[13px] text-slate-500" data-nota-entrega>{E.permisoEntrega(user, venta).texto || "La entrega la registra el responsable de la venta, el gerente o la administradora."}</p>
        </section>
      );
    }
    return (
      <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-white/10" data-entrega-venta="error">
        <h3 className="text-[15px] font-bold text-marino dark:text-white">Entrega</h3>
        <p className="mt-1 text-[13px] text-slate-500">{S.faltaInstalar(consulta.error) ? "El registro de la entrega (HU-032) estará disponible cuando se publique su versión del servidor. Por ahora la venta figura pendiente de entrega." : consulta.error.status >= 500 ? "No se pudo consultar la entrega en este momento (el servidor respondió con un error). La venta no cambió: vuelve a intentarlo con «Actualizar»." : `No se pudo consultar la entrega: ${mensajeError(consulta.error)}`}</p>
      </section>
    );
  }
  if (!est) return <p className="mt-4 text-[13px] text-slate-500" data-entrega-venta="cargando">Consultando la entrega…</p>;
  const ent = est.entrega;
  const permiso = E.permisoEntrega(user, venta);
  const faltan = Array.isArray(est.condicionesFaltantes) ? est.condicionesFaltantes : [];
  const porDefinir = /pendiente/i.test(faltan.join(" ")) && /techo/i.test(faltan.join(" "));
  return (
    <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-white/10" data-entrega-venta={est.estado}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-bold text-marino dark:text-white">Entrega</h3>
          <PillEntrega estado={est.estado} />
        </div>
        {!ent && E.lista(est) && puedeEditar && permiso.puede && <button className="btn btn-primary !py-2 text-[13px]" onClick={() => setRegistrando(true)} data-registrar-entrega>Registrar entrega</button>}
      </div>
      {ent ? (
        <dl className="mt-2 text-[13.5px]">
          <Dato k="Entregada" data="fecha">{`${fechaLarga(ent.fecha)}, en ${ent.sedeEfectiva?.nombre || ent.sedeAcordada?.nombre || "la sede acordada"}`}</Dato>
          <Dato k="Modalidad" data="modalidad">{ent.modalidad === "Embalada" ? "Embalada: la moto se entregó en su embalaje; la entrega no acredita el armado." : "Armada"}</Dato>
          <Dato k="Recibió" data="receptor">{ent.receptor}</Dato>
          <Dato k="Documentos" data="documentos">{ent.documentosPendientes ? <>{`Pendientes: ${ent.observacionDocumentos || "sin detalle"}`}<span className="block text-[12px] font-normal text-slate-500">{`Guía de remisión: ${ent.referenciaGuia || "sin referencia"}. No se marca tarjeta ni placa como entregadas.`}</span></> : "Sin documentos pendientes registrados"}</Dato>
          {ent.observacion && <Dato k="Observación" data="observacion">{ent.observacion}</Dato>}
          <Dato k="Registrada por" data="autor">{`${ent.registradoPor?.nombre || "Sin dato"}${ent.registradoEn ? `, el ${fechaLarga(V.fechaLima(ent.registradoEn))}` : ""}`}</Dato>
          <p className="mt-2 text-[12px] text-slate-500">La entrega queda registrada y no se modifica. No cambia la venta, los pagos ni el saldo{venta.modalidad === "Crédito" ? " (la venta a crédito conserva su saldo y no supone la transferencia de propiedad)" : ""}.</p>
        </dl>
      ) : est.estado === E.CANCELADA ? (
        <p className="mt-2 text-[13px] text-slate-500">La venta está cancelada: no se entrega.</p>
      ) : (
        <>
          <dl className="mt-2 text-[13.5px]">
            <Dato k="Entrega acordada" data="acordada">{textoModalidad(est.modalidadAcordada, est.sedeAcordada)}</Dato>
            <Dato k="Ubicación de la moto" data="ubicacion">{est.ubicacionActual?.sede || (unidad?.ubicacion?.nomubi ? `${unidad.ubicacion.nomubi} (no es una sede de entrega)` : "Sin ubicación registrada")}</Dato>
            {est.preparacion && <Dato k="Preparación" data="preparacion">{`Armado: ${String(est.preparacion.armado || "Sin dato").toLowerCase()} · techo: ${est.decisionTecho === S.SIN_TECHO && est.preparacion.techo !== "Instalado" ? "no lleva (sin techo)" : String(est.preparacion.techo || "Sin dato").toLowerCase()}`}</Dato>}
            {est.decisionTecho && <Dato k="Techo acordado" data="techo">{est.decisionTecho === S.CON_TECHO && venta.techoNombre ? `Con techo: ${venta.techoNombre}` : est.decisionTecho}</Dato>}
          </dl>
          {faltan.length > 0 ? (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-entrega-falta={faltan.length}>
              <p className="font-semibold">Falta para entregar:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{faltan.map((x) => <li key={x}>{x}</li>)}</ul>
              {porDefinir && <p className="mt-1">Primero registra el techo que eligió el comprador con «Elegir techo».</p>}
              {faltan.some((x) => /armado/i.test(x)) && <p className="mt-1" data-ayuda-armado>El armado se registra en «Preparación», en esta misma ficha (gerencia o administración).</p>}
            </div>
          ) : E.lista(est) ? (
            <p className="mt-2 text-[13px] text-emerald-700 dark:text-emerald-300" data-entrega-lista>{est.estado === E.LISTA_EMBALADA ? "Cumple lo acordado para entregarla embalada: recibida en la sede acordada. La entrega no la marca como armada." : "Cumple lo acordado: está en la sede acordada, armada y con el techo pactado."}</p>
          ) : null}
          {E.lista(est) && puedeEditar && !permiso.puede && <p className="mt-2 text-[12px] text-slate-500" data-nota-entrega>Entrega: {permiso.texto}</p>}
        </>
      )}
      {registrando && <RegistrarEntregaModal venta={venta} unidad={unidad} estado={est} onClose={() => setRegistrando(false)} onHecho={() => { setRegistrando(false); consulta.refrescar?.(true); onCambio?.(); }} onCambio={() => { consulta.refrescar?.(true); onCambio?.(); }} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Moto «Vendida» sin venta vigente: su venta se canceló después de entregarla (HU-021 con HU-032, PO 16/11)
// ---------------------------------------------------------------------------------------------
// consulta = useConsultaCentral de E.ventaCanceladaEntregadaApi. La entrega y la venta cancelada se muestran tal como
// quedaron; la moto sigue bloqueada hasta que el gerente registre su retorno (no hay botones: no se edita nada aquí).
export function VentaCanceladaEntregadaCard({ unidad, consulta }) {
  const d = consulta?.data;
  const v = d?.venta;
  const c = d?.cancelacion;
  return (
    <Card data-venta-cancelada-entregada={v?.codven || ""} data-estado={d?.entrega ? "entregada" : v ? "sin-detalle" : d ? "sin-venta" : "cargando"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-marino dark:text-white">{d?.entrega ? "Venta cancelada con la moto ya entregada" : "Sin venta vigente"}</h2>
        {d?.entrega && <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300" data-bloqueo-retorno>Bloqueada hasta registrar el retorno</span>}
      </div>
      {consulta?.error && !d && <div className="mt-3"><Aviso tipo="error">No se pudo consultar la venta cancelada de esta moto: {mensajeError(consulta.error)}</Aviso></div>}
      {!d && !consulta?.error && <p className="mt-2 text-[13px] text-slate-500">Buscando la venta de esta moto…</p>}
      {d && !v && <p className="mt-2 text-[13px] text-slate-500" data-sin-venta>La moto figura vendida, pero no tiene una venta vigente ni una venta cancelada a la vista. Actualiza la ficha; si sigue así, avisa al gerente.</p>}
      {v && !d.entrega && (
        <p className="mt-2 text-[13px] text-slate-500" data-sin-detalle>{`La venta N° ${v.codven} de esta moto se canceló y la moto sigue figurando vendida. Si ya se había entregado, queda bloqueada hasta que el gerente registre su retorno.${d.restringida ? " El detalle lo ven su responsable, el gerente y la administradora." : ""}`}</p>
      )}
      {v && d.entrega && (
        <>
          <p className="mt-1 text-[13px] text-slate-500" data-motivo-bloqueo>{E.BLOQUEO_RETORNO}</p>
          <dl className="mt-3 text-[13.5px]">
            <Dato k="Venta" data="venta">{`N° ${v.codven}, del ${fechaLarga(v.fecha)} · Cancelada`}</Dato>
            <Dato k="Comprador" data="comprador">{v.comprador?.nombre || "Sin dato"}</Dato>
            <Dato k="Techo acordado" data="techo">{v.techo?.decision === S.CON_TECHO ? `Con techo: ${v.techo?.nombre || "sin nombre"}` : v.techo?.decision || "Sin dato"}</Dato>
            <Dato k="Total y recibido" data="importes">{`${S.soles(v.total)} · recibido ${S.soles(v.totalRecibido)}. Se conservan: no se registró ninguna devolución.`}</Dato>
            <Dato k="Responsable" data="responsable">{v.responsable?.nombre || "Sin responsable asignado"}</Dato>
            {c && <Dato k="Cancelación" data="cancelacion">{`${fechaCompleta(c.fecha)}, por ${c.actor?.nombre || "Sin dato"}. Motivo: ${c.motivo}`}</Dato>}
          </dl>
          <EntregaVenta venta={{ ...v, techoNombre: v.techo?.nombre || null }} unidad={unidad} consulta={{ data: d.entrega }} puedeEditar={false} />
          <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5" data-retorno="pendiente">
            <h3 className="text-[15px] font-bold text-marino dark:text-white">Retorno de la moto</h3>
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">Pendiente de registrar. Lo registra el gerente con la fecha real del retorno, la ubicación, la condición de la moto y una observación. Al confirmarlo, la moto vuelve a ofrecerse si no tiene otro compromiso.</p>
          </section>
        </>
      )}
    </Card>
  );
}

const VACIO = { fecha: "", receptor: "", documentosPendientes: false, observacionDocumentos: "", referenciaGuia: "", observacion: "" };

export function RegistrarEntregaModal({ venta, unidad, estado, onClose, onHecho, onCambio }) {
  const toast = useToast();
  const clave = useIntento();
  const hoy = S.hoyLima();
  const [f, setF] = useState({ ...VACIO, fecha: hoy });
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState("");
  const [error, setError] = useState("");
  const [bloqueada, setBloqueada] = useState(false);
  const [hecho, setHecho] = useState(null);
  const fechaVenta = V.soloFecha(venta.fechaVenta);
  const err = E.erroresEntrega(f, { hoy, fechaVenta });
  const ver = (k) => (intentado ? err[k] : undefined);
  const cambiar = (k, v) => { setF((p) => ({ ...p, [k]: v })); setError(""); };
  const comprador = S.nombreComprador(venta.comprador);
  const embalada = estado?.modalidadAcordada === "Embalada";

  async function enviar(ev) {
    ev.preventDefault();
    setIntentado(true);
    if (Object.keys(err).length || enviando || bloqueada) return;
    const cuerpo = E.cuerpoEntrega(f, venta, estado);
    setEnviando("Registrando la entrega…"); setError("");
    try {
      const r = await E.registrarEntregaApi(venta.codven, cuerpo, clave(JSON.stringify(cuerpo)));
      const ent = r.data?.entrega || r.data?.entregaExistente;
      setHecho({ ...ent, reutilizada: r.status === 200 || r.data?.reutilizada === true });
      toast(r.status === 200 ? "La entrega ya estaba registrada" : "Entrega registrada");
    } catch (e) {
      if (sinRespuesta(e)) {
        // Sin respuesta clara: se revisa si la entrega quedó registrada antes de pedir un reintento
        setEnviando("Revisando si la entrega se registró…");
        const ahora = await E.entregaDeVentaApi(venta.codven).catch(() => undefined);
        if (ahora?.entrega) { setHecho({ ...ahora.entrega, reutilizada: true }); toast("La entrega sí quedó registrada"); }
        else setError(`${e.status >= 500 ? `El servidor respondió con un error (${e.status})` : "Se perdió la conexión"} y la entrega no se registró. Vuelve a pulsar «Registrar entrega»: no se duplica.`);
      } else {
        if (e.status === 409 || e.status === 403) { setBloqueada(e.status === 409 && Boolean(e.detalle?.data?.entregaExistente || /ya tiene una entrega/i.test(e.message || ""))); onCambio?.(); }
        setError(E.textoErrorEntrega(e));
      }
    } finally { setEnviando(""); }
  }

  if (hecho) {
    return (
      <Modal abierto onClose={onHecho} titulo="Entrega registrada" sinAvisoCambios pie={<button className="btn btn-primary !py-2" onClick={onHecho}>Listo</button>}>
        <div className="space-y-3 text-[13.5px]" data-entrega-guardada={hecho.codentrega || ""} data-reutilizada={hecho.reutilizada ? "si" : "no"}>
          <Aviso tipo="ok">{hecho.reutilizada ? "Esta entrega ya estaba registrada; no se duplicó." : "La moto quedó entregada al comprador."}</Aviso>
          <dl>
            <Dato k="Fecha">{`${fechaLarga(hecho.fecha)}, en ${hecho.sedeEfectiva?.nombre || estado?.sedeAcordada?.nombre || ""}`}</Dato>
            <Dato k="Modalidad">{hecho.modalidad}</Dato>
            <Dato k="Recibió">{hecho.receptor}</Dato>
            <Dato k="Documentos">{hecho.documentosPendientes ? `Pendientes: ${hecho.observacionDocumentos}. Guía: ${hecho.referenciaGuia}` : "Sin documentos pendientes"}</Dato>
          </dl>
        </div>
      </Modal>
    );
  }

  const pie = (
    <>
      <button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button>
      <button form="f-entrega" className="btn btn-primary !py-2" disabled={Boolean(enviando) || bloqueada} data-entrega-enviar>{enviando || "Registrar entrega"}</button>
    </>
  );
  return (
    <Modal abierto onClose={onClose} titulo="Registrar entrega" ancho="max-w-xl" pie={pie}
      confirmarGuardar={{ titulo: "¿Registrar la entrega?", texto: `Queda como entrega efectiva a ${comprador || "el comprador"} y ya no se modifica. No cambia la venta, los pagos ni la preparación.`, boton: "Sí, registrar entrega", validar: () => { setIntentado(true); return !Object.keys(err).length && !bloqueada; } }}>
      <form id="f-entrega" onSubmit={enviar} className="space-y-4" noValidate data-entrega-modal={venta.codven}>
        <dl className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-[13.5px] dark:border-white/10 dark:bg-white/5">
          <Dato k="Comprador">{S.textoComprador(venta.comprador) || "Sin dato"}</Dato>
          <Dato k="Moto">{`${unidad?.nommod || "Moto"} · motor ${unidad?.nummotuni || "—"} · chasis ${unidad?.chauni || "—"}`}</Dato>
          <Dato k="Entrega acordada">{textoModalidad(estado?.modalidadAcordada, estado?.sedeAcordada)}</Dato>
        </dl>
        {embalada && <Aviso tipo="info">Entrega excepcional embalada: la moto se entrega en su embalaje y no se marca como armada ni con techo instalado.</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Fecha real de la entrega" error={ver("fecha")}>
            <input id="ent-fecha" type="date" className="field-input" value={f.fecha} max={hoy} min={fechaVenta || undefined} onChange={(e) => cambiar("fecha", e.target.value)} />
          </Campo>
          <Campo etiqueta="Quién recibió la moto" error={ver("receptor")}>
            <input id="ent-receptor" className="field-input" maxLength={E.MAX_RECEPTOR + 20} value={f.receptor} onChange={(e) => cambiar("receptor", e.target.value)} placeholder="Nombre de quien recibió" />
            {comprador && <button type="button" className="mt-1 text-[12px] font-semibold text-marino-700 hover:underline dark:text-white" onClick={() => cambiar("receptor", comprador)} data-receptor-comprador>La recibió el comprador</button>}
          </Campo>
        </div>
        <label className="flex items-start gap-2.5 text-[13.5px]">
          <input id="ent-docs" type="checkbox" className="mt-0.5 h-4 w-4 accent-marino-700" checked={f.documentosPendientes} onChange={(e) => cambiar("documentosPendientes", e.target.checked)} />
          <span>Quedan documentos pendientes (tarjeta, placa u otros). <span className="text-slate-500">Se registra la guía de remisión; no se marcan como entregados.</span></span>
        </label>
        {f.documentosPendientes && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Documentos pendientes" error={ver("observacionDocumentos")}>
              <textarea id="ent-docs-obs" className="field-input" rows={2} maxLength={E.MAX_OBSERVACION + 20} value={f.observacionDocumentos} onChange={(e) => cambiar("observacionDocumentos", e.target.value)} placeholder="Por ejemplo: tarjeta y placa en trámite" />
            </Campo>
            <Campo etiqueta="Guía de remisión" error={ver("referenciaGuia")} ayuda="Serie y número de la guía.">
              <input id="ent-guia" className="field-input" maxLength={E.MAX_GUIA + 10} value={f.referenciaGuia} onChange={(e) => cambiar("referenciaGuia", e.target.value)} placeholder="GR-F001-000123" />
            </Campo>
          </div>
        )}
        <Campo etiqueta="Observación (opcional)" error={ver("observacion")}>
          <textarea id="ent-obs" className="field-input" rows={2} maxLength={E.MAX_OBSERVACION + 20} value={f.observacion} onChange={(e) => cambiar("observacion", e.target.value)} />
        </Campo>
        {venta.modalidad === "Crédito" && <p className="text-[12.5px] text-slate-500">Venta a crédito: entregar no supone el pago total ni la transferencia de propiedad.</p>}
        {error && <Aviso tipo="error"><span data-error-entrega>{error}</span></Aviso>}
      </form>
    </Modal>
  );
}
