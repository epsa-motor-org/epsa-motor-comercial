// HU-007 · Login del panel
// Las cuentas las crea el gerente (pantalla Equipo). Si alguien entra con una contraseña temporal,
// antes de usar el panel crea la suya. No hay recuperación por correo: la contraseña la restablece el gerente.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { useAuth } from "../../context/AuthContext";
import { useApp } from "../../store/appStore.jsx";
import { cambiarClaveApi, cerrarSesionApi, iniciarSesion } from "../../lib/api";
import { resumenClave, validarClaveNueva, MIN_CLAVE } from "../../lib/clave";
import { mensajeError } from "../../lib/errores";
import { esCorreo } from "../../lib/validar";
import { ROLES } from "../../data/mockData";
import { MODO_REAL } from "../../lib/config";
import { IconOjo, IconOjoTachado, IconVolver } from "../../components/Icons";

// ---------------------------------------------------------------------------------------------
// Campo de contraseña con botón para mostrarla
// ---------------------------------------------------------------------------------------------
function CampoClave({ id, valor, onChange, ver, setVer, autoComplete, autoFocus }) {
  return (
    <div className="relative">
      <input id={id} className="field-input !py-3 !pr-12" type={ver ? "text" : "password"} value={valor}
        onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-400 transition hover:text-marino dark:hover:text-white">
        {ver ? <IconOjoTachado className="h-5 w-5" /> : <IconOjo className="h-5 w-5" />}
      </button>
    </div>
  );
}

// Mensaje de error o de aviso dentro de la tarjeta
const MensajeError = ({ texto }) => texto ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13.5px] font-medium text-acento dark:bg-red-500/10 dark:text-red-300" role="alert">{texto}</p> : null;

