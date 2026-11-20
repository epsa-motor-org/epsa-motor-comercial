# HU-031 · Pedidos con unidad pendiente de asignación

Implementación de EMT-36 sobre `develop` (`4a9db86`). Un pedido central existe sin unidad, motor, chasis o pago. Recibir un adelanto no inventa stock. Proponer una unidad tampoco la reserva: la disponibilidad se verifica al convertir a separación o venta.

## Uso

1. En **Ventas a clientes → Pedidos sin unidad → Nuevo pedido**, buscar y seleccionar al comprador existente o registrar nombres, apellidos y celular. No se exige ni inventa DNI. Una coincidencia se selecciona expresamente; dos pedidos legítimos del mismo comprador no se fusionan.
2. Elegir modelo interno, sede EPSA, responsable y techo; color, sede/fecha prevista de entrega y observación son opcionales. Precio y techo son referencias separadas del dinero recibido. Una fecha prevista no acredita recepción.
3. Registrar, si corresponde, adelantos reales ya recibidos. El primero debe ser de al menos S/100. El efectivo exige constancia de recepción; una transferencia exige evidencia privada del pedido, número de operación y gerente que confirmó por llamada. No hay consulta bancaria ni aprobación mediante notificaciones.
4. Cuando exista una unidad identificada, **Proponer unidad** por motor/chasis. Debe coincidir modelo/color; actualizar primero el acuerdo si cambiaron. Si el techo configurado difiere, revisar y aceptar explícitamente la adecuación pendiente. Esto conserva la configuración física, preparación y ubicación.
5. **Continuar a separación o venta** revalida la disponibilidad. Separación requiere adelanto; una venta a crédito válida puede no tenerlo. Al vender se reutilizan reglas, descuento autorizado por llamada y cálculos de HU-006. El enlace lleva a la unidad vigente, incluso después de corregirla mediante HU-022.

Un pedido vinculado conserva sus recibos y referencia comercial inicial, y muestra aparte los importes vigentes de la venta. Su cancelación/corrección continúa en la ficha mediante HU-021/HU-022. Cancelar un pedido pendiente conserva dinero, motivo e historial; no reembolsa, anula comprobantes ni libera una operación vinculada. La entrega sigue HU-032 y la preparación HU-033. Por definir no acredita que pueda entregarse.

## Contrato HTTP

Todas las rutas requieren una sesión comercial activa. Gerente/administradora consultan y operan pedidos; un vendedor solo accede a aquellos de los que es responsable vigente y crea a su nombre. Los permisos se vuelven a comprobar en SQL con `auth.uid()` y el perfil activo almacenado. No se autoriza mediante un responsable enviado por el navegador.

| Método y ruta | Uso |
| --- | --- |
| `GET /api/pedidos/formulario` | Usuario actual, responsables, gerentes, sedes y catálogo interno de modelos/techos. No depende del stock ni de publicación web. |
| `GET /api/pedidos/compradores?q=...` | Búsqueda literal por nombre/celular; mínimo 2 caracteres, hasta 10 resultados. Sin DNI ni correo. |
| `GET /api/pedidos?q=...&limite=25&offset=0` | Búsqueda/paginación; límite máximo 50; ámbito del responsable. |
| `GET /api/pedidos/:codped` | Detalle, versión, recibos originales, historial y operación vigente. |
| `POST /api/pedidos` | Crear. `Idempotency-Key` UUID obligatorio. 201 nuevo / 200 intento recuperado. |
| `POST /api/pedidos/:codped/evidencia` | Multipart `archivo`, imagen JPEG/PNG/WebP o PDF validado por contenido, máximo 5 MB. No registra dinero. |
| `POST /api/pedidos/:codped/adelanto` | Registrar recepción documentada; monto/fecha/medio y datos específicos del medio. |
| `POST /api/pedidos/:codped/acuerdo` | Modelo/color/techo y adicional acordado con motivo; conserva dinero y retira propuesta anterior. |
| `POST /api/pedidos/:codped/proponer` | Unidad real compatible. No constituye compromiso exclusivo. |
| `POST /api/pedidos/:codped/continuar` | Conversión atómica a separación o venta. |
| `POST /api/pedidos/:codped/cancelar` | Solo pendiente/propuesta, con motivo y tratamiento conocido del dinero si lo hay. |

