// Componentes base del panel
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconClose, IconCheck, IconAlert } from "./Icons";

// Insignia fija que agrega la plataforma de publicación («Powered by Netlify»: un iframe fijo abajo a la derecha,
// encima de todo). Se reserva su alto abajo (variable --reserva-insignia) para que no tape los botones del pie de las
// ventanas, los avisos ni el final de la página (QA 16/11, EMT-154: tapaba «Revisar y registrar» en 849×523).
function medirInsignia() {
  if (typeof document === "undefined") return 0;
  const el = document.getElementById("nl-badge-frame") || document.querySelector('iframe[title="Powered by Netlify"]');
  if (!el) return 0;
  const cs = window.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (cs.display === "none" || cs.visibility === "hidden" || !r.width || !r.height || r.top >= window.innerHeight) return 0;
  return Math.max(0, Math.ceil(window.innerHeight - r.top)) + 8;
}
function useReservaInsignia() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let previo = -1;
    const aplicar = () => {
      const px = medirInsignia();
      if (px === previo) return;
      previo = px;
      document.documentElement.style.setProperty("--reserva-insignia", `${px}px`);
    };
    aplicar();
    const obs = typeof MutationObserver !== "undefined" ? new MutationObserver(aplicar) : null;
    obs?.observe(document.body, { childList: true, attributes: true, subtree: false, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", aplicar);
    const t = window.setInterval(aplicar, 2000); // la insignia carga sola y puede cambiar de tamaño
    return () => { obs?.disconnect(); window.removeEventListener("resize", aplicar); window.clearInterval(t); };
  }, []);
}
export const RESERVA_INSIGNIA = "var(--reserva-insignia, 0px)";

