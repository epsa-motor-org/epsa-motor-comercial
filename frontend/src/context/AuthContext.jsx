// HU-007 · Sesión y permisos por rol
// Cada rol tiene sus secciones (ROLES). Además, el gerente puede desactivar secciones para la administradora y el
// vendedor en «Roles y permisos»: con la base conectada eso se guarda en Supabase y se vuelve a leer cada 10 segundos,
// así el menú de cada persona cambia sin que tenga que volver a entrar. El gerente siempre ve todo.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ROLES } from "../data/mockData";
import { alCerrarseEnOtraPestana, cerrarSesionApi, permisosListarApi } from "../lib/api";
import { MODO_REAL } from "../lib/config";
import { mensajeError } from "../lib/errores";
import useAutoRefresco from "../hooks/useAutoRefresco";

const AuthContext = createContext(null);
const CLAVE_PERMISOS_LOCAL = "epsa-permisos"; // vista de ejemplo (sin base): permisos guardados en este navegador

// Secciones apagadas por rol a partir de las filas de la base: { vendedor: ["ventas"], ... }
function apagadasDe(filas = []) {
  const m = {};
  for (const f of filas) if (f && f.activo === false) (m[String(f.rol).toLowerCase()] ||= []).push(f.seccion);
  return m;
}
const leerLocal = () => { try { return JSON.parse(localStorage.getItem(CLAVE_PERMISOS_LOCAL) || "{}") || {}; } catch { return {}; } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { const s = JSON.parse(sessionStorage.getItem("epsa-user") || "null"); return s?.v === 4 ? s : null; } catch { return null; }
  });
  // Permisos que el gerente cambió (listo: ya se leyeron; falta: la base aún no tiene la función)
  const [apagadas, setApagadas] = useState(() => (MODO_REAL ? {} : leerLocal()));
  const [permisos, setPermisos] = useState({ listo: !MODO_REAL, falta: false, error: "" });

  // ---------------------------------------------------------------------------------------------
  // Iniciar y cerrar sesión
  // ---------------------------------------------------------------------------------------------
  function login(nombre, rol, extra = {}) {
    const nuevo = { nombre, rol, ...extra, v: 4 };
    try { sessionStorage.setItem("epsa-user", JSON.stringify(nuevo)); } catch {}
    setPermisos((p) => ({ ...p, listo: !MODO_REAL }));
    setUser(nuevo);
  }
  function logout() {
    try { sessionStorage.removeItem("epsa-user"); } catch {}
    cerrarSesionApi(); // cierra la sesión en Supabase sin hacer esperar a la persona
    setUser(null);
  }
  // CP-032-11: si en otra pestaña se cerró esta misma sesión, esta también sale (sin datos de la cuenta en pantalla)
  useEffect(() => alCerrarseEnOtraPestana(() => {
    try { sessionStorage.removeItem("epsa-user"); sessionStorage.setItem("epsa-aviso-login", "Cerraste sesión en otra pestaña. Vuelve a iniciar sesión."); } catch {}
    setUser(null);
  }), []);

  // ---------------------------------------------------------------------------------------------
  // Leer los permisos (al entrar y cada 10 s). Si falla la red se conservan los últimos leídos.
  // ---------------------------------------------------------------------------------------------
  const cargarPermisos = useCallback(async () => {
    if (!user) return;
    if (!MODO_REAL) { setApagadas(leerLocal()); setPermisos({ listo: true, falta: false, error: "" }); return; }
    try {
      setApagadas(apagadasDe(await permisosListarApi()));
      setPermisos({ listo: true, falta: false, error: "" });
    } catch (e) {
      setPermisos({ listo: true, falta: Boolean(e.detalle?.faltaSql), error: e.detalle?.faltaSql ? "" : mensajeError(e) });
    }
  }, [user]);
  useEffect(() => { cargarPermisos(); }, [cargarPermisos]);
  useAutoRefresco(cargarPermisos, 10000, Boolean(user) && MODO_REAL);

  // Vista de ejemplo: el gerente cambia los permisos en este navegador
  function cambiarPermisoLocal(rol, seccion, activo) {
    const m = { ...leerLocal() };
    const lista = new Set(m[rol] || []);
    if (activo) lista.delete(seccion); else lista.add(seccion);
    m[rol] = [...lista];
    try { localStorage.setItem(CLAVE_PERMISOS_LOCAL, JSON.stringify(m)); } catch {}
    setApagadas(m);
  }

  // ---------------------------------------------------------------------------------------------
  // Consultas de permiso: secciones del menú y acciones dentro de cada sección
  // ---------------------------------------------------------------------------------------------
  const rolPermite = (rol, seccion) => Boolean(ROLES[rol]?.puede.includes(seccion));
  const puedeVer = (seccion) => Boolean(user) && rolPermite(user.rol, seccion) && (user.rol === "gerente" || !(apagadas[user.rol] || []).includes(seccion));
  const puede = (accion) => {
    const p = user ? ROLES[user.rol]?.permisos || [] : [];
    return p.includes("*") || p.includes(accion);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, puedeVer, puede, rolPermite, apagadas, setApagadas, permisos, cargarPermisos, cambiarPermisoLocal }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
