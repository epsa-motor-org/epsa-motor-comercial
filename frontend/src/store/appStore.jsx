// Datos de la web y del panel (compartidos)
import useAutoRefresco from "../hooks/useAutoRefresco";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as D from "../data/mockData";
import { MODO_REAL } from "../lib/config";
import { modelosPublicos, sedesPublicasApi } from "../lib/api";
import { modeloDesdeApi, ordenCatalogo } from "../lib/modelos";
import { aplicarFotosCentrales, aplicarGaleria } from "../lib/galeria";
import { useArchivosLocales } from "../hooks/useArchivoLocal";

const Ctx = createContext(null);
// Con la base conectada se usa otra clave: lo que quedó de la vista de ejemplo en este navegador no se mezcla
const CLAVE = MODO_REAL ? "epsa-datos-real-v1" : "epsa-datos-v7";
try { ["epsa-datos-v4", "epsa-datos-v5", "epsa-datos-v6", ...(MODO_REAL ? ["epsa-datos-v7"] : [])].forEach((k) => localStorage.removeItem(k)); } catch {}

// Con la base conectada no hay datos de ejemplo: todo viene de la API o se registra en el panel.
// Solo se conserva la ficha técnica oficial de cada modelo (torito.pe), que completa lo que trae la API.
const SIN_EJEMPLOS = {
  ubicaciones: [], leads: [], seguimientos: [], ventas: [], metas: [], equipo: [], unidades: [], compras: [], opiniones: [],
  movimientos: [], separaciones: [], clientes: [], historialPreparacion: [], imagenes: [],
};

// Datos iniciales
const BASE = () => ({
  modelos: D.MODELOS, ubicaciones: D.UBICACIONES, leads: D.LEADS, seguimientos: D.SEGUIMIENTOS,
  ventas: D.VENTAS, metas: D.METAS, equipo: D.EQUIPO, unidades: D.UNIDADES, compras: D.COMPRAS, opiniones: D.OPINIONES, actividad: [],
  // Sprint 2
  movimientos: D.MOVIMIENTOS, separaciones: D.SEPARACIONES, clientes: D.CLIENTES, historialPreparacion: D.HISTORIAL_PREPARACION, imagenes: D.IMAGENES_MODELO,
  config: { modoAusencia: false, galeriaEditada: {} },
  sprint2: 1,
  ...(MODO_REAL ? SIN_EJEMPLOS : {}),
});

// Sprint 2: agrega los datos nuevos sin borrar lo que ya estaba guardado en este navegador
const DATOS_SPRINT2 = ["movimientos", "separaciones", "clientes", "historialPreparacion", "imagenes"];
function migrarSprint2(d) {
  if (d.sprint2 >= 1) return d;
  const b = BASE();
  const n = { ...d, sprint2: 1, config: { ...b.config, ...d.config } };
  DATOS_SPRINT2.forEach((k) => { if (!Array.isArray(d[k])) n[k] = b[k]; });
  // Unidades de ejemplo que cambian con el Sprint 2: solo si siguen como venían de fábrica
  const antes = { "MC-007": { disponibilidad: "Disponible", techo: "Sin techo" }, "MC-008": { disponibilidad: "Disponible" }, "MC-015": { disponibilidad: "Disponible" }, "MC-010": { ubicacion: "Crossland Ancón" } };
  const nuevas = Object.fromEntries(b.unidades.map((u) => [u.id, u]));
  const ajustadas = new Set();
  n.unidades = (d.unidades || []).map((u) => {
    const a = antes[u.id];
    if (!a || !Object.entries(a).every(([k, v]) => u[k] === v)) return u;
    ajustadas.add(u.id);
    const x = nuevas[u.id];
    return { ...u, disponibilidad: x.disponibilidad, ubicacion: x.ubicacion, techo: x.techo, proveedorTecho: x.proveedorTecho, estadoTecho: x.estadoTecho, historial: x.historial };
  });
  // Ejemplos que dependen de esas unidades: se quitan si la unidad ya cambió
  const sigue = (id) => ["MC-007", "MC-008", "MC-015", "MC-010"].includes(id) ? ajustadas.has(id) : (d.unidades || []).some((u) => u.id === id);
  n.separaciones = n.separaciones.filter((x) => sigue(x.unidad) && (x.estado !== "Activa" || ajustadas.has(x.unidad)));
  const unidadLocal = (id) => n.unidades.find((u) => u.id === id);
  n.movimientos = n.movimientos.filter((x) => sigue(x.unidad) && (x.estado !== "En tránsito" || (unidadLocal(x.unidad)?.ubicacion === x.origen && unidadLocal(x.unidad)?.disponibilidad !== "Vendida")));
  return n;
}

