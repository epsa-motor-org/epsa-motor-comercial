import { pedir, urlFirmadaStorage } from "../lib/api";
export const formularioPedidoApi = () => pedir("/api/pedidos/formulario").then(r => r.data);
export const compradoresPedidoApi = q => pedir(`/api/pedidos/compradores?q=${encodeURIComponent(q)}`).then(r => r.data);
export const pedidosApi = ({ q = "", offset = 0 } = {}) => pedir(`/api/pedidos?q=${encodeURIComponent(q)}&limite=25&offset=${offset}`).then(r => r.data);
export const pedidoApi = codped => pedir(`/api/pedidos/${codped}`).then(r => r.data);
export const crearPedidoApi = (cuerpo, clave) => pedir("/api/pedidos", { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } }).then(r => r.data);
export const actuarPedidoApi = (codped, accion, cuerpo, clave) => pedir(`/api/pedidos/${codped}/${accion}`, { metodo: "POST", cuerpo, headers: { "Idempotency-Key": clave } }).then(r => r.data);
export const evidenciaPedidoApi = (codped, archivo) => { const fd = new FormData(); fd.append("archivo", archivo); return pedir(`/api/pedidos/${codped}/evidencia`, { metodo: "POST", formulario: fd }).then(r => r.data); };
export const verEvidenciaPedidoApi = ruta => urlFirmadaStorage("pedidos-evidencia", ruta, 300);

// Solo clave y huella del envío en esta pestaña; nunca datos del comprador ni tokens.
// Recupera el mismo intento tras una respuesta perdida y una recarga del formulario.
export async function intentoPedido(ambito, cuerpo) {
  const bytes = new TextEncoder().encode(JSON.stringify(cuerpo));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  const referencia = `hu031-intento:${ambito}:${hash}`;
  let clave;
  try { clave = sessionStorage.getItem(referencia); } catch { /* se conserva en memoria si el navegador no permite almacenamiento */ }
  clave ||= crypto.randomUUID();
  try { sessionStorage.setItem(referencia, clave); } catch { /* el reintento de la ventana conserva la clave */ }
  return { clave, cuerpo, referencia };
}
export function olvidarIntentoPedido(intento) { try { sessionStorage.removeItem(intento?.referencia); } catch { /* almacenamiento opcional */ } }
