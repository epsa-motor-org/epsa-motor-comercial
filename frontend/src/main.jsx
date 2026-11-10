// Punto de entrada: monta la app con sus proveedores
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";

const Router = import.meta.env.VITE_ROUTER === "memory" ? MemoryRouter : BrowserRouter;
import "./index.css";
import App from "./App.jsx";
import { ThemeProvider } from "./ThemeContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { AppProvider } from "./store/appStore.jsx";
import FiltrosColor from "./components/FiltrosColor.jsx";
import { API_URL, SUPABASE_URL } from "./lib/config";

// Conexión anticipada con la API, el almacenamiento de fotos y torito.pe: el catálogo y sus fotos llegan antes
// (la API se consulta con CORS; las fotos se cargan como imágenes normales)
for (const [destino, cors] of [[API_URL, true], [SUPABASE_URL, false], ["https://torito.pe", false]]) {
  try {
    if (!destino) continue;
    const l = document.createElement("link");
    l.rel = "preconnect"; l.href = new URL(destino).origin;
    if (cors) l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  } catch { /* dirección no válida: se omite */ }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Router {...(import.meta.env.VITE_ROUTER === "memory" ? { initialEntries: [import.meta.env.VITE_INICIO || "/"] } : {})}>
      <ThemeProvider>
        <AuthProvider>
          <AppProvider>
            <FiltrosColor />
            <App />
          </AppProvider>
        </AuthProvider>
      </ThemeProvider>
    </Router>
  </StrictMode>
);