// Avisos (toasts)
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  useReservaInsignia();
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tipo = "ok") => {
    const id = Math.random();
    setItems((p) => [...p, { id, msg, tipo }]);
    setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[92vw] max-w-sm -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0" style={{ bottom: `calc(1rem + ${RESERVA_INSIGNIA})` }} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`fade-in pointer-events-auto flex items-start gap-2 rounded-lg px-4 py-3 text-[13.5px] font-medium text-white shadow-lg ${t.tipo === "error" ? "bg-acento" : "bg-marino"}`}>
            <span className="mt-0.5 shrink-0">{t.tipo === "error" ? <IconAlert className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Ventana modal
const PILA = [];
export function Modal({ abierto, onClose, titulo, children, ancho = "max-w-lg", pie, confirmarGuardar, sinAvisoCambios = false }) {
  const ref = useRef(null);
  const sucio = useRef(false);
  const confirmado = useRef(false);
  const formRef = useRef(null);
  const [aviso, setAviso] = useState(null);
  const pideGuardar = confirmarGuardar ?? /^editar/i.test(String(titulo || ""));
  const textos = typeof confirmarGuardar === "object" && confirmarGuardar ? confirmarGuardar : {};

  const pedirCierre = () => {
    if (sucio.current && !sinAvisoCambios) setAviso("salir"); else onClose();
  };
  const cierreRef = useRef(pedirCierre);
  cierreRef.current = pedirCierre;

  useEffect(() => {
    if (!abierto) return;
    sucio.current = false; confirmado.current = false; setAviso(null);
    const yo = {};
    PILA.push(yo);
    const k = (e) => { if (e.key === "Escape" && PILA[PILA.length - 1] === yo) cierreRef.current(); };
    document.addEventListener("keydown", k);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = previo; PILA.splice(PILA.indexOf(yo), 1); };
  }, [abierto]);
  if (!abierto) return null;

  function alEnviar(e) {
    if (!pideGuardar || confirmado.current || e.target.tagName !== "FORM") { confirmado.current = false; return; }
    if (textos.validar && !textos.validar()) return;
    e.preventDefault(); e.stopPropagation();
    formRef.current = e.target; setAviso("guardar");
  }
  function confirmarGuardado() {
    setAviso(null); confirmado.current = true;
    formRef.current?.requestSubmit();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-marino/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && pedirCierre()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} data-modal
        style={{ marginBottom: RESERVA_INSIGNIA, maxHeight: `min(92vh, calc(100vh - 2rem - ${RESERVA_INSIGNIA}))` }}
        className={`fade-in relative flex max-h-[92vh] w-full ${ancho} flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none dark:bg-[#121a2b] sm:rounded-xl2`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-white/10">
          <h2 className="text-[17px] font-bold text-marino dark:text-white">{titulo}</h2>
          <button onClick={pedirCierre} aria-label="Cerrar" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"><IconClose /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5" onChangeCapture={() => { sucio.current = true; }} onSubmitCapture={alEnviar}>{children}</div>
        {pie && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3 dark:border-white/10 dark:bg-white/5">{pie}</div>}
        {aviso && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-white/85 p-6 backdrop-blur-sm dark:bg-[#0b1220]/85">
            <div className="w-full max-w-sm rounded-xl2 border border-slate-200 bg-white p-5 text-center shadow-2xl dark:border-white/10 dark:bg-[#121a2b]">
              <div className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${aviso === "salir" ? "bg-amber-100 text-amber-600" : "bg-marino-50 text-marino-700"}`}><IconAlert className="h-5 w-5" /></div>
              <h3 className="mt-3 text-[16px] font-bold text-marino dark:text-white">{aviso === "salir" ? "Tienes cambios sin guardar" : textos.titulo || "¿Guardar los cambios?"}</h3>
              <p className="mt-1 text-[13.5px] text-slate-500">{aviso === "salir" ? "Si sales ahora se perderá lo que escribiste." : textos.texto || "Los cambios se aplicarán de inmediato y, si corresponde, se verán en la web pública."}</p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" className="btn btn-secondary !py-2" onClick={() => setAviso(null)}>{aviso === "salir" ? "Seguir editando" : "Revisar"}</button>
                {aviso === "salir"
                  ? <button type="button" className="btn !py-2 bg-acento text-white hover:bg-acento-600" onClick={() => { setAviso(null); onClose(); }}>Salir sin guardar</button>
                  : <button type="button" className="btn btn-primary !py-2" onClick={confirmarGuardado}>{textos.boton || "Sí, guardar"}</button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Confirmación
const ConfirmCtx = createContext(async () => true);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [est, setEst] = useState(null);
  const confirmar = useCallback((opts) => new Promise((res) => setEst({ ...opts, res })), []);
  const cerrar = (v) => { est.res(v); setEst(null); };
  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      <Modal abierto={!!est} onClose={() => cerrar(false)} titulo={est?.titulo || "Confirmar"} ancho="max-w-md"
        pie={<>
          <button className="btn btn-secondary !py-2" onClick={() => cerrar(false)}>Cancelar</button>
          <button className={`btn !py-2 ${est?.peligro ? "bg-acento text-white hover:bg-acento-600" : "btn-primary"}`} onClick={() => cerrar(true)}>{est?.boton || "Confirmar"}</button>
        </>}>
        <p className="text-[14.5px] text-slate-600 dark:text-slate-300">{est?.texto}</p>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// Encabezado de página
export function PageHeader({ titulo, subtitulo, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-marino dark:text-white">{titulo}</h1>
        {subtitulo && <p className="mt-1 max-w-2xl text-[14px] text-slate-500">{subtitulo}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Tarjeta
export function Card({ children, className = "", ...resto }) {
  return <div className={`rounded-xl2 border border-slate-100 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#121a2b] sm:p-5 ${className}`} {...resto}>{children}</div>;
}

// Indicador
export function Stat({ etiqueta, valor, nota, tono = "marino" }) {
  const col = { marino: "text-marino dark:text-white", rojo: "text-acento", verde: "text-emerald-600", ambar: "text-amber-600" }[tono];
  return (
    <Card>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className={`cifra mt-1 whitespace-nowrap font-bold tracking-tight ${String(valor).length > 7 ? "text-[1.2rem] min-[380px]:text-2xl" : "text-[1.75rem]"} sm:text-3xl ${col}`}>{valor}</p>
      {nota && <p className="mt-1 text-[12.5px] text-slate-500">{nota}</p>}
    </Card>
  );
}

// Estado vacío
export function Vacio({ titulo, texto, children }) {
  return (
    <div className="rounded-xl2 border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center dark:border-white/10 dark:bg-white/5">
      <h3 className="text-[16px] font-semibold text-marino dark:text-white">{titulo}</h3>
      {texto && <p className="mx-auto mt-1 max-w-md text-[13.5px] text-slate-500">{texto}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// Tabla
export function Tabla({ columnas, children, vacio }) {
  return (
    <div className="overflow-x-auto rounded-xl2 border border-slate-100 bg-white shadow-card dark:border-white/10 dark:bg-[#121a2b]">
      <table className="w-full min-w-[640px] text-left text-[13.5px]">
        <thead className="bg-slate-50 text-[12px] uppercase tracking-wide text-slate-500 dark:bg-white/5">
          <tr>{columnas.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/10">{children}</tbody>
      </table>
      {vacio}
    </div>
  );
}

// Campo de formulario
export function Campo({ etiqueta, children, ayuda, error, className = "" }) {
  return (
    <div className={className}>
      <label className="field-label">{etiqueta}</label>
      {children}
      {ayuda && !error && <p className="mt-1 text-[12px] text-slate-400">{ayuda}</p>}
      {error && <p className="mt-1 text-[12px] font-medium text-acento">{error}</p>}
    </div>
  );
}

// Botones pequeños
export const btnMini = "rounded-md border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-marino-700 transition hover:bg-marino-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/10";
export const btnMiniPeligro = "rounded-md border border-acento/40 px-2.5 py-1 text-[12.5px] font-medium text-acento transition hover:bg-acento/10";

// Aviso
export function Aviso({ tipo = "info", children }) {
  const c = { info: "bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200", aviso: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200", error: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300", ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" }[tipo];
  return <div className={`rounded-lg px-4 py-3 text-[13.5px] ${c}`}>{children}</div>;
}
