# HU-030 / EMT-35 — Fase 4: cliente Google Apps Script

## Estado

Esta carpeta contiene el cliente local para Gmail, firma HMAC, carga multipart, reintentos y etiquetas operacionales. No se instaló ni ejecutó un trigger, no se autorizó Gmail y no se llamó al backend. La HU no queda cerrada hasta completar un E2E aprobado y comprobar el trigger en el entorno autorizado.

Render está configurado por el equipo para desplegar `60962083-tech/epsa-motor-comercial` desde `develop`. Los cambios HU-030 de este checkout aún están locales y sin commit; por ello no se debe asumir que el despliegue actual contiene esta integración. Verificar el commit desplegado cuando los cambios se integren. No se ha confirmado aquí la configuración de variables HMAC en Render.

El proceso está pensado para la cuenta dedicada `epsamotor.admin@gmail.com`. No usa la cuenta personal del dueño ni necesita una contraseña Google.

## Archivos y responsabilidades

- `apps-script/importacion-facturas/FacturaImportacionCore.gs`: configuración fail-closed, bytes, SHA-256, canonical, HMAC, adjuntos, pairing, solicitud, respuestas y cola acotada.
- `apps-script/importacion-facturas/FacturaImportacionPolling.gs`: polling, paginación, retries, labels, logging sanitizado y lock.
- `apps-script/importacion-facturas/FacturaImportacionTriggers.gs`: instalación/listado/eliminación/recreación explícita del trigger.
- `apps-script/importacion-facturas/appsscript.json`: runtime V8, zona horaria `America/Lima` y scopes.

El código usa APIs estándar de Apps Script; no requiere `clasp` ni dependencias adicionales. Sincronizar manualmente estos archivos con un proyecto Apps Script nuevo y restringir quién puede editarlo.

## Configuración manual

En **Project Settings → Script properties**, configurar valores aprobados para:

| Propiedad | Uso |
| --- | --- |
| `HU030_ENDPOINT_URL` | URL HTTPS exacta del endpoint `/api/integraciones/facturas` |
| `HU030_HMAC_KEY_ID` | Identificador HMAC registrado en el backend |
| `HU030_HMAC_SECRET` | Secreto HMAC sensible; debe coincidir con `HU030_HMAC_CURRENT_SECRET` de Render y tener al menos 32 bytes UTF-8 |
| `HU030_FECHA_CORTE_ISO` | Fecha/hora ISO 8601 con zona explícita. Obligatoria; no tiene default |
| `HU030_ULTIMO_BARRIDO_ISO` | Cursor escrito por el script al completar un barrido |
| `HU030_LOTE_MAX` | Máximo de threads por corrida; default 25, rango 1–100 |
| `HU030_REMITENTES_AUTORIZADOS` | Lista separada por comas de direcciones exactas autorizadas; actualmente `fespinozac2@gmail.com`. No admite nombres visibles ni comodines |
| `HU030_DOMINIOS_AUTENTICACION` | Lista separada por comas de dominios legítimos para DKIM/DMARC y que debe incluir el dominio de cada remitente autorizado; actualmente `gmail.com` |
| `HU030_LABEL_PROCESADO` | Opcional; default `EPSA/HU030/Procesado` |
| `HU030_LABEL_PENDIENTE` | Opcional; default `EPSA/HU030/Pendiente` |
| `HU030_LABEL_REVISION` | Opcional; default `EPSA/HU030/Revision` |
| `HU030_LABEL_ERROR` | Opcional; default `EPSA/HU030/Error` |

`HU030_HMAC_SECRET` se configura como **Script Property** desde Project Settings junto con las demás propiedades. Trátala como sensible: limita quién puede editar el proyecto y no imprimas ni registres su valor en logs, archivos, Gmail ni respuestas. El mismo secreto HMAC se configura en Render como `HU030_HMAC_CURRENT_SECRET`. El script nunca almacena `SUPABASE_SECRET_KEY`, anon key, contraseña, UUID del actor técnico ni credenciales PostgreSQL.

Falta que el equipo despliegue/configure la credencial HMAC compatible en el backend. Las variables del backend que deberán revisarse antes de E2E son `HU030_HMAC_CURRENT_KEY_ID`, `HU030_HMAC_CURRENT_SECRET`, opcionalmente `HU030_HMAC_PREVIOUS_KEY_ID` y `HU030_HMAC_PREVIOUS_SECRET`, `HU030_HMAC_TOLERANCIA_SEGUNDOS` y `HU030_FACTURAS_BUCKET`. Este documento no contiene sus valores.

