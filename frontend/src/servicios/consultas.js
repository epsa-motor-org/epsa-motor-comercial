// HU-011: utilidades de demostración. El modo real usa la RPC versionada de Supabase.
import { hoyLocal, limpiarTexto } from "../lib/validar";

export const VERSION_CONSENTIMIENTO = "2026-10";
export const TEXTO_CONSENTIMIENTO = "Acepto que EPSA Motor use mi nombre y celular solo para responder esta consulta y contactarme por teléfono o WhatsApp, según la Ley 29733 de Protección de Datos Personales.";
export const POLITICA_DATOS = [
  "Usamos tus datos solo para responder tu consulta y darte información de la moto que te interesa.",
  "No los vendemos ni los compartimos con otras empresas.",
  "Puedes pedir que los borremos o los corrijamos escribiendo a inversionesepsamotor@gmail.com.",
];
export const codigoConsulta = (id) => `W-${String(id).padStart(5, "0")}`;

// Utilidades legadas de demostración; la admisión real la controla la RPC HU-011.
const CLAVE_ENVIOS = "epsa-consultas-enviadas";
export const MAX_ENVIOS = 3;
const VENTANA_MS = 10 * 60000;
export const SEGUNDOS_MINIMOS = 3;
function envios() { try { return JSON.parse(localStorage.getItem(CLAVE_ENVIOS) || "[]").filter((t) => Date.now() - t < VENTANA_MS); } catch { return []; } }
export const limiteAlcanzado = () => envios().length >= MAX_ENVIOS;
export function anotarEnvio() { try { localStorage.setItem(CLAVE_ENVIOS, JSON.stringify([...envios(), Date.now()])); } catch {} }

const ABIERTO = (l) => !["Cerrado ganado", "Perdido"].includes(l.estado);
const siguiente = (lista) => lista.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

// Reparto: vendedor activo de la sede con menos interesados abiertos
export function asignarVendedor({ equipo = [], leads = [], config = {} }, sede) {
  if (config?.modoAusencia) return "Sin asignar";
  const cand = equipo.filter((p) => p.rol === "vendedor" && p.activo && !p.ausente && p.recibeLeads !== false);
  const lista = cand.filter((p) => p.sede === sede).length ? cand.filter((p) => p.sede === sede) : cand;
  if (!lista.length) return "Sin asignar";
  return lista.map((p) => ({ n: p.nombre, c: leads.filter((l) => l.responsable === p.nombre && ABIERTO(l)).length })).sort((a, b) => a.c - b.c)[0].n;
}

// Demostración explícita: solo un lead, sin ventas, seguimientos ni reparto ficticios.
export function registrarConsultaWeb(app, d) {
  const nombre = limpiarTexto(d.nombre), mensaje = limpiarTexto(d.mensaje);
  const id = siguiente(app.leads);
  const codigo = codigoConsulta(id);
  app.agregar("leads", {
    id, fecha: hoyLocal(), contacto: nombre, telefono: d.telefono, canal: "Formulario web",
    modelo: d.modelo?.id || "", color: d.color || "", sede: d.sede,
    responsable: "Sin asignar", estado: "Nuevo", origen: "Web",
    tipoConsulta: d.tipo === "cotizar" ? "Cotización" : "Consulta general", mensaje,
    consentimiento: { acepta: d.acepta === true, fecha: new Date().toISOString(), version: VERSION_CONSENTIMIENTO },
    codigoWeb: codigo, nota: mensaje,
  }, `Consulta web de demostración: ${nombre}`);
  return { codigo, repetido: false, responsable: "Sin asignar" };
}
