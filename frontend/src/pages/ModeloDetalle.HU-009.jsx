// HU-009 · Ficha del modelo · HU-036: fotos de la galería
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useApp } from "../store/appStore.jsx";
import { BloqueCatalogo } from "../components/EstadoCatalogo";
import { useCotizar } from "../components/CotizarModal";
import { OPCIONES_TECHO, SIN_TECHO, CUOTAS_INICIAL, PLAZOS, COLOR_HEX, formatoSoles } from "../data/mockData";
import ModeloImg from "../components/ModeloImg";
import FichaTecnica from "../components/FichaTecnica";
import WhatsAppButton from "../components/WhatsAppButton.HU-013";
import { IconCheck, IconLlanta, IconMedidor, IconMotor, IconPiston, IconRayo } from "../components/Icons";
import { ProductoNoDisponible } from "./Errores";
import { TarjetaModelo } from "./Modelos.HU-008";
import { MODO_REAL } from "../lib/config";
import { modeloPublicadoApi } from "../lib/api";

const TECHOS = [SIN_TECHO, ...OPCIONES_TECHO];
const INCLUYE = [
  ["Garantía oficial", "Unidad nueva con la garantía de la marca."],
  ["Trámite de placa", "Te acompañamos con la placa y la tarjeta de propiedad."],
  ["Crédito directo", "Cuotas a tu medida; evaluamos tu crédito con tu DNI y un recibo de servicios."],
  ["Techo a tu elección", "Lo eliges al cotizar y se instala antes de la entrega."],
];
const CLAVES = [["Motor", IconMotor], ["Cilindrada", IconPiston], ["Llantas", IconLlanta], ["Potencia", IconRayo], ["Torque", IconMedidor]];

export default function ModeloDetalleRuta() {
  const { id } = useParams();
  return <ModeloDetalle key={id} id={id} />;
}

