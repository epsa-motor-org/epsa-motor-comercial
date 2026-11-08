// HU-012 · Modelos (panel) · HU-036: galería de fotos de cada modelo
import { useEffect, useMemo, useState } from "react";
import { Link } from "../../components/dashboard/LinkPanel";
import { useApp } from "../../store/appStore.jsx";
import { useAuth } from "../../context/AuthContext";
import { COLOR_HEX, COLORES, FAMILIAS, FILTROS_CATALOGO, formatoSoles } from "../../data/mockData";
import { soloDigitos } from "../../lib/validar";
import { Aviso, Campo, Modal, PageHeader, Tabla, Vacio, btnMini, btnMiniPeligro, useConfirm, useToast } from "../../components/ui";
import ModeloImg from "../../components/ModeloImg";
import Badge from "../../components/Badge";
import { MODO_REAL, SUPABASE_URL } from "../../lib/config";
import * as api from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { modeloDesdeApi, ordenCatalogo } from "../../lib/modelos";
import GaleriaModelo from "../../components/dashboard/GaleriaModelo";
import GaleriaCentral from "../../components/dashboard/GaleriaCentral";
import { aplicarFotosCentrales } from "../../lib/galeria";
import { fichaATexto } from "../../lib/fichaModelo";
import InformacionTorito from "../../components/dashboard/InformacionTorito";
import { inventarioApi, reemplazarFotoModeloApi, subirFotoModeloApi, useConsultaCentral } from "../../servicios/central";
import { AvisoConexion, BarraActualizacion } from "../../components/dashboard/Central";

// Conexión con la base (HU-012)
const CODTMO = { "Motores 2 Tiempos": "2", "Motores 4 Válvulas": "3", "Motores Crom Plus": "4" };
// Existir en la base y estar publicado en la web son cosas distintas: un modelo «No publicado» se sigue usando
// para el inventario, las compras históricas y los interesados, pero no se ve en la web ni en Compras.
const estadoPanel = (e) => (e === "Publicado" ? "Publicado" : "No publicado");
const ESTADOS_PANEL = MODO_REAL ? ["Publicado", "No publicado"] : ["Publicado", "Borrador"];
const urlParaBase = (u) => { const t = String(u || "").trim(); return /^\/images\/[\w./-]+\.(png|jpe?g|webp|svg|gif)$/i.test(t) || /^https:\/\/[^\s]+$/i.test(t) ? t : ""; };
const fotoActiva = (m) => [...(m?.imagenesApi || [])].filter((i) => i.estimo).sort((a, b) => (a.ordimo ?? 0) - (b.ordimo ?? 0))[0];

const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TABS = [{ id: "motor", t: "Motor" }, { id: "chasis", t: "Chasis" }, { id: "consumo", t: "Consumo y rendimiento" }, { id: "dimensiones", t: "Dimensiones" }, { id: "electrico", t: "Sistema eléctrico" }];
const NUEVO = { nombre: "", familia: FAMILIAS[0], tipoMotor: "4 tiempos", combustible: "Gasolina", uso: "Pasajeros", precioDesde: "", descripcion: "", imagen: "", colores: ["Rojo"], colorFoto: "Rojo", badges: "", destacadosTxt: "", cilindrada: "", potencia: "", torque: "", llantas: "", ...Object.fromEntries(TABS.map((t) => [`spec_${t.id}`, ""])) };
const aTexto = (filas = []) => filas.map(([k, v]) => `${k}: ${v}`).join("\n");
const aFilas = (txt) => txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""]; });

// Foto del modelo
function leerFoto(file) {
  return new Promise((res, rej) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return rej(new Error("Usa una imagen PNG, JPG o WEBP."));
    if (file.size > 6 * 1024 * 1024) return rej(new Error("La imagen pesa más de 6 MB."));
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/webp", 0.85));
      };
      img.onerror = () => rej(new Error("No se pudo leer la imagen."));
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// Foto elegida en la computadora (ya reducida) lista para subir a Supabase Storage
async function archivoDeFoto(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], "foto-modelo.webp", { type: blob.type || "image/webp" });
}
// Ruta en el bucket «modelos» de una foto guardada en nuestro Storage (las de otros sitios no se tocan)
const rutaEnStorage = (url) => {
  const base = `${SUPABASE_URL}/storage/v1/object/public/${api.BUCKET_FOTOS}/`;
  return SUPABASE_URL && String(url || "").startsWith(base) ? decodeURIComponent(String(url).slice(base.length).split("?")[0]) : "";
};

function imagenValida(v) {
  const t = String(v || "").trim();
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(t)) return true;
  if (/^\/(?!\/)[\w./-]+\.(png|jpe?g|webp|svg|gif)$/i.test(t)) return true;
  // Foto guardada en nuestro almacenamiento (Supabase Storage)
  if (SUPABASE_URL && t.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)) return true;
  try { const u = new URL(t); return ["http:", "https:"].includes(u.protocol) && /\.[a-z]{2,}$/i.test(u.hostname); } catch { return false; }
}

