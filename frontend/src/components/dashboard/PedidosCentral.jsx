import { useEffect, useRef, useState } from "react";
import { Link } from "./LinkPanel";
import { useAuth } from "../../context/AuthContext";
import { mensajeError } from "../../lib/errores";
import { useConsultaCentral } from "../../servicios/central";
import * as S from "../../servicios/separacionCentral";
import * as P from "../../servicios/pedidoCentral";
import { Aviso, Campo, Card, Modal, PageHeader, Tabla, Vacio } from "../ui";
import { AvisoConexion, BarraActualizacion, Paginador } from "./Central";
import AccionPedido from "./PedidoAccion";

export default function PedidosCentral() {
  const { puede } = useAuth();
  const [q, setQ] = useState(""); const [offset, setOffset] = useState(0);
  const [nuevo, setNuevo] = useState(false); const [detalle, setDetalle] = useState(null);
  const consulta = useConsultaCentral(() => P.pedidosApi({ q, offset }), [q, offset], { intervalo: 15000, clave: `pedidos-hu031:${q}:${offset}` });
  const d = consulta.data;
  return <div data-pedidos-central>
    <PageHeader titulo="Pedidos sin unidad" subtitulo="Solicitudes de clientes que todavía no tienen una moto concreta vinculada. Un pedido no aumenta inventario ni reserva una unidad.">
      <Link to="/admin/ventas" className="btn btn-secondary">Ver ventas</Link>
      {puede("separaciones.registrar") && <button className="btn btn-primary" onClick={() => setNuevo(true)} data-nuevo-pedido>+ Nuevo pedido</button>}
    </PageHeader>
    <AvisoConexion consulta={consulta} que="los pedidos" />
    <Card className="mb-5"><div className="flex flex-wrap items-end gap-3">
      <div className="grow"><label className="field-label" htmlFor="pedido-buscar">Buscar pedido</label><input id="pedido-buscar" className="field-input" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} placeholder="Número, comprador o celular" /></div>
      <BarraActualizacion consulta={consulta} />
    </div></Card>
    {consulta.error && !d && <Aviso tipo="error">No se pudieron cargar los pedidos: {mensajeError(consulta.error)}</Aviso>}
    {!d && !consulta.error && <p>Cargando pedidos…</p>}
    {d && (d.items.length ? <><Tabla columnas={["Pedido", "Comprador", "Modelo y techo", "Estado", "Responsable y sede", ""]}>
      {d.items.map(p => <tr key={p.codped} data-pedido-fila={p.codped} className="align-top">
        <td className="px-4 py-3">N.º {p.codped}</td>
        <td className="px-4 py-3"><strong>{p.comprador.nombre}</strong><span className="block text-sm text-slate-500">{p.comprador.telefono}</span></td>
        <td className="px-4 py-3">{p.modelo.nombre}<span className="block text-sm text-slate-500">{p.color || "Color por definir"} · {p.techo.nombre || p.techo.decision}</span></td>
        <td className="px-4 py-3">{p.estado}</td>
        <td className="px-4 py-3">{p.responsable.nombre}<span className="block text-sm text-slate-500">{p.sedeAtencion.nombre}</span></td>
        <td className="px-4 py-3"><button className="btn btn-secondary !py-1" onClick={() => setDetalle(p.codped)}>Ver pedido</button></td>
      </tr>)}
    </Tabla><Paginador total={d.total} limite={25} offset={offset} onCambio={setOffset} /></> : <Vacio titulo="No hay pedidos con estos filtros" texto="Puedes registrar un pedido aunque todavía no haya una moto disponible para el cliente." />)}
    {nuevo && <NuevoPedido onClose={() => setNuevo(false)} onHecho={p => { setNuevo(false); consulta.refrescar(true); setDetalle(p.codped); }} />}
    {detalle && <DetallePedido codped={detalle} onClose={() => setDetalle(null)} onCambio={() => consulta.refrescar(true)} />}
  </div>;
}

