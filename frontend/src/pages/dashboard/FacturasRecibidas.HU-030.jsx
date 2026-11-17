// HU-030 · Facturas recibidas (gerente y administradora)
// Las facturas de Crosland llegan a Gmail y el proceso automático (Apps Script cada 5 minutos → API) las registra
// solas: compra, una ficha por moto en Almacén Crosland Ancón y sin duplicados. Aquí se ven todas, sus motos y lo
// que quedó por revisar; también se puede subir el XML de una factura y asignar los códigos de producto de
// Crosland a cada modelo. Todo se lee y guarda en la base central (docs/supabase-sprint2-mejoras.sql).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { MODO_REAL } from "../../lib/config";
import { codigosCroslandApi, correosRecibidosApi, desactivarCodigoCroslandApi, documentosRecibidosApi, guardarCodigoCroslandApi, modelosAdminApi, recepcionesConErrorApi } from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { useConsultaCentral } from "../../servicios/central";
import { formatoDia } from "../../lib/validar";
import { ESTADO_DOCUMENTO, TONO_DOCUMENTO, leerFactura, prepararFactura, registrarFactura, textoCodigo } from "../../servicios/facturas";
import { Aviso, Campo, Card, Modal, PageHeader, Stat, Tabla, Vacio, btnMini, useConfirm, useToast } from "../../components/ui";
import { Pestanas, Pill } from "../../components/dashboard/Sprint2";
import { AvisoConexion, BarraActualizacion, fechaCompleta } from "../../components/dashboard/Central";
import SeccionPendiente from "../../components/dashboard/SeccionPendiente";

