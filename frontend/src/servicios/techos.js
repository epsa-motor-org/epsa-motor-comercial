// Catálogo único de techos (regla del PO del 11 de noviembre): Sin techo, Lona, Techo clásico de fibra, Fibra clásica
// equipada y Techo de fibra deportiva, con su adicional referencial. Son los mismos tipos de la base que usa el panel
// al separar, vender y preparar la moto. La web pública los lee de GET /api/techos; mientras cargan, o si la API no
// responde, se usa la copia de data/mockData.js (mismos nombres y montos). Los montos son referenciales: el adicional
// que se cobra se confirma en la venta.
import { useEffect, useState } from "react";
import { pedir } from "../lib/api";
import { MODO_REAL } from "../lib/config";
import { OPCIONES_TECHO, SIN_TECHO } from "../data/mockData";

export const TECHOS_RESPALDO = [SIN_TECHO, ...OPCIONES_TECHO];

// Identificador estable de cada techo en la web (ilustración y enlaces «Cotizar con este techo»)
export function idTecho(nombre) {
  const t = String(nombre || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/sin techo/.test(t)) return SIN_TECHO.id;
  if (/lona/.test(t)) return "lona";
  if (/equipad/.test(t)) return "equipado";
  if (/deportiv/.test(t)) return "deportivo";
  if (/clasic|fibra/.test(t)) return "clasico";
  return `t-${t.replace(/[^a-z0-9]+/g, "-")}`;
}

// Lista de la API en la forma que usan las páginas: { id, codtte, nombre, precio }, «Sin techo» primero
export function techosDesdeApi(lista) {
  const v = (Array.isArray(lista) ? lista : [])
    .filter((t) => t && t.nombre && t.adicionalReferencial !== null && t.adicionalReferencial !== undefined && Number.isFinite(Number(t.adicionalReferencial)))
    .map((t) => ({ id: t.sinTecho ? SIN_TECHO.id : idTecho(t.nombre), codtte: String(t.codtte ?? ""), nombre: t.sinTecho ? SIN_TECHO.nombre : t.nombre, precio: Number(t.adicionalReferencial) }));
  if (!v.length) return null;
  const sin = v.find((t) => t.id === SIN_TECHO.id) || SIN_TECHO;
  return [sin, ...v.filter((t) => t.id !== SIN_TECHO.id).sort((a, b) => a.precio - b.precio)];
}

const CLAVE = "epsa:techos:v1";
let enMemoria = null;
let enCurso = null;
function leerGuardado() {
  try { const x = JSON.parse(window.localStorage.getItem(CLAVE) || "null"); return Array.isArray(x) && x.length ? x : null; } catch { return null; }
}
export const techosPublicosApi = () => pedir("/api/techos", { privada: false }).then((r) => r.data);
export function cargarTechos() {
  if (!MODO_REAL) return Promise.resolve(TECHOS_RESPALDO);
  if (!enCurso) {
    enCurso = techosPublicosApi().then((d) => {
      const l = techosDesdeApi(d);
      if (l) { enMemoria = l; try { window.localStorage.setItem(CLAVE, JSON.stringify(l)); } catch { /* sin almacenamiento local */ } }
      return enMemoria || leerGuardado() || TECHOS_RESPALDO;
    }).catch(() => { enCurso = null; return enMemoria || leerGuardado() || TECHOS_RESPALDO; });
  }
  return enCurso;
}
// Techos para una página: primero lo último conocido y, al llegar, el catálogo de la base
export function useTechos() {
  const [lista, setLista] = useState(() => enMemoria || (MODO_REAL ? leerGuardado() : null) || TECHOS_RESPALDO);
  useEffect(() => {
    let vivo = true;
    cargarTechos().then((l) => { if (vivo) setLista(l); });
    return () => { vivo = false; };
  }, []);
  return lista;
}