// Cargar lo guardado en el navegador
function cargar() {
  try {
    const g = localStorage.getItem(CLAVE);
    if (g) {
      const crudo = JSON.parse(g);
      const d = migrarSprint2({ ...BASE(), ...crudo, sprint2: crudo.sprint2 || 0 });
      d.ventas = (d.ventas || []).map((v) => (typeof v.comprobante === "string" ? { ...v, voucherPago: v.comprobante, comprobante: null } : v));
      d.unidades = (d.unidades || []).map((u) => { const techo = D.normalizarTecho(u.techo, u.proveedorTecho); return techo === u.techo ? u : { ...u, techo, proveedorTecho: D.TECHO_REQUIERE_PROVEEDOR(techo) ? u.proveedorTecho : "" }; });
      return d;
    }
  } catch {}
  return BASE();
}

const siguienteId = (arr) => arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

// HU-010 · Sedes: Supabase + datos del panel
const claveSede = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^\s*sede\s+/, "").replace(/[^a-z0-9]/g, "");
function unirSedes(api, ubicaciones) {
  const locales = ubicaciones.filter((u) => u.tipo === "Sede propia");
  const usadas = new Set();
  return api.map((a) => {
    const l = locales.find((x) => !usadas.has(x.id) && claveSede(x.nombre) === claveSede(a.nomsed));
    if (l) usadas.add(l.id);
    return {
      ...l, id: l?.id ?? `sede-${a.codsed}`, codsed: String(a.codsed), tipo: "Sede propia", activo: true,
      nombre: l?.nombre || String(a.nomsed || "").replace(/^\s*sede\s+/i, "").trim(),
      direccion: a.dirsed || l?.direccion || "", telefono: a.telsed || l?.telefono || "", correo: l?.correo || "",
      horario: a.horsed || l?.horario || "", horarioNota: a.horsed ? "" : l?.horarioNota || "",
    };
  });
}

// Proveedor de datos
// Último catálogo público confirmado (modelos y sedes): la web lo muestra al instante al volver a entrar y lo
// actualiza en segundo plano. Así no espera a que la API despierte (Render tarda en la primera consulta).
const CLAVE_CATALOGO = "epsa-catalogo-web-v1";
const VIGENCIA_CATALOGO = 7 * 24 * 3600 * 1000;
function catalogoGuardado() {
  if (!MODO_REAL) return null;
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_CATALOGO) || "null");
    if (g && Array.isArray(g.modelos) && Date.now() - Number(g.t || 0) < VIGENCIA_CATALOGO) return g;
  } catch { /* sin almacenamiento local */ }
  return null;
}
function guardarCatalogo(parte) {
  try {
    const previo = JSON.parse(localStorage.getItem(CLAVE_CATALOGO) || "null") || {};
    localStorage.setItem(CLAVE_CATALOGO, JSON.stringify({ ...previo, ...parte, t: Date.now() }));
  } catch { /* sin almacenamiento local o lleno: se sigue sin copia */ }
}

