// HU-033 · Actualizar la preparación de las motos (base central, funciones de Michelle)
// La moto se vende con o sin techo. Cuando el cliente elige un techo al separar (HU-005), la moto queda aquí con su
// techo por armar hasta registrarlo instalado, con fecha, autor y observación. La configuración del techo es de HU-004,
// la ubicación de HU-003 y la situación comercial no cambia aquí. Vendedores solo consultan.
import { useMemo, useState } from "react";
import { Link } from "../../components/dashboard/LinkPanel";
import { useAuth } from "../../context/AuthContext";
import { inventarioApi, useConsultaCentral } from "../../servicios/central";
import { etapaOperativa, techoPorArmar } from "../../servicios/inventarioCentral";
import { Card, PageHeader, Stat, Tabla, Vacio, btnMini } from "../../components/ui";
import { EstadoConexion, Pestanas, Pill } from "../../components/dashboard/Sprint2";
import { AvisoConexion, sinApi, BarraActualizacion, ColorUnidad, PillComercial, TextoUbicacion } from "../../components/dashboard/Central";
import { ModalAvancePreparacion, accionesPreparacion } from "../../components/dashboard/PreparacionUnidad";

const TEXTO_TECHO = { Pendiente: "Por armar", "En proceso": "En armado", Instalado: "Instalado", "No requiere": "No requiere" };
const normal = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const VISTAS = {
  porArmar: (po) => techoPorArmar(po),
  enArmado: (po) => techoPorArmar(po) && po.techo?.estado === "En proceso",
  listas: (po) => !techoPorArmar(po),
  todas: () => true,
};
const SUBTITULO = "La moto se vende con o sin techo. Cuando se le configura un techo, aquí se registra su armado hasta que quede instalado.";

