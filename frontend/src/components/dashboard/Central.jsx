// Sprint 2 · Piezas de las vistas conectadas a la base central
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { mensajeError } from "../../lib/errores";
import { useConsultaCentral } from "../../servicios/central";
import { listarCompras } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Link } from "./LinkPanel";
import { TONO_COMERCIAL, preparacionDe, techoDe, ubicacionDe } from "../../servicios/inventarioCentral";
import { Aviso, btnMini } from "../ui";
import { ColorPunto, Pill } from "./Sprint2";

export const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");

// Hora de una lectura: «15:32:10» si es de hoy, «29/10 15:32:10» si es de otro día
export const momentoLectura = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const hms = d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return d.toDateString() === new Date().toDateString() ? hms : `${d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" })} ${hms}`;
};

// Botón Actualizar con la hora de la última lectura correcta (la vista también se actualiza sola y al volver a la
// pestaña). Si un intento falla, la hora no cambia: sigue mostrando la del último dato confirmado.
export function BarraActualizacion({ consulta }) {
  const hora = momentoLectura(consulta.actualizado);
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 self-end">
      {hora && (
        <span className={`text-[12.5px] ${consulta.fallo ? "font-semibold text-amber-700 dark:text-amber-300" : "text-slate-500"}`} data-ultima-lectura={consulta.actualizado} role="status">
          {consulta.fallo ? `Último dato de las ${hora}` : `Actualizado a las ${hora}`}
        </span>
      )}
      <button className="btn btn-secondary !px-3.5 !py-2 text-[13px]" onClick={() => consulta.refrescar()} disabled={consulta.cargando} data-actualizar data-actualizado={consulta.actualizado || ""}>
        {consulta.cargando ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  );
}

// Error de carga o datos que pueden estar desactualizados (sin prometer tiempo real)
// La ruta todavía no existe en el servidor publicado (y no hay datos previos): la pantalla muestra solo el aviso
export const sinApi = (consulta) => Boolean(consulta?.error?.detalle?.sinRuta && !consulta?.data);

export function AvisoConexion({ consulta, que = "la información" }) {
  if (consulta.error && !consulta.data) {
    const reintentar = <button className="ml-1 font-semibold underline" onClick={() => consulta.refrescar()}>Reintentar</button>;
    // La sección aún no está habilitada en el servidor publicado. La persona ve un mensaje de negocio;
    // la ruta que falta queda en data-sin-api y en la consola, solo para el equipo técnico.
    if (consulta.error.detalle?.sinRuta) {
      return (
        <div className="mb-4" data-error-carga data-sin-api={consulta.error.detalle.endpoint}>
          <Aviso tipo="aviso">
            <b>Esta sección todavía no está disponible.</b> Estamos terminando de habilitarla; mientras tanto puedes seguir usando el resto del panel. {reintentar}
          </Aviso>
        </div>
      );
    }
    return (
      <div className="mb-4" data-error-carga>
        <Aviso tipo="error">No se {/^(los|las) /.test(que) ? "pudieron" : "pudo"} cargar {que}: {mensajeError(consulta.error)} {reintentar}</Aviso>
      </div>
    );
  }
  if (consulta.fallo && consulta.data) {
    return (
      <div className="mb-4" data-desactualizado role="status">
        <Aviso tipo="aviso">
          <b>No se pudo actualizar{consulta.fallo.status === 0 ? ": no hay conexión" : ""}.</b> Lo que ves es la última información confirmada{consulta.actualizado ? `, de las ${momentoLectura(consulta.actualizado)}` : ""}, y puede estar desactualizado. Se vuelve a intentar sola, o usa Actualizar.
        </Aviso>
      </div>
    );
  }
  return null;
}

// Mientras el inventario central no esté publicado: llegar a una moto desde su compra o por su número
export function AbrirPorNumero({ texto }) {
  const navigate = useNavigate();
  const [tipo, setTipo] = useState("compra"); const [n, setN] = useState(""); const [err, setErr] = useState("");
  function ir(e) {
    e.preventDefault();
    const v = n.trim();
    if (!/^[1-9]\d{0,9}$/.test(v)) { setErr("Escribe solo el número, por ejemplo 5."); return; }
    navigate(tipo === "compra" ? `/admin/compras/${v}` : `/admin/inventario/${v}`);
  }
  return (
    <form onSubmit={ir} className="rounded-xl2 border border-slate-100 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#121a2b]" data-abrir-numero noValidate>
      <p className="text-[13.5px] text-slate-600 dark:text-white/70">{texto}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div><label className="field-label" htmlFor="abrir-tipo">Abrir</label><select id="abrir-tipo" className="field-input !py-2" value={tipo} onChange={(e) => { setTipo(e.target.value); setErr(""); }}><option value="compra">Compra N°</option><option value="unidad">Moto N°</option></select></div>
        <div><label className="field-label" htmlFor="abrir-numero">Número</label><input id="abrir-numero" className="field-input !w-32 !py-2" inputMode="numeric" maxLength={10} value={n} onChange={(e) => { setN(e.target.value); setErr(""); }} placeholder="Ej: 5" /></div>
        <button className="btn btn-primary !py-2.5">Abrir</button>
      </div>
      {err && <p className="mt-1 text-[12px] font-medium text-acento">{err}</p>}
    </form>
  );
}

