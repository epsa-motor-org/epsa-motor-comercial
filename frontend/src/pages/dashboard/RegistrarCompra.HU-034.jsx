// HU-034 · Registrar compra pendiente de factura
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { MODO_REAL } from "../../lib/config";
import * as api from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { Aviso, Campo, Card, PageHeader, useConfirm, useToast } from "../../components/ui";
import ModeloImg from "../../components/ModeloImg";
import { ESTADO_COMPRA } from "./Compras.HU-034";
import { COLOR_HEX } from "../../data/mockData";
import { fechaLocal, horaLima, soloDigitos } from "../../lib/validar";
import { emparejarModelos } from "../../lib/modelos";
import useAutoRefresco from "../../hooks/useAutoRefresco";
import { REFRESCO_MS } from "../../servicios/central";

const PALETA = Object.keys(COLOR_HEX);

// Clave de idempotencia
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

export default function RegistrarCompra() {
  const { compras: locales, modelos: modelosLocales, apiModelos, agregar } = useApp();
  const par = MODO_REAL ? emparejarModelos(apiModelos || [], modelosLocales) : null;
  const localDe = (a) => { for (const [id, x] of par.porLocal) if (x === a) return modelosLocales.find((m) => m.id === id); return null; };
  const modelos = par
    ? (apiModelos || []).map((a) => { const l = localDe(a); return { ...l, id: l?.id || `api-${a.codmod}`, codmod: String(a.codmod), nombre: a.nommod, colores: a.colores?.length ? a.colores : l?.colores?.length ? l.colores : PALETA, sinFicha: !l, imagenApi: a.imagenes?.[0]?.urlimo }; })
    : modelosLocales;
  const { puede, user } = useAuth();
  const toast = useToast(); const confirmar = useConfirm(); const navigate = useNavigate();
  const [pendientes, setPendientes] = useState(MODO_REAL ? [] : locales.filter((c) => c.estcom !== "Identificada"));
  const [f, setF] = useState({ codmod: modelos[0]?.codmod || "", colcom: modelos[0]?.colores?.length === 1 ? modelos[0].colores[0] : "", cancom: 1, pedido: "" });
  const [err, setErr] = useState({});
  const [reviso, setReviso] = useState(false);
  const [enviando, setEnviando] = useState(false); const [reintento, setReintento] = useState(false);
  const clave = useRef(uuid());

  useEffect(() => {
    if (!MODO_REAL) return;
    api.listarCompras(100, 0).then((r) => setPendientes(r.data || [])).catch((e) => toast(mensajeError(e), "error"));
  }, []); // eslint-disable-line
  // Lista de pendientes al día: se actualiza sola (otra sesión pudo registrar o identificar una compra)
  useAutoRefresco(() => api.listarCompras(100, 0).then((r) => setPendientes(r.data || [])).catch(() => {}), REFRESCO_MS, MODO_REAL);

  const codigos = modelos.map((m) => m.codmod).join("|");
  useEffect(() => {
    if (reintento || !modelos.length || modelos.some((m) => m.codmod === f.codmod)) return;
    const m = modelos[0];
    setF((x) => ({ ...x, codmod: m.codmod, colcom: m.colores?.length === 1 ? m.colores[0] : "" }));
  }, [codigos]); // eslint-disable-line

  const modelo = modelos.find((m) => m.codmod === f.codmod);
  const coloresModelo = modelo?.colores?.length ? modelo.colores : PALETA;
  const color = coloresModelo.includes(f.colcom) ? f.colcom : "";
  const similares = useMemo(() => pendientes.filter((c) => c.codmod === String(f.codmod) && c.colcom.toLowerCase() === color.toLowerCase()), [pendientes, f.codmod, color]);

  if (!puede("compras.registrar")) {
    return <div className="space-y-3"><Aviso tipo="aviso">Solo gerencia y administración registran compras a proveedor. Tu rol puede consultarlas.</Aviso><Link className="btn btn-secondary" to="/admin/compras">Ver compras</Link></div>;
  }

  // Validación
  function validar() {
    const x = {};
    if (!modelo) x.codmod = MODO_REAL && !modelos.length ? "Todavía no hay modelos publicados." : "Elige el modelo comprado.";
    if (!color) x.colcom = "Elige uno de los colores del modelo.";
    const n = Number(f.cancom);
    if (!Number.isInteger(n) || n < 1 || n > 9999) x.cancom = "La cantidad debe ser un número entero entre 1 y 9999.";
    if (!reviso) x.reviso = "Confirma que revisaste las compras pendientes.";
    if (MODO_REAL && f.pedido.trim() && !/^[A-Za-z0-9-]{1,40}$/.test(f.pedido.trim())) x.pedido = "Usa solo letras, números o guiones (máximo 40), tal como figura en Asiri.";
    setErr(x); return Object.keys(x).length === 0;
  }

  function registrarLocal(cuerpo) {
    const previa = locales.find((c) => c.idem === clave.current);
    if (previa) {
      if (previa.codmod === cuerpo.codmod && previa.colcom === cuerpo.colcom && previa.cancom === cuerpo.cancom) return { status: 200, data: previa };
      throw Object.assign(new Error("La clave de idempotencia ya se usó con otros datos."), { status: 409 });
    }
    const ahora = new Date();
    const codcom = String(locales.reduce((a, c) => Math.max(a, Number(c.codcom)), 0) + 1);
    agregar("compras", { id: Date.now(), codcom, codmod: cuerpo.codmod, nommod: modelo.nombre, colcom: cuerpo.colcom, cancom: cuerpo.cancom, cantidad_pendiente: cuerpo.cancom, estcom: "Pendiente de factura", feccom: fechaLocal(ahora), horcom: horaLima(ahora), codusu: user.nombre, idem: clave.current, factura: null, unidades: [] }, `Compra registrada: ${modelo.nombre} ${cuerpo.colcom} x${cuerpo.cancom}`);
    return { status: 201, data: { codcom } };
  }

  // Enviar (POST /api/compras)
  async function enviar(e) {
    e.preventDefault();
    if (!validar()) return;
    const cuerpo = { codmod: String(f.codmod), colcom: color, cancom: Number(f.cancom) };
    if (!(await confirmar({ titulo: "¿Registrar esta compra?", texto: `${modelo?.nombre} · color ${color} · ${cuerpo.cancom} moto(s). Quedará «Pendiente de factura» con tu usuario, fecha y hora automáticos.`, boton: "Registrar compra" }))) return;
    setEnviando(true);
    try {
      const r = MODO_REAL ? await api.crearCompra(cuerpo, clave.current) : registrarLocal(cuerpo);
      // El N° de pedido de Asiri se guarda con la compra (guardarPedidoApi, docs/supabase-sprint2-final.sql)
      if (MODO_REAL && f.pedido.trim() && r.data?.codcom) {
        try { await api.guardarPedidoApi(r.data.codcom, f.pedido.trim()); }
        catch (er) { toast(`Compra registrada, pero el N° de pedido no se guardó: ${mensajeError(er)} Agrégalo desde la compra.`, "error"); }
      }
      toast(r.status === 200 ? "Esa compra ya estaba registrada (mismo reintento): se muestra la misma." : MODO_REAL ? "Compra registrada como respaldo. Cuando llegue la factura por correo se completará sola si coincide el pedido y la cantidad." : "Compra registrada. Siguiente paso: registrar la factura y adjuntar el PDF.");
      navigate(`/admin/compras/${r.data?.codcom}`);
    } catch (er) {
      if (er.status === 0 || er.status >= 500) { setReintento(true); toast("No recibimos la confirmación. Presiona «Reintentar»: la compra no se registrará dos veces.", "error"); }
      else { clave.current = uuid(); setReintento(false); setErr({ general: mensajeError(er) }); toast(mensajeError(er), "error"); }
    } finally { setEnviando(false); }
  }

  return (
    <div>
      <PageHeader titulo="Registrar compra pendiente de factura" subtitulo="Después de cotizar y pagar a Crosland, registra qué modelo, color y cuántas motos se compraron. La factura y las series se completan después.">
        <Link to="/admin/compras" className="btn btn-secondary !py-2.5">← Compras</Link>
      </PageHeader>
      {MODO_REAL && <div className="mb-5"><Aviso>Registrarla a mano es opcional: cuando la factura de Crosland llega por correo, la compra y sus motos se registran solas. Úsalo como respaldo si quieres dejar constancia antes de que llegue la factura.</Aviso></div>}

      {/* Formulario de compra */}
      <form onSubmit={enviar} noValidate className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="min-w-0">
          <h2 className="text-lg font-bold text-marino dark:text-white">Datos de la compra</h2>
          <div className="mt-5 grid gap-5">
            <Campo etiqueta="Modelo comprado" error={err.codmod}>
              <div className="flex items-center gap-4">
                <div className="grid h-20 w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-escenario dark:bg-escenario-oscuro">{modelo && <ModeloImg modelo={modelo} className="h-full w-full object-contain p-1" />}</div>
                <select id="compra-modelo" disabled={reintento || !modelos.length} className="field-input" value={modelo ? f.codmod : ""} onChange={(e) => { const m = modelos.find((x) => x.codmod === e.target.value); setF({ ...f, codmod: e.target.value, colcom: m?.colores?.length === 1 ? m.colores[0] : "" }); }}>
                  {!modelos.length && <option value="">{apiModelos === null ? "Cargando modelos…" : "Sin modelos publicados"}</option>}
                  {modelos.map((m) => <option key={m.codmod} value={m.codmod}>{m.nombre}</option>)}
                </select>
              </div>
              {MODO_REAL && apiModelos === null && <p className="mt-2 text-[12.5px] text-slate-500">Si la lista no carga, espera un minuto y actualiza la página.</p>}
            </Campo>
            <Campo etiqueta="Color" error={err.colcom} ayuda={!modelo ? "" : modelo.sinFicha ? `${modelo.nombre} aún no tiene ficha en la web: elige el color que figura en la compra.` : coloresModelo.length === 1 ? `El ${modelo.nombre} solo viene en ${coloresModelo[0]}.` : `Colores disponibles del ${modelo.nombre}.`}>
              <div id="compra-color" role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
                {coloresModelo.map((c) => (
                  <button type="button" disabled={reintento} role="radio" aria-checked={color === c} data-color={c} key={c} onClick={() => setF({ ...f, colcom: c })} className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium ${color === c ? "border-marino-700 bg-marino-700 text-white" : "border-slate-300 hover:bg-slate-50 dark:border-white/15 dark:hover:bg-white/5"}`}><span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/15" style={{ background: COLOR_HEX[c] }} />{c}</button>
                ))}
              </div>
            </Campo>
            <Campo etiqueta="Cantidad de motos" error={err.cancom}>
              <div className="flex items-center gap-2">
                <button type="button" disabled={reintento} aria-label="Restar una" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-300 text-xl dark:border-white/15" onClick={() => setF({ ...f, cancom: Math.max(1, Number(f.cancom) - 1) })}>−</button>
                <input id="compra-cantidad" disabled={reintento} className="field-input !w-24 text-center text-lg font-bold tabular-nums" inputMode="numeric" value={f.cancom} maxLength={4} onChange={(e) => setF({ ...f, cancom: soloDigitos(e.target.value, 4).replace(/^0+/, "") })} />
                <button type="button" disabled={reintento} aria-label="Sumar una" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-300 text-xl dark:border-white/15" onClick={() => setF({ ...f, cancom: Math.min(9999, Number(f.cancom || 0) + 1) })}>+</button>
              </div>
            </Campo>
            {MODO_REAL && (
              <Campo etiqueta="N° de pedido de Asiri (opcional)" error={err.pedido} ayuda="Si la factura llega por correo con este pedido y la misma cantidad, completa esta compra en lugar de crear otra.">
                <input id="compra-pedido" disabled={reintento} className="field-input sm:max-w-xs" maxLength={40} value={f.pedido} onChange={(e) => setF({ ...f, pedido: e.target.value.replace(/\s/g, "") })} placeholder="0002010750" />
              </Campo>
            )}
            {similares.length > 0 && <Aviso tipo="aviso">Ya hay {similares.length} compra(s) pendiente(s) de {modelo?.nombre} en {color} (#{similares.map((c) => c.codcom).join(", #")}). Confirma con la gerencia que no sea la misma antes de registrar otra.</Aviso>}
            {err.general && <Aviso tipo="error">{err.general}</Aviso>}
            {reintento && <Aviso>No recibimos la confirmación. Los datos quedan fijos para reintentar: si la compra ya se registró, no se duplicará. <button type="button" className="font-semibold underline" onClick={() => { clave.current = uuid(); setReintento(false); }}>Empezar una compra distinta</button></Aviso>}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-bold text-marino dark:text-white">Antes de registrar</h2>
            <p className="mt-1 text-[13px] text-slate-500">Revisa que esta compra no esté ya en la lista. Dos registros distintos nunca se fusionan.</p>
            {pendientes.length === 0 ? <p className="mt-3 text-[13.5px] text-slate-400">No hay compras pendientes.</p> : (
              <ul className="mt-3 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-[13.5px] dark:divide-white/10 dark:border-white/10">
                {pendientes.map((c) => (
                  <li key={c.codcom} className={`flex items-center justify-between gap-3 px-3 py-2 ${similares.includes(c) ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}>
                    <span>#{c.codcom} · {c.nommod} · {c.colcom} · {c.cancom}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_COMPRA[c.estcom] || "bg-slate-200"}`}>{c.estcom}</span>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-4 flex items-start gap-2 text-[14px] font-medium"><input id="compra-reviso" type="checkbox" className="mt-1 h-4 w-4 accent-[#0e2c52]" checked={reviso} onChange={(e) => setReviso(e.target.checked)} />Revisé las compras pendientes y esta compra no está registrada.</label>
            {err.reviso && <p className="mt-1 text-[12px] font-medium text-acento">{err.reviso}</p>}
          </Card>
          <Card>
            <h2 className="font-bold text-marino dark:text-white">Resumen</h2>
            <dl className="mt-3 space-y-2 text-[14px]">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Modelo</dt><dd className="text-right font-semibold">{modelo?.nombre || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Color</dt><dd className="font-semibold">{color || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Cantidad</dt><dd className="font-semibold tabular-nums">{f.cancom || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Estado inicial</dt><dd><span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${ESTADO_COMPRA["Pendiente de factura"]}`}>Pendiente de factura</span></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Registra</dt><dd className="font-semibold">{user.nombre} (automático)</dd></div>
            </dl>
            <p className="mt-3 break-all text-[11.5px] text-slate-400">Clave de reintento: {clave.current}</p>
            <button id="compra-registrar" className="btn btn-acento mt-5 w-full !py-3.5 text-[15px] shadow-lg shadow-acento/25" disabled={enviando}>{enviando ? "Registrando…" : reintento ? "Reintentar registro" : "Registrar compra pendiente de factura"}</button>
          </Card>
        </div>
      </form>
    </div>
  );
}