export function AppProvider({ children }) {
  const [s, setS] = useState(cargar);
  const [apiModelos, setApiModelos] = useState(() => catalogoGuardado()?.modelos ?? null);
  // Estado del catálogo central en la web: «cargando» hasta la primera respuesta, «error» si la primera lectura falla
  // (después de una lectura correcta, un fallo deja el último catálogo confirmado y se reintenta solo)
  const [catalogoError, setCatalogoError] = useState(null);
  const [apiSedes, setApiSedes] = useState(() => catalogoGuardado()?.sedes ?? null);
  const guardado = useRef("");

  // Guardar cambios en el navegador
  useEffect(() => {
    try {
      const t = JSON.stringify(s);
      if (t !== guardado.current) { guardado.current = t; localStorage.setItem(CLAVE, t); }
    } catch {}
  }, [s]);

  // Sincronizar pestañas del mismo navegador
  useEffect(() => {
    const alCambiar = (e) => {
      if (e.key !== CLAVE) return;
      if (e.newValue === null) { setS(BASE()); return; }
      if (e.newValue === guardado.current) return;
      guardado.current = e.newValue;
      setS(cargar());
    };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, []);

  // Catálogo y sedes desde la API: al abrir, cada 10 s y al volver a la pestaña
  const refrescarWeb = useCallback(() => {
    if (!MODO_REAL) return Promise.resolve();
    return Promise.all([
      modelosPublicos().then((r) => { const lista = Array.isArray(r.data) ? r.data : []; setApiModelos(lista); setCatalogoError(null); guardarCatalogo({ modelos: lista }); }).catch((e) => setCatalogoError(e || new Error("Sin respuesta"))),
      sedesPublicasApi().then((r) => { const lista = Array.isArray(r.data) ? r.data : null; setApiSedes(lista); if (lista) guardarCatalogo({ sedes: lista }); }).catch(() => {}),
    ]);
  }, []);
  useEffect(() => { refrescarWeb(); }, [refrescarWeb]);
  useAutoRefresco(refrescarWeb, 10000, MODO_REAL);

  // Agregar, editar y eliminar registros
  const registrar = useCallback((detalle, quien = "Sistema") => {
    setS((p) => ({ ...p, actividad: [{ id: Date.now() + Math.random(), fecha: new Date().toISOString(), detalle, quien }, ...p.actividad].slice(0, 60) }));
  }, []);

  const agregar = useCallback((ent, item, nota) => {
    let creado;
    setS((p) => {
      creado = { ...item, id: item.id !== undefined && item.id !== null && item.id !== "" ? item.id : siguienteId(p[ent]) };
      return { ...p, [ent]: [creado, ...p[ent]] };
    });
    if (nota) registrar(nota);
    return creado;
  }, [registrar]);

  const actualizar = useCallback((ent, id, patch, nota) => {
    setS((p) => ({ ...p, [ent]: p[ent].map((x) => (x.id === id ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)) }));
    if (nota) registrar(nota);
  }, [registrar]);

  const eliminar = useCallback((ent, id, nota) => {
    setS((p) => ({ ...p, [ent]: p[ent].filter((x) => x.id !== id) }));
    if (nota) registrar(nota);
  }, [registrar]);

  const reemplazar = useCallback((ent, lista) => setS((p) => ({ ...p, [ent]: lista })), []);
  const configurar = useCallback((patch, nota) => { setS((p) => ({ ...p, config: { ...p.config, ...patch } })); if (nota) registrar(nota); }, [registrar]);
  const restablecer = useCallback(() => {
    try { localStorage.removeItem(CLAVE); } catch {}
    setS(BASE());
  }, []);

  // HU-036 · Fotos de cada modelo (galería del panel)
  const urlsFotos = useArchivosLocales((s.imagenes || []).map((i) => i.archivo));
  // Con la API conectada no se aplica la galería guardada en este navegador: mandan las fotos centrales
  const modelosConFotos = useMemo(() => (MODO_REAL ? s.modelos : aplicarGaleria(s.modelos, s.imagenes || [], urlsFotos, s.config?.galeriaEditada || {})), [s.modelos, s.imagenes, urlsFotos, s.config?.galeriaEditada]);

  // Catálogo público (modelos publicados). Con la API conectada, toda la información sale de la base (HU-036):
  // precio, colores, descripción, ficha técnica (carmod) y fotos de GET /api/modelos, sin datos guardados en el front.
  // Mientras llega la primera respuesta (o si falla) el catálogo queda vacío: los modelos de demostración del front
  // solo se usan en el modo sin base.
  let publicos = MODO_REAL ? [] : modelosConFotos.filter((m) => m.estado === "Publicado");
  const sinFicha = [];
  if (apiModelos) {
    const ocupados = new Set();
    publicos = apiModelos
      .map((a) => { const m = modeloDesdeApi(a, ocupados); ocupados.add(m.id); return aplicarFotosCentrales({ ...m, estado: "Publicado" }, a.imagenes); })
      .sort(ordenCatalogo);
  }

  // Sedes de la web
  const sedes = apiSedes?.length ? unirSedes(apiSedes, s.ubicaciones) : s.ubicaciones.filter((u) => u.tipo === "Sede propia" && u.activo);

  const catalogo = { estado: !MODO_REAL || apiModelos ? "listo" : catalogoError ? "error" : "cargando", reintentar: refrescarWeb };

  const api = {
    ...s, publicos, apiModelos, sinFicha, apiSedes, catalogo,
    agregar, actualizar, eliminar, reemplazar, restablecer, registrar, configurar,
    sedes, refrescarWeb, modelosConFotos, urlsFotos,
    modelo: (id) => s.modelos.find((m) => m.id === id),
    togglePublicadoModelo: (id) => actualizar("modelos", id, (m) => ({ estado: m.estado === "Publicado" ? "Borrador" : "Publicado" })),
    toggleActivoUbicacion: (id) => actualizar("ubicaciones", id, (u) => ({ activo: !u.activo })),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