// Situación comercial (separada de la ubicación y la preparación)
export function PillComercial({ comercial }) {
  return <Pill tono={TONO_COMERCIAL[comercial] || "gris"}>{comercial === "Libre" ? "Libre para vender" : comercial || "Sin dato"}</Pill>;
}

export function PillPreparacion({ preparacion }) {
  const p = preparacionDe(preparacion);
  return <Pill tono={p.tono}>{p.etapa}</Pill>;
}

// Ubicación con su tránsito o traslado programado
export function TextoUbicacion({ unidad, conDetalle = true }) {
  const x = ubicacionDe(unidad);
  return (
    <span className="block min-w-0">
      <span className={`block font-semibold ${x.transito ? "text-sky-700 dark:text-sky-300" : x.sin ? "text-amber-700 dark:text-amber-300" : "text-marino dark:text-white"}`}>{x.texto}</span>
      {conDetalle && x.detalle && <span className={`block text-[12px] ${x.programado ? "font-semibold text-sky-700 dark:text-sky-300" : "text-slate-400"}`}>{x.detalle}</span>}
    </span>
  );
}

// Techo: configuración y avance
export function TextoTecho({ preparacion }) {
  const t = techoDe(preparacion);
  return (
    <span className="block">
      <span className={`block ${t.config === "Sin techo" ? "text-slate-500" : t.config === "Por definir" ? "text-amber-700 dark:text-amber-300" : ""}`}>{t.config}{t.proveedor ? <span className="text-slate-400">, {t.proveedor}</span> : null}</span>
      {t.requiereInstalacion && <span className={`mt-0.5 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.avance === "Instalado" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{t.avance === "Instalado" ? "Instalado" : t.avance === "En proceso" ? "En armado" : "Por armar"}</span>}
    </span>
  );
}

export function ColorUnidad({ color }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><ColorPunto color={capital(color)} className="h-2.5 w-2.5" />{capital(color)}</span>;
}

// «AZUL» del XML se muestra como «Azul»
// Nombre corto de una moto: su motor si la API lo envía; si no, su número central
export const nombreUnidad = (u) => (u?.nummotuni ? `Motor ${u.nummotuni}` : `Moto N° ${u?.coduni ?? ""}`);
export const capital = (t) => { const s = String(t || "").trim().toLowerCase(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; };

// Paginación sencilla
export function Paginador({ total, limite, offset, onCambio }) {
  if (!total || total <= limite) return null;
  const pagina = Math.floor(offset / limite) + 1;
  const paginas = Math.ceil(total / limite);
  return (
    <div className="mt-4 flex items-center justify-between text-[13px] text-slate-500">
      <span>{total} en total, página {pagina} de {paginas}</span>
      <div className="flex gap-2">
        <button className={btnMini} disabled={pagina <= 1} onClick={() => onCambio(Math.max(0, offset - limite))}>Anterior</button>
        <button className={btnMini} disabled={pagina >= paginas} onClick={() => onCambio(offset + limite)}>Siguiente</button>
      </div>
    </div>
  );
}

// Fecha y hora completas para trazabilidad
export function fechaCompleta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }).replace(".", "")}, ${hora(iso)}`;
}

// HU-001 · Motos compradas que todavía no entran al inventario
// Una compra registrada no crea motos: aparecen en Disponibilidad e Inventario cuando se registra su factura y se
// identifican (motor y chasis) en Compras a proveedor (HU-002). Este aviso lo explica con lo que dice la base.
export function MotosPorIdentificar() {
  const { puedeVer } = useAuth();
  const ve = puedeVer("compras");
  const consulta = useConsultaCentral(() => listarCompras(100, 0).then((r) => (Array.isArray(r.data) ? r.data : [])), [], { activo: ve, clave: "compras-pendientes" });
  const compras = (consulta.data || []).filter((c) => Number(c.cantidad_pendiente) > 0);
  const motos = compras.reduce((n, c) => n + Number(c.cantidad_pendiente || 0), 0);
  if (!ve || !motos) return null;
  return (
    <div className="mb-4" data-motos-por-identificar={motos}>
      <Aviso tipo="aviso">
        <b>{motos} moto{motos === 1 ? "" : "s"} comprada{motos === 1 ? "" : "s"} todavía no {motos === 1 ? "entra" : "entran"} al inventario.</b> Aparecen aquí cuando registras la factura de la compra e identificas cada moto (motor y chasis).{" "}
        <Link to="/admin/compras" className="font-semibold underline">Ir a Compras a proveedor</Link>
      </Aviso>
    </div>
  );
}
