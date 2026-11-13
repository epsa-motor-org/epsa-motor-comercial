// Ventas a clientes · Sprint 2: las separaciones (HU-005) se registran y se convierten en venta
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { CANALES, SEDES_ATENCION, OPCIONES_TECHO, SIN_TECHO, formatoSoles } from "../../data/mockData";
import { soloDigitos, soloLetras, soloMonto, esNombre, esCelular, esRuc, hoyLocal, limpiarTexto, MSJ } from "../../lib/validar";
import { descargarComprobante, numeroComprobante } from "../../lib/voucher";
import { numeroSeparacion, useSeparaciones } from "../../servicios/separaciones";
import { nombreCliente } from "../../lib/sprint2";
import { Aviso, Campo, Card, Modal, PageHeader, Stat, Tabla, Vacio, btnMini, btnMiniPeligro, useConfirm, useToast } from "../../components/ui";

const ETAPA_TONO = { "Solicitud web": "bg-amber-100 text-amber-800", Cotización: "bg-slate-200 text-slate-700", "Pedido registrado": "bg-sky-100 text-sky-700", Entregado: "bg-emerald-100 text-emerald-700" };
const EMPRESA = { razon: "INVERSIONES EPSA MOTOR S.A.C.", ruc: "20555595469" };
const IGV = 0.18;
const dosDec = (n) => (Math.round(n * 100) / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CON_OPERACION = ["Transferencia", "Depósito", "Yape / Plin", "Tarjeta"];
const DOCS = { DNI: [8, 8], CE: [9, 9], RUC: [11, 11] };
const TECHOS = [SIN_TECHO, ...OPCIONES_TECHO];
const MEDIOS = ["Efectivo", "Transferencia", "Yape / Plin", "Depósito", "Tarjeta"];
const ORIGEN = ["Redes sociales", "Referido", "Pasó por la sede", "Publicidad", "Web de EPSA", "Otro"];
const ADELANTO_MINIMO = 100;
const ABIERTO = (l) => !["Cerrado ganado", "Perdido"].includes(l.estado);
const limpiaOperacion = (t) => String(t || "").replace(/[^\w-]/g, "").toUpperCase().slice(0, 20);

// Documento del cliente
function validarDoc(tipo, num) {
  if (!num) return "";
  const [min, max] = DOCS[tipo];
  if (!/^\d+$/.test(num)) return "Solo números.";
  if (tipo === "RUC" && num.length === 11 && !esRuc(num)) return MSJ.ruc;
  return num.length < min || num.length > max ? `El ${tipo} debe tener ${min} dígitos.` : "";
}

// Página de ventas
export default function Ventas() {
  const { ventas, modelos, equipo, unidades, leads, agregar, actualizar, eliminar, publicos = [], separaciones = [], clientes = [] } = useApp();
  const sepS = useSeparaciones();
  const { user, puede } = useAuth();
  const { state } = useLocation();
  const toast = useToast(); const confirmar = useConfirm();
  const vendedores = equipo.filter((p) => p.rol === "vendedor" && p.activo);
  const publicados = modelos.filter((m) => m.estado === "Publicado");
  const [q, setQ] = useState(""); const [etapa, setEtapa] = useState(""); const [sedeF, setSedeF] = useState("");
  const nombreModelo = (id) => (modelos.find((m) => m.id === id) || publicos.find((m) => m.id === id))?.nombre || "—";

  // HU-005: venta que nace de una separación activa
  const desdeSep = state?.desdeSeparacion ? separaciones.find((x) => x.id === state.desdeSeparacion && x.estado === "Activa") : null;
  const base = () => {
    if (desdeSep) {
      const u = unidades.find((x) => x.id === desdeSep.unidad); const c = clientes.find((x) => x.id === desdeSep.cliente);
      const mod = modelos.find((m) => m.id === u?.modelo);
      return { cliente: nombreCliente(c), celular: c?.celular || "", modelo: mod?.id || "", color: u?.color || mod?.colores?.[0] || "", techo: "", tipoDoc: c?.tipoDoc || "DNI", doc: c?.doc || "", canal: "Visita a sede", origen: "Pasó por la sede", vendedor: desdeSep.vendedor, sede: desdeSep.sede, pago: "", accion: "pedido", medio: desdeSep.medio, adelanto: String(desdeSep.monto), operacion: desdeSep.operacion, desdeSeparacion: desdeSep.id };
    }
    const mod = publicados.find((m) => m.id === state?.lead?.modelo) || publicados[0]; return { cliente: state?.lead?.contacto || "", celular: state?.lead?.telefono || "", modelo: mod?.id || "", color: mod?.colores?.includes(state?.lead?.color) ? state.lead.color : mod?.colores?.[0] || "", techo: "", tipoDoc: "DNI", doc: "", canal: "WhatsApp", origen: "Pasó por la sede", vendedor: user.rol === "vendedor" ? user.nombre : vendedores[0]?.nombre || "", sede: state?.lead?.sede || "Comas", pago: "", accion: "cotizar", medio: "Transferencia", adelanto: "", operacion: "" }; };
  const unidadPara = (modelo, sede, color) => {
    const libres = unidades.filter((u) => u.modelo === modelo && u.disponibilidad === "Disponible" && (!color || u.color === color));
    return libres.find((u) => u.ubicacion === sede) || libres[0];
  };
  const [nueva, setNueva] = useState(state?.lead || state?.nueva || desdeSep ? { paso: 1, f: base() } : null);
  const [err, setErr] = useState({});
  const [atender, setAtender] = useState(null); const [vendAt, setVendAt] = useState("");
  const [comp, setComp] = useState(null); const [cf, setCf] = useState({}); const [cerr, setCerr] = useState({});
  const [verComp, setVerComp] = useState(null);
  useEffect(() => {
    const v = state?.emitir && ventas.find((x) => x.id === state.emitir);
    if (v && !v.comprobante) abrirComprobante(v);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pedido, setPedido] = useState(null);
  const [pf, setPf] = useState({});
  const [perr, setPerr] = useState({});

  const lista = useMemo(() => ventas.filter((v) => {
    if (q && !`${v.cliente} ${v.celular} ${v.documento}`.toLowerCase().includes(q.toLowerCase())) return false;
    return (!etapa || v.etapa === etapa) && (!sedeF || v.sede === sedeF) && (user.rol !== "vendedor" || v.vendedor === user.nombre || v.vendedor === "Sin asignar");
  }), [ventas, q, etapa, sedeF, user]);

  const setN = (k, v) => setNueva((n) => {
    const f = { ...n.f, [k]: v };
    if (k === "modelo") f.color = modelos.find((m) => m.id === v)?.colores?.[0] || "";
    if (k === "tipoDoc") f.doc = "";
    return { ...n, f };
  });
  const totalDe = (f) => (modelos.find((m) => m.id === f.modelo)?.precioDesde || 0) + (TECHOS.find((t) => t.id === f.techo)?.precio || 0);
  const ultimoPaso = useRef(0);
  // Nueva venta
  function siguiente() {
    if (Date.now() - ultimoPaso.current < 450) return;
    const f = nueva.f; const e = {};
    if (nueva.paso === 1) {
      if (!esNombre(f.cliente)) e.cliente = MSJ.nombre;
      if (!esCelular(f.celular)) e.celular = MSJ.celular;
      const d = validarDoc(f.tipoDoc, f.doc); if (d || !f.doc) e.doc = d || `Ingresa el ${f.tipoDoc} del cliente.`;
      const mismoDoc = !e.doc && ventas.find((v) => v.documento === `${f.tipoDoc} ${f.doc}` && limpiarTexto(v.cliente).toLowerCase() !== limpiarTexto(f.cliente).toLowerCase());
      if (mismoDoc) e.doc = `Ese ${f.tipoDoc} ya está registrado a nombre de ${mismoDoc.cliente}. Revisa el documento o el nombre.`;
      if (!publicados.some((m) => m.id === f.modelo)) e.modelo = "Elige una moto publicada.";
      if (!f.color) e.color = "Elige el color.";
      if (!f.techo) e.techo = "Elige el techo o «Sin techo».";
      if (!f.vendedor) e.vendedor = "Elige el vendedor responsable.";
    }
    if (nueva.paso === 2 && !["Pago al contado", "Financiamiento"].includes(f.pago)) e.pago = "Elige la forma de compra.";
    setErr(e);
    if (Object.keys(e).length) return;
    ultimoPaso.current = Date.now();
    setNueva({ ...nueva, paso: nueva.paso + 1 });
  }
  async function crear() {
    const f = nueva.f; const m = modelos.find((x) => x.id === f.modelo); const e = {};
    if (f.desdeSeparacion) return crearDesdeSeparacion(f, m);
    let unidad = null;
    if (f.accion === "separar") {
      unidad = unidadPara(f.modelo, f.sede, f.color);
      if (!unidad) e.general = `No hay unidades disponibles del ${m?.nombre} en color ${f.color} para separar. Registra solo la cotización.`;
      const monto = Number(f.adelanto);
      if (!(monto > 0)) e.adelanto = "Para separar se necesita un adelanto mayor a 0."; else if (monto < ADELANTO_MINIMO) e.adelanto = `El adelanto mínimo para separar es ${formatoSoles(ADELANTO_MINIMO)}.`; else if (monto > totalDe(f)) e.adelanto = `No puede superar ${formatoSoles(totalDe(f))}.`;
      const op = limpiaOperacion(f.operacion);
      if (CON_OPERACION.includes(f.medio) && op.length < 4) e.operacion = "Ingresa el N° de operación (mínimo 4 caracteres).";
      else if (op && ventas.some((v) => v.operacion && v.operacion === op && v.medioPago === f.medio)) e.operacion = "Ese N° de operación ya se registró en otra venta.";
    }
    setErr(e); if (Object.keys(e).length) return;
    const ok = await confirmar({
      titulo: f.accion === "separar" ? "¿Separar la unidad?" : f.accion === "pedido" ? "¿Registrar cliente y pasar al pedido?" : "¿Registrar la cotización?",
      texto: `${f.cliente.trim()} · ${m?.nombre} ${f.color} · ${f.techo === SIN_TECHO.id ? "sin techo" : `techo ${TECHOS.find((t) => t.id === f.techo)?.nombre}`} · total ${formatoSoles(totalDe(f))} · ${f.pago}${f.accion === "separar" ? ` · adelanto ${formatoSoles(Number(f.adelanto))} por ${f.medio}. Se reservará la unidad ${unidad.id} (${unidad.ubicacion}).` : "."}`,
      boton: "Confirmar",
    });
    if (!ok) return;
    const hoy = hoyLocal();
    if (unidad) actualizar("unidades", unidad.id, (u) => ({ disponibilidad: "Separada", historial: [...u.historial, { fecha: hoy, detalle: `Separada para ${f.cliente.trim()} (adelanto ${formatoSoles(Number(f.adelanto))})` }] }));
    const tSel = TECHOS.find((t) => t.id === f.techo);
    const datos = { fecha: hoy, cliente: f.cliente.trim().replace(/\s+/g, " "), celular: f.celular, documento: `${f.tipoDoc} ${f.doc}`, modelo: f.modelo, color: f.color, techo: tSel?.precio ? tSel.nombre : "", techoPrecio: tSel?.precio || 0, pago: f.pago, etapa: unidad ? "Pedido registrado" : "Cotización", vendedor: f.vendedor, sede: f.sede, adelanto: unidad ? Number(f.adelanto) : 0, total: totalDe(f), unidad: unidad?.id || null, canal: f.canal, origen: f.origen, ...(unidad ? { medioPago: f.medio, operacion: limpiaOperacion(f.operacion), fechaPago: hoy } : {}) };
    const id = ventas.reduce((mx, v) => Math.max(mx, Number(v.id) || 0), 0) + 1;
    agregar("ventas", { id, ...datos }, `Venta registrada: ${f.cliente} · ${m.nombre}`);
    if (unidad) sepS.registrarDesdeVenta({ unidadId: unidad.id, ventaId: id, cliente: datos.cliente, documento: datos.documento, celular: datos.celular, monto: datos.adelanto, medio: datos.medioPago, operacion: datos.operacion, fechaPago: hoy, vendedor: datos.vendedor });
    const lead = leads.find((l) => l.telefono === f.celular && ABIERTO(l));
    if (lead) actualizar("leads", lead.id, { estado: "Cotizado" });
    toast(unidad ? `Unidad ${unidad.id} separada para ${f.cliente.trim()}` : "Cliente registrado y cotización creada");
    setNueva(null);
    if (f.accion === "pedido") abrirPedido({ id, ...datos });
  }

  // HU-005: la separación pasa a pedido con su moto y su adelanto
  async function crearDesdeSeparacion(f, m) {
    const s = separaciones.find((x) => x.id === f.desdeSeparacion);
    if (!s || s.estado !== "Activa") { setErr({ general: "Esa separación ya no está activa." }); return; }
    if (!(await confirmar({ titulo: "¿Registrar el pedido?", texto: `${f.cliente.trim()} · ${m?.nombre} ${f.color} · unidad ${s.unidad} · total ${formatoSoles(totalDe(f))} · el adelanto de ${formatoSoles(s.monto)} de la separación ${numeroSeparacion(s)} cuenta como pago.`, boton: "Registrar pedido" }))) return;
    const hoy = hoyLocal();
    const tSel = TECHOS.find((t) => t.id === f.techo);
    const id = ventas.reduce((mx, v) => Math.max(mx, Number(v.id) || 0), 0) + 1;
    agregar("ventas", { id, fecha: hoy, cliente: f.cliente.trim().replace(/\s+/g, " "), celular: f.celular, documento: `${f.tipoDoc} ${f.doc}`, modelo: f.modelo, color: f.color, techo: tSel?.precio ? tSel.nombre : "", techoPrecio: tSel?.precio || 0, pago: f.pago, etapa: "Pedido registrado", vendedor: f.vendedor, sede: f.sede, adelanto: s.monto, total: totalDe(f), unidad: s.unidad, canal: f.canal, origen: f.origen, medioPago: s.medio, operacion: s.operacion, fechaPago: s.fechaPago, separacionId: s.id }, `Pedido registrado desde ${numeroSeparacion(s)}: ${f.cliente}`);
    sepS.convertir(s, id);
    actualizar("unidades", s.unidad, (u) => ({ historial: [...(u.historial || []), { fecha: hoy, detalle: `Pedido registrado para ${f.cliente.trim()} (desde ${numeroSeparacion(s)})` }] }));
    toast(`Pedido registrado. La separación ${numeroSeparacion(s)} pasó a venta.`);
    setNueva(null);
  }

  // Pedido con adelanto
  function abrirPedido(v) {
    if (!(Number(v.total) > 0)) {
      const precio = Number((modelos.find((m) => m.id === v.modelo) || publicos.find((m) => m.id === v.modelo))?.precioDesde);
      if (precio > 0) v = { ...v, total: precio + (Number(v.techoPrecio) || 0) };
    }
    setPerr({}); setPf({ conAdelanto: true, separar: false, medio: "Transferencia", adelanto: "", fecha: hoyLocal(), operacion: "", archivo: "", obs: "", tipoDoc: v.documento?.split(" ")[0] || "DNI", doc: v.documento?.split(" ")[1] || "", celular: v.celular }); setPedido(v); }
  function validarPedido() {
    const x = {};
    const monto = Number(pf.adelanto);
    if (pf.conAdelanto || pf.separar) {
      if (!monto || monto <= 0) x.adelanto = "Ingresa el monto del adelanto.";
      else if (pf.separar && !pedido.unidad && monto < ADELANTO_MINIMO) x.adelanto = `El adelanto mínimo para separar es ${formatoSoles(ADELANTO_MINIMO)}.`;
      else if (monto > pedido.total) x.adelanto = `No puede superar ${formatoSoles(pedido.total)}.`;
      if (!pf.fecha) x.fecha = "Indica la fecha del pago."; else if (pf.fecha > hoyLocal()) x.fecha = "La fecha del pago no puede ser futura."; else if (pedido.fecha && pf.fecha < pedido.fecha) x.fecha = `No puede ser anterior a la cotización (${pedido.fecha}).`;
      const op = limpiaOperacion(pf.operacion);
      if (CON_OPERACION.includes(pf.medio) && op.length < 4) x.operacion = "Ingresa el N° de operación (mínimo 4 caracteres).";
      else if (op && ventas.some((v) => v.id !== pedido.id && v.operacion === op && v.medioPago === pf.medio)) x.operacion = "Ese N° de operación ya se registró en otra venta.";
    }
    if (pf.separar && !pedido.unidad && !unidadPara(pedido.modelo, pedido.sede, pedido.color)) x.separar = `No hay unidades disponibles de este modelo en color ${pedido.color || "elegido"} para separar.`;
    if (limpiarTexto(pf.obs).length > 500) x.obs = "Máximo 500 caracteres.";
    const d = validarDoc(pf.tipoDoc, pf.doc); if (d || !pf.doc) x.doc = d || "El documento es obligatorio para registrar el pedido.";
    const otro = !x.doc && ventas.find((v) => v.id !== pedido.id && v.documento === `${pf.tipoDoc} ${pf.doc}` && limpiarTexto(v.cliente).toLowerCase() !== limpiarTexto(pedido.cliente).toLowerCase());
    if (otro) x.doc = `Ese ${pf.tipoDoc} ya está registrado a nombre de ${otro.cliente}. Revisa el documento.`;
    if (!esCelular(pf.celular)) x.celular = MSJ.celular;
    if (!(Number(pedido.total) > 0)) x.general = `${nombreModelo(pedido.modelo)} aún no tiene precio en el panel. Créalo en Modelos con el mismo nombre (precio y colores) y vuelve a registrar el pedido.`;
    setPerr(x); return Object.keys(x).length === 0;
  }
  function guardarPedido(e) {
    e.preventDefault();
    if (!validarPedido()) return;
    const monto = Number(pf.adelanto); const hoy = hoyLocal();
    let unidad = pedido.unidad;
    if (pf.separar && !unidad) {
      const u = unidadPara(pedido.modelo, pedido.sede, pedido.color); unidad = u.id;
      actualizar("unidades", u.id, (x) => ({ disponibilidad: "Separada", historial: [...x.historial, { fecha: hoy, detalle: `Separada para ${pedido.cliente} (adelanto ${formatoSoles(monto)})` }] }));
      sepS.registrarDesdeVenta({ unidadId: u.id, ventaId: pedido.id, cliente: pedido.cliente, documento: `${pf.tipoDoc} ${pf.doc}`, celular: pf.celular, monto, medio: pf.medio, operacion: pf.operacion, fechaPago: pf.fecha, vendedor: pedido.vendedor });
    }
    const conPago = pf.conAdelanto || pf.separar;
    actualizar("ventas", pedido.id, { etapa: "Pedido registrado", unidad, total: pedido.total, adelanto: conPago ? monto : 0, fechaPago: conPago ? pf.fecha : "", documento: `${pf.tipoDoc} ${pf.doc}`, celular: pf.celular, medioPago: conPago ? pf.medio : "", operacion: conPago ? limpiaOperacion(pf.operacion) : "", voucherPago: conPago ? pf.archivo : "", obs: limpiarTexto(pf.obs) }, `Pedido registrado: ${pedido.cliente}`);
    toast(unidad && !pedido.unidad ? `Pedido registrado y unidad ${unidad} separada` : "Pedido registrado"); setPedido(null);
  }
  function archivo(e) {
    const a = e.target.files?.[0]; if (!a) return;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(a.type)) { setPerr({ ...perr, archivo: "Formato no permitido (JPG, PNG, WebP o PDF)." }); e.target.value = ""; return; }
    if (a.size > 10 * 1024 * 1024) { setPerr({ ...perr, archivo: "El archivo supera los 10 MB." }); e.target.value = ""; return; }
    setPerr({ ...perr, archivo: "" }); setPf({ ...pf, archivo: a.name });
  }
  // Entrega
  async function entregar(v) {
    const u = v.unidad ? unidades.find((x) => x.id === v.unidad) : unidadPara(v.modelo, v.sede, v.color);
    if (!u) return toast(`No hay una unidad disponible del ${nombreModelo(v.modelo)}${v.color ? ` en color ${v.color}` : ""} para entregar. Revisa el inventario.`, "error");
    if (u.disponibilidad === "Vendida") return toast(`La unidad ${u.id} ya figura como vendida. Revisa el inventario.`, "error");
    if (!(await confirmar({ titulo: "Confirmar entrega", texto: `Se entregará la unidad ${u.id} (motor ${u.motor}) a ${v.cliente}. La unidad pasará a «Vendida» y saldrá del stock de la web.`, boton: "Confirmar entrega" }))) return;
    actualizar("unidades", u.id, (x) => ({ disponibilidad: "Vendida", historial: [...x.historial, { fecha: hoyLocal(), detalle: `Entregada a ${v.cliente}` }] }));
    actualizar("ventas", v.id, { etapa: "Entregado", unidad: u.id }, `Entrega confirmada: ${v.cliente}`); toast("Entrega registrada");
  }
  // Atender solicitud web
  function abrirAtender(v) { setVendAt(v.vendedor !== "Sin asignar" ? v.vendedor : user.rol === "vendedor" ? user.nombre : vendedores[0]?.nombre || ""); setAtender(v); }
  function guardarAtender(e) {
    e.preventDefault();
    if (!vendAt) return toast("Elige quién atiende la solicitud.", "error");
    actualizar("ventas", atender.id, { etapa: "Cotización", vendedor: vendAt }, `Solicitud web atendida: ${atender.cliente} (${vendAt})`);
    const lead = leads.find((l) => l.id === atender.leadId) || leads.find((l) => l.telefono === atender.celular);
    if (lead) actualizar("leads", lead.id, { responsable: vendAt, estado: lead.estado === "Nuevo" ? "En seguimiento" : lead.estado });
    toast(`Solicitud asignada a ${vendAt} y convertida en cotización`); setAtender(null);
  }

  // Comprobante (boleta o factura)
  function abrirComprobante(v) {
    const [td, num] = (v.documento || "").split(" ");
    const u = unidades.find((x) => x.id === v.unidad);
    setCerr({});
    setCf({ tipo: td === "RUC" ? "Factura" : "Boleta de venta", tipoDoc: td === "RUC" ? "RUC" : td || "DNI", doc: num || "", razon: "", direccion: "", fecha: hoyLocal(), total: String(v.total || ""), descripcion: `Motocar ${nombreModelo(v.modelo)}${v.color ? ` color ${v.color}` : ""}${u ? `, motor ${u.motor}, chasis ${u.chasis}` : ""}`, medio: v.medioPago || (v.pago === "Pago al contado" ? "Efectivo" : "Transferencia") });
    setComp(v);
  }
  function validarComprobante() {
    const x = {};
    if (cf.tipo === "Factura") {
      if (!esRuc(cf.doc)) x.doc = MSJ.ruc;
      const razon = limpiarTexto(cf.razon); const dir = limpiarTexto(cf.direccion);
      if (razon.length < 3 || !/\p{L}/u.test(razon)) x.razon = "Escribe la razón social."; else if (razon.length > 100) x.razon = "Máximo 100 caracteres.";
      if (dir.length < 5 || (dir.match(/\p{L}/gu) || []).length < 3) x.direccion = "Escribe la dirección fiscal."; else if (dir.length > 250) x.direccion = "Máximo 250 caracteres.";
    } else {
      const d = validarDoc(cf.tipoDoc, cf.doc); if (!["DNI", "CE"].includes(cf.tipoDoc)) x.doc = "La boleta es para clientes con DNI o CE. Con RUC, emite una factura.";
      else if (d || !cf.doc) x.doc = d || "El documento del cliente es obligatorio.";
      else if (comp.documento && comp.documento !== `${cf.tipoDoc} ${cf.doc}`) x.doc = `Debe ser el documento del pedido (${comp.documento}).`;
    }
    const total = Number(cf.total);
    if (!(total > 0)) x.total = "Importe mayor a 0."; else if (Math.abs(total - Number(comp.total)) > 0.009) x.total = `Debe ser igual al total de la venta (${formatoSoles(comp.total)}).`;
    if (!cf.fecha || cf.fecha > hoyLocal()) x.fecha = "La fecha de emisión no puede ser futura."; else if (comp.fecha && cf.fecha < comp.fecha) x.fecha = `No puede ser anterior a la venta (${comp.fecha}).`;
    const desc = limpiarTexto(cf.descripcion);
    if (desc.length < 5 || (desc.match(/\p{L}/gu) || []).length < 3) x.descripcion = "Describe el bien vendido."; else if (desc.length > 300) x.descripcion = "Máximo 300 caracteres.";
    setCerr(x); return Object.keys(x).length === 0;
  }
  function emitirComprobante(e) {
    e.preventDefault();
    if (!validarComprobante()) return;
    const serie = cf.tipo === "Factura" ? "F001" : "B001";
    const usados = ventas.flatMap((v) => [v.comprobante, ...(v.comprobantesAnulados || [])]).filter((c) => c && typeof c === "object" && c.serie === serie);
    const correlativo = usados.reduce((m, c) => Math.max(m, Number(c.numero) || 0), 0) + 1;
    const total = Number(cf.total); const gravada = total / (1 + IGV);
    const c = { tipo: cf.tipo, serie, numero: correlativo, fecha: cf.fecha, cliente: cf.tipo === "Factura" ? limpiarTexto(cf.razon) : comp.cliente, tipoDoc: cf.tipo === "Factura" ? "RUC" : cf.tipoDoc, doc: cf.doc, direccion: limpiarTexto(cf.direccion), descripcion: limpiarTexto(cf.descripcion), medio: cf.medio, total, gravada, igv: total - gravada, emitidoPor: user.nombre, estado: "Emitido" };
    actualizar("ventas", comp.id, { comprobante: c }, `Comprobante ${serie}-${String(correlativo).padStart(8, "0")} emitido para ${comp.cliente}`);
    toast(`${cf.tipo} ${serie}-${String(correlativo).padStart(8, "0")} emitida y guardada en Facturas`); setComp(null); setVerComp({ ...comp, comprobante: c });
  }
  async function anularComprobante(v) {
    if (!(await confirmar({ titulo: "Anular comprobante", texto: `El comprobante ${v.comprobante.serie}-${String(v.comprobante.numero).padStart(8, "0")} quedará anulado y podrás emitir uno nuevo. Esta acción queda registrada.`, boton: "Anular", peligro: true }))) return;
    actualizar("ventas", v.id, { comprobante: null, comprobantesAnulados: [...(v.comprobantesAnulados || []), { ...v.comprobante, estado: "Anulado" }] }, `Comprobante anulado: ${v.cliente}`);
    toast("Comprobante anulado"); setVerComp(null);
  }

  // Eliminar
  async function borrar(v) {
    if (v.etapa === "Entregado") return toast("Una venta entregada no se elimina: forma parte del historial.", "error");
    if (v.comprobante || (v.comprobantesAnulados || []).length) return toast("Una venta con comprobante emitido o anulado no se elimina: su numeración debe quedar registrada.", "error");
    if (await confirmar({ titulo: "Eliminar venta", texto: `¿Eliminar la venta de ${v.cliente}?${v.unidad ? ` La unidad ${v.unidad} volverá a estar disponible.` : ""} Esta acción no se puede deshacer.`, boton: "Eliminar", peligro: true })) {
      if (v.unidad) actualizar("unidades", v.unidad, { disponibilidad: "Disponible" });
      sepS.anularPorVenta(v.id);
      eliminar("ventas", v.id, `Venta eliminada: ${v.cliente}`); toast("Venta eliminada");
    }
  }

  const f = nueva?.f;
  const pasos = ["Cliente y modelo", "Forma de compra", "¿Qué registrar?"];
  return (
    <div>
      <PageHeader titulo="Ventas a clientes" subtitulo="Solicitudes de la web, cotizaciones, pedidos con adelanto, separación de unidades, entregas y comprobantes.">
        <button className="btn btn-primary !py-2.5" onClick={() => { setErr({}); setNueva({ paso: 1, f: base() }); }}>+ Nueva venta</button>
      </PageHeader>
      {/* Indicadores */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat etiqueta="Solicitudes web por atender" valor={ventas.filter((v) => v.etapa === "Solicitud web").length} tono="ambar" nota="Llegan desde «Cotizar» en la web" />
        <Stat etiqueta="Cotizaciones" valor={ventas.filter((v) => v.etapa === "Cotización").length} />
        <Stat etiqueta="Pedidos registrados" valor={ventas.filter((v) => v.etapa === "Pedido registrado").length} tono="marino" />
        <Stat etiqueta="Entregadas" valor={ventas.filter((v) => v.etapa === "Entregado").length} tono="verde" />
      </div>
      {/* Filtros */}
      <Card className="mb-5 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="field-label">Buscar</label><input className="field-input" placeholder="Cliente, celular o documento" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label className="field-label">Etapa</label><select className="field-input" value={etapa} onChange={(e) => setEtapa(e.target.value)}><option value="">Todas</option>{Object.keys(ETAPA_TONO).map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="field-label">Sede</label><select className="field-input" value={sedeF} onChange={(e) => setSedeF(e.target.value)}><option value="">Todas</option>{SEDES_ATENCION.map((x) => <option key={x}>{x}</option>)}</select></div>
      </Card>

      {lista.length === 0 ? <Vacio titulo="Sin ventas" texto="Registra una nueva venta para empezar." /> : (
        <Tabla columnas={["Fecha", "Cliente", "Modelo", "Pago", "Total / adelanto", "Vendedor", "Etapa", "Acciones"]}>
          {lista.map((v) => (
            <tr key={v.id}>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{v.fecha}</td>
              <td className="px-4 py-3"><p className="font-semibold text-marino dark:text-white">{v.cliente}</p><p className="text-[12.5px] text-slate-400">{v.celular}{v.documento && ` · ${v.documento}`}</p></td>
              <td className="px-4 py-3">{nombreModelo(v.modelo)}<span className="block text-[12px] text-slate-400">{[v.color, v.techo ? `techo ${v.techo}` : "sin techo", v.unidad && `unidad ${v.unidad}`].filter(Boolean).join(" · ")}</span></td>
              <td className="px-4 py-3">{v.pago}</td>
              <td className="whitespace-nowrap px-4 py-3">{formatoSoles(v.total)}<span className="block text-[12px] text-slate-400">Adelanto {formatoSoles(v.adelanto)}</span></td>
              <td className="px-4 py-3">{v.vendedor === "Sin asignar" ? <span className="font-semibold text-amber-600">Sin asignar</span> : v.vendedor}<span className="block text-[12px] text-slate-400">{v.sede}</span></td>
              <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${ETAPA_TONO[v.etapa]}`}>{v.etapa}</span></td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                {v.etapa === "Solicitud web" && <button className={btnMini} onClick={() => abrirAtender(v)}>Atender</button>}
                {v.etapa === "Cotización" && <button className={btnMini} onClick={() => abrirPedido(v)}>Registrar pedido</button>}
                {v.etapa === "Pedido registrado" && <button className={btnMini} onClick={() => entregar(v)}>Marcar entrega</button>}
                {v.comprobante && <button className={btnMini} onClick={() => setVerComp(v)}>{numeroComprobante(v.comprobante)}</button>}
                {!v.comprobante && puede("comprobantes.emitir") && ["Pedido registrado", "Entregado"].includes(v.etapa) && <button className={btnMini} onClick={() => abrirComprobante(v)}>Emitir comprobante</button>}
                <a className={btnMini} target="_blank" rel="noopener noreferrer" href={`https://wa.me/51${v.celular}`}>WhatsApp</a>
                {puede("eliminar") && <button className={btnMiniPeligro} onClick={() => borrar(v)}>Eliminar</button>}
              </div></td>
            </tr>
          ))}
        </Tabla>
      )}

      {/* Nueva venta */}
      <Modal abierto={!!nueva} onClose={() => setNueva(null)} titulo={nueva?.f?.desdeSeparacion ? `Venta desde la separación ${numeroSeparacion({ id: nueva.f.desdeSeparacion })}` : "Nueva venta"} ancho="max-w-2xl"
        pie={nueva && <>
          {nueva.paso > 1 && <button className="btn btn-secondary !py-2" onClick={() => setNueva({ ...nueva, paso: nueva.paso - 1 })}>Atrás</button>}
          {nueva.paso < 3 ? <button className="btn btn-primary !py-2" onClick={siguiente}>Siguiente</button> : <button className="btn btn-primary !py-2" onClick={crear}>{f.desdeSeparacion ? "Registrar pedido" : f.accion === "separar" ? "Registrar cliente y separar" : f.accion === "pedido" ? "Registrar cliente y pedido" : "Registrar cliente y cotizar"}</button>}
        </>}>
        {nueva && <>
          <ol className="mb-5 flex gap-2 text-[12.5px]">{pasos.map((p, i) => <li key={p} className={`flex-1 rounded-lg px-3 py-2 text-center font-semibold ${nueva.paso === i + 1 ? "bg-marino text-white" : nueva.paso > i + 1 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500 dark:bg-white/10"}`}>{i + 1}. {p}</li>)}</ol>
          {nueva.paso === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Nombre completo del cliente" error={err.cliente}><input id="v-cliente" className="field-input" maxLength={80} value={f.cliente} onChange={(e) => setN("cliente", soloLetras(e.target.value))} /></Campo>
              <Campo etiqueta="Documento de identidad" error={err.doc}>
                <div className="flex gap-2"><select className="field-input !w-24" value={f.tipoDoc} onChange={(e) => setN("tipoDoc", e.target.value)}>{Object.keys(DOCS).map((d) => <option key={d}>{d}</option>)}</select><input id="v-doc" className="field-input" inputMode="numeric" maxLength={DOCS[f.tipoDoc][1]} placeholder={`${DOCS[f.tipoDoc][1]} dígitos`} value={f.doc} onChange={(e) => setN("doc", soloDigitos(e.target.value, DOCS[f.tipoDoc][1]))} /></div>
              </Campo>
              <Campo etiqueta="Celular" error={err.celular}><input id="v-celular" className="field-input" type="tel" inputMode="numeric" maxLength={9} placeholder="9XXXXXXXX" value={f.celular} onChange={(e) => setN("celular", soloDigitos(e.target.value, 9))} /></Campo>
              <Campo etiqueta="Moto que compra" error={err.modelo}><select id="v-modelo" className="field-input" disabled={!!f.desdeSeparacion} value={f.modelo} onChange={(e) => setN("modelo", e.target.value)}>{publicados.map((m) => <option key={m.id} value={m.id}>{m.nombre} · {formatoSoles(m.precioDesde)}</option>)}</select></Campo>
              <Campo etiqueta="Color" error={err.color}><select id="v-color" className="field-input" disabled={!!f.desdeSeparacion} value={f.color} onChange={(e) => setN("color", e.target.value)}>{(modelos.find((m) => m.id === f.modelo)?.colores || []).map((c) => <option key={c}>{c}</option>)}</select></Campo>
              <Campo etiqueta="Techo (adicional)" error={err.techo}><select id="v-techo" className="field-input" value={f.techo} onChange={(e) => setN("techo", e.target.value)}><option value="">Elige…</option>{TECHOS.map((t) => <option key={t.id} value={t.id}>{t.precio ? `${t.nombre} · + ${formatoSoles(t.precio)}` : "Sin techo"}</option>)}</select></Campo>
              <p className="rounded-lg bg-marino-50 px-3 py-2 text-[13.5px] dark:bg-white/5 sm:col-span-2">Total de la venta: <b className="cifra">{formatoSoles(totalDe(f))}</b> <span className="text-slate-500">(moto {formatoSoles(modelos.find((m) => m.id === f.modelo)?.precioDesde || 0)}{TECHOS.find((t) => t.id === f.techo)?.precio ? ` + techo ${formatoSoles(TECHOS.find((t) => t.id === f.techo).precio)}` : ""})</span></p>
              <Campo etiqueta="Canal de contacto"><select className="field-input" value={f.canal} onChange={(e) => setN("canal", e.target.value)}>{CANALES.map((c) => <option key={c}>{c}</option>)}</select></Campo>
              <Campo etiqueta="¿Cómo llegó a EPSA?"><select className="field-input" value={f.origen} onChange={(e) => setN("origen", e.target.value)}>{ORIGEN.map((c) => <option key={c}>{c}</option>)}</select></Campo>
              <Campo etiqueta="Vendedor responsable" error={err.vendedor}><select className="field-input" value={f.vendedor} onChange={(e) => setN("vendedor", e.target.value)}>{vendedores.map((v) => <option key={v.id}>{v.nombre}</option>)}</select></Campo>
              <Campo etiqueta="Sede de atención"><select className="field-input" value={f.sede} onChange={(e) => setN("sede", e.target.value)}>{SEDES_ATENCION.map((c) => <option key={c}>{c}</option>)}</select></Campo>
            </div>
          )}
          {nueva.paso === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[["Pago al contado", "Paga el total del vehículo."], ["Financiamiento", "Inicial y cuotas con crédito directo."]].map(([k, d]) => (
                <button key={k} onClick={() => setN("pago", k)} className={`rounded-xl2 border-2 p-5 text-left transition ${f.pago === k ? "border-marino-700 bg-marino-50 dark:bg-white/10" : "border-slate-200 hover:border-marino-700/40 dark:border-white/15"}`}>
                  <p className="font-bold text-marino dark:text-white">{k}</p><p className="mt-1 text-[13px] text-slate-500">{d}</p></button>
              ))}
              {err.pago && <p className="text-[12.5px] font-medium text-acento sm:col-span-2" data-error-pago>{err.pago}</p>}
            </div>
          )}
          {nueva.paso === 3 && f.desdeSeparacion && (
            <div className="space-y-3" data-desde-separacion>
              <Aviso tipo="ok">Se registrará el pedido con la moto <b>{separaciones.find((x) => x.id === f.desdeSeparacion)?.unidad}</b> que ya está separada. El adelanto de <b>{formatoSoles(Number(f.adelanto))}</b> ({f.medio}{f.operacion ? `, op. ${f.operacion}` : ""}) cuenta como pago y la separación pasa a «Convertida en venta».</Aviso>
              {err.general && <Aviso tipo="error">{err.general}</Aviso>}
            </div>
          )}
          {nueva.paso === 3 && !f.desdeSeparacion && (
            <div className="space-y-3">
              {[["cotizar", "Preparar cotización", "Registra al cliente y deja la cotización lista."], ["pedido", "Registrar pedido", "Pasa directo a registrar adelanto y documentos."], ["separar", "Separar una unidad", "Reserva una unidad disponible de este modelo."]].map(([k, t, d]) => (
                <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl2 border-2 p-4 ${f.accion === k ? "border-marino-700 bg-marino-50 dark:bg-white/10" : "border-slate-200 dark:border-white/15"}`}>
                  <input type="radio" name="accion" className="mt-1 accent-[#0e2c52]" checked={f.accion === k} onChange={() => setN("accion", k)} />
                  <span><span className="block font-semibold text-marino dark:text-white">{t}</span><span className="text-[13px] text-slate-500">{d}</span></span>
                </label>
              ))}
              {f.accion === "separar" && (
                <div className="grid gap-4 rounded-xl2 border border-amber-200 bg-amber-50 p-4 sm:grid-cols-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <Campo etiqueta="Medio de pago"><select className="field-input" value={f.medio} onChange={(e) => setN("medio", e.target.value)}>{MEDIOS.map((x) => <option key={x}>{x}</option>)}</select></Campo>
                  <Campo etiqueta="Adelanto (S/)" error={err.adelanto} ayuda={`Mínimo ${formatoSoles(ADELANTO_MINIMO)}`}><input className="field-input" inputMode="decimal" value={f.adelanto} onChange={(e) => setN("adelanto", soloMonto(e.target.value))} /></Campo>
                  <Campo etiqueta="N° de operación" error={err.operacion}><input className="field-input" maxLength={20} value={f.operacion} onChange={(e) => setN("operacion", limpiaOperacion(e.target.value))} placeholder={CON_OPERACION.includes(f.medio) ? "Obligatorio" : "Opcional"} /></Campo>
                  <p className="text-[12.5px] text-amber-800 sm:col-span-3 dark:text-amber-200">Separar exige un adelanto: medio de pago, monto mayor a 0 y referencia.</p>
                </div>
              )}
              {err.general && <Aviso tipo="error">{err.general}</Aviso>}
              <Aviso>Se registra {f.cliente || "el cliente"} para el {nombreModelo(f.modelo)} {f.color} · {TECHOS.find((t) => t.id === f.techo)?.precio ? `techo ${TECHOS.find((t) => t.id === f.techo).nombre}` : "sin techo"} · total {formatoSoles(totalDe(f))} · {f.pago}.</Aviso>
            </div>
          )}
        </>}
      </Modal>

      {/* Registrar pedido */}
      <Modal abierto={!!pedido} onClose={() => setPedido(null)} titulo={`Registrar pedido · cotización #${pedido?.id}`} ancho="max-w-2xl"
        confirmarGuardar={pedido ? { titulo: "¿Registrar el pedido?", texto: `${pedido.cliente} · ${nombreModelo(pedido.modelo)}${pf.conAdelanto || pf.separar ? ` · adelanto ${formatoSoles(Number(pf.adelanto) || 0)} por ${pf.medio}` : " · sin adelanto"}${pf.separar && !pedido.unidad ? " · se separará una unidad disponible" : ""}.`, boton: "Registrar pedido", validar: validarPedido } : false}
        pie={<><button className="btn btn-secondary !py-2" onClick={() => setPedido(null)}>Cancelar</button><button form="f-ped" className="btn btn-primary !py-2">Registrar pedido</button></>}>
        {pedido && (
          <form id="f-ped" onSubmit={guardarPedido} className="grid gap-4 sm:grid-cols-2" noValidate>
            {perr.general && <div className="sm:col-span-2"><Aviso tipo="error">{perr.general}</Aviso></div>}
            <label className="flex items-center gap-2 text-[14px] font-semibold sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[#0e2c52]" checked={pf.conAdelanto || pf.separar} disabled={pf.separar} onChange={(e) => setPf({ ...pf, conAdelanto: e.target.checked })} />El cliente deja un adelanto</label>
            {!pedido.unidad && <label className="flex items-center gap-2 text-[14px] font-semibold sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[#0e2c52]" checked={pf.separar} onChange={(e) => setPf({ ...pf, separar: e.target.checked, conAdelanto: e.target.checked || pf.conAdelanto })} />Separar una unidad disponible para este cliente {perr.separar && <span className="font-medium text-acento">· {perr.separar}</span>}</label>}
            {(pf.conAdelanto || pf.separar) && <>
              <Campo etiqueta="Medio de pago"><select className="field-input" value={pf.medio} onChange={(e) => setPf({ ...pf, medio: e.target.value })}>{MEDIOS.map((m) => <option key={m}>{m}</option>)}</select></Campo>
              <Campo etiqueta="Adelanto (S/)" error={perr.adelanto} ayuda={`Máximo ${formatoSoles(pedido.total)}`}><input className="field-input" inputMode="decimal" value={pf.adelanto} onChange={(e) => setPf({ ...pf, adelanto: soloMonto(e.target.value) })} /></Campo>
              <Campo etiqueta="Fecha del pago" error={perr.fecha}><input type="date" min={pedido.fecha} max={hoyLocal()} className="field-input" value={pf.fecha} onChange={(e) => setPf({ ...pf, fecha: e.target.value })} /></Campo>
              <Campo etiqueta="N° de operación" error={perr.operacion}><input className="field-input" maxLength={20} value={pf.operacion} onChange={(e) => setPf({ ...pf, operacion: limpiaOperacion(e.target.value) })} /></Campo>
              <Campo etiqueta="Comprobante" error={perr.archivo} ayuda={pf.archivo || "JPG, PNG, WebP o PDF · máx. 10 MB"} className="sm:col-span-2"><input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={archivo} className="field-input" /></Campo>
            </>}
            <Campo etiqueta="Documento" error={perr.doc}><div className="flex gap-2"><select className="field-input !w-24" value={pf.tipoDoc} onChange={(e) => setPf({ ...pf, tipoDoc: e.target.value, doc: "" })}>{Object.keys(DOCS).map((d) => <option key={d}>{d}</option>)}</select><input className="field-input" inputMode="numeric" maxLength={DOCS[pf.tipoDoc]?.[1] || 8} value={pf.doc} onChange={(e) => setPf({ ...pf, doc: soloDigitos(e.target.value, DOCS[pf.tipoDoc]?.[1] || 8) })} /></div></Campo>
            <Campo etiqueta="Celular" error={perr.celular}><input className="field-input" type="tel" inputMode="numeric" maxLength={9} value={pf.celular} onChange={(e) => setPf({ ...pf, celular: soloDigitos(e.target.value, 9) })} /></Campo>
            <Campo etiqueta="Observaciones" error={perr.obs} className="sm:col-span-2"><textarea rows={2} maxLength={520} className="field-input" value={pf.obs} onChange={(e) => setPf({ ...pf, obs: e.target.value })} /></Campo>
          </form>
        )}
      </Modal>
      {/* Atender solicitud web */}
      <Modal abierto={!!atender} onClose={() => setAtender(null)} titulo={`Atender solicitud de ${atender?.cliente || ""}`} ancho="max-w-md"
        confirmarGuardar={{ titulo: "¿Atender esta solicitud?", texto: `Pasará a «Cotización» a cargo de ${vendAt || "—"}.`, boton: "Atender" }}
        pie={<><button className="btn btn-secondary !py-2" onClick={() => setAtender(null)}>Cancelar</button><button form="f-at" className="btn btn-primary !py-2">Atender</button></>}>
        {atender && (
          <form id="f-at" onSubmit={guardarAtender} className="grid gap-4" noValidate>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-marino-50 p-4 text-[13.5px] dark:bg-white/5">
              <div><dt className="text-slate-500">Modelo</dt><dd className="font-semibold">{nombreModelo(atender.modelo)}{atender.color && ` · ${atender.color}`}</dd></div>
              <div><dt className="text-slate-500">Forma de compra</dt><dd className="font-semibold">{atender.pago}</dd></div>
              <div><dt className="text-slate-500">Celular</dt><dd className="font-semibold">{atender.celular}</dd></div>
              <div><dt className="text-slate-500">Sede</dt><dd className="font-semibold">{atender.sede}</dd></div>
              {atender.techo && <div className="col-span-2"><dt className="text-slate-500">Techo de interés</dt><dd className="font-semibold">{atender.techo}</dd></div>}
            </dl>
            <Campo etiqueta="Vendedor que atiende"><select className="field-input" value={vendAt} onChange={(e) => setVendAt(e.target.value)}>{vendedores.map((p) => <option key={p.id}>{p.nombre}</option>)}</select></Campo>
          </form>
        )}
      </Modal>

      {/* Emitir comprobante */}
      <Modal abierto={!!comp} onClose={() => setComp(null)} titulo={`Emitir comprobante · ${comp?.cliente || ""}`} ancho="max-w-2xl"
        confirmarGuardar={comp ? { titulo: `¿Emitir ${cf.tipo === "Factura" ? "la factura" : "la boleta"}?`, texto: `${cf.tipo === "Factura" ? "F001" : "B001"} · ${cf.tipo === "Factura" ? cf.razon || "—" : comp.cliente} · total S/ ${dosDec(Number(cf.total) || 0)}. El número se asigna en orden y no se reutiliza.`, boton: "Emitir", validar: validarComprobante } : false}
        pie={<><button className="btn btn-secondary !py-2" onClick={() => setComp(null)}>Cancelar</button><button form="f-comp" className="btn btn-primary !py-2">Emitir comprobante</button></>}>
        {comp && (
          <form id="f-comp" onSubmit={emitirComprobante} className="grid gap-4 sm:grid-cols-2" noValidate>
            <div className="flex gap-2 sm:col-span-2">
              {["Boleta de venta", "Factura"].map((t) => (
                <button type="button" key={t} onClick={() => setCf({ ...cf, tipo: t, tipoDoc: t === "Factura" ? "RUC" : "DNI", doc: t === "Factura" ? "" : cf.doc })} className={`flex-1 rounded-lg border-2 px-4 py-3 text-left text-[14px] font-semibold ${cf.tipo === t ? "border-marino-700 bg-marino-50 text-marino dark:bg-white/10 dark:text-white" : "border-slate-200 text-slate-500 dark:border-white/15"}`}>{t}<span className="block text-[12px] font-normal text-slate-500">Serie {t === "Factura" ? "F001 · cliente con RUC" : "B001 · cliente con DNI o CE"}</span></button>
              ))}
            </div>
            {cf.tipo === "Factura" ? <>
              <Campo etiqueta="RUC" error={cerr.doc}><input className="field-input" inputMode="numeric" maxLength={11} value={cf.doc} onChange={(e) => setCf({ ...cf, doc: e.target.value.replace(/\D/g, "") })} /></Campo>
              <Campo etiqueta="Razón social" error={cerr.razon}><input className="field-input" maxLength={100} value={cf.razon} onChange={(e) => setCf({ ...cf, razon: e.target.value })} /></Campo>
              <Campo etiqueta="Dirección fiscal" error={cerr.direccion} className="sm:col-span-2"><input className="field-input" maxLength={250} value={cf.direccion} onChange={(e) => setCf({ ...cf, direccion: e.target.value })} /></Campo>
            </> : (
              <Campo etiqueta={`Documento de ${comp.cliente}`} error={cerr.doc} className="sm:col-span-2"><div className="flex gap-2"><select className="field-input !w-24" value={cf.tipoDoc} onChange={(e) => setCf({ ...cf, tipoDoc: e.target.value, doc: "" })}>{["DNI", "CE"].map((d) => <option key={d}>{d}</option>)}</select><input className="field-input" inputMode="numeric" maxLength={DOCS[cf.tipoDoc]?.[1] || 8} value={cf.doc} onChange={(e) => setCf({ ...cf, doc: soloDigitos(e.target.value, DOCS[cf.tipoDoc]?.[1] || 8) })} /></div></Campo>
            )}
            <Campo etiqueta="Fecha de emisión" error={cerr.fecha}><input type="date" min={comp.fecha} max={hoyLocal()} className="field-input" value={cf.fecha} onChange={(e) => setCf({ ...cf, fecha: e.target.value })} /></Campo>
            <Campo etiqueta="Medio de pago"><select className="field-input" value={cf.medio} onChange={(e) => setCf({ ...cf, medio: e.target.value })}>{MEDIOS.map((m) => <option key={m}>{m}</option>)}</select></Campo>
            <Campo etiqueta="Descripción" error={cerr.descripcion} className="sm:col-span-2"><input className="field-input" maxLength={300} value={cf.descripcion} onChange={(e) => setCf({ ...cf, descripcion: e.target.value })} /></Campo>
            <Campo etiqueta="Importe total (S/, IGV incluido)" error={cerr.total} ayuda="Es el total de la venta."><input className="field-input tabular-nums" inputMode="decimal" readOnly value={cf.total} onChange={(e) => setCf({ ...cf, total: soloMonto(e.target.value) })} /></Campo>
            <dl className="grid grid-cols-3 gap-2 self-end rounded-lg bg-marino-50 p-3 text-[12.5px] tabular-nums dark:bg-white/5">
              <div><dt className="text-slate-500">Op. gravada</dt><dd className="font-semibold">S/ {dosDec((Number(cf.total) || 0) / (1 + IGV))}</dd></div>
              <div><dt className="text-slate-500">IGV 18%</dt><dd className="font-semibold">S/ {dosDec((Number(cf.total) || 0) - (Number(cf.total) || 0) / (1 + IGV))}</dd></div>
              <div><dt className="text-slate-500">Total</dt><dd className="font-semibold">S/ {dosDec(Number(cf.total) || 0)}</dd></div>
            </dl>
            <div className="sm:col-span-2"><Aviso>Comprobante manual interno de EPSA Motor. El comprobante electrónico ante SUNAT se emite en el sistema de facturación de la empresa.</Aviso></div>
          </form>
        )}
      </Modal>

      {/* Ver comprobante */}
      <Modal abierto={!!verComp} onClose={() => setVerComp(null)} titulo="Comprobante" ancho="max-w-lg"
        pie={<>{verComp && puede("comprobantes.emitir") && <button className="btn !py-2 border border-acento/40 text-acento hover:bg-acento/10" onClick={() => anularComprobante(verComp)}>Anular</button>}<button className="btn btn-secondary !py-2" onClick={() => setVerComp(null)}>Cerrar</button>{verComp?.comprobante && <button className="btn btn-primary !py-2" onClick={() => descargarComprobante({ comprobante: verComp.comprobante, venta: verComp, modelo: nombreModelo(verComp.modelo) })}>Descargar PDF</button>}</>}>
        {verComp?.comprobante && (() => { const c = verComp.comprobante; return (
          <div className="overflow-hidden rounded-xl border border-slate-200 text-[13.5px] dark:border-white/10">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-white/10">
              <div><img src="/images/logo-epsa.svg" alt="EPSA Motor" className="mb-2 h-9 w-auto rounded bg-marino p-1.5" /><p className="font-bold text-marino dark:text-white">{EMPRESA.razon}</p><p className="text-slate-500">RUC {EMPRESA.ruc}</p></div>
              <div className="rounded-lg border-2 border-marino px-3 py-2 text-center dark:border-white/40"><p className="text-[11px] font-bold uppercase text-marino dark:text-white">{c.tipo}</p><p className="font-mono font-bold tabular-nums">{numeroComprobante(c)}</p></div>
            </div>
            <dl className="grid grid-cols-2 gap-3 p-5">
              <div><dt className="text-slate-500">Cliente</dt><dd className="font-semibold">{c.cliente}</dd></div>
              <div><dt className="text-slate-500">{c.tipoDoc}</dt><dd className="font-semibold tabular-nums">{c.doc}</dd></div>
              {c.direccion && <div className="col-span-2"><dt className="text-slate-500">Dirección fiscal</dt><dd>{c.direccion}</dd></div>}
              <div><dt className="text-slate-500">Fecha de emisión</dt><dd className="font-semibold">{c.fecha}</dd></div>
              <div><dt className="text-slate-500">Medio de pago</dt><dd className="font-semibold">{c.medio}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Descripción</dt><dd>{c.descripcion}{verComp.techo ? ` · techo adicional ${verComp.techo} (${formatoSoles(verComp.techoPrecio)})` : ""}</dd></div>
            </dl>
            <dl className="space-y-1 border-t border-slate-200 bg-slate-50 p-5 tabular-nums dark:border-white/10 dark:bg-white/5">
              <div className="flex justify-between"><dt>Op. gravada</dt><dd>S/ {dosDec(c.gravada)}</dd></div>
              <div className="flex justify-between"><dt>IGV 18%</dt><dd>S/ {dosDec(c.igv)}</dd></div>
              <div className="flex justify-between text-[15px] font-bold text-marino dark:text-white"><dt>Total</dt><dd>S/ {dosDec(c.total)}</dd></div>
            </dl>
            <p className="px-5 py-3 text-[12px] text-slate-500">Emitido por {c.emitidoPor}. Comprobante manual interno; no reemplaza al comprobante electrónico SUNAT.</p>
          </div>
        ); })()}
      </Modal>
    </div>
  );
}
