// HU-004 · Inventario de unidades (base central) · HU-001 lectura compartida, HU-003 movimientos
// Lista operativa de todas las unidades identificadas: ubicación, preparación, techo y situación comercial.
// No hay copias por navegador: lo que se ve aquí es lo mismo que ven las demás cuentas.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Link } from "../../components/dashboard/LinkPanel";
import { useAuth } from "../../context/AuthContext";
import { inventarioApi, useConsultaCentral } from "../../servicios/central";
import { ETAPAS_FILTRO_CENTRAL, FILTRO_INICIAL, GRUPOS_LUGAR_API, filtrarUnidades } from "../../servicios/inventarioCentral";
import { Card, PageHeader, Stat, Tabla, Vacio, btnMini } from "../../components/ui";
import { EstadoConexion } from "../../components/dashboard/Sprint2";
import { AbrirPorNumero, AvisoConexion, nombreUnidad, sinApi, BarraActualizacion, ColorUnidad, PillComercial, PillPreparacion, TextoTecho, TextoUbicacion } from "../../components/dashboard/Central";
import { ModalTrasladoCentral, ModalUbicacionInicial } from "../../components/dashboard/ModalesCentral";

const POR_PAGINA = 20;
// Filtros y página se recuerdan en esta pestaña del navegador (igual que en Disponibilidad): al volver desde la
// ficha de una moto, con el botón «Volver» o con la flecha del navegador, la lista sigue filtrada igual
const CLAVE_FILTROS = "epsa-filtros-inventario";
function leerFiltros() {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_FILTROS) || "null") || {}; } catch { return {}; }
}

