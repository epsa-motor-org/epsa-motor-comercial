// Rutas de la web pública y del panel
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { MODO_REAL } from "./lib/config";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ErrorBoundary from "./components/ErrorBoundary";
import { CotizarProvider } from "./components/CotizarModal";
import { ToastProvider, ConfirmProvider } from "./components/ui";
import Home from "./pages/Home";
import Modelos from "./pages/Modelos.HU-008";
import ModeloDetalle from "./pages/ModeloDetalle.HU-009";
import Nosotros from "./pages/Nosotros.HU-010";
import Sedes from "./pages/Sedes.HU-010";
import { NotFound, ErrorPorCodigo } from "./pages/Errores";

// Panel: cada pantalla se descarga recién cuando se abre, así la web de clientes carga rápido.
// Si se publicó una versión nueva mientras la página estaba abierta, se recarga una vez para traerla.
function diferido(cargar) {
  return lazy(() => cargar().then((m) => { try { sessionStorage.removeItem("epsa-recarga"); } catch {} return m; }).catch((e) => {
    try { if (!sessionStorage.getItem("epsa-recarga")) { sessionStorage.setItem("epsa-recarga", "1"); window.location.reload(); return new Promise(() => {}); } } catch {}
    throw e;
  }));
}
import ProtectedRoute from "./components/dashboard/ProtectedRoute";
import SeccionPendiente from "./components/dashboard/SeccionPendiente";
const DashboardLayout = diferido(() => import("./components/dashboard/DashboardLayout"));
const Prohibido = diferido(() => import("./pages/dashboard/Prohibido.HU-007"));
const Resumen = diferido(() => import("./pages/dashboard/Resumen"));
const Leads = diferido(() => import("./pages/dashboard/Leads.HU-014"));
const Seguimiento = diferido(() => import("./pages/dashboard/Seguimiento"));
const Ventas = diferido(() => import("./pages/dashboard/Ventas"));
const Metas = diferido(() => import("./pages/dashboard/Metas"));
const ModelosAdmin = diferido(() => import("./pages/dashboard/ModelosAdmin.HU-012"));
const Inventario = diferido(() => import("./pages/dashboard/Inventario.HU-004"));
const Facturas = diferido(() => import("./pages/dashboard/Facturas"));
const FichaUnidad = diferido(() => import("./pages/dashboard/FichaUnidad.HU-004"));
const RegistrarCompra = diferido(() => import("./pages/dashboard/RegistrarCompra.HU-034"));
const RegistrarCompraCarrito = diferido(() => import("./pages/dashboard/RegistrarCompraCarrito.HU-034"));
const Ubicaciones = diferido(() => import("./pages/dashboard/Ubicaciones.HU-026"));
const Compras = diferido(() => import("./pages/dashboard/Compras.HU-034"));
const CompraDetalle = diferido(() => import("./pages/dashboard/CompraDetalle.HU-002"));
const Equipo = diferido(() => import("./pages/dashboard/Equipo"));
const RolesPermisos = diferido(() => import("./pages/dashboard/RolesPermisos"));
const SeguimientoCentral = diferido(() => import("./components/dashboard/SeguimientoCentral"));
const VentasCentral = diferido(() => import("./components/dashboard/VentasCentral"));
const PedidosCentral = diferido(() => import("./components/dashboard/PedidosCentral"));
const Disponibilidad = diferido(() => import("./pages/dashboard/Disponibilidad.HU-001"));
const Movimientos = diferido(() => import("./pages/dashboard/Movimientos.HU-003"));
const Separaciones = diferido(() => import("./pages/dashboard/Separaciones.HU-005"));
const Preparacion = diferido(() => import("./pages/dashboard/Preparacion.HU-033"));
const DisponibilidadCentral = diferido(() => import("./pages/dashboard/DisponibilidadCentral.HU-001"));
const InventarioCentral = diferido(() => import("./pages/dashboard/InventarioCentral.HU-004"));
const FichaCentral = diferido(() => import("./pages/dashboard/FichaCentral.HU-004"));
const MovimientosCentral = diferido(() => import("./pages/dashboard/MovimientosCentral.HU-003"));
const PreparacionCentral = diferido(() => import("./pages/dashboard/PreparacionCentral.HU-033"));
const FacturasRecibidas = diferido(() => import("./pages/dashboard/FacturasRecibidas.HU-030"));
const FacturaRecibida = diferido(() => import("./pages/dashboard/FacturaRecibida.HU-030"));

