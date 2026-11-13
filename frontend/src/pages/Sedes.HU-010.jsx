// HU-010 · Sedes y sucursales
// Localizador de sedes (vienen de la API y se administran en el panel, Ubicaciones), qué vas a ver en la sede
// (motor y chasis de cada modelo según su ficha oficial, y los techos), qué traer y preguntas frecuentes.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../store/appStore.jsx";
import { useCotizar } from "../components/CotizarModal";
import ModeloImg, { motosConFotoDistinta } from "../components/ModeloImg";
import IlustracionTecho from "../components/IlustracionTecho";
import WhatsAppButton from "../components/WhatsAppButton.HU-013";
import { IlustracionDni, IlustracionRecibo, IlustracionCotizacion } from "../components/IlustracionesVisita";
import { IconPhone, IconMail, IconPin, IconFlecha, IconCheck, IconPiston, IconRayo, IconMotor, IconMedidor } from "../components/Icons";
import { enlaceGoogleMaps, enlaceMapaEmbebido, formatoSoles } from "../data/mockData";
import { useTechos } from "../servicios/techos";
import { formatoTelefono, limpiarTelefono } from "../lib/validar";
import { WHATSAPP_NUMERO } from "../lib/config";

// ---------------------------------------------------------------------------------------------
// Contenido fijo de la página
// ---------------------------------------------------------------------------------------------
const SERVICIOS = ["Venta de unidades", "Crédito directo", "Trámite de placa", "Entrega de unidades"];

const REQUISITOS = [
  { Ilustracion: IlustracionDni, t: "DNI vigente", d: "Del titular de la compra." },
  { Ilustracion: IlustracionRecibo, t: "Recibo de servicios", d: "De luz o agua, para evaluar tu crédito directo." },
  { Ilustracion: IlustracionCotizacion, t: "Tu cotización", d: "La que enviaste por WhatsApp, para que tu asesor la tenga a la mano." },
];

const PREGUNTAS = [
  ["¿Qué necesito para el crédito directo?", "Tu DNI y un recibo de servicios. Con eso evaluamos tu historial crediticio y te proponemos cuotas a tu medida."],
  ["¿Puedo avisar antes de ir?", "Sí. Escríbenos por WhatsApp y un asesor te espera con el modelo que te interesa."],
  ["¿Cuánto demora la entrega?", "Depende del modelo, del color y del techo elegido. Tu asesor te confirma la fecha al cerrar la compra."],
  ["¿Me ayudan con la placa y la tarjeta de propiedad?", "Sí. Gestionamos ante Sunarp la placa y la tarjeta de propiedad con la compra de tu Torito nuevo."],
];

// Techos que se eligen al cotizar: el catálogo único (servicios/techos.js)
const DESCRIPCION_TECHO = {
  ninguno: "Solo la moto, para que armes el techo a tu manera.",
  lona: "Cubierta de lona sobre estructura metálica.",
  clasico: "Techo de fibra de línea clásica.",
  equipado: "Techo de fibra clásica con su equipamiento completo.",
  deportivo: "Techo de fibra de línea deportiva.",
};

// Qué significa cada dato del motor y del chasis
const GLOSARIO = [
  ["Potencia (HP)", "Qué tan rápido gana velocidad. Más HP, más agilidad con pasajeros a bordo."],
  ["Torque (Nm)", "La fuerza para arrancar y subir pendientes con carga completa."],
  ["Cilindrada (cc)", "El tamaño del motor. Influye en la fuerza y en el consumo."],
  ["Reversa", "Todas las versiones traen 4 marchas y 1 reversa para maniobrar y estacionar."],
];