export default function PreparacionCentral() {
  const { puede } = useAuth();
  const gestiona = puede("unidades.gestionar");
  const [vista, setVista] = useState("porArmar");
  const [conVendidas, setConVendidas] = useState(false);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const consulta = useConsultaCentral(() => inventarioApi(), [], { clave: "inventario::" });
  const todas = useMemo(() => (consulta.data?.unidades || []).filter((u) => u.preparacion?.operativa && (conVendidas || u.comercial !== "Vendida")), [consulta.data, conVendidas]);
  const sinDatos = consulta.data && (consulta.data.unidades || []).length > 0 && !(consulta.data.unidades || []).some((u) => u.preparacion?.operativa);
  const lista = todas.filter((u) => VISTAS[vista](u.preparacion.operativa)).filter((u) => !q.trim() || normal(`${u.nummotuni} ${u.chauni} ${u.nommod} ${u.coduni} ${u.coluni} ${u.ubicacion?.nomubi || ""}`).includes(normal(q.trim())));
  const n = (k) => todas.filter((u) => VISTAS[k](u.preparacion.operativa)).length;

  if (sinApi(consulta)) return (
    <div>
      <PageHeader titulo="Preparación de motos" subtitulo={SUBTITULO} />
      <AvisoConexion consulta={consulta} que="la preparación" />
    </div>
  );

  return (
    <div data-hu033>
      <PageHeader titulo="Preparación de motos" subtitulo={SUBTITULO}>
        <EstadoConexion hu="HU-033" consulta={consulta} />
        <BarraActualizacion consulta={consulta} />
      </PageHeader>
      <AvisoConexion consulta={consulta} que="la preparación" />
      {sinDatos && <Vacio titulo="La preparación todavía no está habilitada" texto="Falta ejecutar en Supabase el SQL de mejoras finales (docs/supabase-sprint2-final.sql)." />}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat etiqueta="Techo por armar" valor={n("porArmar")} tono={n("porArmar") ? "ambar" : "marino"} nota="Techo configurado, falta instalarlo" />
        <Stat etiqueta="Techo en armado" valor={n("enArmado")} nota="Ya se está instalando" />
        <Stat etiqueta="Listas para entrega" valor={n("listas")} tono="verde" nota="Sin techo o con su techo instalado" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Pestanas etiqueta="Etapa" valor={vista} onCambio={setVista} opciones={[
          { id: "porArmar", label: "Techo por armar", n: n("porArmar"), alerta: n("porArmar") > 0 },
          { id: "listas", label: "Listas para entrega", n: n("listas") },
          { id: "todas", label: "Todas", n: todas.length },
        ]} />
        <div className="flex flex-wrap items-center gap-3">
          <input className="field-input !w-60 !py-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Modelo, motor, chasis o ubicación" aria-label="Buscar moto" data-buscar-prep />
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[#0e2c52]" checked={conVendidas} onChange={(e) => setConVendidas(e.target.checked)} />Incluir vendidas</label>
        </div>
      </div>

      {consulta.data && !sinDatos && (lista.length === 0 ? <Vacio titulo={vista === "porArmar" && !q ? "No hay techos por armar" : "No hay motos en esta etapa"} texto={q ? "Ninguna coincide con la búsqueda." : vista === "porArmar" ? "Cuando un cliente elija un techo al separar su moto, aparecerá aquí." : "Cambia de pestaña para ver las demás etapas."} /> : (
        <Tabla columnas={["Moto", "Modelo", "Ubicación", "Techo", "Preparación", "Situación", "Acciones"]}>
          {lista.map((u) => {
            const po = u.preparacion.operativa; const t = po.techo || {}; const e = etapaOperativa(po);
            return (
              <tr key={u.coduni} className="align-top" data-prep={u.coduni}>
                <td className="px-4 py-3"><Link className="font-semibold text-marino hover:underline dark:text-white" to={`/admin/inventario/${u.coduni}`}>{u.nummotuni || `N° ${u.coduni}`}</Link>{u.chauni && <span className="block text-[12px] text-slate-400">chasis {u.chauni}</span>}</td>
                <td className="px-4 py-3">{u.nommod}<span className="block text-[12px] text-slate-400"><ColorUnidad color={u.coluni} /></span></td>
                <td className="px-4 py-3"><TextoUbicacion unidad={u} /></td>
                <td className="px-4 py-3">{t.configuracion ? <><span className="block">{t.configuracion}{po.proveedorTecho ? <span className="text-slate-400">, {po.proveedorTecho}</span> : null}</span><span className={`mt-0.5 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.estado === "Instalado" || t.estado === "No requiere" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{TEXTO_TECHO[t.estado] || t.estado}</span></> : <span className="text-slate-500">Sin techo</span>}</td>
                <td className="px-4 py-3"><Pill tono={e.tono}>{e.etapa}</Pill></td>
                <td className="px-4 py-3"><PillComercial comercial={u.comercial} /></td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                  {gestiona && accionesPreparacion(po).map((a) => <button key={`${a.etapa}-${a.estado}`} className={btnMini} onClick={() => setModal({ unidad: u, po, etapa: a.etapa, estado: a.estado })} data-accion-prep={`${a.etapa}:${a.estado}`}>{a.texto}</button>)}
                  <Link className={btnMini} to={`/admin/inventario/${u.coduni}`}>Ficha</Link>
                </div></td>
              </tr>
            );
          })}
        </Tabla>
      ))}
      {!gestiona && <p className="mt-3 text-[12.5px] text-slate-400">Tu rol consulta la preparación; el armado del techo lo registran gerencia y administración.</p>}
      <Card className="mt-5 text-[12.5px] text-slate-500">Una moto sin techo elegido no tiene pendientes y se puede vender. El techo configurado en la ficha de la moto queda aquí por armar hasta registrarlo instalado; la decisión del comprador al separar o vender no lo programa sola. El aviso de FIVESA, JAVICAR o FIBRAT se registra en «Techo instalado» y no mueve la moto: el traslado va en Movimientos.</Card>

      <ModalAvancePreparacion datos={modal} onClose={() => setModal(null)} onHecho={() => consulta.refrescar(true)} />
    </div>
  );
}
