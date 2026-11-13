// HU-013 · Formulario «Cotizar mi Torito» · HU-011: enviar una consulta desde la web
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Modal, Campo, Aviso } from "./ui";
import { useApp } from "../store/appStore.jsx";
import { MODO_REAL, WHATSAPP_NUMERO } from "../lib/config";
import { IconWhatsapp } from "./Icons";
import ModeloImg from "./ModeloImg";
import { COLORES, formatoSoles } from "../data/mockData";
import { useTechos } from "../servicios/techos";
import { registrarInteresadoWebApi } from "../lib/api";
import { mensajeError } from "../lib/errores";
import { soloDigitos, soloLetrasNombre, esNombreYApellido, esCelular, limpiarTexto, formatoTelefono, MSJ } from "../lib/validar";
import { POLITICA_DATOS, SEGUNDOS_MINIMOS, TEXTO_CONSENTIMIENTO, anotarEnvio, limiteAlcanzado, registrarConsultaWeb } from "../servicios/consultas";

const Ctx = createContext(() => {});
export const useCotizar = () => useContext(Ctx);

const VACIO = { tipo: "cotizar", nombre: "", telefono: "", modelo: "", color: "", sede: "", techo: "", pago: "Financiamiento", mensaje: "", acepta: false, trampa: "" };
const MAX_MENSAJE = 400;
// Colores para elegir: los del modelo en la base; si el modelo todavía no tiene, todos los de la marca
const coloresDe = (m) => (m?.colores?.length ? m.colores : m ? COLORES : []);
const colorInicial = (m, pedido) => (m?.colores?.length ? (m.colores.includes(pedido) ? pedido : m.colores[0]) : COLORES.includes(pedido) ? pedido : "");

