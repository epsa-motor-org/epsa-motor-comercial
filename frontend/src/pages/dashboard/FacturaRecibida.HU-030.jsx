// HU-030 · Detalle de una factura recibida (gerente y administradora)
// Muestra cada línea de la factura (motos, accesorios y lo que quedó por revisar), las motos que entraron al inventario
// con su ubicación, la compra vinculada y cada intento de procesamiento. Desde aquí se abre el PDF o el XML guardados
// y se vuelve a procesar la factura después de asignar un código de Crosland (sin duplicar nada).
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { MODO_REAL } from "../../lib/config";
import { BUCKET_FACTURAS, documentoRecibidoApi, urlFirmadaStorage } from "../../lib/api";
import { mensajeError } from "../../lib/errores";
import { useConsultaCentral } from "../../servicios/central";
import { formatoDia } from "../../lib/validar";
import { ESTADO_DOCUMENTO, TONO_DOCUMENTO, reprocesarFactura, textoCodigo } from "../../servicios/facturas";
import { Aviso, Card, PageHeader, Tabla, Vacio, btnMini, useToast } from "../../components/ui";
import { Pill } from "../../components/dashboard/Sprint2";
import { AvisoConexion, BarraActualizacion, capital, fechaCompleta } from "../../components/dashboard/Central";
import SeccionPendiente from "../../components/dashboard/SeccionPendiente";