// Página de modelos
export default function ModelosAdmin() {
  const { modelos: locales, unidades, agregar, actualizar, eliminar, refrescarWeb, modelosConFotos = [], imagenes = [] } = useApp();
  const [galeria, setGaleria] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [torito, setTorito] = useState(false);
  // HU-036: si se editaron sus fotos, la miniatura usa la foto principal de la galería
  const conFotos = (m) => { if (MODO_REAL) return m; const x = modelosConFotos.find((y) => y.id === m.id); return x?.fotoPropia && x.galeria ? { ...m, imagen: x.imagen, fotosColor: x.fotosColor, colorFoto: x.colorFoto, fotoPropia: true, imagenApi: undefined } : m; };
  const { puede } = useAuth();
  const enBase = MODO_REAL && puede("modelos.editar");

  // Con la base conectada, la lista sale solo de la base (gerencia y administración ven todos los modelos,
  // publicados o no; las demás cuentas, los publicados). Nada de modelos ni precios de ejemplo del front, ni
  // copias en el navegador: mientras carga se ve la espera, si falla la primera vez el error con «Reintentar», y si
  // falla una actualización posterior queda lo último que confirmó la base, con su hora.
  const consulta = useConsultaCentral(
    () => (enBase ? api.modelosAdminApi() : api.modelosPublicos()).then((r) => (Array.isArray(r.data) ? r.data : [])),
    [enBase], { activo: MODO_REAL, clave: `modelos-panel:${enBase ? "todos" : "publicados"}` });
  const admin = MODO_REAL ? consulta.data : null;
  const cargarAdmin = () => consulta.refrescar(true);
  const [guardando, setGuardando] = useState(false);

  // Unidades registradas de cada modelo: motos del inventario central unidas a su número de modelo (codmod)
  const inventario = useConsultaCentral(() => inventarioApi(), [], { activo: MODO_REAL, clave: "inventario::", intervalo: 30000 });
  const unidadesPorModelo = useMemo(() => {
    const c = new Map();
    for (const u of inventario.data?.unidades || []) if (u.codmod) c.set(String(u.codmod), (c.get(String(u.codmod)) || 0) + 1);
    return c;
  }, [inventario.data]);
  const unidadesDe = (m) => (!MODO_REAL ? unidades.filter((u) => u.modelo === m.id).length : inventario.data ? unidadesPorModelo.get(String(m.codmodApi)) || 0 : "—");

  // Modelos: con la base conectada, toda la información sale de ella (precio, colores, descripción, ficha de carmod,
  // fotos, origen y vínculo con torito.pe), igual que en la web
  const modelos = useMemo(() => {
    if (!MODO_REAL) return locales;
    if (!admin) return [];
    const ocupados = new Set();
    return admin.map((a) => {
      const b = modeloDesdeApi(a, ocupados);
      ocupados.add(b.id);
      return aplicarFotosCentrales({
        ...b, codtmo: a.codtmo, estmod: a.estmod, estado: estadoPanel(a.estmod), carmod: a.carmod || "",
        colores: COLORES.filter((c) => (a.colores || []).includes(c)), imagenesApi: a.imagenes || [],
      }, a.imagenes);
    }).sort(ordenCatalogo);
  }, [admin, locales]);
  const toast = useToast(); const confirmar = useConfirm();
  const [q, setQ] = useState(""); const [est, setEst] = useState(""); const [fam, setFam] = useState("");
  const [modal, setModal] = useState(null); const [f, setF] = useState(NUEVO); const [err, setErr] = useState({});
  const [publicarYa, setPublicarYa] = useState(true);
  const editar = puede("modelos.editar");
  const publica = puede("modelos.publicar");

  const lista = useMemo(() => modelos.filter((m) => (!q || m.nombre.toLowerCase().includes(q.toLowerCase())) && (!est || m.estado === est) && (!fam || m.familia === fam)), [modelos, q, est, fam]);

  const faltantes = (m) => enBase ? [!fotoActiva(m) ? "foto" : null, !m.descripcion?.trim() ? "descripción" : null].filter(Boolean) : [!m.descripcion || m.descripcion.trim().length < 40 ? "descripción (mín. 40 caracteres)" : null, !m.precioDesde ? "precio" : null, !m.imagen && !m.local ? "imagen" : null, !m.colores?.length ? "al menos un color" : null].filter(Boolean);

  function abrir(modelo) {
    setErr({});
    // Solo la vista de ejemplo propone su ficha local; con la base, la ficha oficial llega con «Traer información de
    // torito.pe» (y nunca a un modelo creado a mano)
    const s = !MODO_REAL && modelo?.fichaSugerida && !modelo.fichaCompleta ? modelo.fichaSugerida : null;
    const m = s ? { ...modelo, familia: s.familia, tipoMotor: s.tipoMotor, combustible: s.combustible, uso: s.uso, tipoTecho: s.tipoTecho, badges: s.badges, destacados: s.destacados, resumen: s.resumen, specs: s.specs, colorFoto: s.colorFoto || modelo.colorFoto, descripcion: modelo.descripcion || s.descripcion } : modelo;
    setF(m ? {
      ...m, badges: (m.badges || []).join(", "), precioDesde: String(m.precioDesde ?? m.precioSugerido ?? ""),
      colores: m.colores?.length ? m.colores : m.coloresSugeridos || m.colores || [],
      destacadosTxt: (m.destacados || []).join("\n"),
      cilindrada: m.resumen?.Cilindrada || "", potencia: m.resumen?.Potencia || "", torque: m.resumen?.Torque || "", llantas: m.resumen?.Llantas || "",
      ...Object.fromEntries(TABS.map((t) => [`spec_${t.id}`, aTexto(m.specs?.[t.id])])),
    } : NUEVO);
    setPublicarYa(true);
    setModal({ m: modelo });
  }
  async function subirFoto(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try { const url = await leerFoto(file); setF((p) => ({ ...p, imagen: url, fotoNueva: true })); setErr((p) => ({ ...p, imagen: undefined })); }
    catch (er) { setErr((p) => ({ ...p, imagen: er.message })); }
    e.target.value = "";
  }
  // Validación
  function validarModelo() {
    const x = {};
    const nombre = f.nombre.trim().replace(/\s+/g, " ");
    const precio = Number(f.precioDesde);
    if (nombre.length < 3 || !/\p{L}/u.test(nombre) || !slug(nombre)) x.nombre = "Ingresa el nombre del modelo (con letras, mínimo 3 caracteres).";
    else if (nombre.length > 60) x.nombre = "Máximo 60 caracteres.";
    else if (modelos.some((m) => m.nombre.toLowerCase() === nombre.toLowerCase() && m.id !== modal.m?.id)) x.nombre = "Ya existe un modelo con ese nombre.";
    if (!f.precioDesde || !Number.isInteger(precio) || precio < 1000 || precio > 999999) x.precioDesde = "Ingresa un precio entre S/ 1,000 y S/ 999,999 (sin decimales).";
    const desc = f.descripcion.trim();
    if (desc.length < 40 || (desc.match(/\p{L}/gu) || []).length < 20) x.descripcion = "La descripción debe tener al menos 40 caracteres (con palabras, no solo signos)."; else if (desc.length > 1200) x.descripcion = "Máximo 1200 caracteres.";
    if (f.badges.length > 120) x.badges = "Máximo 120 caracteres.";
    if (["cilindrada", "potencia", "torque", "llantas"].some((k) => String(f[k] || "").trim().length > 30)) x.datos = "Cada dato técnico admite como máximo 30 caracteres.";
    if (f.destacadosTxt.length > 600) x.destacados = "Máximo 600 caracteres.";
    if (TABS.some((t) => String(f[`spec_${t.id}`] || "").length > 2000)) x.specs = "Cada pestaña de la ficha técnica admite como máximo 2000 caracteres.";
    if (enBase && f.imagen?.startsWith("data:")) { /* foto elegida en la computadora: se sube al guardar */ }
    else if (enBase && f.imagen && !urlParaBase(f.imagen)) x.imagen = "Sube la foto desde tu computadora.";
    else if (f.imagen && !imagenValida(f.imagen)) x.imagen = "Usa un enlace https:// completo (con dominio), una ruta /images/... o sube una foto.";
    if (!f.colores.length) x.colores = "Elige al menos un color.";
    const quedaPublicado = modal.m ? modal.m.estado === "Publicado" : publicarYa && publica;
    const fotoCambio = f.fotoNueva || (modal.m && f.imagen !== modal.m.imagen);
    if (quedaPublicado && !f.imagen && (fotoCambio || !f.local)) x.imagen = "Un modelo publicado en la web necesita foto: súbela o enlázala.";
    setErr(x); return Object.keys(x).length === 0;
  }
  // Guardar, publicar y eliminar
  function guardar(e) {
    e.preventDefault();
    if (!validarModelo()) return;
    const motorResumen = String(f.resumen?.Motor || "").startsWith(f.tipoMotor) ? f.resumen.Motor : f.tipoMotor;
    const resumen = Object.fromEntries([["Motor", motorResumen], ["Cilindrada", f.cilindrada], ["Llantas", f.llantas], ["Potencia", f.potencia], ["Torque", f.torque]].filter(([, v]) => String(v).trim()));
    const specs = Object.fromEntries(TABS.map((t) => [t.id, aFilas(f[`spec_${t.id}`] || "")]));
    if (!specs.motor.length) specs.motor = [["Tipo de motor", f.tipoMotor], ["Combustible", f.combustible]];
    const limpio = Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith("spec_") && !["destacadosTxt", "cilindrada", "potencia", "torque", "llantas", "fotoNueva", "imagenApi"].includes(k)));
    limpio.colores = COLORES.filter((c) => f.colores.includes(c));
    if (!limpio.colores.includes(limpio.colorPortada)) limpio.colorPortada = limpio.colores[0];
    const fotoCambio = f.fotoNueva || (modal.m && f.imagen !== modal.m.imagen);
    if (fotoCambio) { limpio.fotosColor = {}; limpio.fotoPropia = true; limpio.local = ""; }
    if (modal.m) limpio.editadoEnPanel = true;
    const datos = {
      ...limpio, nombre: f.nombre.trim().replace(/\s+/g, " "), precioDesde: Number(f.precioDesde), descripcion: f.descripcion.trim(),
      badges: f.badges.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      destacados: f.destacadosTxt.split("\n").map((l) => l.trim()).filter(Boolean), resumen, specs,
    };
    if (enBase) return guardarEnBase(datos);
    if (modal.m) { actualizar("modelos", modal.m.id, datos, `Modelo editado: ${datos.nombre}`); toast(modal.m.estado === "Publicado" ? "Cambios guardados: ya se ven en la web" : "Cambios guardados"); }
    else {
      let id = slug(datos.nombre); if (modelos.some((m) => m.id === id)) id = `${id}-${Date.now().toString().slice(-4)}`;
      const estado = publicarYa && publica ? "Publicado" : "Borrador";
      agregar("modelos", { ...datos, id, codmod: String(Date.now()).slice(-6), estado, local: "", creadoEnPanel: true, fotoPropia: true, fotosColor: {} }, `Modelo creado${estado === "Publicado" ? " y publicado" : ""}: ${datos.nombre}`);
      toast(estado === "Publicado" ? `${datos.nombre} creado y ya visible en la web` : "Modelo creado como borrador. Publícalo para que aparezca en la web.");
    }
    setModal(null);
  }

  // Guardar en la base: crear o editar, foto y publicación
  async function guardarEnBase(datos) {
    const m = modal.m;
    // HU-036: la ficha completa (familia, motor, combustible, uso, destacados, resumen, pestañas y fotos por color) va en carmod
    // Un modelo creado aquí queda como «Origen: Manual»: la sincronización con torito.pe no lo vincula ni lo cambia.
    // Al editar se conservan su origen y su página de torito.pe (vienen de su ficha en la base).
    const origen = m?.codmodApi ? datos.origen : "Manual";
    const cuerpo = { codtmo: CODTMO[datos.familia] || datos.codtmo || "3", nommod: datos.nombre, marmod: "Bajaj", desmod: datos.descripcion, carmod: fichaATexto({ ...datos, origen }), premod: datos.precioDesde, colores: datos.colores };
    const url = datos.imagen?.startsWith("data:") ? "" : urlParaBase(datos.imagen) || (datos.local && urlParaBase(datos.local)) || "";
    setGuardando(true);
    let codmod = m?.codmodApi;
    try {
      if (codmod) await api.editarModeloApi(codmod, cuerpo);
      else {
        codmod = String((await api.crearModeloApi(cuerpo)).data.codmod);
        setModal((x) => (x ? { m: { ...datos, id: m?.id, codmodApi: codmod, imagenesApi: [], estado: "No publicado" } } : x));
      }
      // La foto principal solo se toca si se cambió en este formulario (las demás se manejan en «Fotos»).
      // Una foto elegida en la computadora se sube a Supabase Storage y queda registrada en la base.
      const actual = fotoActiva(m);
      if (datos.imagen?.startsWith("data:")) {
        const archivo = await archivoDeFoto(datos.imagen);
        if (actual) await reemplazarFotoModeloApi(codmod, actual.codimo, archivo, actual.ordimo || 1);
        else await subirFotoModeloApi(codmod, archivo, 1);
      } else if (url && !actual) await api.agregarImagenModeloApi(codmod, url);
      else if (url && datos.imagen !== m?.imagen && actual.urlimo !== url) await api.editarImagenModeloApi(codmod, actual.codimo, url);
      const publicar = !m?.codmodApi && publicarYa && publica;
      if (publicar) await api.estadoModeloApi(codmod, "Publicado");
      toast(publicar ? `${datos.nombre} guardado y publicado en la web` : m?.estado === "Publicado" ? "Cambios guardados: ya se ven en la web" : "Guardado sin publicar: ya se puede usar en el inventario. Publícalo para que aparezca en la web y en Compras.");
      setModal(null);
    } catch (e) { toast(mensajeError(e), "error"); }
    finally { setGuardando(false); await Promise.all([cargarAdmin(), refrescarWeb()]); }
  }

  async function alternar(m) {
    if (enBase) {
      if (m.soloLocal) return toast("Primero guarda este modelo con Editar y luego Guardar.", "error");
      const publicar = m.estado !== "Publicado";
      if (publicar && !fotoActiva(m)) return toast("No se puede publicar: falta la foto. Edítalo y usa «Subir foto».", "error");
      if (!publicar && !(await confirmar({ titulo: "Retirar de la web", texto: `${m.nombre} dejará de verse en el catálogo público y en Compras. Podrás publicarlo otra vez.`, boton: "Retirar" }))) return;
      try {
        await api.estadoModeloApi(m.codmodApi, publicar ? "Publicado" : "No publicado");
        toast(publicar ? `${m.nombre} ya está visible en la web y en Compras` : `${m.nombre} se retiró de la web`);
      } catch (e) { toast(mensajeError(e), "error"); }
      finally { await Promise.all([cargarAdmin(), refrescarWeb()]); }
      return;
    }
    if (m.estado !== "Publicado") {
      const f2 = faltantes(m);
      if (f2.length) return toast(`No se puede publicar: falta ${f2.join(", ")}.`, "error");
      actualizar("modelos", m.id, { estado: "Publicado" }, `Modelo publicado: ${m.nombre}`); toast(`${m.nombre} ya está visible en la web`);
    } else {
      if (!(await confirmar({ titulo: "Retirar de la web", texto: `${m.nombre} dejará de verse en el catálogo público. Podrás publicarlo otra vez.`, boton: "Retirar" }))) return;
      actualizar("modelos", m.id, { estado: "Borrador" }, `Modelo retirado: ${m.nombre}`); toast(`${m.nombre} se retiró de la web`);
    }
  }
  async function borrar(m) {
    const n = unidades.filter((u) => u.modelo === m.id).length;
    if (!(await confirmar({ titulo: "Eliminar modelo", texto: `Se eliminará ${m.nombre} del catálogo y desaparecerá de la web.${n ? ` Tiene ${n} unidades en inventario que conservarán su registro.` : ""} Esta acción no se puede deshacer.`, boton: "Eliminar", peligro: true }))) return;
    eliminar("modelos", m.id, `Modelo eliminado: ${m.nombre}`); toast("Modelo eliminado");
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <PageHeader titulo="Modelos" subtitulo="Lo que publiques, edites o elimines aquí cambia al instante en la web de clientes.">
        {MODO_REAL && <BarraActualizacion consulta={consulta} />}
        {enBase && <button className="btn btn-secondary !py-2.5" onClick={() => setTorito(true)} disabled={!admin} data-abrir-torito>Traer información de torito.pe</button>}
        {editar && <button className="btn btn-primary !py-2.5" onClick={() => abrir(null)} disabled={MODO_REAL && !admin}>+ Nuevo modelo</button>}
      </PageHeader>
      <InformacionTorito abierto={torito} modelos={admin || []} onClose={() => setTorito(false)} onHecho={() => { cargarAdmin(); refrescarWeb(); }} />
      {MODO_REAL && <AvisoConexion consulta={consulta} que="los modelos" />}
      <div className="mb-5 grid gap-3 rounded-xl2 border border-slate-100 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#121a2b] sm:grid-cols-3">
        <div><label className="field-label">Buscar</label><input className="field-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del modelo" /></div>
        <div><label className="field-label">Estado</label><select className="field-input" value={est} onChange={(e) => setEst(e.target.value)}><option value="">Todos</option>{ESTADOS_PANEL.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="field-label">Familia</label><select className="field-input" value={fam} onChange={(e) => setFam(e.target.value)}><option value="">Todas</option>{FAMILIAS.map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
      {/* Tabla de modelos */}
      {MODO_REAL && !admin ? (consulta.error ? null : <CargandoModelosPanel />) : lista.length === 0 ? <Vacio titulo="No hay modelos" texto="Crea un modelo nuevo o cambia los filtros." /> : (
        <Tabla columnas={["Modelo", "Familia", "Motor", "Desde", MODO_REAL ? "Unidades registradas" : "Unidades", "Estado", "Acciones"]}>
          {lista.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3"><div className="flex items-center gap-3"><ModeloImg modelo={conFotos(m)} className="h-12 w-16 shrink-0 rounded-md bg-marino-50 object-contain" /><div><p className="font-semibold text-marino dark:text-white">{m.nombre}</p><p className="max-w-[240px] truncate text-[12px] text-slate-400">{m.descripcion}</p></div></div></td>
              <td className="px-4 py-3">{m.familia}</td>
              <td className="px-4 py-3">{m.tipoMotor} · {m.combustible}</td>
              <td className="whitespace-nowrap px-4 py-3">{m.precioDesde ? formatoSoles(m.precioDesde) : <span className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-300" title="En la web sale «A consultar». Ponlo con Editar.">Sin precio</span>}</td>
              <td className="px-4 py-3" data-unidades-modelo={m.codmodApi || m.id} title={MODO_REAL ? "Motos registradas en el inventario con este modelo (incluye vendidas y no disponibles)" : undefined}>{unidadesDe(m)}</td>
              <td className="px-4 py-3"><Badge estado={m.estado} />{m.origen === "Manual" && <p className="mt-1 text-[11.5px] text-slate-400" data-origen-manual>Registro manual</p>}</td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                {m.estado === "Publicado" && <Link className={btnMini} to={`/modelos/${m.id}`} target="_blank">Ver en la web</Link>}
                {editar && <button className={btnMini} onClick={() => abrir(m)}>Editar</button>}
                {editar && (enBase
                  ? <button className={btnMini} onClick={() => setGaleria(m)} disabled={m.soloLocal} title={m.soloLocal ? "Guárdalo primero" : ""}>Fotos{(m.imagenesApi || []).length ? ` (${(m.imagenesApi || []).filter((i) => i.estimo).length})` : ""}</button>
                  : <button className={btnMini} onClick={() => setGaleria(m)}>Fotos{imagenes.filter((i) => i.modelo === m.id).length ? ` (${imagenes.filter((i) => i.modelo === m.id).length})` : ""}</button>)}
                {publica && <button className={btnMini} onClick={() => alternar(m)}>{m.estado === "Publicado" ? "Retirar" : "Publicar"}</button>}
                {puede("eliminar") && (enBase && m.codmodApi
                  ? <button className={btnMiniPeligro} onClick={() => setAEliminar(m)} data-eliminar-modelo={m.codmodApi}>Eliminar</button>
                  : !m.codmodApi && <button className={btnMiniPeligro} onClick={() => borrar(m)}>Eliminar</button>)}
              </div></td>
            </tr>
          ))}
        </Tabla>
      )}
      {!editar && <p className="mt-3 text-[12.5px] text-slate-400">Tu rol puede consultar el catálogo, pero no modificarlo.</p>}
      {editar && !puede("eliminar") && <p className="mt-3 text-[12.5px] text-slate-400">Eliminar modelos es una acción exclusiva de la gerencia.</p>}

      <ModalEliminarModelo modelo={aEliminar} onClose={() => setAEliminar(null)} imagen={aEliminar ? conFotos(aEliminar) : null}
        onRetirar={publica ? (m) => { setAEliminar(null); alternar(m); } : null}
        onEliminado={() => { setAEliminar(null); cargarAdmin(); refrescarWeb(); }} />

      {enBase ? <GaleriaCentral modelo={galeria} onClose={() => setGaleria(null)} onCambio={() => { cargarAdmin(); refrescarWeb(); }} />
        : <GaleriaModelo modelo={galeria} onClose={() => setGaleria(null)} />}

      {/* Nuevo / editar modelo */}
      <Modal abierto={!!modal} onClose={() => setModal(null)} titulo={modal?.m ? `Editar ${modal.m.nombre}` : "Nuevo modelo"} ancho="max-w-3xl"
        confirmarGuardar={modal?.m
          ? { titulo: "¿Guardar los cambios?", texto: modal.m.estado === "Publicado" ? `${modal.m.nombre} está publicado: los cambios se verán al instante en la web de clientes.` : "Los cambios se guardarán en el catálogo. El modelo sigue sin publicar hasta que lo publiques.", boton: "Guardar cambios", validar: validarModelo }
          : { titulo: "¿Crear este modelo?", texto: publicarYa && publica ? "Se creará y aparecerá en la web de clientes al instante." : MODO_REAL ? "Se creará sin publicar: queda guardado en la base para el inventario. Para que aparezca en la web y en Compras, publícalo desde la lista." : "Se creará como borrador. Para que aparezca en la web, publícalo desde la lista.", boton: "Crear modelo", validar: validarModelo }}
        pie={<><button className="btn btn-secondary !py-2" onClick={() => setModal(null)}>Cancelar</button><button form="f-mod" className="btn btn-primary !py-2" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button></>}>
        <form id="f-mod" onSubmit={guardar} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Campo etiqueta="Nombre" error={err.nombre}><input id="mod-nombre" className="field-input" maxLength={60} value={f.nombre} onChange={set("nombre")} /></Campo>
          <Campo etiqueta="Precio desde (S/)" error={err.precioDesde}><input id="mod-precio" className="field-input" inputMode="numeric" maxLength={6} value={f.precioDesde} onChange={(e) => setF({ ...f, precioDesde: soloDigitos(e.target.value, 6).replace(/^0+/, "") })} /></Campo>
          <Campo etiqueta="Familia"><select className="field-input" value={f.familia} onChange={set("familia")}>{FAMILIAS.map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="Tipo de motor"><select className="field-input" value={f.tipoMotor} onChange={set("tipoMotor")}>{FILTROS_CATALOGO.tipoMotor.map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="Combustible"><select className="field-input" value={f.combustible} onChange={set("combustible")}>{FILTROS_CATALOGO.combustible.map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="Uso"><select className="field-input" value={f.uso} onChange={set("uso")}>{FILTROS_CATALOGO.uso.map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="Descripción (se muestra en la web)" error={err.descripcion} className="sm:col-span-2"><textarea id="mod-desc" rows={4} maxLength={1220} className="field-input" value={f.descripcion} onChange={set("descripcion")} /></Campo>
          <Campo etiqueta="Foto del modelo" error={err.imagen} className="sm:col-span-2" ayuda="Elige la foto desde tu computadora (PNG, JPG o WebP, hasta 6 MB), ideal en el primer color marcado y con fondo transparente. Para los demás colores la web ajusta el tono.">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid h-28 w-36 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-white/15 dark:bg-white/5">
                {f.imagen ? <ModeloImg modelo={{ ...f, id: "vista", local: "" }} className="h-full w-full object-contain" /> : <span className="px-2 text-center text-[12px] text-slate-400">Sin foto</span>}
              </div>
              <div className="flex-1 space-y-2">
                {enBase ? (
                  <p className="text-[13px] text-slate-500" data-foto-estado>{f.imagen?.startsWith("data:") ? "Foto elegida. Se guardará en el almacenamiento al presionar «Guardar»." : f.imagen ? "Foto actual del modelo. Para cambiarla, sube otra." : "Todavía no tiene foto."}</p>
                ) : <input className="field-input" value={f.imagen?.startsWith("data:") ? "(foto subida desde tu computadora)" : f.imagen} readOnly={f.imagen?.startsWith("data:")} onChange={set("imagen")} placeholder="https://torito.pe/wp-content/uploads/…png" />}
                <div className="flex flex-wrap gap-2">
                  <label className={`${enBase ? "btn btn-primary !py-2 text-[13.5px]" : btnMini} cursor-pointer`}>{f.imagen ? "Cambiar foto" : "Subir foto"}<input id="mod-foto" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={subirFoto} /></label>
                  {f.imagen && <button type="button" className={btnMiniPeligro} onClick={() => setF({ ...f, imagen: "" })}>Quitar foto</button>}
                </div>
              </div>
            </div>
          </Campo>
          <Campo etiqueta="Etiquetas" error={err.badges} ayuda="Separadas por coma. Ej: NUEVO MODELO, PRECIO DE LANZAMIENTO" className="sm:col-span-2"><input className="field-input" maxLength={120} value={f.badges} onChange={set("badges")} /></Campo>
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-4">
            <Campo etiqueta="Cilindrada"><input className="field-input" maxLength={30} value={f.cilindrada} onChange={set("cilindrada")} placeholder="236.2 cc" /></Campo>
            <Campo etiqueta="Potencia"><input className="field-input" maxLength={30} value={f.potencia} onChange={set("potencia")} placeholder="10.73 HP" /></Campo>
            <Campo etiqueta="Torque"><input className="field-input" maxLength={30} value={f.torque} onChange={set("torque")} placeholder="20 Nm" /></Campo>
            <Campo etiqueta="Llantas"><input className="field-input" maxLength={30} value={f.llantas} onChange={set("llantas")} placeholder="4.00-8" /></Campo>
            {err.datos && <p className="text-[12px] font-medium text-acento sm:col-span-4">{err.datos}</p>}
          </div>
          <Campo etiqueta="Puntos destacados" error={err.destacados} ayuda="Uno por línea. Se muestran en la ficha del modelo." className="sm:col-span-2"><textarea rows={3} maxLength={600} className="field-input" value={f.destacadosTxt} onChange={set("destacadosTxt")} /></Campo>
          <details className="rounded-lg border border-slate-200 p-3 sm:col-span-2 dark:border-white/10">
            <summary className="cursor-pointer text-[13.5px] font-semibold text-marino dark:text-white">Ficha técnica (5 pestañas de la web)</summary>
            <p className="mt-1 text-[12px] text-slate-400">Una característica por línea con el formato <b>Nombre: valor</b>. Ej: Cilindrada: 236.2 cc</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {TABS.map((t) => <Campo key={t.id} etiqueta={t.t}><textarea rows={4} maxLength={2000} className="field-input font-mono text-[12.5px]" value={f[`spec_${t.id}`] || ""} onChange={set(`spec_${t.id}`)} /></Campo>)}
            </div>
            {err.specs && <p className="mt-2 text-[12px] font-medium text-acento">{err.specs}</p>}
          </details>
          {/* «relative»: el check oculto queda dentro de su botón; sin eso, al marcar un color el formulario se desplazaba y quedaba en blanco */}
          <Campo etiqueta="Colores ofrecidos" error={err.colores} className="sm:col-span-2" ayuda="Solo los colores marcados se ven en la web, en Cotizar y en Compras.">
            <div className="flex flex-wrap gap-2">{COLORES.map((c) => (
              <label key={c} data-color={c} className={`relative inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium ${f.colores.includes(c) ? "border-marino-700 bg-marino-700 text-white" : "border-slate-200 dark:border-white/15"}`}>
                <input type="checkbox" className="sr-only" checked={f.colores.includes(c)} onChange={() => setF({ ...f, colores: f.colores.includes(c) ? f.colores.filter((x) => x !== c) : [...f.colores, c] })} />
                <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/15" style={{ background: COLOR_HEX[c] }} />{c}</label>
            ))}</div>
          </Campo>
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
            <Campo etiqueta="¿De qué color es la foto?" ayuda="Desde ese color la web pinta los demás.">
              <select id="mod-color-foto" className="field-input" value={f.colorFoto || "Rojo"} onChange={set("colorFoto")}>{COLORES.map((c) => <option key={c}>{c}</option>)}</select>
            </Campo>
            <div>
              <span className="field-label">Así se verá en la web</span>
              <div className="flex flex-wrap gap-2" data-vista-colores>
                {COLORES.filter((c) => f.colores.includes(c)).map((c) => (
                  <figure key={c} className="w-[92px] rounded-lg bg-escenario p-1.5 text-center dark:bg-escenario-oscuro">
                    {f.imagen || f.local ? <ModeloImg modelo={{ ...f, id: "vista", fotosColor: f.fotoNueva ? {} : f.fotosColor, imagenApi: undefined }} color={c} className="h-14 w-full object-contain" /> : <div className="h-14" />}
                    <figcaption className="mt-1 flex items-center justify-center gap-1 text-[11.5px] font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_HEX[c] }} />{c}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
          {!modal?.m && publica && (
            <label className="flex items-center gap-2 text-[14px] font-medium sm:col-span-2"><input id="mod-publicar" type="checkbox" className="h-4 w-4 accent-[#0e2c52]" checked={publicarYa} onChange={(e) => setPublicarYa(e.target.checked)} />Publicar en la web al guardar</label>
          )}
        </form>
      </Modal>
    </div>
  );
}

// Filas de espera mientras llega la lista de modelos de la base
function CargandoModelosPanel() {
  return (
    <div className="space-y-2 rounded-xl2 border border-slate-100 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#121a2b]" data-cargando-modelos role="status" aria-live="polite">
      <span className="sr-only">Cargando modelos…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 py-2 motion-reduce:animate-none" aria-hidden="true">
          <div className="h-12 w-16 rounded-md bg-slate-200/80 dark:bg-white/10" />
          <div className="h-4 w-1/4 rounded bg-slate-200/80 dark:bg-white/10" />
          <div className="ml-auto h-4 w-1/3 rounded bg-slate-200/60 dark:bg-white/[0.07]" />
        </div>
      ))}
    </div>
  );
}

// Eliminar un modelo (solo gerencia): ventana con casilla de confirmación. Si el modelo tiene motos, compras o
// interesados, la base no lo borra y se ofrece retirarlo de la web.
function ModalEliminarModelo({ modelo, imagen, onClose, onEliminado, onRetirar }) {
  const toast = useToast();
  const [seguro, setSeguro] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSeguro(false); setError(""); }, [modelo?.codmodApi]);
  if (!modelo) return null;
  async function eliminarYa() {
    if (!seguro || borrando) return;
    setBorrando(true); setError("");
    try {
      const r = await api.eliminarModeloApi(modelo.codmodApi);
      // Fotos que estaban en nuestro almacenamiento: ya no las usa ningún modelo
      const rutas = (r?.fotos || []).map(rutaEnStorage).filter(Boolean);
      if (rutas.length) await api.borrarArchivoStorage(api.BUCKET_FOTOS, rutas).catch(() => {});
      toast(`${modelo.nombre} se eliminó`);
      onEliminado(modelo);
    } catch (e) { setError(mensajeError(e)); }
    finally { setBorrando(false); }
  }
  const bloqueado = /no se puede eliminar/i.test(error);
  return (
    <Modal abierto onClose={onClose} titulo="Eliminar modelo" ancho="max-w-lg"
      pie={<>
        <button type="button" className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button>
        {bloqueado && onRetirar && modelo.estado === "Publicado"
          ? <button type="button" className="btn btn-primary !py-2" onClick={() => onRetirar(modelo)}>Retirar de la web</button>
          : <button type="button" data-confirmar-eliminar className="btn !py-2 bg-acento text-white hover:bg-acento-600 disabled:cursor-not-allowed disabled:opacity-40" disabled={!seguro || borrando || bloqueado} onClick={eliminarYa}>{borrando ? "Eliminando…" : "Eliminar modelo"}</button>}
      </>}>
      <div data-modal-eliminar>
        <h3 className="text-[18px] font-bold leading-snug text-marino dark:text-white">¿Estás seguro de que deseas eliminar el {modelo.nombre}?</h3>
        <p className="mt-1 text-[14px] text-slate-500">Se borrará el modelo con sus colores y fotos, y dejará de verse en la web. Esta acción no se puede deshacer.</p>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-marino-50 p-3 dark:bg-white/5">
          <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-white dark:bg-white/10">{imagen && <ModeloImg modelo={imagen} className="h-full w-full object-contain" />}</div>
          <div><p className="font-semibold text-marino dark:text-white">{modelo.nombre} <Badge estado={modelo.estado} /></p><p className="text-[12.5px] text-slate-500">{modelo.familia}{modelo.precioDesde ? ` · ${formatoSoles(modelo.precioDesde)}` : ""}</p></div>
        </div>
        <label className="mt-4 flex items-start gap-2 text-[14px] font-semibold text-marino dark:text-white">
          <input type="checkbox" data-casilla-eliminar className="mt-0.5 h-4 w-4 accent-[#c62828]" checked={seguro} onChange={(e) => setSeguro(e.target.checked)} disabled={bloqueado} />
          Sí, entiendo que el modelo se eliminará para siempre.
        </label>
        {error && <div className="mt-3"><Aviso tipo={bloqueado ? "aviso" : "error"}>{error}</Aviso></div>}
      </div>
    </Modal>
  );
}