Las cinco acciones exigen `versionEsperada` e `Idempotency-Key`. Respuesta `{ok:true,data:{pedido,reutilizada}}`; consulta/lista usan `{ok:true,data:...}`. Errores controlados: 400 formato, 403 permiso, 404 fuera de ámbito/inexistente, 409 conflicto/reintento distinto/versión antigua, 422 regla comercial, 503 RPC aún no desplegada. Fallos inesperados devuelven un mensaje genérico sin SQL ni datos privados. Los nuevos códigos PostgREST son estados HTTP válidos `PT400/403/404/409/422`, para evitar el defecto de transporte PT6xx/PT7xx conocido en HU-022.

Ejemplo de creación (identificadores ilustrativos; deben venir del catálogo):

```json
{
  "codcli": 1,
  "codmod": 1,
  "codusuResponsable": 3,
  "codsedAtencion": 1,
  "codsedEntregaPrevista": null,
  "color": null,
  "techo": {"decision": "Por definir"},
  "fechaEntregaPrevista": null,
  "observacion": null
}
```

Ejemplo de adelanto en efectivo:

```json
{
  "versionEsperada": 1,
  "monto": 100,
  "fecha": "2026-11-19",
  "medioPago": "Efectivo",
  "observacion": "PRUEBA QA CODEX: recepción sintética",
  "ingresoConfirmado": true
}
```

Transferencia agrega `referencia`, `rutaEvidencia` devuelta por el servidor y `codusuConfirmador` gerente activo. La ruta debe pertenecer a ese pedido y el objeto existir. La evidencia por sí sola no confirma ingreso. No se aceptan pagos cero, negativos, de más de dos decimales, superiores a la referencia vigente ni con fecha futura o de recepción ingresada hace más de 30 días.

Propuesta: `{versionEsperada,coduni,adecuacionAceptada}`. Continuidad: `{versionEsperada,destino:"Venta",modalidad:"Crédito",adecuacionAceptada}` o destino `Separacion`. El descuento se aplica solo al vender; agrega `descuento`, `motivoDescuento`, `codusuAutorizadorDescuento` y `confirmacionTelefonicaRecibida:true`, reutilizando HU-006. No constituye pago.

Después de un resultado de red incierto se reenvía exactamente la misma solicitud y clave. La interfaz conserva la clave y una huella del cuerpo en `sessionStorage`, sin nombres, celular o credenciales en ese registro. El servidor es la fuente de verdad. Cambiar el cuerpo con una clave ya utilizada produce conflicto.

## Persistencia y dinero

`pedidocliente` conserva comprador, acuerdo, creador/responsable, versión y enlaces. `pagopedidocliente` es la fuente de los recibos originales. `pedidoclienteevento` conserva actor/fecha/detalle; `pedidoclienteintento` permite recuperar operaciones repetidas. No se exponen tablas directamente a `anon` ni `authenticated`: RLS activo y privilegios revocados. Las RPC públicas son `SECURITY INVOKER`; las entradas privadas comprueban actor/ámbito y tienen `search_path=''`.

Al convertir con adelantos se crea una **proyección única** en `separacion`, enlazada por `codpedorigen`, con medio **Adelanto de pedido**. No se crea otro recibo ni un `pagoventa`. Los medios, evidencias, autores y confirmaciones originales se consultan en el pedido. La pantalla distingue quién vinculó el dinero de quién lo recibió. HU-006 incorpora esa proyección una sola vez al recibido/saldo.

El disparador que valida el origen comprueba pedido, unidad, comprador, suma y medio; no permite cambiar después el origen/importe. HU-022 puede corregir comprador/unidad conservando ese origen. La conversión completa se guarda en una transacción: si falla venta/validación no quedan separación temporal, unidad comprometida ni traslado parcial de dinero.

La proyección no es una recepción nueva: puede incluir el adicional del techo y recibos que hayan envejecido durante la espera. Por eso el disparador de tope/fecha de HU-005 delega **solo cuando existe `codpedorigen`** al control de origen HU-031. Las separaciones ordinarias conservan mínimo, tope de lista y antigüedad de 30 días. No se cambia la fecha original para superar controles.

El bucket `pedidos-evidencia` es privado. Políticas de lectura/alta verifican pedido y responsable vigente; alta solo en pedidos editables y carpeta autorizada. No se añaden políticas de actualización/borrado. Se generan URL firmadas breves para consulta.

## Migración y revisión

Archivos generados mediante Supabase CLI, en este orden:

1. `20261120030916_hu031_pedidos_sin_unidad.sql`.
2. `20261120031744_hu031_adelantos_y_continuidad.sql`.