export default function Login() {
  const { login } = useAuth();
  const { equipo, actualizar } = useApp();
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  // Aviso de una sesión cerrada en otra pestaña (CP-032-11): se muestra una vez
  const [aviso] = useState(() => { try { const t = sessionStorage.getItem("epsa-aviso-login") || ""; sessionStorage.removeItem("epsa-aviso-login"); return t; } catch { return ""; } });
  const [cargando, setCargando] = useState(false);
  // Contraseña temporal: la persona crea la suya antes de entrar
  const [cambio, setCambio] = useState(null);
  const [nueva, setNueva] = useState({ clave: "", confirmar: "" });

  // ---------------------------------------------------------------------------------------------
  // Iniciar sesión (con la base conectada: Supabase Auth y el rol de la tabla usuario)
  // ---------------------------------------------------------------------------------------------
  async function entrarReal(correo, pass) {
    const r = await iniciarSesion(correo, pass);
    if (!["gerente", "administradora", "vendedor"].includes(r.rol)) { cerrarSesionApi(); throw new Error("Tu usuario no tiene un rol válido en EPSA Motor."); }
    const datos = { nombre: r.nombreCompleto || r.nombre, rol: r.rol, extra: { codusu: r.codusu, correo, cargo: ROLES[r.rol]?.nombre, sede: "Todas" } };
    if (r.claveTemporal) { setCambio({ real: true, datos, temporal: pass }); setNueva({ clave: "", confirmar: "" }); return; }
    login(datos.nombre, datos.rol, datos.extra);
    navigate("/admin");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    const u = usuario.trim().toLowerCase();
    if (!u || !clave) return setError("Escribe tu correo y tu contraseña.");
    if (!esCorreo(u)) return setError("Escribe un correo válido.");
    if (MODO_REAL) {
      setCargando(true);
      try { await entrarReal(u, clave); } catch (err) { setError(mensajeError(err)); } finally { setCargando(false); }
      return;
    }
    // Vista de ejemplo (sin base conectada): cuentas guardadas en este navegador
    const p = equipo.find((x) => x.correo?.toLowerCase() === u && x.claveHash === resumenClave(x.correo, clave));
    if (!p) return setError("Correo o contraseña incorrectos.");
    if (!p.activo) return setError("Tu acceso está desactivado. Consulta con la gerencia.");
    if (p.claveTemporal) { setCambio({ persona: p, temporal: clave }); setNueva({ clave: "", confirmar: "" }); return; }
    entrar(p);
  }

  function entrar(p) {
    login(p.nombre, p.rol, { correo: p.correo, sede: p.sede, idEquipo: p.id, cargo: p.cargo });
    navigate("/admin");
  }

  // ---------------------------------------------------------------------------------------------
  // Crear la contraseña propia cuando se entró con una temporal
  // ---------------------------------------------------------------------------------------------
  async function guardarNueva(e) {
    e.preventDefault(); setError("");
    const msg = validarClaveNueva(nueva.clave, nueva.confirmar, cambio.temporal);
    if (msg) return setError(msg);
    if (cambio.real) {
      setCargando(true);
      try { await cambiarClaveApi(nueva.clave); login(cambio.datos.nombre, cambio.datos.rol, cambio.datos.extra); navigate("/admin"); }
      catch (err) { setError(mensajeError(err)); } finally { setCargando(false); }
      return;
    }
    const p = cambio.persona;
    actualizar("equipo", p.id, { claveHash: resumenClave(p.correo, nueva.clave), claveTemporal: false }, `${p.nombre} creó su contraseña personal`);
    entrar(p);
  }
  function cancelarCambio() { setCambio(null); setClave(""); setError(""); if (cambio?.real) cerrarSesionApi(); }

  // ---------------------------------------------------------------------------------------------
  // Pantalla: tarjeta centrada sobre el fondo de la marca
  // ---------------------------------------------------------------------------------------------
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-marino px-4 py-12">
      {/* Fondo: luces suaves y la silueta de la marca */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-marino-700 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-48 -right-40 h-[560px] w-[560px] rounded-full bg-acento/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" aria-hidden="true" />

      <div className="fade-in relative w-full max-w-[430px]">
        <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_30px_80px_rgba(0,0,0,.35)] ring-1 ring-white/10 dark:bg-[#101c33]">
          {/* Cabecera de la tarjeta con el logo */}
          <div className="relative overflow-hidden bg-gradient-to-br from-marino-700 to-marino px-8 pb-7 pt-8 text-center">
            <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-acento/30 blur-2xl" aria-hidden="true" />
            <img src="/images/logo-epsa.svg" alt="EPSA Motor" className="relative mx-auto h-14 w-auto" />
            <p className="relative mt-3 text-[13.5px] font-medium text-white/70">Panel de gestión comercial</p>
          </div>

          {cambio ? (
            <form onSubmit={guardarNueva} noValidate className="px-8 pb-8 pt-7" data-cambio-clave>
              <h1 className="text-[21px] font-bold text-marino dark:text-white">Crea tu contraseña</h1>
              <p className="mt-1.5 text-[14px] text-slate-500 dark:text-white/60">Hola, {String(cambio.persona?.nombre || cambio.datos?.nombre).split(" ")[0]}. Entraste con una contraseña temporal: crea una nueva para continuar.</p>
              <label htmlFor="nueva-clave" className="field-label mt-6">Nueva contraseña</label>
              <CampoClave id="nueva-clave" valor={nueva.clave} onChange={(v) => setNueva({ ...nueva, clave: v })} ver={ver} setVer={setVer} autoComplete="new-password" autoFocus />
              <label htmlFor="nueva-confirmar" className="field-label mt-4">Repite la contraseña</label>
              <CampoClave id="nueva-confirmar" valor={nueva.confirmar} onChange={(v) => setNueva({ ...nueva, confirmar: v })} ver={ver} setVer={setVer} autoComplete="new-password" />
              <p className="mt-2 text-[12.5px] text-slate-500 dark:text-white/50">Mínimo {MIN_CLAVE} caracteres, con letras y números.</p>
              <MensajeError texto={error} />
              <button className="btn btn-primary mt-6 w-full !py-3.5 dark:bg-white dark:text-marino dark:hover:bg-slate-200" type="submit" disabled={cargando}>{cargando ? "Guardando…" : "Guardar y entrar"}</button>
              <button type="button" className="mt-3 w-full text-[13.5px] font-medium text-slate-500 hover:text-marino dark:text-white/60" onClick={cancelarCambio}>Cancelar</button>
            </form>
          ) : (
            <form onSubmit={onSubmit} noValidate className="px-8 pb-8 pt-7">
              <h1 className="text-[21px] font-bold text-marino dark:text-white">Iniciar sesión</h1>
              <p className="mt-1 text-[14px] text-slate-500 dark:text-white/60">Entra con la cuenta que te dio la gerencia.</p>
              {aviso && !error && <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-[13.5px] font-medium text-sky-800 dark:bg-sky-500/10 dark:text-sky-200" role="status" data-aviso-login>{aviso}</p>}
              <label htmlFor="login-correo" className="field-label mt-6">Correo</label>
              <input id="login-correo" type="email" inputMode="email" className="field-input !py-3" value={usuario} onChange={(e) => setUsuario(e.target.value)}
                autoComplete="username" autoCapitalize="none" spellCheck="false" autoFocus placeholder="tu correo" />
              <label htmlFor="login-clave" className="field-label mt-5">Contraseña</label>
              <CampoClave id="login-clave" valor={clave} onChange={setClave} ver={ver} setVer={setVer} autoComplete="current-password" />
              <MensajeError texto={error} />
              <button className="btn btn-primary mt-7 w-full !py-3.5 dark:bg-white dark:text-marino dark:hover:bg-slate-200" type="submit" disabled={cargando}>{cargando ? "Ingresando…" : "Ingresar"}</button>
              <p className="mt-4 text-center text-[12.5px] text-slate-400">¿No puedes entrar? Pide a la gerencia que restablezca tu contraseña.</p>
            </form>
          )}
        </div>

        <Link to="/" className="mx-auto mt-6 flex w-fit items-center gap-2 text-[13.5px] text-white/60 transition hover:text-white">
          <IconVolver className="h-4 w-4" /> Volver a la web
        </Link>
      </div>
    </div>
  );
}