// ---------------------------------------------------------------------------------------------
// ¿Abierto ahora? Lee horarios como «Lunes a Sábado de 9:00 AM a 5:00 PM» (hora de Lima).
// Si el horario tiene otro formato, devuelve null y no se muestra nada.
// ---------------------------------------------------------------------------------------------
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIA_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const minutos = (h, m, sufijo) => {
  let hora = Number(h) % 24;
  if (sufijo === "pm" && hora < 12) hora += 12;
  if (sufijo === "am" && hora === 12) hora = 0;
  return hora * 60 + Number(m || 0);
};
function estadoHorario(horario, ahora = new Date()) {
  const t = String(horario || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\./g, "").replace(/\b([ap]) m\b/g, "$1m").replace(/\s+/g, " ").trim();
  if (!t || /[,;]| y /.test(t)) return null;
  const d = /(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s? (?:a|al|-) (domingo|lunes|martes|miercoles|jueves|viernes|sabado)/.exec(t);
  if (!d) return null;
  const h = /(\d{1,2})(?::(\d{2}))? ?(am|pm)? ?(?:a|-|hasta) ?(\d{1,2})(?::(\d{2}))? ?(am|pm)?/.exec(t.slice(d.index + d[0].length));
  if (!h) return null;
  const desde = minutos(h[1], h[2], h[3]);
  let hasta = minutos(h[4], h[5], h[6]);
  if (hasta <= desde && !h[6]) hasta += 12 * 60;
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(ahora);
    const dia = DIA_EN.indexOf(p.find((x) => x.type === "weekday")?.value);
    const ya = minutos(p.find((x) => x.type === "hour")?.value, p.find((x) => x.type === "minute")?.value);
    const ini = DIAS.indexOf(d[1]);
    const fin = DIAS.indexOf(d[2]);
    const diaOk = ini <= fin ? dia >= ini && dia <= fin : dia >= ini || dia <= fin;
    return { abierto: diaOk && ya >= desde && ya < hasta };
  } catch { return null; }
}

// Datos de la ficha técnica de un modelo
const fila = (m, grupo, inicio) => (m.specs?.[grupo] || []).find(([k]) => k.toLowerCase().startsWith(inicio))?.[1] || "";
const numero = (texto, unidad) => new RegExp(`([\\d.,]+)\\s*${unidad}`, "i").exec(texto || "")?.[1] || "";
const telefonoVisible = (t) => (limpiarTelefono(t).startsWith("9") ? `+51 ${formatoTelefono(t)}` : formatoTelefono(t));