// Ventana de cotización o consulta (se abre desde cualquier página)
export function CotizarProvider({ children }) {
  const app = useApp();
  const { publicos, sedes } = app;
  const TECHOS = useTechos();
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState(VACIO);
  const [err, setErr] = useState({});
  const [hecho, setHecho] = useState(null);
  const [pausaClic, setPausaClic] = useState(false);
  const [verPolitica, setVerPolitica] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const enviando = useRef(false);
  const abiertoEn = useRef(0);

  // pre: { modeloId, color, techo, tipo: "consulta" }
  const abrir = useCallback((pre = {}) => {
    const consulta = pre.tipo === "consulta";
    const m = publicos.find((x) => x.id === pre.modeloId) || (consulta ? null : publicos[0]);
    const color = colorInicial(m, pre.color);
    setF({ ...VACIO, tipo: consulta ? "consulta" : "cotizar", modelo: m?.id || "", color, techo: TECHOS.some((t) => t.id === pre.techo) ? pre.techo : "", sede: pre.sede && sedes.some((s) => s.nombre === pre.sede) ? pre.sede : sedes[0]?.nombre || "" });
    setErr({}); setHecho(null); setVerPolitica(false); enviando.current = false; abiertoEn.current = Date.now(); setAbierto(true);
  }, [publicos, sedes, TECHOS]);

  const consulta = f.tipo === "consulta";
  const modelo = publicos.find((m) => m.id === f.modelo);
  const techo = TECHOS.find((t) => t.id === f.techo);
  const conPrecio = Number(modelo?.precioDesde) > 0;
  const total = (Number(modelo?.precioDesde) || 0) + (techo?.precio || 0);
  // Horario de la sede elegida (viene de la base); si no tiene, no se muestra
  const horarioSede = hecho ? sedes.find((s) => s.nombre === hecho.sede)?.horario || "" : "";
  const set = (k, v) => {
    setF((p) => {
      const n = { ...p, [k]: v };
      if (k === "modelo") n.color = colorInicial(publicos.find((x) => x.id === v), p.color);
      return n;
    });
    setErr((x) => (x[k] || x.general ? { ...x, [k]: undefined, general: undefined } : x));
  };

  // Validación
  function validar() {
    const e = {};
    if (!limpiarTexto(f.nombre)) e.nombre = "Escribe tu nombre y apellido.";
    else if (!esNombreYApellido(f.nombre)) e.nombre = "Escribe tu nombre y apellido, solo con letras (sin números ni símbolos).";
    if (!f.telefono) e.telefono = "Escribe tu celular.";
    else if (!esCelular(f.telefono)) e.telefono = MSJ.celular;
    if (!f.sede) e.sede = "Elige una sede.";
    if (consulta) {
      const t = limpiarTexto(f.mensaje);
      if (t.length < 10 || (t.match(/\p{L}/gu) || []).length < 5) e.mensaje = "Escribe tu consulta (mínimo 10 caracteres).";
      else if (t.length > MAX_MENSAJE) e.mensaje = `Máximo ${MAX_MENSAJE} caracteres.`;
    } else {
      if (!modelo) e.modelo = "Elige un modelo.";
      if (!f.techo) e.techo = "Elige un techo o «Sin techo».";
      if (limpiarTexto(f.mensaje).length > MAX_MENSAJE) e.mensaje = `Máximo ${MAX_MENSAJE} caracteres.`;
    }
    if (!f.acepta) e.acepta = "Para responderte necesitamos tu autorización.";
    setErr(e);
    return Object.keys(e).length === 0;
  }

  // Enviar: con la base conectada queda guardado como interesado en Leads (HU-015 lo asigna a un vendedor)
  async function enviar(e) {
    e.preventDefault();
    if (enviando.current || !validar()) return;
    // Antispam: campo trampa, tiempo mínimo y límite de envíos por navegador
    if (f.trampa) { setHecho({ codigo: "", repetido: false, url: "", modelo: modelo?.nombre || "", sede: f.sede }); return; }
    if ((Date.now() - abiertoEn.current) / 1000 < SEGUNDOS_MINIMOS) { setErr({ general: "Revisa tus datos un momento y vuelve a enviar." }); return; }
    if (limiteAlcanzado()) { setErr({ general: "Ya recibimos tus mensajes. Un asesor te contactará pronto; si es urgente, escríbenos por WhatsApp." }); return; }
    enviando.current = true;
    const nombre = limpiarTexto(f.nombre);
    const techoTxt = techo?.precio ? techo.nombre : "";
    let r = { codigo: "", repetido: false, guardado: false };
    if (MODO_REAL) {
      const detalle = consulta
        ? limpiarTexto(f.mensaje)
        : [techoTxt ? `Techo ${techoTxt} (+${formatoSoles(techo.precio)})` : "Sin techo", f.pago, conPrecio ? `Total referencial ${formatoSoles(total)}` : "Precio por confirmar", limpiarTexto(f.mensaje)].filter(Boolean).join(" · ");
      setErr({}); setGuardando(true);
      try {
        const g = await registrarInteresadoWebApi({ nombre, telefono: f.telefono, codmod: modelo?.codmodApi, color: f.color, codsed: sedes.find((s) => s.nombre === f.sede)?.codsed, detalle, tipo: consulta ? "Consulta" : "Cotización" });
        r = { codigo: "", repetido: !!g?.repetido, guardado: true };
      } catch (er) {
        // Sin la función en Supabase la web sigue funcionando por WhatsApp; otro error se muestra para corregirlo
        if (!er?.detalle?.faltaSql) { setErr({ general: mensajeError(er) }); setGuardando(false); enviando.current = false; return; }
      }
      setGuardando(false);
    } else {
      // Vista de ejemplo: queda en este navegador con su número de consulta
      r = registrarConsultaWeb(app, { tipo: f.tipo, nombre, telefono: f.telefono, sede: f.sede, modelo, color: f.color, techo, pago: f.pago, total: conPrecio ? total : 0, mensaje: f.mensaje });
    }
    anotarEnvio();
    const msg = consulta
      ? `Hola, soy ${nombre}. ${modelo ? `Consulto por el ${modelo.nombre}. ` : ""}${limpiarTexto(f.mensaje)} Sede ${f.sede}. Mi celular: ${f.telefono}.`
      : `Hola, soy ${nombre}. Quisiera cotizar el ${modelo.nombre}${f.color ? ` en color ${f.color}` : ""}${techoTxt ? ` con techo ${techoTxt} (+${formatoSoles(techo.precio)})` : " sin techo"}, ${conPrecio ? `total referencial ${formatoSoles(total)}` : "precio por confirmar"} (${f.pago.toLowerCase()}). Sede ${f.sede}. Mi celular: ${f.telefono}.`;
    setPausaClic(true); setTimeout(() => setPausaClic(false), 700);
    setHecho({ ...r, modelo: modelo?.nombre || "", sede: f.sede, url: `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(r.codigo ? `${msg} (Consulta ${r.codigo})` : msg)}` });
  }

  const valor = useMemo(() => abrir, [abrir]);
  const titulo = hecho ? (MODO_REAL && !hecho.guardado ? "¡Tu mensaje está listo!" : consulta ? "¡Consulta enviada!" : "¡Solicitud recibida!") : consulta ? "Envíanos tu consulta" : "Cotizar mi Torito";
  const soloWhatsapp = MODO_REAL && !hecho?.guardado;
  return (
    <Ctx.Provider value={valor}>
      {children}
      <Modal abierto={abierto} onClose={() => { if (!pausaClic) setAbierto(false); }} sinAvisoCambios={!!hecho || !publicos.length} titulo={titulo} ancho="max-w-2xl" confirmarGuardar={false}>
        {/* Sin catálogo / confirmación / formulario */}
        {!hecho && !consulta && !publicos.length ? (
          <div className="space-y-4 text-center" data-cotizar-vacio>
            <p className="text-[15px] text-slate-600 dark:text-slate-300">Estamos actualizando nuestro catálogo. Escríbenos por WhatsApp y un asesor te cotiza al momento.</p>
            <a href={`https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent("Hola, quisiera cotizar un Torito.")}`} target="_blank" rel="noopener noreferrer" className="btn btn-whatsapp w-full"><IconWhatsapp /> Cotizar por WhatsApp</a>
            <button className="btn btn-secondary w-full" onClick={() => setAbierto(false)}>Cerrar</button>
          </div>
        ) : hecho ? (
          <div className={`space-y-5 ${pausaClic ? "pointer-events-none" : ""}`} data-consulta-enviada>
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-600">✓</div>
              <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-300">{soloWhatsapp ? <>Armamos tu {consulta ? "consulta" : "solicitud"}{hecho.modelo ? <> por el <strong>{hecho.modelo}</strong></> : ""}. Envíala por WhatsApp y un asesor de la sede {hecho.sede} te responde.</> : <>{hecho.repetido ? "Ya teníamos tus datos: sumamos este mensaje a tu consulta" : consulta ? "Recibimos tu consulta" : "Registramos tu solicitud"}{hecho.modelo ? <> por el <strong>{hecho.modelo}</strong></> : ""}.</>}</p>
              {hecho.codigo && <p className="mt-2 text-[13.5px] text-slate-500">Número de consulta <b className="cifra font-mono text-[15px] text-marino dark:text-white" data-codigo-consulta>{hecho.codigo}</b></p>}
            </div>
            <ol className="space-y-2 rounded-xl2 bg-marino-50 p-4 text-[14px] text-slate-600 dark:bg-white/5 dark:text-slate-300">
              {soloWhatsapp ? <>
                <li><b className="text-marino dark:text-white">1.</b> Toca «Enviar por WhatsApp»: el mensaje ya lleva tus datos y lo que elegiste.</li>
                <li><b className="text-marino dark:text-white">2.</b> Un asesor de la sede {hecho.sede} te responde en su horario de atención{horarioSede ? ` (${horarioSede})` : ""}.</li>
              </> : <>
                <li><b className="text-marino dark:text-white">1.</b> Un asesor de la sede {hecho.sede} revisa tu {consulta ? "consulta" : "solicitud"}.</li>
                <li><b className="text-marino dark:text-white">2.</b> Te llamamos o escribimos al {formatoTelefono(f.telefono)} en horario de atención{horarioSede ? ` (${horarioSede})` : ""}.</li>
                <li><b className="text-marino dark:text-white">3.</b> Si prefieres, adelanta la conversación por WhatsApp.</li>
              </>}
            </ol>
            {hecho.url && <a href={hecho.url} target="_blank" rel="noopener noreferrer" className="btn btn-whatsapp w-full"><IconWhatsapp /> {soloWhatsapp ? "Enviar por WhatsApp" : "Continuar por WhatsApp"}</a>}
            <button className="btn btn-secondary w-full" onClick={() => setAbierto(false)}>Cerrar</button>
          </div>
        ) : (
          <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2" noValidate data-formulario={consulta ? "consulta" : "cotizar"}>
            {/* Cotizar o preguntar */}
            <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 sm:col-span-2 dark:bg-white/5" role="tablist" aria-label="Tipo de mensaje">
              {[["cotizar", "Quiero una cotización"], ["consulta", "Tengo una pregunta"]].map(([t, l]) => (
                <button key={t} type="button" role="tab" aria-selected={f.tipo === t} onClick={() => { setErr({}); setF((p) => ({ ...p, tipo: t, modelo: t === "cotizar" && !p.modelo ? publicos[0]?.id || "" : p.modelo, color: t === "cotizar" && !p.modelo ? colorInicial(publicos[0], p.color) : p.color })); }}
                  className={`flex-1 rounded-lg px-3 py-2 text-[13.5px] font-semibold transition ${f.tipo === t ? "bg-white text-marino shadow-sm dark:bg-white/15 dark:text-white" : "text-slate-500"}`}>{l}</button>
              ))}
            </div>
            {modelo && !consulta && (
              <div className="flex items-center gap-4 rounded-2xl bg-escenario p-3 sm:col-span-2 dark:bg-escenario-oscuro" aria-live="polite">
                <ModeloImg modelo={modelo} color={f.color} className="h-20 w-28 shrink-0 object-contain" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-500">Estás cotizando</p>
                  <p className="truncate font-display text-[1.45rem] font-bold uppercase leading-tight text-marino dark:text-white" data-cotizando>{modelo.nombre}</p>
                  <p className="text-[13px] text-slate-500">{f.color && `Color ${f.color}, `}{conPrecio ? `moto desde ${formatoSoles(modelo.precioDesde)}` : "precio a consultar"}</p>
                </div>
              </div>
            )}
            {/* Datos del cliente */}
            <Campo etiqueta="Nombre completo" error={err.nombre} className="sm:col-span-2">
              <input id="cot-nombre" className="field-input" value={f.nombre} maxLength={80} onChange={(e) => set("nombre", soloLetrasNombre(e.target.value, 80))} autoComplete="name" />
            </Campo>
            <Campo etiqueta="Celular" error={err.telefono}>
              <input id="cot-celular" className="field-input" type="tel" inputMode="numeric" pattern="9[0-9]{8}" maxLength={9} value={f.telefono} onChange={(e) => set("telefono", soloDigitos(e.target.value, 9))} placeholder="9XXXXXXXX" autoComplete="tel" />
            </Campo>
            <Campo etiqueta="Sede de atención" error={err.sede}>
              <select className="field-input" value={f.sede} onChange={(e) => set("sede", e.target.value)}>
                {sedes.map((s) => <option key={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
            {/* Modelo y color */}
            <Campo etiqueta={consulta ? "Modelo (opcional)" : "Modelo"} error={err.modelo}>
              <select className="field-input" value={f.modelo} onChange={(e) => set("modelo", e.target.value)} aria-label="Modelo">
                {consulta && <option value="">Aún no lo decido</option>}
                {publicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Color">
              <select className="field-input" value={f.color} onChange={(e) => set("color", e.target.value)} disabled={coloresDe(modelo).length < 2} aria-label="Color" data-colores={coloresDe(modelo).length}>
                {(!modelo || !modelo.colores?.length) && <option value="">{modelo ? "Sin preferencia" : "—"}</option>}
                {coloresDe(modelo).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Campo>
            {!consulta && <>
              <fieldset className="sm:col-span-2">
                <legend className="field-label">Techo <span className="font-normal text-slate-500">(adicional referencial: se suma al precio de la moto)</span></legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Techo">
                  {TECHOS.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={f.techo === t.id} onClick={() => set("techo", t.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${f.techo === t.id ? "border-marino-700 bg-marino-50 ring-1 ring-marino-700 dark:border-white/60 dark:bg-white/10 dark:ring-white/60" : "border-slate-200 hover:border-slate-300 dark:border-white/15"}`}>
                      <span className="block text-[13px] font-semibold leading-tight text-marino dark:text-white">{t.precio ? t.nombre : "Sin techo"}</span>
                      <span className="cifra text-[12px] text-slate-500">{t.precio ? `+ ${formatoSoles(t.precio)}` : "Solo la moto"}</span>
                    </button>
                  ))}
                </div>
                {err.techo && <p className="mt-1.5 text-[12px] font-medium text-acento">{err.techo}</p>}
              </fieldset>
              <Campo etiqueta="Forma de compra">
                <select className="field-input" value={f.pago} onChange={(e) => set("pago", e.target.value)}>
                  <option>Financiamiento</option><option>Pago al contado</option>
                </select>
              </Campo>
              <dl className="grid content-end gap-1 rounded-xl bg-marino-50 px-4 py-3 text-[13px] dark:bg-white/5" data-presupuesto>
                <div className="flex justify-between"><dt className="text-slate-500">Moto</dt><dd className="cifra">{conPrecio ? formatoSoles(modelo.precioDesde) : "A consultar"}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Techo</dt><dd className="cifra">{techo ? formatoSoles(techo.precio) : "—"}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-[15px] font-bold text-marino dark:border-white/10 dark:text-white"><dt>Total referencial</dt><dd className="cifra">{conPrecio ? formatoSoles(total) : "A consultar"}</dd></div>
              </dl>
            </>}
            <Campo etiqueta={consulta ? "Tu consulta" : "¿Algo más que quieras contarnos? (opcional)"} error={err.mensaje} className="sm:col-span-2" ayuda={`${limpiarTexto(f.mensaje).length}/${MAX_MENSAJE}`}>
              <textarea id="cot-mensaje" rows={consulta ? 4 : 2} maxLength={MAX_MENSAJE + 20} className="field-input" value={f.mensaje} onChange={(e) => set("mensaje", e.target.value)} placeholder={consulta ? "Ej: ¿Puedo financiar con 20% de inicial si soy independiente?" : "Ej: me interesa para trabajar como mototaxi"} />
            </Campo>
            {/* Campo trampa para robots: las personas no lo ven */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="cot-empresa">No llenar este campo</label>
              <input id="cot-empresa" tabIndex={-1} autoComplete="off" value={f.trampa} onChange={(e) => set("trampa", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                <input id="cot-acepta" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0e2c52]" checked={f.acepta} onChange={(e) => set("acepta", e.target.checked)} />
                <span>{TEXTO_CONSENTIMIENTO} <button type="button" className="font-semibold text-marino-700 underline-offset-2 hover:underline dark:text-white" aria-expanded={verPolitica} onClick={() => setVerPolitica(!verPolitica)}>{verPolitica ? "Ocultar" : "Cómo usamos tus datos"}</button></span>
              </label>
              {verPolitica && <ul className="mt-2 list-disc space-y-1 rounded-lg bg-slate-50 py-3 pl-9 pr-4 text-[12.5px] text-slate-600 dark:bg-white/5 dark:text-slate-300">{POLITICA_DATOS.map((t) => <li key={t}>{t}</li>)}</ul>}
              {err.acepta && <p className="mt-1 text-[12px] font-medium text-acento">{err.acepta}</p>}
            </div>
            {err.general && <div className="sm:col-span-2"><Aviso tipo="error">{err.general}</Aviso></div>}
            {!consulta && <div className="sm:col-span-2"><Aviso>Precio referencial sin matrícula ni SOAT. El precio final y la disponibilidad los confirma un asesor.</Aviso></div>}
            <button id="cot-enviar" className="btn bg-acento text-white hover:bg-acento-600 sm:col-span-2" type="submit" disabled={guardando}>{guardando ? "Enviando…" : consulta ? "Enviar consulta" : "Enviar solicitud"}</button>
          </form>
        )}
      </Modal>
    </Ctx.Provider>
  );
}