function NuevoPedido({ onClose, onHecho }) {
  const [form, setForm] = useState(null); const [error, setError] = useState(""); const [guardando, setGuardando] = useState(false);
  const [incierto, setIncierto] = useState(false); const intento = useRef(null); const comprador = useRef(null);
  const [buscar, setBuscar] = useState(""); const [coincidencias, setCoincidencias] = useState(null); const [elegido, setElegido] = useState(null);
  const [f, setF] = useState({ nombres: "", apellidoPaterno: "", apellidoMaterno: "", telefono: "", codmod: "", color: "", responsable: "", sede: "", sedeEntrega: "", decision: "Por definir", tipo: "", fecha: "", observacion: "" });
  const cambiar = (k, v) => { if (["nombres", "apellidoPaterno", "apellidoMaterno", "telefono"].includes(k)) setElegido(null); setF(x => ({ ...x, [k]: v })); };
  const cargar = () => { setError(""); P.formularioPedidoApi().then(x => { setForm(x); setF(v => ({ ...v, responsable: x.usuarioActual.codusu })); }).catch(e => setError(mensajeError(e))); };
  useEffect(cargar, []);
  const modelo = form?.modelos.find(m => m.codmod === f.codmod);
  const tipo = form?.tiposTecho.find(t => t.codtte === f.tipo);
  const responsables = form ? S.responsablesPermitidos(form) : [];
  const techoExtra = f.decision === "Con techo" ? Number(tipo?.adicionalReferencial || 0) : 0;
  async function guardar(e) {
    e.preventDefault(); if (guardando) return;
    setError("");
    if (!intento.current) {
      const errores = S.erroresComprador(f);
      if (Object.keys(errores).length) { setError(Object.values(errores).join(" ")); return; }
      if (!f.codmod || !f.responsable || !f.sede || (f.decision === "Con techo" && !f.tipo)) { setError("Completa modelo, responsable, sede y tipo de techo cuando corresponda."); return; }
    }
    setGuardando(true);
    try {
      if (!intento.current) {
        const datosPersona = { nombres: S.limpio(f.nombres), apellidoPaterno: S.limpio(f.apellidoPaterno), apellidoMaterno: S.limpio(f.apellidoMaterno) || null, telefono: f.telefono };
        const firma = JSON.stringify(datosPersona);
        if (!elegido && comprador.current?.firma !== firma) comprador.current = { firma, resultado: await S.registrarCompradorApi(datosPersona) };
        const c = elegido || comprador.current.resultado;
        const persona = c.comprador || c;
        const cuerpo = {
          codcli: Number(persona.codcli), codmod: Number(f.codmod), codusuResponsable: Number(f.responsable), codsedAtencion: Number(f.sede),
          codsedEntregaPrevista: f.sedeEntrega ? Number(f.sedeEntrega) : null, color: S.limpio(f.color) || null,
          techo: f.decision === "Con techo" ? { decision: f.decision, codtte: Number(f.tipo) } : { decision: f.decision },
          fechaEntregaPrevista: f.fecha || null, observacion: S.limpio(f.observacion) || null
        };
        intento.current = await P.intentoPedido(`crear:${form.usuarioActual.codusu}`, cuerpo);
      }
      const r = await P.crearPedidoApi(intento.current.cuerpo, intento.current.clave);
      P.olvidarIntentoPedido(intento.current);
      onHecho(r.pedido);
    } catch (er) {
      const desconocido = !er.status || er.status >= 500;
      setIncierto(desconocido && Boolean(intento.current));
      if (!desconocido) { P.olvidarIntentoPedido(intento.current); intento.current = null; }
      setError(mensajeError(er) + (desconocido && intento.current ? " Reintenta este mismo envío para recuperar su resultado sin duplicarlo." : ""));
    } finally { setGuardando(false); }
  }
  return <Modal abierto onClose={onClose} titulo="Nuevo pedido sin unidad" ancho="max-w-2xl" sinAvisoCambios={guardando || incierto} pie={<>
    <button className="btn btn-secondary" disabled={guardando} onClick={onClose}>Volver</button>
    <button form="pedido-nuevo" type="submit" className="btn btn-primary" disabled={!form || guardando}>{guardando ? "Guardando…" : incierto ? "Reintentar el mismo envío" : "Guardar pedido"}</button>
  </>}>
    {!form && !error && <p>Cargando datos…</p>}
    {error && <Aviso tipo="error">{error}{!form && <button className="underline ml-2" onClick={cargar}>Reintentar</button>}</Aviso>}
    {form && <form id="pedido-nuevo" onSubmit={guardar} className="space-y-4">
      <fieldset disabled={guardando || incierto} className="space-y-4">
        <Aviso>Registra la solicitud sin inventar una moto. El precio mostrado es referencial y el pedido no confirma compra, separación ni entrega.</Aviso>
        <div className="space-y-2">
          <label className="field-label" htmlFor="pedido-comprador-buscar">Buscar comprador existente</label>
          <div className="flex gap-2"><input id="pedido-comprador-buscar" className="field-input" value={buscar} maxLength={100} onChange={e => { setBuscar(e.target.value); setCoincidencias(null); }} placeholder="Nombre o celular" /><button type="button" className="btn btn-secondary" disabled={buscar.trim().length < 2} onClick={async () => { try { setCoincidencias(await P.compradoresPedidoApi(buscar)); setError(""); } catch(e) { setError(mensajeError(e)); } }}>Buscar</button></div>
          {coincidencias && <ul>{coincidencias.map(c => <li key={c.codcli}><button type="button" className="underline text-left" onClick={() => { setElegido(c); setF(x => ({ ...x, nombres:c.nombres, apellidoPaterno:c.apellidoPaterno, apellidoMaterno:c.apellidoMaterno || "", telefono:c.telefono })); setCoincidencias(null); }}>{S.nombreComprador(c)} · {c.telefono}</button></li>)}{!coincidencias.length && <li>No hay coincidencias; completa los datos del comprador nuevo.</li>}</ul>}
          {elegido && <p className="text-sm">Se usará el comprador N.º {elegido.codcli}; editar sus datos inicia otro registro, sin modificar el original.</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombres"><input id="pedido-nombres" className="field-input" required maxLength={100} value={f.nombres} onChange={e => cambiar("nombres", S.soloNombre(e.target.value))} /></Campo>
          <Campo etiqueta="Apellido paterno"><input id="pedido-paterno" className="field-input" required maxLength={100} value={f.apellidoPaterno} onChange={e => cambiar("apellidoPaterno", S.soloNombre(e.target.value))} /></Campo>
          <Campo etiqueta="Apellido materno (opcional)"><input id="pedido-materno" className="field-input" maxLength={100} value={f.apellidoMaterno} onChange={e => cambiar("apellidoMaterno", S.soloNombre(e.target.value))} /></Campo>
          <Campo etiqueta="Celular"><input id="pedido-celular" className="field-input" required inputMode="numeric" value={f.telefono} onChange={e => cambiar("telefono", S.filtrarTelefono(e.target.value))} /></Campo>
          <Campo etiqueta="Modelo solicitado"><select id="pedido-modelo" className="field-input" required value={f.codmod} onChange={e => cambiar("codmod", e.target.value)}><option value="">Selecciona modelo</option>{form.modelos.map(m => <option key={m.codmod} value={m.codmod}>{m.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Color solicitado (opcional)" ayuda="Vacío significa Por definir"><input id="pedido-color" className="field-input" maxLength={50} value={f.color} onChange={e => cambiar("color", e.target.value)} /></Campo>
          <Campo etiqueta="Responsable"><select id="pedido-responsable" className="field-input" required value={f.responsable} onChange={e => cambiar("responsable", e.target.value)}>{responsables.map(r => <option key={r.codusu} value={r.codusu}>{r.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Sede de atención"><select id="pedido-sede" className="field-input" required value={f.sede} onChange={e => cambiar("sede", e.target.value)}><option value="">Selecciona sede</option>{form.sedes.map(s => <option key={s.codsed} value={s.codsed}>{s.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Techo solicitado"><select id="pedido-techo" className="field-input" value={f.decision} onChange={e => { cambiar("decision", e.target.value); cambiar("tipo", ""); }}><option>Por definir</option><option>Sin techo</option><option>Con techo</option></select></Campo>
          {f.decision === "Con techo" && <Campo etiqueta="Tipo de techo"><select id="pedido-tipo" className="field-input" required value={f.tipo} onChange={e => cambiar("tipo", e.target.value)}><option value="">Selecciona tipo</option>{form.tiposTecho.filter(t => t.nombre !== "Sin techo").map(t => <option key={t.codtte} value={t.codtte}>{t.nombre} · {S.soles(t.adicionalReferencial || 0)}</option>)}</select></Campo>}
          <Campo etiqueta="Sede prevista de entrega (opcional)"><select id="pedido-sede-entrega" className="field-input" value={f.sedeEntrega} onChange={e => cambiar("sedeEntrega", e.target.value)}><option value="">Por acordar</option>{form.sedes.map(s => <option key={s.codsed} value={s.codsed}>{s.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Fecha prevista de entrega (opcional)" ayuda="Solo si ya se acordó; no acredita recepción"><input id="pedido-fecha" className="field-input" type="date" value={f.fecha} onChange={e => cambiar("fecha", e.target.value)} /></Campo>
        </div>
        {modelo && <p data-precio-pedido>Referencia: {S.soles(modelo.precio)} + techo {S.soles(techoExtra)} = <strong>{S.soles(Number(modelo.precio) + techoExtra)}</strong>{f.decision === "Por definir" && ". Techo pendiente de elección."}</p>}
        <Campo etiqueta="Observación (opcional)"><textarea id="pedido-observacion" className="field-input" rows={3} maxLength={2000} value={f.observacion} onChange={e => cambiar("observacion", e.target.value)} /></Campo>
      </fieldset>
    </form>}
  </Modal>;
}

function DetallePedido({ codped, onClose, onCambio }) {
  const consulta = useConsultaCentral(() => P.pedidoApi(codped), [codped], { clave: `pedido-hu031:${codped}` });
  const [accion, setAccion] = useState(null); const [errorEvidencia, setErrorEvidencia] = useState("");
  const p = consulta.data;
  return <Modal abierto onClose={onClose} titulo={`Pedido N.º ${codped}`} ancho="max-w-2xl" pie={<button className="btn btn-secondary" onClick={onClose}>Cerrar</button>}>
    {consulta.error && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}
    {!p && !consulta.error && <p>Cargando pedido…</p>}
    {p && <div className="space-y-4" data-pedido-detalle={p.codped}>
      <p><strong>{p.estado}</strong> · {p.comprador.nombre} · {p.comprador.telefono}</p>
      <p>{p.modelo.nombre} · {p.color || "Color por definir"} · {p.techo.nombre || p.techo.decision}</p>
      <p>Atención: {p.sedeAtencion.nombre} · Responsable: {p.responsable.nombre}</p>
      <p>Precio referencial: {S.soles(p.precioReferencia.base)} + techo {S.soles(p.precioReferencia.adicional)} = <strong>{S.soles(p.precioReferencia.total)}</strong></p>
      <p>Adelantos originales del pedido: <strong>{S.soles(p.totalRecibido || 0)}</strong>{!p.operacion?.venta && <> · Saldo referencial: {S.soles(p.saldoReferencial ?? p.precioReferencia.total)}</>}</p>
      <p>{p.coduniPropuesta ? `Unidad propuesta: ${p.coduniPropuesta}` : "Sin unidad asignada. No se ha reservado una moto."}</p>
      {p.unidadPropuesta && <p>Motor {p.unidadPropuesta.motor} · Chasis {p.unidadPropuesta.chasis} · {p.unidadPropuesta.color} · Techo físico: {p.unidadPropuesta.techoFisico || "Sin techo instalado"}. La propuesta no acredita preparación ni reserva.</p>}
      {p.operacion?.codsep && <p>Separación N.º {p.operacion.codsep}: {p.operacion.estadoSeparacion}</p>}
      {p.operacion?.codven && <p>Venta N.º {p.operacion.codven}: {p.operacion.estadoVenta}</p>}
      {p.operacion?.venta && <div className="rounded-xl border border-linea p-3" data-finanzas-venta-pedido>
        <h3 className="font-bold">Importes vigentes de la venta</h3>
        <p>{S.soles(p.operacion.venta.base)} + techo {S.soles(p.operacion.venta.adicional)} − descuento {S.soles(p.operacion.venta.descuento || 0)} = <strong>{S.soles(p.operacion.venta.total)}</strong></p>
        <p>Recibido en total: {S.soles(p.operacion.venta.recibido)} · Saldo: <strong>{S.soles(p.operacion.venta.saldo)}</strong></p>
      </div>}
      {p.estado === "Vinculado" && <Aviso>El dinero del pedido se conserva como adelanto de la operación vinculada, sin un nuevo cobro. Cancelaciones y correcciones se gestionan desde la ficha de la moto.</Aviso>}
      {p.estado === "Vinculado" && <Link to={`/admin/inventario/${p.operacion?.coduni || p.coduniPropuesta}`} onClick={onClose} className="btn btn-secondary">Ver operación en la ficha</Link>}
      {p.pagos?.length > 0 && <><h3 className="font-bold">Recibos originales del pedido</h3><ul className="space-y-2">{p.pagos.map(r => <li key={r.codpagped}>{S.soles(r.monto)} · {r.medioPago} · {r.fecha}{r.referencia && ` · ${r.referencia}`}{r.rutaEvidencia && <button className="ml-2 underline" onClick={async () => { try { const url = await P.verEvidenciaPedidoApi(r.rutaEvidencia); window.open(url, "_blank", "noopener,noreferrer"); } catch (e) { setErrorEvidencia(mensajeError(e)); } }}>Ver evidencia</button>}</li>)}</ul></>}
      {errorEvidencia && <Aviso tipo="error">{errorEvidencia}</Aviso>}
      {["Pendiente de unidad", "Unidad propuesta"].includes(p.estado) && <div className="flex flex-wrap gap-2">
        <button className="btn btn-secondary" onClick={() => setAccion("adelanto")}>Registrar adelanto</button>
        <button className="btn btn-secondary" onClick={() => setAccion("acuerdo")}>Actualizar acuerdo</button>
        <button className="btn btn-secondary" onClick={() => setAccion("proponer")}>Proponer unidad</button>
        {p.coduniPropuesta && <button className="btn btn-primary" onClick={() => setAccion("continuar")}>Continuar a separación o venta</button>}
        <button className="btn btn-secondary text-acento" onClick={() => setAccion("cancelar")}>Cancelar pedido</button>
      </div>}
      {p.observacion && <p className="whitespace-pre-wrap">{p.observacion}</p>}
      <h3 className="font-bold">Historial</h3>
      <ul className="space-y-2">{p.historial.map(e => <li key={e.id}>{({creado:"Pedido creado",adelanto:"Adelanto registrado",acuerdo:"Acuerdo actualizado",proponer:"Unidad propuesta",continuar:"Operación vinculada",cancelar:"Pedido cancelado"})[e.tipo] || e.tipo} · {e.autorNombre || `Usuario ${e.autor}`} · {new Date(e.fecha).toLocaleString("es-PE", { timeZone: "America/Lima" })}{e.detalle?.solicitud?.motivo && <p>{e.detalle.solicitud.motivo}</p>}</li>)}</ul>
    </div>}
    {p && accion && <AccionPedido pedido={p} accion={accion} onClose={() => setAccion(null)} onHecho={() => { setAccion(null); consulta.refrescar(true); onCambio(); }} />}
  </Modal>;
}