export default function Sedes() {
  const { sedes, publicos } = useApp();
  const cotizar = useCotizar();
  const TECHOS = useTechos();
  const motos = motosConFotoDistinta(publicos, 3);

  return (
    <div className="fade-in">
      {/* ------------------------------------------------------------------------------------- */}
      {/* Presentación: vitrina con tres modelos                                                */}
      {/* ------------------------------------------------------------------------------------- */}
      <section className="relative overflow-hidden bg-marino text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-acento/20 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-white/5 blur-2xl" aria-hidden="true" />
        <div className="wrap relative grid gap-8 pb-14 pt-14 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:pb-20">
          <div>
            <p className="text-[15px] font-medium text-white/60">Visítanos</p>
            <h1 className="mt-2 font-display text-[3.2rem] font-bold uppercase leading-[0.9] tracking-tight sm:text-[4.5rem]">Sedes y sucursales</h1>
            <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-white/75">Conoce las unidades en persona, elige tu techo y evalúa tu crédito directo. Estamos en Lima Norte y el Callao.</p>
            <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
              <a href={`https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent("Hola, quisiera coordinar una visita a una sede de EPSA Motor.")}`} target="_blank" rel="noopener noreferrer" className="btn btn-whatsapp">Coordinar visita por WhatsApp</a>
              <a href="#localizador" className="btn btn-claro">Buscar mi sede</a>
            </div>
            <dl className="mt-9 flex flex-wrap gap-x-10 gap-y-4">
              {[sedes.length ? [String(sedes.length), sedes.length === 1 ? "sede" : "sedes"] : null, publicos.length ? [String(publicos.length), "modelos para ver"] : null, ["+12", "años en el mercado"]].filter(Boolean).map(([n, t]) => (
                <div key={t}><dt className="sr-only">{t}</dt><dd><span className="cifra block font-display text-[2.4rem] font-bold leading-none">{n}</span><span className="text-[13px] text-white/60">{t}</span></dd></div>
              ))}
            </dl>
          </div>
          {motos.length > 0 && (
            <div className="relative mx-auto h-56 w-full max-w-[640px] sm:h-80 lg:h-[400px]" data-vitrina-sedes>
              <div className="absolute inset-x-[4%] bottom-[7%] h-[14%] rounded-[50%] bg-black/40 blur-2xl" aria-hidden="true" />
              {motos[1] && <ModeloImg modelo={motos[1]} className="absolute bottom-[11%] left-0 h-[58%] w-[44%] object-contain opacity-80 drop-shadow-[0_18px_22px_rgba(0,0,0,.4)]" />}
              {motos[2] && <ModeloImg modelo={motos[2]} className="absolute bottom-[11%] right-0 h-[58%] w-[44%] object-contain opacity-80 drop-shadow-[0_18px_22px_rgba(0,0,0,.4)]" />}
              <ModeloImg modelo={motos[0]} className="absolute bottom-[4%] left-1/2 z-10 h-[84%] w-[62%] -translate-x-1/2 object-contain drop-shadow-[0_30px_36px_rgba(0,0,0,.5)]" />
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------------------------- */}
      {/* Localizador de sedes                                                                  */}
      {/* ------------------------------------------------------------------------------------- */}
      <section id="localizador" className="wrap scroll-mt-24 py-14 lg:py-16">
        {sedes.length === 0
          ? <p className="rounded-2xl border-2 border-dashed border-slate-300 py-12 text-center text-slate-500 dark:border-white/15">No hay sedes activas por el momento. Escríbenos por WhatsApp y te atendemos.</p>
          : <Localizador sedes={sedes} cotizar={cotizar} />}
      </section>

      {/* ------------------------------------------------------------------------------------- */}
      {/* Motor y chasis de cada modelo                                                         */}
      {/* ------------------------------------------------------------------------------------- */}
      <MotorChasis publicos={publicos} cotizar={cotizar} />

      {/* ------------------------------------------------------------------------------------- */}
      {/* Techos                                                                                */}
      {/* ------------------------------------------------------------------------------------- */}
      <section className="bg-escenario py-16 dark:bg-escenario-oscuro lg:py-20" aria-labelledby="sedes-techos">
        <div className="wrap">
          <h2 id="sedes-techos" className="titulo">Elige tu techo</h2>
          <p className="bajada mt-3">El techo se elige al cotizar y se instala en la preparación de tu unidad, antes de la entrega. En la sede ves los acabados reales.</p>
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
            {TECHOS.map((t) => (
              <li key={t.id} className="group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.04] transition hover:-translate-y-0.5 hover:shadow-cardHover dark:bg-[#101c33] dark:ring-white/10" data-techo={t.id}>
                <div className="bg-gradient-to-b from-white to-escenario px-2 pt-4 dark:from-[#16294a] dark:to-[#101c33]">
                  <IlustracionTecho tipo={t.id} nombre={t.nombre} className="w-full transition duration-500 group-hover:scale-[1.03]" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="font-display text-[1.35rem] font-bold uppercase leading-none text-marino dark:text-white">{t.precio ? t.nombre : "Sin techo"}</h3>
                  <p className="mt-1.5 flex-1 text-[13.5px] leading-snug text-slate-600 dark:text-slate-300">{DESCRIPCION_TECHO[t.id]}</p>
                  <p className="mt-3 text-[13px] text-slate-500">{t.precio ? <>Suma <b className="cifra text-marino dark:text-white">{formatoSoles(t.precio)}</b> a tu Torito</> : "No suma al precio"}</p>
                  <button type="button" onClick={() => cotizar({ techo: t.id })} className="mt-3 w-fit text-[13.5px] font-semibold text-acento underline-offset-4 hover:underline dark:text-red-300">Cotizar con este techo</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] text-slate-500">Ilustraciones referenciales.</p>
        </div>
      </section>

      {/* ------------------------------------------------------------------------------------- */}
      {/* Qué traer a tu visita                                                                 */}
      {/* ------------------------------------------------------------------------------------- */}
      <section className="wrap py-16 lg:py-20" aria-labelledby="sedes-traer">
        <h2 id="sedes-traer" className="titulo">Qué traer a tu visita</h2>
        <p className="bajada mt-3">Con esto evaluamos tu crédito y avanzamos tu compra en la sede.</p>
        <div className="mt-9 grid gap-5 sm:grid-cols-3">
          {REQUISITOS.map(({ Ilustracion, t, d }) => (
            <div key={t} className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-black/[0.03] dark:bg-[#121a2b] dark:ring-white/5" data-requisito={t}>
              <div className="aspect-[12/7] bg-gradient-to-br from-escenario to-marino-50 px-4 pt-3 dark:from-white/[0.04] dark:to-white/[0.08]"><Ilustracion /></div>
              <div className="p-5">
                <h3 className="font-bold text-marino dark:text-white">{t}</h3>
                <p className="mt-1 text-[14px] text-slate-500">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------------------------- */}
      {/* Preguntas frecuentes                                                                  */}
      {/* ------------------------------------------------------------------------------------- */}
      <Preguntas cotizar={cotizar} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Localizador: lista de sedes (se recorre con flechas), mapa y acciones de la sede elegida
// ---------------------------------------------------------------------------------------------
function Localizador({ sedes, cotizar }) {
  const [sel, setSel] = useState(0);
  const [mapaListo, setMapaListo] = useState("");
  const [copiada, setCopiada] = useState("");
  const botones = useRef([]);
  const s = sedes[Math.min(sel, sedes.length - 1)];

  function teclas(e, i) {
    const paso = ["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : ["ArrowUp", "ArrowLeft"].includes(e.key) ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const j = (i + paso + sedes.length) % sedes.length;
    setSel(j);
    botones.current[j]?.focus();
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(s.direccion); setCopiada(s.id); setTimeout(() => setCopiada(""), 2000); } catch { /* sin permiso: no pasa nada */ }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(300px,380px)_1fr] lg:gap-8">
      {/* Lista: en celular se desliza de lado; en computadora es una columna */}
      <div className="min-w-0">
        <h2 className="titulo-sm">Elige tu sede</h2>
        <div role="tablist" aria-label="Sedes" aria-orientation="vertical"
          className="no-scrollbar -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:space-y-3 lg:overflow-visible lg:px-0">
          {sedes.map((x, i) => {
            const activa = s?.id === x.id;
            const estado = estadoHorario(x.horario);
            return (
              <button key={x.id} ref={(el) => { botones.current[i] = el; }} type="button" role="tab" aria-selected={activa} tabIndex={activa ? 0 : -1}
                onClick={() => setSel(i)} onKeyDown={(e) => teclas(e, i)} data-sede={x.nombre}
                className={`relative w-[80%] shrink-0 snap-start overflow-hidden rounded-2xl border p-4 text-left transition sm:w-[46%] lg:w-full ${activa ? "border-marino bg-marino text-white shadow-cardHover dark:border-white/40 dark:bg-white/10" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-card dark:border-white/10 dark:bg-[#121a2b]"}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className={`font-display text-[1.45rem] font-bold uppercase leading-none ${activa ? "text-white" : "text-marino dark:text-white"}`}>Sede {x.nombre}</span>
                  {estado && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${estado.abierto ? "bg-emerald-100 text-emerald-700" : activa ? "bg-white/15 text-white/80" : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60"}`}>{estado.abierto ? "Abierto ahora" : "Cerrado ahora"}</span>}
                </span>
                {x.direccion && <span className={`mt-2 line-clamp-2 block text-[13.5px] ${activa ? "text-white/75" : "text-slate-500"}`}>{x.direccion}</span>}
                {x.horario && <span className={`mt-1 block text-[12.5px] ${activa ? "text-white/60" : "text-slate-400"}`}>{x.horario}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sede elegida: mapa, datos y acciones */}
      {s && (
        <div key={s.id} className="fade-in min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-card dark:border-white/10 dark:bg-[#121a2b]" role="tabpanel" aria-label={`Sede ${s.nombre}`}>
          {s.direccion && (
            <div className="relative h-64 bg-escenario dark:bg-escenario-oscuro sm:h-80 lg:h-96">
              {mapaListo !== s.id && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-100 to-slate-200 dark:from-white/5 dark:to-white/10" aria-hidden="true" />}
              <iframe title={`Mapa de la sede ${s.nombre}`} src={enlaceMapaEmbebido(s.direccion)} onLoad={() => setMapaListo(s.id)} loading="lazy"
                className={`relative h-full w-full border-0 transition-opacity duration-500 ${mapaListo === s.id ? "opacity-100" : "opacity-0"}`} />
              <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-marino px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-card"><IconPin className="h-3.5 w-3.5 text-red-300" /> Sede {s.nombre}</span>
              <a href={enlaceGoogleMaps(s.direccion)} target="_blank" rel="noopener noreferrer" className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12.5px] font-semibold text-marino shadow-cardHover transition hover:bg-marino-50">Abrir en Google Maps <IconFlecha className="h-3.5 w-3.5" /></a>
            </div>
          )}
          <div className="grid gap-8 p-6 md:grid-cols-[1.1fr_1fr] lg:p-8">
            <div>
              <h2 className="font-display text-[2.2rem] font-bold uppercase leading-none tracking-tight text-marino dark:text-white">Sede {s.nombre}</h2>
              {s.direccion && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-slate-600 dark:text-slate-300">
                  {s.direccion}
                  <button type="button" onClick={copiar} className="text-[12.5px] font-semibold text-marino-700 underline-offset-2 hover:underline dark:text-white/80" data-copiar-direccion>{copiada === s.id ? "Dirección copiada" : "Copiar dirección"}</button>
                </p>
              )}
              {s.horario && <p className="mt-4 text-[14px] font-semibold text-marino dark:text-white">{s.horario}</p>}
              {s.horarioNota && <p className="text-[13px] text-slate-500">{s.horarioNota}</p>}
              {(s.telefono || s.correo) && (
                <div className="mt-4 space-y-2 text-[14px] text-slate-600 dark:text-slate-300">
                  {s.telefono && <a href={`tel:+51${limpiarTelefono(s.telefono)}`} className="flex w-fit items-center gap-2 hover:text-marino dark:hover:text-white"><IconPhone className="h-4 w-4 text-acento" /> {telefonoVisible(s.telefono)}</a>}
                  {s.correo && <a href={`mailto:${s.correo}`} className="flex w-fit items-center gap-2 break-all hover:text-marino dark:hover:text-white"><IconMail className="h-4 w-4 shrink-0 text-acento" /> {s.correo}</a>}
                </div>
              )}
              <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2.5">
                {SERVICIOS.map((x) => <li key={x} className="flex items-center gap-2 text-[13.5px] text-slate-600 dark:text-slate-300"><IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />{x}</li>)}
              </ul>
            </div>
            <div className="grid content-start gap-3">
              {s.direccion && <a href={enlaceGoogleMaps(s.direccion)} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Cómo llegar</a>}
              <button type="button" onClick={() => cotizar({ sede: s.nombre })} className="btn btn-acento">Cotizar en esta sede</button>
              <WhatsAppButton mensaje={`Hola, quisiera visitar la sede de ${s.nombre}.`} />
              <button type="button" onClick={() => cotizar({ tipo: "consulta", sede: s.nombre })} className="mt-1 text-[13.5px] font-semibold text-marino-700 underline-offset-2 hover:underline dark:text-white/80">Escribir una consulta a esta sede</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Motor y chasis: se elige un modelo y se ven sus datos clave y su ficha resumida
// ---------------------------------------------------------------------------------------------
function MotorChasis({ publicos, cotizar }) {
  const [id, setId] = useState("");
  const conFicha = publicos.filter((m) => m.specs?.motor?.length);
  if (!conFicha.length) return null;
  const m = conFicha.find((x) => x.id === id) || conFicha[0];
  const cifras = [
    { Icono: IconPiston, valor: numero(fila(m, "motor", "cilindrada"), "cc"), unidad: "cc", etiqueta: "Cilindrada" },
    { Icono: IconRayo, valor: numero(fila(m, "motor", "potencia"), "HP"), unidad: "HP", etiqueta: "Potencia" },
    { Icono: IconMotor, valor: numero(fila(m, "motor", "torque"), "Nm"), unidad: "Nm", etiqueta: "Torque" },
    { Icono: IconMedidor, valor: numero(fila(m, "consumo", "velocidad"), "km/h"), unidad: "km/h", etiqueta: "Velocidad máxima" },
  ].filter((c) => c.valor);
  const motor = m.specs.motor.filter(([k]) => !/^(cilindrada|potencia|torque|diámetro)/i.test(k));
  const chasis = [...(m.specs.chasis || []), ...(m.specs.dimensiones || []).filter(([k]) => /^peso/i.test(k))];

  return (
    <section className="wrap pb-16 lg:pb-24" aria-labelledby="sedes-motor">
      <h2 id="sedes-motor" className="titulo">Conoce tu Torito por dentro</h2>
      <p className="bajada mt-3">Motor y chasis de cada modelo según su ficha oficial. En la sede te los mostramos en persona.</p>

      {/* Modelos */}
      <div role="tablist" aria-label="Modelo" className="no-scrollbar -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {conFicha.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === m.id} onClick={() => setId(x.id)} data-ficha-modelo={x.id}
            className={`shrink-0 rounded-full border px-4 py-2 text-[13.5px] font-semibold transition ${x.id === m.id ? "border-marino bg-marino text-white dark:border-white dark:bg-white dark:text-marino" : "border-slate-300 text-slate-600 hover:border-marino-700 hover:text-marino dark:border-white/15 dark:text-white/80"}`}>
            {x.nombre}
          </button>
        ))}
      </div>

      <div key={m.id} className="fade-in mt-6 grid gap-8 rounded-[28px] [&>*]:min-w-0 border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101c33] sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12" role="tabpanel">
        {/* Foto y datos del modelo */}
        <div>
          <div className="relative grid h-60 place-items-center overflow-hidden rounded-2xl bg-escenario dark:bg-escenario-oscuro sm:h-80">
            <div className="absolute inset-x-[18%] bottom-6 h-6 rounded-[50%] bg-marino/15 blur-md dark:bg-black/40" aria-hidden="true" />
            <ModeloImg modelo={m} className="relative h-[86%] w-[86%] object-contain" />
          </div>
          <p className="mt-5 text-[13px] text-slate-500">{[m.familia, m.combustible].filter(Boolean).join(", ")}</p>
          <h3 className="font-display text-[2rem] font-bold uppercase leading-none text-marino dark:text-white">{m.nombre}</h3>
          {m.precioDesde ? <p className="mt-2 text-[14px] text-slate-600 dark:text-slate-300">Desde <b className="cifra text-marino dark:text-white">{formatoSoles(m.precioDesde)}</b></p> : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={`/modelos/${m.id}`} className="btn btn-secondary !py-2.5">Ver ficha completa</Link>
            <button type="button" onClick={() => cotizar({ modeloId: m.id })} className="btn btn-acento !py-2.5">Cotizar</button>
          </div>
        </div>

        {/* Cifras clave y ficha resumida */}
        <div>
          {cifras.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {cifras.map(({ Icono, valor, unidad, etiqueta }) => (
                <li key={etiqueta} className="rounded-2xl bg-escenario p-4 dark:bg-white/[0.04]">
                  <Icono className="h-5 w-5 text-acento dark:text-red-300" />
                  <p className="mt-3 whitespace-nowrap font-display text-[1.65rem] font-bold leading-none text-marino xl:text-[1.9rem] dark:text-white"><span className="cifra">{valor}</span> <span className="text-[0.95rem]">{unidad}</span></p>
                  <p className="mt-1 text-[12.5px] text-slate-500">{etiqueta}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            {[["Motor", motor], ["Chasis", chasis]].filter(([, filas]) => filas.length).map(([titulo, filas]) => (
              <div key={titulo}>
                <h4 className="border-b-2 border-acento pb-2 text-[15px] font-bold text-marino dark:text-white">{titulo}</h4>
                <dl className="divide-y divide-slate-100 dark:divide-white/10">
                  {filas.map(([k, v]) => (
                    <div key={k} className="py-2.5">
                      <dt className="text-[12.5px] text-slate-500">{k}</dt>
                      <dd className="text-[14px] font-medium text-marino dark:text-white">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Qué significa cada dato */}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {GLOSARIO.map(([t, d]) => (
          <li key={t} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-[14.5px] font-semibold text-marino dark:text-white">{t}</p>
            <p className="mt-1 text-[13.5px] leading-snug text-slate-600 dark:text-slate-300">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Preguntas frecuentes
// ---------------------------------------------------------------------------------------------
function Preguntas({ cotizar }) {
  const [abierta, setAbierta] = useState(0);
  return (
    <section className="bg-marino-50 py-16 dark:bg-white/[0.03] lg:py-20" aria-labelledby="sedes-preguntas">
      <div className="wrap max-w-4xl">
        <h2 id="sedes-preguntas" className="titulo text-center">Preguntas frecuentes</h2>
        <div className="mt-8 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-card dark:divide-white/10 dark:border-white/5 dark:bg-[#121a2b]">
          {PREGUNTAS.map(([p, r], i) => (
            <div key={p}>
              <button type="button" onClick={() => setAbierta(abierta === i ? -1 : i)} aria-expanded={abierta === i} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-marino dark:text-white">
                {p}<span className={`text-xl text-acento transition ${abierta === i ? "rotate-45" : ""}`} aria-hidden="true">+</span>
              </button>
              {abierta === i && <p className="fade-in px-5 pb-4 text-[14.5px] text-slate-600 dark:text-slate-300">{r}</p>}
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[14px] text-slate-500">¿No encontraste tu respuesta? <button type="button" className="font-semibold text-marino-700 underline-offset-2 hover:underline dark:text-white" onClick={() => cotizar({ tipo: "consulta" })}>Envíanos tu consulta</button> y un asesor te responde.</p>
      </div>
    </section>
  );
}