// Al cambiar de página, vuelve arriba
function SubirArriba() {
  const { pathname } = useLocation();
  useEffect(() => { try { window.scrollTo(0, 0); } catch {} }, [pathname]);
  return null;
}

// Web pública: menú, páginas y pie de página
function SitioPublico() {
  return (
    <CotizarProvider>
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/modelos" element={<Modelos />} />
            <Route path="/modelos/:id" element={<ModeloDetalle />} />
            <Route path="/nosotros" element={<Nosotros />} />
            <Route path="/sedes" element={<Sedes />} />
            <Route path="/error/:codigo" element={<ErrorPorCodigo />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </CotizarProvider>
  );
}

// Mientras se descarga una pantalla del panel
const Cargando = () => <p className="py-16 text-center text-[14px] text-slate-400">Cargando…</p>;
const Diferida = ({ children }) => <Suspense fallback={<Cargando />}>{children}</Suspense>;

// Ruta del panel protegida por rol
const P = ({ s, children }) => <ProtectedRoute seccion={s}><Diferida>{children}</Diferida></ProtectedRoute>;

// Rutas
export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <SubirArriba />
          <Routes>
            <Route path="/admin" element={<Diferida><DashboardLayout /></Diferida>}>
              <Route index element={<Diferida><Resumen /></Diferida>} />
              <Route path="leads" element={<P s="leads"><Leads /></P>} />
              {/* Seguimiento, ventas, facturas de venta y metas aún no tienen su parte en la base:
                  con la base conectada avisan que no están disponibles (sin datos de ejemplo) */}
              <Route path="seguimiento" element={<P s="seguimiento">{MODO_REAL ? <SeguimientoCentral /> : <Seguimiento />}</P>} />
              <Route path="ventas" element={<P s="ventas">{MODO_REAL ? <VentasCentral /> : <Ventas />}</P>} />
              <Route path="pedidos" element={<P s="ventas"><PedidosCentral /></P>} />
              <Route path="disponibilidad" element={<P s="disponibilidad">{MODO_REAL ? <DisponibilidadCentral /> : <Disponibilidad />}</P>} />
              {/* HU-005 ya no es del Sprint 2: solo en la vista previa */}
              <Route path="separaciones" element={MODO_REAL ? <Navigate to="/admin/disponibilidad" replace /> : <P s="separaciones"><Separaciones /></P>} />
              <Route path="movimientos" element={<P s="movimientos">{MODO_REAL ? <MovimientosCentral /> : <Movimientos />}</P>} />
              <Route path="preparacion" element={<P s="preparacion">{MODO_REAL ? <PreparacionCentral /> : <Preparacion />}</P>} />
              <Route path="metas" element={<P s="metas">{MODO_REAL ? <SeccionPendiente titulo="Metas" /> : <Metas />}</P>} />
              <Route path="modelos" element={<P s="modelos"><ModelosAdmin /></P>} />
              <Route path="inventario" element={<P s="inventario">{MODO_REAL ? <InventarioCentral /> : <Inventario />}</P>} />
              <Route path="inventario/:id" element={<P s="inventario">{MODO_REAL ? <FichaCentral /> : <FichaUnidad />}</P>} />
              <Route path="ubicaciones" element={<P s="ubicaciones"><Ubicaciones /></P>} />
              <Route path="compras" element={<P s="compras"><Compras /></P>} />
              <Route path="compras/nueva" element={<P s="compras">{MODO_REAL ? <RegistrarCompraCarrito /> : <RegistrarCompra />}</P>} />
              <Route path="compras/:id" element={<P s="compras"><CompraDetalle /></P>} />
              <Route path="equipo" element={<P s="equipo"><Equipo /></P>} />
              <Route path="permisos" element={<P s="permisos"><RolesPermisos /></P>} />
              <Route path="facturas" element={<P s="facturas">{MODO_REAL ? <SeccionPendiente titulo="Facturas y clientes" /> : <Facturas />}</P>} />
              <Route path="facturas-recibidas" element={<P s="facturasRecibidas"><FacturasRecibidas /></P>} />
              <Route path="facturas-recibidas/:id" element={<P s="facturasRecibidas"><FacturaRecibida /></P>} />
              <Route path="403" element={<Diferida><Prohibido /></Diferida>} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>
            <Route path="/dashboard/*" element={<Navigate to="/admin" replace />} />
            <Route path="/*" element={<SitioPublico />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