Si falta URL, key ID, secreto, fecha de corte, lista de remitentes o lista de dominios, la corrida se detiene con un motivo controlado. Una lista inválida también detiene la corrida; no hay fallback abierto ni remitente comodín. No hay URL ni fecha de producción codificadas.

## Polling, corte y lote

El handler `procesarCorreosPendientes` toma `LockService.getScriptLock()` con `tryLock`; si ya existe otra ejecución, sale sin iniciar trabajo paralelo. Libera el lock en `finally`.

La búsqueda Gmail es paginada y usa `has:attachment {filename:xml filename:pdf}`, un grupo `from:` construido desde la lista configurada y una fecha gruesa anterior al límite. Gmail solo preselecciona threads: cada mensaje de cada thread se filtra por fecha exacta y se autentica individualmente; el filtro de búsqueda nunca autoriza un mensaje. La dirección `From` debe coincidir exactamente con una dirección configurada. El nombre visible, asunto y presencia de adjuntos no otorgan autorización.

Antes de `getAttachments()`, hashes, XML/PDF o backend, el script analiza solo la sección de cabeceras de `GmailMessage.getRawContent()`. Para evitar confiar en un header arbitrario del remitente, exige un único `Authentication-Results` cuyo identificador sea `mx.google.com`; si está ausente, es ambiguo o identifica otro servicio, el mensaje queda en `Revision`. También exige SPF `pass` con `smtp.mailfrom` igual al remitente autorizado, DKIM `pass` alineado a un dominio de `HU030_DOMINIOS_AUTENTICACION` y DMARC `pass` con `header.from` en esa misma lista. ARC no es obligatorio. Un remitente que no esté autorizado queda `EXCLUIDO`; una identidad aparente autorizada sin evidencia verificable queda `Revision` con un motivo controlado.

La configuración actual es `HU030_REMITENTES_AUTORIZADOS=fespinozac2@gmail.com` y `HU030_DOMINIOS_AUTENTICACION=gmail.com`, confirmada por el PO. Para agregar otro remitente en el futuro, se debe aprobar su dirección exacta y dominio de autenticación, añadirlos a las Script Properties separadas por comas y verificar fixtures/cabeceras reales antes de habilitar el flujo. No se debe agregar `@gmail.com`, dominios comodín, nombres visibles ni coincidencias parciales.

La primera corrida usa `HU030_FECHA_CORTE_ISO`. Luego se usa `HU030_ULTIMO_BARRIDO_ISO` menos 15 minutos de solapamiento; solo se guarda el nuevo cursor tras completar el barrido. Si hay más threads que el lote permitido, la corrida procesa el lote y deja el cursor sin avanzar para no saltarse mensajes. En un backlog sostenido mayor al lote, el orden/devuelta de Gmail puede hacer que una página anterior reaparezca; antes de activar el trigger se debe dimensionar `HU030_LOTE_MAX` y verificar el volumen. El estado local no agrega un cursor/persistencia de documentos porque la especificación limita la persistencia a último barrido y retries.

Default: 25 threads; máximo configurable: 100. Los HTTP se procesan secuencialmente. La cola técnica queda acotada a 20 XML y 8 KB; si no puede guardarse un nuevo retry, el barrido no avanza y el caso queda visible para revisión operacional.

## Adjuntos y pairing

Se solicitan adjuntos sin imágenes inline. XML se clasifica por extensión `.xml` o MIME XML; PDF por `.pdf` o MIME PDF; ZIP se ignora y no se descomprime. Un PDF sin XML no llama al backend y marca el thread para revisión. No se convierte XML a texto antes de hashearlo.

Con un XML y un PDF se asocian directamente. Con varios, solo se asocian basenames idénticos después de quitar path, espacios externos y extensión y comparar sin distinguir mayúsculas. No se quitan sufijos/números ni se adivina. Si la correspondencia no es única, el XML se envía sin PDF y se marca revisión.

Un PDF que llega en otro Gmail Message ID no se vincula automáticamente a una recepción anterior. Cada XML usa `message.getId()`; el backend diferencia por Gmail message ID y hash XML. Reenviar posteriormente el mismo XML junto al PDF inicia otra recepción de transporte y depende de la idempotencia documental del backend.

## SHA-256, HMAC y multipart

El hash se calcula sobre `Blob.getBytes()`; se envían los mismos Blob cuyos bytes se hashearon. La canonical es exactamente nueve líneas separadas por LF, sin LF final, con ruta `/api/integraciones/facturas`. Cada intento crea UUID v4 minúsculo, timestamp decimal Unix en segundos y firma HMAC-SHA256 `v1=<hex lowercase>`. `UrlFetchApp.fetch` recibe solo las partes Blob `xml` y, si aplica, `pdf`; no se construye boundary, no se fija `Content-Type` y no se envía Bearer.