Se apoyan en HU-005/HU-006 y su adaptador HTTP `20261117072549`. El entorno de integración local incorpora también la fuente de entrega HU-032 y retorno HU-021 vigente. Se reaplicaron ambas migraciones sin borrar registros. No usar reset sobre una base compartida. No se aplicaron estas migraciones en el proyecto alojado.

Revisar especialmente la proyección monetaria y compatibilidad de consumidores de `metpagsep`: el nuevo valor solo existe con `codpedorigen`. Para una retirada de despliegue, conservar tablas, recibos y enlaces; no proponer un rollback que borre dinero. La publicación exige revisar primero las migraciones, después API y frontend, y verificar el mismo recorrido sobre la versión publicada.

## Validación local y límites

Ejecución propia de Codex del 19/11/2026 (Lima): **753 pruebas aprobadas**, incluidas **27 del bloque HU-031** (el contador incluye los dos agrupadores). Compilación backend/frontend y lint frontend aprobados. En Brave se ejecutó el alta de un pedido, recepción sintética de S/100 y consulta tras recarga: mismo pedido, un recibo, sin unidad asignada. Esto fue en el arnés local con sesión de gerente sintética, no en Netlify ni con una sesión real de vendedor. Las capturas y logs locales se conservan fuera del repositorio; no contienen clientes reales.

```sh
npm test
npm run build
npm --prefix frontend run build
npm --prefix frontend run lint -- --quiet
npm run test:hu031:postgrest
```

`tests/pedidos.database.test.ts` y `tests/pedidos.continuidad.database.test.ts` ejecutan SQL con PGlite y los roles sintéticos gerente, administradora y dos vendedores. Cubren registro sin stock, selección de comprador, ámbito, referencias inválidas, reintentos, adelantos, evidencia/confirmación en base, propuesta, precio/techo/descuento, conversión, regresión a HU-006/HU-022, cancelación y conservación de recibos históricos.

`scripts/qa-hu031-postgrest.ts` usa PostgreSQL 17.11 y PostgREST 16.5 en contenedores temporales, más la API Express real. Comprueba estados HTTP, JWT/identidad SQL, replay, rollback, dinero/techo, RLS y dos conexiones concurrentes sobre una unidad: 200/409 y una sola venta. **GoTrue se sustituye por la fábrica local**; no acredita login de producción ni un recorrido real de Storage. `--serve` monta opcionalmente el frontend real con sesión sintética local para inspección; no cambia autenticación del producto. `GET http://127.0.0.1:5178/qa-hu031/stop` termina el arnés y limpia únicamente sus contenedores/red propios; también termina a los 20 minutos.

Los advisors se ejecutaron con CLI 3.2.0 contra la base temporal, nunca contra producción. Revisar su resultado final con la evidencia de la ejecución: RLS sin políticas de las cuatro tablas es cierre intencional del acceso directo; las RPC privadas son el único acceso autorizado. Índices sin uso son informativos en una base recién creada. No se considera esto una auditoría general de toda la plataforma.

| Escenarios Jira | Evidencia local | Qué sigue pendiente para aceptación |
| --- | --- | --- |
| 1–4 | Pedido sin stock/adelanto; consulta; mínimo y datos inválidos; replay y pedidos distintos. | Repetir en la versión publicada con sesiones reales. |
| 5 | Unidades sintéticas identificadas y propuestas explícitas. | Recorrido de compra/importación → unidad → pedido con las versiones integradas. No se importó una factura real. |
| 6–9 | Propuesta no exclusiva, continuidad y recibos únicos; techo anterior conservado; descuento; dos conexiones reales. | Verificar pantalla y contratos sobre la publicación aprobada. |
| 10–12 | Referencias/permiso/versión rechazados; cancelación con dinero conservado; rollback de conversión. | Retest de fallos nuevos y caso real de respuesta perdida en navegador. |
| 13 | Pedido distingue operación, recibos y precio referencial; no cambia ubicación/preparación. | Entrega/comprobante externo integrados según HU-032/HU-006. No se emitió comprobante ni entrega real. |
| 14–16 | Descuento/adelanto único, unidad aún libre y conflicto si fue comprometida por tercero. | Conformidad funcional del PO y consolidación de QA. |

Antes de cerrar: comprobar carga/lectura real de evidencia privada en Storage, perfiles y persistencia en el despliegue; completar recorridos de compra y entrega relacionados, revisar PR y registrar aceptación del PO. Las pruebas locales y esta guía no equivalen al cierre de la HU ni a la ejecución de Jazmín.
