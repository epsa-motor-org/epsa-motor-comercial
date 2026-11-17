// Diseño del panel: barra superior y menú lateral
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { IconMenu, IconClose, IconSun, IconMoon } from "../Icons";
import { RESERVA_INSIGNIA } from "../ui";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../ThemeContext";
import { ROLES } from "../../data/mockData";
import { GRUPOS_PANEL } from "../../data/secciones";
import Login from "../../pages/dashboard/Login.HU-007";

// Íconos del menú
const IC = {
  resumen: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z",
  leads: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 20a8 8 0 0 1 16 0",
  seguimiento: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  ventas: "M3 17l5-5 4 4 8-9M15 7h5v5",
  metas: "M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  modelos: "M3 14l2-5h9l4 3h3v4H3Zm4 4a2 2 0 1 0 0-4m10 4a2 2 0 1 0 0-4",
  inventario: "M3 7l9-4 9 4v10l-9 4-9-4V7Zm9 4v10M3 7l9 4 9-4",
  ubicaciones: "M12 21s-7-6-7-11.5a7 7 0 0 1 14 0C19 15 12 21 12 21Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  compras: "M3 4h2l2 12h11l2-8H6M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01",
  equipo: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9 0a3 3 0 1 0 0-6M2 19a6 6 0 0 1 12 0m1-5a5 5 0 0 1 7 5",
  opiniones: "M4 5h16v11H9l-5 4V5Zm4 4h8M8 12h5",
  facturas: "M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Zm2 5h6M9 12h6M9 16h3",
  disponibilidad: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9.5 3.5 2 2 4-4",
  separaciones: "M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Zm2.5 7.5 2 2 3.5-3.5",
  movimientos: "M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4",
  preparacion: "M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z",
  facturasRecibidas: "M3 6h18v12H3V6Zm0 0 9 7 9-7M14 14h4",
  permisos: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
};
const Ico = ({ n }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={IC[n]} /></svg>
);

export default function DashboardLayout() {
  const { user, logout, puedeVer, permisos } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  if (!user) return <Login />;
  // Antes de mostrar el menú se leen los permisos del rol (así no aparece por un instante una sección desactivada)
  if (!permisos.listo) return <div className="grid min-h-screen place-items-center bg-slate-50 text-[14px] text-slate-400 dark:bg-[#0b1220]">Cargando tu panel…</div>;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-[#0b1220]">
      {/* Barra superior */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-marino px-4 text-white sm:px-6">
        <div className="flex items-center gap-3">
          <button className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Abrir menú">{open ? <IconClose /> : <IconMenu />}</button>
          <Link to="/admin"><img src="/images/logo-epsa.svg" alt="EPSA Motor" className="h-10 w-auto" /></Link>
          <span className="hidden border-l border-white/20 pl-3 text-[14px] text-white/60 sm:inline">Gestión comercial</span>
        </div>
        <div className="flex items-center gap-2 text-[14px] sm:gap-3">
          <button onClick={toggle} aria-label="Cambiar tema" className="grid h-9 w-9 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white">{dark ? <IconSun /> : <IconMoon />}</button>
          <div className="hidden items-center gap-2.5 border-l border-white/15 pl-3 sm:flex" aria-label="Sesión actual">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-[14px] font-bold">{user.nombre?.[0]}</span>
            <span className="leading-tight"><span className="block text-[14px] font-semibold">{String(user.nombre).split(" ").slice(0, 2).join(" ")}</span><span className="block text-[12px] text-white/60">{user.cargo || ROLES[user.rol]?.nombre}</span></span>
          </div>
          <Link to="/" className="hidden rounded-lg px-3 py-1.5 text-[13.5px] text-white/80 transition hover:bg-white/10 hover:text-white md:block">Visitar sitio web</Link>
          <button onClick={() => { logout(); navigate("/admin"); }} className="rounded-lg border border-white/20 px-3 py-1.5 text-[13.5px] transition hover:bg-white/10">Salir</button>
        </div>
      </header>

      <div className="flex flex-1">
        {open && <div className="fixed inset-0 top-16 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        {/* Menú lateral */}
        <aside className={`${open ? "translate-x-0" : "-translate-x-full"} fixed bottom-0 top-16 z-30 w-64 overflow-y-auto border-r border-slate-200 bg-white transition-transform dark:border-white/10 dark:bg-[#0f1830] lg:static lg:translate-x-0`}>
          <nav className="flex min-h-full flex-col px-3 py-4" aria-label="Secciones del panel">
            {GRUPOS_PANEL.map((g) => {
              const items = g.items.filter((i) => puedeVer(i.seccion));
              if (!items.length) return null;
              return (
                <div key={g.titulo} className="mb-5">
                  <p className="px-3 pb-1.5 text-[11.5px] font-semibold text-slate-400">{g.titulo}</p>
                  {items.map((it) => (
                    <NavLink key={it.to} to={it.to} end={it.end}
                      className={({ isActive }) => `mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors ${isActive ? "bg-marino text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}>
                      <Ico n={it.seccion} />{it.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
            {/* Acceso a la web pública (en celular la barra superior no lo muestra) */}
            <Link to="/" className="group mt-auto flex items-center gap-3 overflow-hidden rounded-xl bg-marino p-3 text-white transition hover:bg-marino-700" data-ver-web>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 4.5 5h15L21 10.5M3 10.5h18M3 10.5c0 1.4 1.1 2.5 2.5 2.5S8 11.9 8 10.5c0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5c0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5c0 1.4 1.1 2.5 2.5 2.5M5 13v6h14v-6M10 19v-4h4v4" /></svg></span>
              <span className="min-w-0 leading-tight"><span className="block text-[13.5px] font-semibold">Visitar sitio web</span><span className="block truncate text-[12px] text-white/60">La web de clientes</span></span>
            </Link>
          </nav>
        </aside>
        {/* Contenido */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8" style={{ paddingBottom: `calc(2rem + ${RESERVA_INSIGNIA})` }}><div className="fade-in mx-auto max-w-[1500px]"><Outlet /></div></main>
      </div>
    </div>
  );
}