export default function InventarioCentral() {
  const { puede } = useAuth();
  const gestiona = puede("unidades.gestionar");
  const { state } = useLocation();
  const guardado = useMemo(leerFiltros, []);
  const [servidor, setServidor] = useState({ codubi: state?.codubi || guardado.servidor?.codubi || "", codmod: state?.codubi ? "" : guardado.servidor?.codmod || "" });
  const [f, setF] = useState({ ...FILTRO_INICIAL, comercial: "", ...(state?.codubi ? {} : guardado.f) });
  const [sinUbicacion, setSinUbicacion] = useState(state?.codubi ? false : Boolean(guardado.sinUbicacion));
  const [pag, setPag] = useState(state?.codubi ? 1 : Number(guardado.pag) || 1);
  useEffect(() => { try { sessionStorage.setItem(CLAVE_FILTROS, JSON.stringify({ servidor, f, sinUbicacion, pag })); } catch { /* sin almacenamiento */ } }, [servidor, f, sinUbicacion, pag]);
  const [modal, setModal] = useState(null);
  // La ubicación se pide al servidor; el modelo se filtra aquí, para que la lista de modelos muestre siempre todos
  const consulta = useConsultaCentral(() => inventarioApi({ codubi: servidor.codubi }), [servidor.codubi], { clave: `inventario:${servidor.codubi || ""}:` });
  const datos = consulta.data;
  const todas = datos?.unidades || [];
  const unidades = useMemo(() => (servidor.codmod ? todas.filter((u) => u.codmod === servidor.codmod) : todas), [todas, servidor.codmod]);
  const ubicaciones = datos?.ubicaciones || [];
  // Modelos que tienen motos en el inventario (con cuántas), ordenados por nombre
  const modelos = useMemo(() => {
    const m = new Map();
    todas.forEach((u) => { if (u.codmod) m.set(u.codmod, { codmod: u.codmod, nommod: u.nommod, n: (m.get(u.codmod)?.n || 0) + 1 }); });
    return [...m.values()].sort((a, b) => a.nommod.localeCompare(b.nommod, "es"));
  }, [todas]);
  const lista = useMemo(() => filtrarUnidades(unidades, f).filter((u) => !sinUbicacion || !u.ubicacion), [unidades, f, sinUbicacion]);
  // Cambiar un filtro vuelve a la página 1 (al volver a la lista con los mismos filtros se conserva la página)
  const firmaFiltros = JSON.stringify([servidor, f, sinUbicacion]);
  const filtrosAntes = useRef(firmaFiltros);
  useEffect(() => { if (filtrosAntes.current !== firmaFiltros) { filtrosAntes.current = firmaFiltros; setPag(1); } }, [firmaFiltros]);
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const pagina = Math.min(pag, paginas);
  const visibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const cambiar = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const limpiar = () => { setServidor({ codubi: "", codmod: "" }); setF({ ...FILTRO_INICIAL, comercial: "" }); setSinUbicacion(false); };
  const cuenta = (fn) => unidades.filter(fn).length;
  const recargar = () => consulta.refrescar(true);

  // Si el servidor todavía no tiene esta consulta, se muestra solo el aviso (sin cifras en cero ni filtros vacíos)
  if (sinApi(consulta)) return (
    <div>
      <PageHeader titulo="Inventario" subtitulo="Todas las motos identificadas, con su ubicación, preparación, techo y situación comercial." />
      <AvisoConexion consulta={consulta} que="el inventario central" />
      <div className="mt-5"><AbrirPorNumero texto="Mientras tanto, abre una compra para ver sus motos, o una moto por su número, para consultar su ubicación, sus movimientos y su techo." /></div>
    </div>
  );

  return (
    <div>
      <PageHeader titulo="Inventario" subtitulo="Todas las motos identificadas, con su ubicación, preparación, techo y situación comercial.">
        <EstadoConexion hu="HU-001" consulta={consulta} />
        <BarraActualizacion consulta={consulta} />
        {puede("compras.registrar") && <Link className="btn btn-primary !py-2.5" to="/admin/compras">Compras e identificación</Link>}
      </PageHeader>
      <AvisoConexion consulta={consulta} que="el inventario central" />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat etiqueta="Unidades" valor={unidades.length} nota={servidor.codubi || servidor.codmod ? "Con el filtro de ubicación o modelo" : "Identificadas en total"} />
        <Stat etiqueta="Libres" valor={cuenta((u) => u.comercial === "Libre")} tono="verde" nota="Sin separación ni venta" />
        <Stat etiqueta="Listas para entrega" valor={cuenta((u) => u.preparacion?.lista_para_entrega)} tono="verde" />
        <Stat etiqueta="En tránsito" valor={cuenta((u) => u.movimiento_activo)} tono="ambar" nota="Salieron y falta confirmar la llegada" />
        <Stat etiqueta="Sin ubicación" valor={cuenta((u) => !u.ubicacion)} tono="rojo" nota="Falta registrar dónde están" />
      </div>

      {/* Filtros */}
      <Card className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2"><label className="field-label" htmlFor="inv-buscar">Buscar</label><input id="inv-buscar" className="field-input" value={f.q} maxLength={40} onChange={(e) => cambiar("q", e.target.value)} placeholder="Motor, chasis, modelo o N°" /></div>
        <div><label className="field-label" htmlFor="inv-lugar">Ubicación</label>
          <select id="inv-lugar" className="field-input" value={servidor.codubi} onChange={(e) => setServidor((s) => ({ ...s, codubi: e.target.value }))}>
            <option value="">Todas</option>
            {GRUPOS_LUGAR_API.map((g) => { const ls = ubicaciones.filter((l) => l.tipubi === g.tipo); return ls.length ? <optgroup key={g.tipo} label={g.titulo}>{ls.map((l) => <option key={l.codubi} value={l.codubi}>{l.nomubi}</option>)}</optgroup> : null; })}
          </select></div>
        <div><label className="field-label" htmlFor="inv-modelo">Modelo</label><select id="inv-modelo" className="field-input" value={servidor.codmod} onChange={(e) => setServidor((s) => ({ ...s, codmod: e.target.value }))}><option value="">Todos los modelos ({todas.length})</option>{modelos.map((m) => <option key={m.codmod} value={m.codmod}>{m.nommod} ({m.n})</option>)}</select></div>
        <div><label className="field-label" htmlFor="inv-prep">Preparación</label><select id="inv-prep" className="field-input" value={f.prep} onChange={(e) => cambiar("prep", e.target.value)}><option value="">Todas</option>{ETAPAS_FILTRO_CENTRAL.map((e) => <option key={e}>{e}</option>)}</select></div>
        <div><label className="field-label" htmlFor="inv-comercial">Situación comercial</label><select id="inv-comercial" className="field-input" value={f.comercial} onChange={(e) => cambiar("comercial", e.target.value)}><option value="">Todas</option><option value="Libre">Libres</option><option value="Separada">Separadas</option><option value="Vendida">Vendidas</option></select></div>
        <label className="flex items-center gap-2 text-[13.5px] font-medium sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[#0e2c52]" checked={sinUbicacion} onChange={(e) => setSinUbicacion(e.target.checked)} />Solo las que no tienen ubicación registrada</label>
        <div className="flex items-end lg:col-span-4 lg:justify-end"><button className="pb-2 text-[13px] font-semibold text-acento hover:underline" onClick={limpiar}>Limpiar filtros</button></div>
      </Card>

      {datos && lista.length === 0 ? <Vacio titulo="Sin unidades con esos filtros" texto={unidades.length ? "Cambia o limpia los filtros." : "Aún no hay unidades identificadas. Aparecen al identificar una compra o al importar una factura."} /> : (
        <>
          <Tabla columnas={["Unidad", "Modelo", "Ubicación", "Preparación", "Techo", "Situación comercial", "Acciones"]}>
            {visibles.map((u) => (
              <tr key={u.coduni} className="align-top" data-unidad={u.coduni}>
                <td className="px-4 py-3"><Link to={`/admin/inventario/${u.coduni}`} className="font-semibold text-marino hover:underline dark:text-white">{nombreUnidad(u)}</Link>{u.chauni && <p className="text-[11.5px] text-slate-400">chasis {u.chauni}, N° {u.coduni}</p>}</td>
                <td className="px-4 py-3">{u.nommod}<span className="block text-[12px] text-slate-400"><ColorUnidad color={u.coluni} /></span></td>
                <td className="px-4 py-3"><TextoUbicacion unidad={u} /></td>
                <td className="px-4 py-3"><PillPreparacion preparacion={u.preparacion} /></td>
                <td className="px-4 py-3"><TextoTecho preparacion={u.preparacion} /></td>
                <td className="px-4 py-3"><PillComercial comercial={u.comercial} /><span className="mt-1 block text-[11.5px] text-slate-400">{u.origen}</span></td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                  <Link className={btnMini} to={`/admin/inventario/${u.coduni}`}>Ficha</Link>
                  {gestiona && !u.ubicacion && <button className={btnMini} onClick={() => setModal({ tipo: "inicial", u })}>Ubicación inicial</button>}
                  {gestiona && u.ubicacion && !u.movimiento_activo && <button className={btnMini} onClick={() => setModal({ tipo: "traslado", u })}>Trasladar</button>}
                </div></td>
              </tr>
            ))}
          </Tabla>
          {lista.length > POR_PAGINA && (
            <div className="mt-4 flex items-center justify-between text-[13px] text-slate-500">
              <span>{lista.length} unidades, página {pagina} de {paginas}</span>
              <div className="flex gap-2"><button disabled={pagina === 1} className={btnMini} onClick={() => setPag(pagina - 1)}>Anterior</button><button disabled={pagina === paginas} className={btnMini} onClick={() => setPag(pagina + 1)}>Siguiente</button></div>
            </div>
          )}
        </>
      )}
      {!gestiona && <p className="mt-3 text-[12.5px] text-slate-400">Tu rol consulta el inventario. Los movimientos y la preparación los registran gerencia y administración.</p>}

      <ModalTrasladoCentral abierto={modal?.tipo === "traslado"} unidad={modal?.u} ubicaciones={ubicaciones} onClose={() => setModal(null)} onHecho={recargar} onConflicto={recargar} />
      <ModalUbicacionInicial unidad={modal?.tipo === "inicial" ? modal.u : null} ubicaciones={ubicaciones} onClose={() => setModal(null)} onHecho={recargar} onConflicto={recargar} />
    </div>
  );
}