export { TONO_DOCUMENTO };
const soles = (n) => (n == null || n === "" ? "—" : `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
// Avisos para la persona (la diferencia de codificación del XML de Crosland es normal y no se muestra)
const avisos = (lista = []) => lista.filter((c) => c !== "ENCODING_DECLARADO_NO_COINCIDE").map(textoCodigo).join(" ");
const fecha = (d) => (d ? formatoDia(d, { day: "numeric", month: "short", year: "numeric" }).replace(".", "") || "—" : "—");

export default function FacturasRecibidas() {
  const [params, setParams] = useSearchParams();
  const pestana = params.get("pestana") || "facturas";
  const cambiar = (p) => setParams(p === "facturas" ? {} : { pestana: p });
  if (!MODO_REAL) {
    return (
      <div>
        <PageHeader titulo="Facturas recibidas" subtitulo="Facturas de Crosland que llegan por correo y registran solas la compra y sus motos." />
        <Aviso>Aquí aparecen las facturas que llegan al correo de compras. En la vista de ejemplo no hay correos que leer.</Aviso>
      </div>
    );
  }
  return (
    <div data-hu030>
      <PageHeader titulo="Facturas recibidas" subtitulo="Las facturas de Crosland llegan al correo y cada 5 minutos se registran solas: la compra y una ficha por moto en Almacén Crosland Ancón. Esta lista se actualiza sola. También puedes subir una factura aquí." />
      <div className="mb-5">
        <Pestanas etiqueta="Secciones" valor={pestana} onCambio={cambiar} opciones={[
          { id: "facturas", label: "Facturas" }, { id: "correos", label: "Correos recibidos" }, { id: "subir", label: "Subir factura" }, { id: "codigos", label: "Códigos de Crosland" },
        ]} />
      </div>
      {pestana === "facturas" && <Facturas />}
      {pestana === "correos" && <CorreosRecibidos />}
      {pestana === "subir" && <SubirFactura />}
      {pestana === "codigos" && <CodigosCrosland codigoInicial={params.get("codigo") || ""} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Lista de facturas
// ---------------------------------------------------------------------------------------------
function Facturas() {
  const consulta = useConsultaCentral(() => documentosRecibidosApi().then((r) => (Array.isArray(r) ? r : [])), [], { clave: "hu030-documentos" });
  const errores = useConsultaCentral(() => recepcionesConErrorApi().then((r) => (Array.isArray(r) ? r : [])), [], { clave: "hu030-errores", intervalo: 30000 });
  const [estado, setEstado] = useState("");
  const [texto, setTexto] = useState("");
  const docs = useMemo(() => consulta.data || [], [consulta.data]);
  const q = texto.trim().toLowerCase();
  const lista = docs.filter((d) => (!estado || (estado === "revisar" ? ["Pendiente de revision", "Importado parcialmente", "Error"].includes(d.estado) : d.estado === estado))
    && (!q || `${d.factura} ${d.proveedor || ""}`.toLowerCase().includes(q)));
  if (consulta.error?.detalle?.faltaSql) return <SeccionPendiente titulo="Facturas recibidas" />;
  const porRevisar = docs.filter((d) => ["Pendiente de revision", "Importado parcialmente", "Error"].includes(d.estado)).length;
  return (
    <div data-facturas>
      <AvisoConexion consulta={consulta} que="las facturas" />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat etiqueta="Facturas" valor={consulta.data ? docs.length : "—"} nota="Del correo y del panel" />
        <Stat etiqueta="Importadas" valor={consulta.data ? docs.filter((d) => d.estado === "Importado").length : "—"} tono="verde" />
        <Stat etiqueta="Por revisar" valor={consulta.data ? porRevisar : "—"} tono={porRevisar ? "ambar" : "marino"} nota="Líneas o motos que no entraron" />
        <Stat etiqueta="Motos ingresadas" valor={consulta.data ? docs.reduce((s, d) => s + Number(d.motosIngresadas || 0), 0) : "—"} nota="Quedan en Almacén Crosland Ancón" />
      </div>
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><label className="field-label" htmlFor="fr-buscar">Buscar</label><input id="fr-buscar" className="field-input" value={texto} maxLength={60} onChange={(e) => setTexto(e.target.value)} placeholder="Serie y número, por ejemplo F067-00015880" /></div>
          <div><label className="field-label" htmlFor="fr-estado">Estado</label>
            <select id="fr-estado" className="field-input" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todas</option><option value="revisar">Por revisar</option>
              {Object.entries(ESTADO_DOCUMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="flex items-end"><BarraActualizacion consulta={consulta} /></div>
        </div>
      </Card>
      {consulta.data && lista.length === 0 ? (
        <Vacio titulo={docs.length ? "No hay facturas con ese filtro" : "Todavía no hay facturas recibidas"} texto={docs.length ? "Cambia el filtro o la búsqueda." : "Llegan solas desde el correo cada 5 minutos. También puedes subir una en «Subir factura»."} />
      ) : consulta.data && (
        <Tabla columnas={["Recibida", "Factura", "Origen", "Motos", "Total", "Estado", ""]}>
          {lista.map((d) => (
            <tr key={d.coddoc} className="align-top" data-documento={d.factura}>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{d.recibida ? fechaCompleta(d.recibida) : "—"}<span className="block text-[12px] text-slate-400">Emitida {fecha(d.emitida)}</span></td>
              <td className="px-4 py-3"><Link className="font-semibold text-marino hover:underline dark:text-white" to={`/admin/facturas-recibidas/${d.coddoc}`}>{d.factura}</Link><span className="block text-[12px] text-slate-400">{d.proveedor}</span></td>
              <td className="px-4 py-3">{d.origen === "Correo" ? "Correo automático" : "Subida en el panel"}</td>
              <td className="px-4 py-3"><b className="text-marino dark:text-white">{d.motosIngresadas}</b> de {d.motos} ingresada{Number(d.motos) === 1 ? "" : "s"}{Number(d.revision) > 0 && <span className="block text-[12px] font-semibold text-orange-700 dark:text-orange-300">{d.revision} línea{Number(d.revision) === 1 ? "" : "s"} por revisar</span>}</td>
              <td className="whitespace-nowrap px-4 py-3">{soles(d.total)}</td>
              <td className="px-4 py-3"><Pill tono={TONO_DOCUMENTO[d.estado] || "gris"}>{ESTADO_DOCUMENTO[d.estado] || d.estado}</Pill>{d.error && <span className="mt-1 block max-w-[16rem] text-[12px] text-slate-500">{textoCodigo(d.error)}</span>}</td>
              <td className="px-4 py-3"><Link className={btnMini} to={`/admin/facturas-recibidas/${d.coddoc}`}>Ver detalle</Link></td>
            </tr>
          ))}
        </Tabla>
      )}
      {(errores.data || []).length > 0 && (
        <Card className="mt-6" data-recepciones-error>
          <p className="font-semibold text-marino dark:text-white">Correos que no se pudieron procesar</p>
          <p className="mb-3 text-[13px] text-slate-500">El proceso automático los vuelve a intentar. Si el problema sigue, revisa el correo o sube la factura aquí.</p>
          <ul className="space-y-1.5 text-[13.5px]">
            {errores.data.slice(0, 10).map((r) => <li key={r.codrec} className="flex flex-wrap gap-x-3"><span className="text-slate-400">{fechaCompleta(r.recibida)}</span><span>{textoCodigo(r.error)}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Correos recibidos: cada correo con factura que leyó el proceso automático y cómo quedó
// (los mismos estados que el proceso marca como etiquetas en Gmail)
// ---------------------------------------------------------------------------------------------
const TONO_CORREO = { Procesado: "verde", "En revisión": "naranja", Pendiente: "celeste", Error: "rojo" };
const NOTA_CORREO = {
  Procesado: "La factura se registró con su compra y sus motos.",
  "En revisión": "La factura se registró, pero hay líneas o motos por revisar.",
  Pendiente: "Se está procesando; el proceso lo vuelve a revisar solo.",
  Error: "No se pudo procesar. El proceso lo reintenta; si sigue, revisa el correo.",
};
function CorreosRecibidos() {
  const consulta = useConsultaCentral(async () => {
    try { return { lista: await correosRecibidosApi(), completo: true }; }
    catch (e) {
      if (!e?.detalle?.faltaSql) throw e;
      const errores = await recepcionesConErrorApi();
      return { lista: (errores || []).map((r) => ({ ...r, recibido: r.recibida, estado: "Error" })), completo: false };
    }
  }, [], { clave: "hu030-correos" });
  const lista = consulta.data?.lista || [];
  const cuenta = (e) => lista.filter((c) => c.estado === e).length;
  return (
    <div data-correos>
      <AvisoConexion consulta={consulta} que="los correos recibidos" />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {["Procesado", "En revisión", "Pendiente", "Error"].map((e) => <Stat key={e} etiqueta={e} valor={consulta.data ? cuenta(e) : "—"} tono={{ Procesado: "verde", "En revisión": "ambar", Error: "rojo" }[e] || "marino"} nota={NOTA_CORREO[e]} />)}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-slate-500">El proceso revisa el correo de compras cada 5 minutos y deja cada correo con una de estas etiquetas.{lista[0] ? ` Último correo: ${fechaCompleta(lista[0].recibido)}.` : ""}</p>
        <BarraActualizacion consulta={consulta} />
      </div>
      {consulta.data && !consulta.data.completo && <div className="mb-3"><Aviso tipo="aviso">Se muestran solo los correos con error. Para ver todos, ejecuta en Supabase el SQL de mejoras finales.</Aviso></div>}
      {consulta.data && lista.length === 0 ? <Vacio titulo="Todavía no llegan correos con facturas" texto="Cuando llegue un correo con el XML y el PDF de una factura de Crosland, aparecerá aquí en unos minutos." /> : consulta.data && (
        <Tabla columnas={["Recibido", "Etiqueta", "Factura", "Motos", "Archivos", "Detalle"]}>
          {lista.map((c) => (
            <tr key={c.codrec} className="align-top" data-correo={c.estado}>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fechaCompleta(c.recibido)}{Number(c.revisiones) > 1 && <span className="block text-[12px] text-slate-400">Revisado {c.revisiones} veces, sin duplicar</span>}</td>
              <td className="px-4 py-3"><Pill tono={TONO_CORREO[c.estado] || "gris"}>{c.estado}</Pill></td>
              <td className="px-4 py-3">{c.coddoc ? <Link className="font-semibold text-marino hover:underline dark:text-white" to={`/admin/facturas-recibidas/${c.coddoc}`}>{c.factura}</Link> : <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-3">{c.coddoc ? `${c.motos || 0} ingresada${Number(c.motos) === 1 ? "" : "s"}` : "—"}</td>
              <td className="px-4 py-3 text-[12.5px]">{c.xml ? "XML" : ""}{c.xml && c.pdf ? " y " : ""}{c.pdf ? "PDF" : ""}{!c.xml && !c.pdf ? <span className="text-slate-400">Sin archivos</span> : ""}</td>
              <td className="max-w-[22rem] px-4 py-3 text-[12.5px] text-slate-500">{c.error ? textoCodigo(c.error) : NOTA_CORREO[c.estado]}</td>
            </tr>
          ))}
        </Tabla>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Subir una factura: solo el XML, que es de donde salen modelos, motores, chasis y cantidades; se revisa antes de registrar
// ---------------------------------------------------------------------------------------------
function SubirFactura() {
  const toast = useToast();
  const nav = useNavigate();
  const [revision, setRevision] = useState({ estado: "vacio" }); // vacio | leyendo | listo | error
  const [registrando, setRegistrando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function revisar(archivo) {
    setResultado(null);
    if (!archivo) { setRevision({ estado: "vacio" }); return; }
    if (!/\.xml$/i.test(archivo.name) && !/xml/i.test(archivo.type)) { setRevision({ estado: "error", error: "Elige el archivo .xml de la factura." }); return; }
    setRevision({ estado: "leyendo" });
    try {
      const lectura = await leerFactura(archivo);
      const preparada = lectura.validacion.valido ? await prepararFactura(lectura) : null;
      setRevision({ estado: "listo", lectura, preparada });
    } catch (e) { setRevision({ estado: "error", error: mensajeError(e) }); }
  }

  async function registrar() {
    if (registrando || revision.estado !== "listo") return;
    setRegistrando(true);
    try {
      const r = await registrarFactura(revision.lectura, revision.preparada);
      setResultado(r);
      toast(r.estadoDocumento === "Importado" ? `Factura registrada: ${r.conteos?.importados || 0} moto(s) ingresada(s)` : `Factura registrada como «${ESTADO_DOCUMENTO[r.estadoDocumento] || r.estadoDocumento}»`);
    } catch (e) { toast(mensajeError(e), "error"); }
    finally { setRegistrando(false); }
  }

  const doc = revision.lectura?.documento;
  const lineas = doc ? doc.lineas.map((l, i) => ({ ...l, ...revision.preparada?.clasificacion[i] })) : [];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" data-subir-factura>
      <Card>
        <p className="font-semibold text-marino dark:text-white">Archivo de la factura</p>
        <p className="mb-4 text-[13px] text-slate-500">Sube el XML que Crosland envía con la factura: de ahí se leen los modelos, motores, chasis y cantidades.</p>
        <div className="space-y-4">
          <Campo etiqueta="XML de la factura"><input id="fac-xml" type="file" accept=".xml,text/xml,application/xml" className="field-input" onChange={(e) => revisar(e.target.files?.[0] || null)} /></Campo>
          {revision.estado === "leyendo" && <Aviso>Leyendo la factura…</Aviso>}
          {revision.estado === "error" && <div data-error-factura><Aviso tipo="error">{revision.error}</Aviso></div>}
          {revision.estado === "listo" && !revision.lectura.validacion.valido && (
            <div data-error-factura><Aviso tipo="error">No se puede registrar: {revision.lectura.validacion.errores.map(textoCodigo).join(" ")}</Aviso></div>
          )}
          <button className="btn btn-primary w-full !py-2.5" disabled={registrando || revision.estado !== "listo" || !revision.lectura.validacion.valido || Boolean(resultado)} onClick={registrar} data-registrar-factura>
            {registrando ? "Registrando…" : "Registrar factura"}
          </button>
          <p className="text-[12.5px] text-slate-400">Si la factura ya estaba registrada, no se duplica: se vuelve a procesar solo lo pendiente.</p>
        </div>
      </Card>

      <div className="space-y-4">
        {doc && (
          <Card data-vista-previa>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-[12.5px] text-slate-400">Factura</p><p className="text-lg font-bold text-marino dark:text-white">{doc.idDocumento}</p></div>
              <div className="text-right"><p className="text-[12.5px] text-slate-400">Total</p><p className="font-bold text-marino dark:text-white">{soles(doc.totales.totalPagar)}</p></div>
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
              <div><dt className="text-slate-400">Emitida</dt><dd>{fecha(doc.fechaEmision)}</dd></div>
              <div><dt className="text-slate-400">Proveedor</dt><dd>{doc.razonSocialEmisor} · {doc.rucEmisor}</dd></div>
              <div><dt className="text-slate-400">Cliente</dt><dd>{doc.razonSocialComprador} · {doc.rucComprador}</dd></div>
              <div><dt className="text-slate-400">Líneas</dt><dd>{doc.lineas.length}</dd></div>
            </dl>
            {avisos(revision.lectura.validacion.advertencias) && <p className="mt-2 text-[12.5px] text-slate-500">{avisos(revision.lectura.validacion.advertencias)}</p>}
            <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 text-[13.5px] dark:divide-white/10 dark:border-white/10">
              {lineas.map((l) => (
                <li key={l.numeroLinea} className="px-4 py-2.5" data-linea-previa={l.clasificacion || ""}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><b className="text-marino dark:text-white">{l.descripcion}</b> <span className="text-slate-400">· {l.codigoExterno} · {Number(l.cantidad)} und.</span></span>
                    <Pill tono={l.clasificacion === "Vehiculo" ? (l.estado === "Revision" ? "naranja" : "verde") : l.clasificacion === "Accesorio" ? "gris" : "naranja"}>
                      {l.clasificacion === "Vehiculo" ? (l.estado === "Revision" ? "Moto por revisar" : "Moto") : l.clasificacion === "Accesorio" ? "Accesorio (no entra al inventario)" : "Código desconocido"}
                    </Pill>
                  </div>
                  {(l.vehiculos || []).map((v) => <p key={v.motor} className="mt-1 text-[12.5px] text-slate-500">Motor {v.motor} · Chasis {v.chasis} · {v.color}{v.anioModelo ? ` · ${v.anioModelo}` : ""}</p>)}
                  {l.estado === "Revision" && <p className="mt-1 text-[12.5px] font-medium text-orange-700 dark:text-orange-300">{(l.motivos?.length ? l.motivos : [l.motivo]).map(textoCodigo).join(" ")}</p>}
                </li>
              ))}
            </ul>
            {revision.preparada?.grupos?.length > 0 && <p className="mt-3 text-[13px] text-slate-500">Al registrarla entra{revision.preparada.grupos.reduce((n, g) => n + g.cantidad, 0) === 1 ? "" : "n"} {revision.preparada.grupos.map((g) => `${g.cantidad} moto${g.cantidad === 1 ? "" : "s"} de color ${g.color.toLowerCase()}`).join(" y ")} al inventario, en Almacén Crosland Ancón.</p>}
          </Card>
        )}
        {resultado && (
          <Card data-resultado-factura>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-marino dark:text-white">Resultado</p>
              <Pill tono={TONO_DOCUMENTO[resultado.estadoDocumento] || "gris"}>{ESTADO_DOCUMENTO[resultado.estadoDocumento] || resultado.estadoDocumento}</Pill>
            </div>
            <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-300">{resultado.conteos?.importados || 0} de {resultado.conteos?.vehiculos || 0} moto{Number(resultado.conteos?.vehiculos) === 1 ? "" : "s"} ingresada{Number(resultado.conteos?.vehiculos) === 1 ? "" : "s"}{resultado.reintento ? " (la factura ya estaba registrada; no se duplicó)" : ""}.</p>
            {resultado.error && <p className="mt-1 text-[13px] text-acento">{textoCodigo(resultado.error)}</p>}
            {(resultado.lineasRevision || []).map((l) => <p key={l.numeroLinea} className="mt-1 text-[13px] text-orange-700 dark:text-orange-300">Línea {l.numeroLinea}{l.codigo ? ` (${l.codigo})` : ""}: {textoCodigo(l.motivo)}</p>)}
            {(resultado.avisos || []).map((a) => <p key={a} className="mt-1 text-[12.5px] text-slate-500">{a}</p>)}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary !py-2" onClick={() => nav(`/admin/facturas-recibidas/${resultado.coddoc}`)}>Ver la factura</button>
              {(resultado.compras || []).map((c) => <Link key={c.codcom} className="btn btn-secondary !py-2" to={`/admin/compras/${c.codcom}`}>Compra N° {c.codcom}</Link>)}
              <Link className="btn btn-secondary !py-2" to="/admin/inventario">Ver en Inventario</Link>
            </div>
          </Card>
        )}
        {!doc && revision.estado !== "leyendo" && <Vacio titulo="Elige el XML de la factura" texto="Verás qué motos trae, sus motores y chasis, y qué líneas son accesorios, antes de registrarla." />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Códigos de producto de Crosland → modelo (un código desconocido nunca crea ni publica un modelo)
// ---------------------------------------------------------------------------------------------
function CodigosCrosland({ codigoInicial }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const consulta = useConsultaCentral(() => codigosCroslandApi().then((r) => (Array.isArray(r) ? r : [])), [], { clave: "hu030-codigos" });
  const [modelos, setModelos] = useState([]);
  const [editar, setEditar] = useState(codigoInicial ? { codigo: codigoInicial, clasificacion: "Vehiculo", codmod: "", observacion: "" } : null);
  useEffect(() => { modelosAdminApi().then((r) => setModelos(Array.isArray(r.data) ? r.data : [])).catch(() => setModelos([])); }, []);
  if (consulta.error?.detalle?.faltaSql) return <SeccionPendiente titulo="Códigos de Crosland" />;

  async function desactivar(c) {
    if (!(await confirmar({ titulo: "Desactivar código", texto: `Las próximas facturas con ${c.codigo} quedarán por revisar hasta que lo vuelvas a asignar.`, boton: "Desactivar" }))) return;
    try { await desactivarCodigoCroslandApi(c.codequ); toast(`${c.codigo} desactivado`); consulta.refrescar(true); }
    catch (e) { toast(mensajeError(e), "error"); }
  }
  const lista = consulta.data || [];
  return (
    <div data-codigos-crosland>
      <AvisoConexion consulta={consulta} que="los códigos" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-slate-500">Cada línea de la factura trae un código de producto de Crosland. Aquí se indica a qué modelo corresponde cada código de moto, o si es un accesorio (aceite, bonificación) que no entra al inventario.</p>
        <button className="btn btn-primary !py-2.5" onClick={() => setEditar({ codigo: "", clasificacion: "Vehiculo", codmod: "", observacion: "" })} data-nuevo-codigo>+ Asignar código</button>
      </div>
      {consulta.data && lista.length === 0 ? <Vacio titulo="Todavía no hay códigos asignados" /> : consulta.data && (
        <Tabla columnas={["Código", "Es", "Modelo", "Estado", "Asignado", ""]}>
          {lista.map((c) => (
            <tr key={c.codequ} data-codigo={c.codigo}>
              <td className="px-4 py-3 font-mono font-semibold text-marino dark:text-white">{c.codigo}</td>
              <td className="px-4 py-3">{c.clasificacion === "Vehiculo" ? "Moto" : "Accesorio"}</td>
              <td className="px-4 py-3">{c.modelo || <span className="text-slate-400">—</span>}{c.observacion && <span className="block max-w-[18rem] text-[12px] text-slate-400">{c.observacion}</span>}</td>
              <td className="px-4 py-3"><Pill tono={c.activa ? "verde" : "gris"}>{c.activa ? "Activo" : "Inactivo"}</Pill></td>
              <td className="px-4 py-3 text-[12.5px] text-slate-500">{c.aprobado ? fechaCompleta(c.aprobado) : "—"}<span className="block">{c.aprobadoPor || c.fuente || ""}</span></td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                {c.activa && <button className={btnMini} onClick={() => setEditar({ codigo: c.codigo, clasificacion: c.clasificacion, codmod: c.codmod || "", observacion: c.observacion || "" })}>Cambiar</button>}
                {c.activa && <button className={btnMini} onClick={() => desactivar(c)}>Desactivar</button>}
              </div></td>
            </tr>
          ))}
        </Tabla>
      )}
      <ModalCodigo datos={editar} modelos={modelos} onClose={() => setEditar(null)} onHecho={() => consulta.refrescar(true)} />
    </div>
  );
}

function ModalCodigo({ datos, modelos, onClose, onHecho }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setF(datos); setErr({}); }, [datos]);
  if (!datos || !f) return null;
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErr({}); };
  async function guardar(e) {
    e.preventDefault();
    const x = {};
    const codigo = String(f.codigo || "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,119}$/.test(codigo)) x.codigo = "Escribe el código tal como sale en la factura.";
    if (f.clasificacion === "Vehiculo" && !f.codmod) x.codmod = "Elige el modelo de moto.";
    if (String(f.observacion || "").length > 300) x.observacion = "Máximo 300 caracteres.";
    setErr(x); if (Object.keys(x).length) return;
    setEnviando(true);
    try {
      await guardarCodigoCroslandApi({ ...f, codigo });
      toast(`Código ${codigo} guardado. Las facturas que lo tenían por revisar se pueden volver a procesar.`);
      onHecho?.(); onClose();
    } catch (er) { setErr({ general: mensajeError(er) }); }
    finally { setEnviando(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo="Código de Crosland" ancho="max-w-lg"
      pie={<><button className="btn btn-secondary !py-2" onClick={onClose}>Cancelar</button><button form="f-codigo" className="btn btn-primary !py-2" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button></>}>
      <form id="f-codigo" onSubmit={guardar} className="space-y-4" noValidate>
        <Campo etiqueta="Código en la factura" error={err.codigo}><input id="cod-codigo" className="field-input font-mono uppercase" maxLength={120} value={f.codigo} onChange={set("codigo")} placeholder="Ej: B3-4TLPG250UG4V" /></Campo>
        <Campo etiqueta="¿Qué es?"><select id="cod-clase" className="field-input" value={f.clasificacion} onChange={set("clasificacion")}><option value="Vehiculo">Moto (entra al inventario)</option><option value="Accesorio">Accesorio o bonificación (no entra)</option></select></Campo>
        {f.clasificacion === "Vehiculo" && (
          <Campo etiqueta="Modelo" error={err.codmod}><select id="cod-modelo" className="field-input" value={f.codmod} onChange={set("codmod")}>
            <option value="">Elige el modelo</option>
            {modelos.map((m) => <option key={m.codmod} value={m.codmod}>{m.nommod}</option>)}
          </select></Campo>
        )}
        <Campo etiqueta="Nota (opcional)" error={err.observacion}><input className="field-input" maxLength={320} value={f.observacion} onChange={set("observacion")} placeholder="Ej: confirmado con Crosland" /></Campo>
        {err.general && <Aviso tipo="error">{err.general}</Aviso>}
      </form>
    </Modal>
  );
}