Se usan exactamente los headers `X-EPSA-Key-Id`, `X-EPSA-Timestamp`, `X-EPSA-Nonce`, `X-EPSA-Message-Id`, `X-EPSA-XML-SHA256`, `X-EPSA-PDF-SHA256` y `X-EPSA-Signature`. Sin PDF, el hash enviado es `-`.

## Respuestas y retries

- `200`/`201`: completado; si `pdfPendiente` es true, el thread queda Pendiente.
- `202`: Pendiente; vuelve a intentar en un siguiente trigger sin consumir retry técnico.
- `401`: detiene toda la corrida y registra solo un aviso sanitizado.
- `500`, `503`, `NONCE_REPETIDO`, `LEASE_PERDIDO`: máximo cinco intentos totales, con esperas de 15, 30, 60 y 120 minutos. Cada intento vuelve a generar nonce, timestamp y firma.
- `400`, `413`, `422` y conflictos `409` no transitorios: revisión manual; no se reintentan.

La cola guarda únicamente `messageId`, `sha256Xml`, `retryCount` y `nextAttemptAt`; no guarda documentos. Para retry, vuelve a obtener el Gmail message por ID y exige exactamente un XML cuyo SHA-256 coincide. Si no existe o hay más de uno, lo retira de la cola y marca revisión. Al completar o requerir atención manual, se elimina de la cola.

Las labels `Procesado`, `Pendiente`, `Revision` y `Error` son indicadores operacionales, no idempotencia ni exclusión de búsqueda. El estado calculado del thread prioriza Revision, Error, Pendiente y luego Procesado. Si un mensaje nuevo llega al mismo thread, se vuelve a inspeccionar según su fecha. Las labels previas de atención (Pendiente/Revision/Error) se conservan como estado agregado conservador; una persona debe retirar la label de atención después de resolver el caso para que una nueva evaluación pueda mostrar Procesado. La label Procesado nunca impide buscar ni procesar mensajes nuevos.

La persistencia permitida no incluye el estado individual de cada XML ya finalizado. Por eso, si se requiere recalcular automáticamente una label de atención antigua sin intervención humana, hace falta aprobar almacenamiento adicional de estado por documento; esta fase no lo incorpora.

Los logs incluyen solo IDs de mensaje, estado y motivo controlado de autenticación, prefijo de hash, HTTP status, códigos controlados, `codrec`, `coddoc`, intento y duración. No registran remitente, XML/PDF, seriales, secretos, firma, canonical, cabeceras completas ni respuestas crudas.

## Scopes y triggers

El manifest declara scopes para Gmail, solicitudes HTTPS, PropertiesService y triggers. Apps Script puede solicitar acceso amplio a Gmail por usar `GmailApp`; por eso el proyecto debe pertenecer a la cuenta dedicada y tener acceso de edición limitado.

Funciones disponibles, ninguna ejecutada durante esta implementación:

- `instalarTriggerFacturas()` crea un trigger cada 5 minutos y evita duplicados.
- `listarTriggersFacturas()` devuelve los triggers del handler HU-030.
- `eliminarTriggersFacturas()` los elimina.
- `recrearTriggerFacturas()` elimina y crea uno nuevo.

El trigger instalable debe crearlo `epsamotor.admin@gmail.com`. No instalarlo todavía. Quien pueda editar código Apps Script sigue siendo un actor sensible.

## Pruebas y pasos antes de E2E

Las pruebas locales usan `node:test` con dobles de GmailApp, Utilities, UrlFetchApp, PropertiesService, LockService y ScriptApp; no autorizan ni invocan servicios Google reales.

Antes de una prueba externa, acordar explícitamente un entorno de integración que no sea producción y seguir este orden:

1. desplegar el backend HU-030 en el entorno aprobado;
2. configurar las variables HMAC/bucket en Render para ese entorno;
3. verificar el endpoint y su contrato;
4. crear/configurar el proyecto Apps Script con `epsamotor.admin@gmail.com`;
5. configurar propiedades y secreto aprobado;
6. ejecutar una prueba manual controlada sin trigger;
7. ejecutar E2E sintético en el entorno aprobado;
8. ejecutar prueba real controlada;
9. solo tras aprobación, instalar el trigger de 5 minutos.

No se asume que exista staging; si no existe, queda pendiente su disponibilidad o aprobación de un entorno seguro. La base operativa con datos de prueba no cambia esa restricción. No apuntar automáticamente datos sintéticos a producción.