// Página del modelo
function ModeloDetalle({ id }) {
  const { modelo: buscar, publicos, catalogo } = useApp();
  const cotizar = useCotizar();
  const m = publicos.find((x) => x.id === id);
  // Con la base conectada, el nombre de un modelo retirado no se toma de los datos de demostración
  const retirado = !m && !MODO_REAL ? buscar(id) : null;
  const [color, setColor] = useState("");
  const [foto, setFoto] = useState(null);
  const [techo, setTecho] = useState(SIN_TECHO.id);
  const [inicial, setInicial] = useState(30);
  const [plazo, setPlazo] = useState(24);
  const [ficha, setFicha] = useState(null); const [despublicado, setDespublicado] = useState(false);
  useEffect(() => {
    if (!MODO_REAL || !m?.codmodApi) return undefined;
    let vivo = true;
    modeloPublicadoApi(m.codmodApi).then((r) => vivo && setFicha(r.data || null)).catch((e) => { if (vivo && e.status === 404 && !e.detalle?.sinRuta) setDespublicado(true); });
    return () => { vivo = false; };
  }, [m?.codmodApi]); // eslint-disable-line

  // Mientras llega el catálogo de la base (o si falla), no se dice todavía que el modelo no está disponible
  if (!m && catalogo?.estado !== "listo") return <div className="wrap py-16"><BloqueCatalogo n={1} className="mx-auto grid max-w-xl gap-6">{null}</BloqueCatalogo></div>;
  if (!m || despublicado) return <ProductoNoDisponible nombre={m?.nombre || retirado?.nombre} />;

  const desc = ficha?.desmod && !m.editadoEnPanel ? ficha.desmod : m.descripcion;
  const conPrecio = Number(m.precioDesde) > 0;
  const colores = m.colores?.length ? m.colores : [];
  const colorSel = color || colores[0] || "";
  const t = TECHOS.find((o) => o.id === techo);
  const total = (Number(m.precioDesde) || 0) + (t?.precio || 0);
  const montoInicial = Math.round((total * inicial) / 100);
  const cuota = Math.round((total - montoInicial) / plazo);
  const relacionados = publicos.filter((x) => x.id !== m.id && x.familia === m.familia).concat(publicos.filter((x) => x.id !== m.id && x.familia !== m.familia)).slice(0, 4);
  const pedir = () => cotizar({ modeloId: m.id, color: colorSel, techo });

  return (
    <div className="fade-in">
      {/* Producto: foto, colores, techo y precio */}
      <section className="border-b border-slate-200 dark:border-white/10">
        <div className="wrap py-6 lg:py-10">
          <nav aria-label="Ruta de navegación" className="text-[13.5px] text-slate-500">
            <Link to="/modelos" className="hover:text-marino hover:underline dark:hover:text-white">Modelos</Link> <span aria-hidden="true">/</span> {m.familia} <span aria-hidden="true">/</span> <span className="text-slate-700 dark:text-slate-300">{m.nombre}</span>
          </nav>

          <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-14">
            <div className="min-w-0">
              <div className="relative overflow-hidden rounded-3xl bg-escenario p-4 sm:p-8 dark:bg-escenario-oscuro">
                <div className="pointer-events-none absolute inset-x-[15%] bottom-[10%] h-[12%] rounded-[50%] bg-marino/10 blur-2xl dark:bg-black/40" aria-hidden="true" />
                {foto ? <img src={foto.src} alt={`${m.nombre}${foto.color ? ` color ${foto.color}` : ""}`} referrerPolicy="no-referrer" className="relative mx-auto aspect-[4/3] w-full object-contain" />
                  : <ModeloImg modelo={m} color={color || (m.sinTinte ? undefined : colorSel)} className="relative mx-auto aspect-[4/3] w-full object-contain" />}
              </div>
              {(m.galeria || []).length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Más fotos" data-galeria-web>
                  {m.galeria.map((g, i) => (
                    <button key={g.id || g.src} role="listitem" onClick={() => setFoto(foto?.src === g.src ? null : g)} aria-pressed={foto?.src === g.src} aria-label={`Ver foto ${i + 1}${g.color ? ` en ${g.color}` : ""}`}
                      className={`grid h-16 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-escenario p-1 ring-2 transition dark:bg-escenario-oscuro ${foto?.src === g.src ? "ring-marino-700 dark:ring-white" : "ring-transparent hover:ring-slate-300"}`}>
                      <img src={g.src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
              )}
              {colores.length > 0 && <div className="mt-5 flex flex-wrap items-center gap-4">
                <p className="text-[14px] text-slate-500">{colores.length > 1 ? "Color" : "Disponible en"} <span className="font-semibold text-marino dark:text-white">{colorSel}</span></p>
                <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colores disponibles">
                  {colores.map((c) => (
                    <button key={c} role="radio" onClick={() => { setColor(c); setFoto(null); }} aria-label={`Color ${c}`} aria-checked={colorSel === c} title={c} disabled={colores.length === 1}
                      className={`h-9 w-9 rounded-full border-2 transition disabled:cursor-default ${colorSel === c ? "scale-110 border-white ring-2 ring-marino-700 dark:ring-white" : "border-white/70 ring-1 ring-slate-300 hover:scale-105 dark:ring-white/20"}`} style={{ background: COLOR_HEX[c] || "#94a3b8" }} />
                  ))}
                </div>
              </div>}
              <p className="mt-2 text-[12.5px] text-slate-400">Foto referencial{colores.length > 1 ? `. Disponible en ${colores.length} colores.` : colores.length ? "." : ". Consulta los colores disponibles con tu asesor."}</p>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                {(m.badges || []).slice(0, 1).map((b) => <span key={b} className={`rounded-md px-2.5 py-1 text-[11.5px] font-bold tracking-wide text-white ${b.startsWith("NUEVO") ? "bg-acento" : "bg-marino-700"}`}>{b}</span>)}
              </div>
              <p className="mt-4 text-[15px] font-medium text-slate-500">{m.familia}</p>
              <h1 className="font-display text-[3rem] font-bold uppercase leading-[0.9] tracking-tight text-marino sm:text-[4.25rem] dark:text-white">{m.nombre}</h1>
              <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-slate-600 dark:text-slate-300">{desc}</p>

              <div className="mt-7 flex flex-wrap items-end gap-x-5 gap-y-2">
                <div>
                  <p className="text-[13px] font-medium text-slate-500">{conPrecio ? "Desde" : "Precio"}</p>
                  <p className="cifra font-display text-[3.25rem] font-bold leading-none text-marino dark:text-white">{formatoSoles(m.precioDesde)}</p>
                </div>
                <p className="max-w-[16rem] pb-1 text-[12px] leading-snug text-slate-400">{conPrecio ? "Precio de la moto sin techo. No incluye matrícula ni SOAT; puede variar por zona." : "Pide tu cotización y un asesor te confirma el precio."}</p>
              </div>
              <div className="mt-6 rounded-2xl border border-slate-200 p-4 dark:border-white/10">
                <p className="text-[13.5px] font-semibold text-marino dark:text-white">Techo de fibra <span className="font-normal text-slate-500">· adicional, se suma al precio</span></p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Techo adicional">
                  {TECHOS.map((o) => (
                    <button key={o.id} type="button" role="radio" aria-checked={techo === o.id} onClick={() => setTecho(o.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${techo === o.id ? "border-marino-700 bg-marino-50 dark:border-white/50 dark:bg-white/10" : "border-slate-200 hover:border-slate-300 dark:border-white/10"}`}>
                      <span className="block text-[13px] font-semibold leading-tight text-marino dark:text-white">{o.id === SIN_TECHO.id ? "Sin techo" : o.nombre}</span>
                      <span className="cifra text-[12px] text-slate-500">{o.precio ? `+ ${formatoSoles(o.precio)}` : "S/ 0"}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3 text-[14px] dark:border-white/10">
                  <span className="text-slate-500">Total {t?.precio ? `con techo ${t.nombre.toLowerCase()}` : "sin techo"}</span>
                  <span className="cifra font-display text-[1.9rem] font-bold leading-none text-marino dark:text-white" data-total-ficha>{conPrecio ? formatoSoles(total) : "A consultar"}</span>
                </p>
              </div>
              <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
                <button onClick={pedir} className="btn btn-acento">Quiero que me contacten</button>
                <WhatsAppButton mensaje={`Hola, quisiera información sobre el ${m.nombre}${colorSel ? ` en color ${colorSel}` : ""}${t?.precio ? ` con techo ${t.nombre}` : ""}.`} />
              </div>

              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-slate-200 pt-6 sm:grid-cols-4 dark:border-white/10">
                {CLAVES.filter(([k]) => k !== "Motor").map(([k, Icono]) => (
                  <div key={k}>
                    <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><Icono className="h-4 w-4" />{k}</dt>
                    <dd className="mt-1 font-display text-[21px] font-bold leading-tight text-marino dark:text-white">{m.resumen?.[k] || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* Ficha técnica */}
      <section className="wrap py-14 lg:py-20">
        <h2 className="titulo">Detalles técnicos</h2>
        <p className="bajada mt-3">Las barras comparan este modelo con el resto de la línea Torito que ofrecemos.</p>
        {(m.destacados || []).length > 0 && (
          <ul className="mt-7 grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {m.destacados.map((d) => <li key={d} className="flex gap-2.5 text-[14.5px] leading-snug text-slate-600 dark:text-slate-300"><IconCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-acento" />{d}</li>)}
          </ul>
        )}
        <div className="mt-8"><FichaTecnica modelo={m} todos={publicos} /></div>
      </section>

      {/* Inversión y financiamiento */}
      <section className="wrap grid gap-12 py-14 lg:grid-cols-[1fr_1.1fr] lg:py-20">
        <div>
          <h2 className="titulo">Tu {m.nombre} incluye</h2>
          <ul className="mt-8 divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
            {INCLUYE.map(([titulo, d]) => (
              <li key={titulo} className="flex gap-4 py-4">
                <IconCheck className="mt-0.5 h-5 w-5 shrink-0 text-acento" />
                <div><p className="font-semibold text-marino dark:text-white">{titulo}</p><p className="text-[14px] text-slate-500">{d}</p></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-slate-200 p-6 sm:p-8 dark:border-white/10">
          <h2 className="titulo-sm">Calcula tu inversión</h2>
          <div className="mt-6 space-y-6">
            <fieldset>
              <legend className="field-label">Techo adicional</legend>
              <div className="grid grid-cols-2 gap-2">
                {TECHOS.map((o) => (
                  <button key={o.id} type="button" onClick={() => setTecho(o.id)} aria-pressed={techo === o.id}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${techo === o.id ? "border-marino-700 bg-marino-50 dark:border-white/50 dark:bg-white/10" : "border-slate-200 hover:border-slate-300 dark:border-white/10"}`}>
                    <span className="block text-[14px] font-semibold text-marino dark:text-white">{o.id === SIN_TECHO.id ? "Sin techo" : o.nombre}</span>
                    <span className="cifra text-[12.5px] text-slate-500">{o.precio ? `+ ${formatoSoles(o.precio)}` : "S/ 0"}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="field-label">Cuota inicial</legend>
              <div className="grid grid-cols-4 gap-2">
                {CUOTAS_INICIAL.map((p) => (
                  <button key={p} type="button" onClick={() => setInicial(p)} aria-pressed={inicial === p} className={`rounded-xl border py-2.5 text-[14px] font-semibold transition ${inicial === p ? "border-marino-700 bg-marino-700 text-white" : "border-slate-200 hover:border-slate-300 dark:border-white/10"}`}>{p}%</button>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="calc-plazo" className="field-label">Plazo</label>
              <select id="calc-plazo" className="field-input" value={plazo} onChange={(e) => setPlazo(Number(e.target.value))}>{PLAZOS.map((p) => <option key={p} value={p}>{p} meses</option>)}</select>
            </div>
          </div>
          {conPrecio ? <dl className="mt-6 space-y-2 border-t border-slate-200 pt-5 text-[14.5px] dark:border-white/10">
            <div className="flex justify-between"><dt className="text-slate-500">Moto {formatoSoles(m.precioDesde)}{t?.precio ? ` + techo ${formatoSoles(t.precio)}` : ""}</dt><dd className="cifra font-semibold">{formatoSoles(total)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Inicial ({inicial}%)</dt><dd className="cifra font-semibold">{formatoSoles(montoInicial)}</dd></div>
            <div className="flex items-baseline justify-between pt-2"><dt className="font-semibold">Cuota mensual aprox.</dt><dd className="cifra font-display text-[2.2rem] font-bold leading-none text-acento">{formatoSoles(cuota)}</dd></div>
          </dl> : <p className="mt-6 border-t border-slate-200 pt-5 text-[14.5px] text-slate-500 dark:border-white/10">Este modelo aún no tiene precio publicado. Cotízalo y un asesor te envía el precio y la cuota.</p>}
          <p className="mt-2 text-[12px] text-slate-400">Cálculo referencial sin intereses ni gastos. La cuota real la confirma un asesor.</p>
          <button onClick={pedir} className="btn btn-primary mt-6 w-full">Cotizar con estos datos</button>
        </div>
      </section>

      {/* Modelos relacionados */}
      {relacionados.length > 0 && (
        <section className="border-t border-slate-200 bg-escenario/60 py-14 dark:border-white/10 dark:bg-transparent">
          <div className="wrap">
            <h2 className="titulo">También te puede interesar</h2>
            <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {relacionados.map((r) => <TarjetaModelo key={r.id} m={r} />)}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