const soles = (n) => (n == null || n === "" ? "—" : `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fecha = (d) => (d ? formatoDia(d, { day: "numeric", month: "short", year: "numeric" }).replace(".", "") || "—" : "—");
const TONO_LINEA = { Procesada: "verde", Revision: "naranja", Error: "rojo", Pendiente: "gris", Omitida: "gris" };
const ESTADO_LINEA = { Procesada: "Lista", Revision: "Por revisar", Error: "Error", Pendiente: "Pendiente", Omitida: "Omitida" };

export default function FacturaRecibida() {
  const { id } = useParams();
  const toast = useToast();
  const consulta = useConsultaCentral(() => documentoRecibidoApi(id), [id], { clave: `hu030-doc:${id}`, activo: MODO_REAL });
  const [procesando, setProcesando] = useState(false);
  if (!MODO_REAL) return <Aviso>Las facturas recibidas se ven con la base conectada.</Aviso>;
  if (consulta.error?.detalle?.faltaSql) return <SeccionPendiente titulo="Factura recibida" />;
  const d = consulta.data;

  async function abrir(ruta) {
    const ventana = window.open("", "_blank");
    try { const url = await urlFirmadaStorage(BUCKET_FACTURAS, ruta); if (ventana) ventana.location.href = url; else window.open(url, "_blank"); }
    catch (e) { ventana?.close(); toast(mensajeError(e), "error"); }
  }
  async function reprocesar() {
    setProcesando(true);
    try {
      const r = await reprocesarFactura(d.rutaXml);
      toast(`Factura procesada otra vez: ${ESTADO_DOCUMENTO[r.estadoDocumento] || r.estadoDocumento}, ${r.conteos?.importados || 0} moto(s) ingresada(s)`);
      consulta.refrescar(true);
    } catch (e) { toast(mensajeError(e), "error"); }
    finally { setProcesando(false); }
  }

  const porRevisar = (d?.lineas || []).filter((l) => l.estado === "Revision");
  const motos = (d?.lineas || []).flatMap((l) => l.motos.map((m) => ({ ...m, linea: l.numero, codigo: l.codigo })));
  return (
    <div data-factura-detalle>
      <p className="mb-2 text-[13px]"><Link className="font-semibold text-marino-700 hover:underline dark:text-white" to="/admin/facturas-recibidas">← Facturas recibidas</Link></p>
      <PageHeader titulo={d ? `Factura ${d.factura}` : "Factura"} subtitulo={d ? `${d.emisor?.nombre || "Crosland"} · emitida ${fecha(d.emitida)} · ${d.origen === "Correo" ? "llegó por correo" : "subida en el panel"}` : ""}>
        <BarraActualizacion consulta={consulta} />
      </PageHeader>
      <AvisoConexion consulta={consulta} que="la factura" />
      {consulta.error && !d && <Vacio titulo="No se encontró la factura" texto={mensajeError(consulta.error)} />}
      {d && <>
        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          <Card>
            <p className="text-[12.5px] text-slate-400">Estado</p>
            <div className="mt-1"><Pill tono={TONO_DOCUMENTO[d.estado] || "gris"}>{ESTADO_DOCUMENTO[d.estado] || d.estado}</Pill></div>
            {d.error && <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-300">{textoCodigo(d.error)}</p>}
            {d.motivo && <p className="mt-1 text-[12.5px] text-slate-500">{d.motivo}</p>}
            <p className="mt-3 text-[12.5px] text-slate-400">Recibida {d.recibida ? fechaCompleta(d.recibida) : "—"}</p>
          </Card>
          <Card>
            <dl className="space-y-1 text-[13.5px]">
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Valor de venta</dt><dd>{soles(d.totales?.valorVenta)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">IGV</dt><dd>{soles(d.totales?.impuestos)}</dd></div>
              <div className="flex justify-between gap-3 font-bold text-marino dark:text-white"><dt>Total</dt><dd>{soles(d.totales?.total)}</dd></div>
              {Number(d.totales?.gratuitas) > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-400">Bonificaciones</dt><dd>{soles(d.totales.gratuitas)}</dd></div>}
            </dl>
          </Card>
          <Card>
            <p className="text-[12.5px] text-slate-400">Archivos</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {d.rutaPdf ? <button className={btnMini} onClick={() => abrir(d.rutaPdf)} data-ver-pdf>Ver PDF</button> : <span className="text-[13px] text-slate-400">{d.pdfPendiente ? "PDF pendiente" : "Sin PDF"}</span>}
              {d.rutaXml && <button className={btnMini} onClick={() => abrir(d.rutaXml)}>Ver XML</button>}
            </div>
            {porRevisar.length > 0 && d.rutaXml && (
              <button className="btn btn-primary mt-3 !py-2" disabled={procesando} onClick={reprocesar} data-reprocesar>{procesando ? "Procesando…" : "Volver a procesar"}</button>
            )}
            {porRevisar.length > 0 && !d.rutaXml && <p className="mt-3 text-[12.5px] text-slate-500">Para volver a procesarla, súbela otra vez en «Subir factura».</p>}
          </Card>
        </div>

        {porRevisar.length > 0 && (
          <div className="mb-5" data-por-revisar><Aviso tipo="aviso">
            <b>{porRevisar.length} línea{porRevisar.length === 1 ? "" : "s"} por revisar.</b>{" "}
            {porRevisar.map((l) => `Línea ${l.numero}${l.codigo ? ` (${l.codigo})` : ""}: ${textoCodigo(l.motivo)}`).join(" ")}{" "}
            {porRevisar.some((l) => /EQUIVALENCIA|SIN_EQUIVALENCIA/.test(l.motivo || "")) && <Link className="font-semibold underline" to={`/admin/facturas-recibidas?pestana=codigos&codigo=${encodeURIComponent(porRevisar.find((l) => l.codigo)?.codigo || "")}`}>Asignar el código</Link>}
          </Aviso></div>
        )}
        {(d.advertencias || []).some((c) => c !== "ENCODING_DECLARADO_NO_COINCIDE") && <p className="mb-4 text-[12.5px] text-slate-500">{d.advertencias.filter((c) => c !== "ENCODING_DECLARADO_NO_COINCIDE").map(textoCodigo).join(" ")}</p>}

        <h2 className="mb-2 font-semibold text-marino dark:text-white">Motos de la factura</h2>
        {motos.length === 0 ? <Vacio titulo="La factura no trae motos" /> : (
          <Tabla columnas={["Línea", "Motor", "Chasis", "Color", "Ingresó al inventario", "Ubicación"]}>
            {motos.map((m) => (
              <tr key={`${m.linea}-${m.orden}`} data-moto-factura={m.motor}>
                <td className="px-4 py-3 text-slate-500">{m.linea}<span className="block text-[12px]">{m.codigo}</span></td>
                <td className="px-4 py-3 font-semibold text-marino dark:text-white">{m.motor || "—"}</td>
                <td className="px-4 py-3">{m.chasis || "—"}</td>
                <td className="px-4 py-3">{capital(m.color)}</td>
                <td className="px-4 py-3">{m.coduni ? <Link className="font-semibold text-marino-700 hover:underline dark:text-white" to={`/admin/inventario/${m.coduni}`}>{m.modelo} · N° {m.coduni}</Link> : <span className="text-orange-700 dark:text-orange-300">{m.motivo ? textoCodigo(m.motivo) : "Todavía no"}</span>}</td>
                <td className="px-4 py-3">{m.ubicacion || "—"}</td>
              </tr>
            ))}
          </Tabla>
        )}

        <h2 className="mb-2 mt-6 font-semibold text-marino dark:text-white">Compra registrada</h2>
        {d.compras.length === 0 ? <p className="text-[13.5px] text-slate-500">Todavía no hay compra vinculada.</p> : (
          <div className="flex flex-wrap gap-2">{d.compras.map((c) => (
            <Link key={c.codcom} className="btn btn-secondary !py-2" to={`/admin/compras/${c.codcom}`} data-compra-factura={c.codcom}>Compra N° {c.codcom} · {c.cantidad} {c.modelo} {capital(c.color)} {c.vinculo === "Conciliado" ? "(registrada a mano)" : ""}</Link>
          ))}</div>
        )}

        <h2 className="mb-2 mt-6 font-semibold text-marino dark:text-white">Líneas de la factura</h2>
        <Tabla columnas={["N°", "Código", "Descripción", "Cant.", "Es", "Estado"]}>
          {d.lineas.map((l) => (
            <tr key={l.numero} className="align-top" data-linea={l.numero}>
              <td className="px-4 py-3 text-slate-500">{l.numero}</td>
              <td className="px-4 py-3 font-mono text-[12.5px]">{l.codigo || "—"}</td>
              <td className="px-4 py-3">{l.descripcion}{l.gratuita && <span className="block text-[12px] text-slate-400">Bonificación</span>}</td>
              <td className="px-4 py-3">{Number(l.cantidad)}</td>
              <td className="px-4 py-3">{l.clasificacion === "Vehiculo" ? "Moto" : l.clasificacion === "Accesorio" ? "Accesorio" : "Desconocido"}</td>
              <td className="px-4 py-3"><Pill tono={TONO_LINEA[l.estado] || "gris"}>{ESTADO_LINEA[l.estado] || l.estado}</Pill>{l.motivo && <span className="mt-1 block max-w-[16rem] text-[12px] text-slate-500">{textoCodigo(l.motivo)}</span>}</td>
            </tr>
          ))}
        </Tabla>

        <h2 className="mb-2 mt-6 font-semibold text-marino dark:text-white">Historial de procesamiento</h2>
        <ol className="space-y-2 border-l-2 border-slate-200 pl-4 text-[13.5px] dark:border-white/15" data-intentos>
          {d.intentos.map((i, n) => (
            <li key={n}><span className="text-slate-400">{fechaCompleta(i.inicio)} · {i.actor}</span><br />{i.resultado === "Exito" ? "Procesada" : i.resultado === "Parcial" ? "Procesada en parte" : i.resultado} · {i.ingresadas} de {i.motos} moto{Number(i.motos) === 1 ? "" : "s"} ingresada{Number(i.motos) === 1 ? "" : "s"}{Number(i.revision) ? `, ${i.revision} por revisar` : ""}{i.error ? ` · ${textoCodigo(i.error)}` : ""}</li>
          ))}
        </ol>
      </>}
    </div>
  );
}
