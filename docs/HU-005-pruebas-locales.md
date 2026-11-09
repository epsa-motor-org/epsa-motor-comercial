# HU-005: probar la separación en tu computadora

Con esta guía pruebas la separación completa sin desplegar nada: la API y el panel corren en tu computadora y guardan en el mismo Supabase del equipo. Cuando todo pase, se sube el PR y Adrián despliega una sola vez.

Importante: lo que pruebes queda guardado de verdad en Supabase (separaciones, compradores y capturas). Usa pocas motos, anota sus números y, si quieres dejarlas como estaban, usa la limpieza del final.

## Antes de empezar

1. Los SQL `202611070001_hu005_comprador_evidencia.sql`, `202611080001_hu005_techo_y_venta.sql`, `202611080002_hu005_decision_techo_y_tope.sql` y `202611080003_hu005_comprador_sin_documento.sql` (carpeta `supabase/migrations`) deben estar ejecutados en Supabase, en ese orden (una sola vez basta).
2. Estar en la rama de las correcciones, con los archivos copiados encima:

```
git checkout feature/HU-005-correcciones-qa
```

3. En la raíz del proyecto (donde está `package.json` de la API) debe existir el archivo `.env` con estas tres líneas. Es el mismo que usa la API; no se sube a GitHub y nunca lleva la clave service_role:

```
SUPABASE_URL=https://scydgghoucqlnpyxlczg.supabase.co
SUPABASE_ANON_KEY=la clave anon del proyecto
PORT=3000
```

4. En `frontend/.env` agrega estas dos líneas. Hacen que el panel use tu API local en vez de la de Render (también es un archivo que no se sube):

```
EPSA_API_LOCAL=1
VITE_API_URL=http://localhost:3000
```

## Paso 1: levantar la API (terminal 1)

En la raíz del proyecto:

```
npm install
npm run dev
```

Déjala abierta. En el navegador, `http://localhost:3000` debe mostrar `{"message":"API EPSA Motor funcionando"}`.

## Paso 2: levantar el panel (terminal 2)

```
cd frontend
npm install
npm run dev
```

Abre la dirección que muestra (normalmente `http://localhost:5173/admin`) e inicia sesión. Si el panel ya estaba abierto antes de cambiar `frontend/.env`, ciérralo con Ctrl+C y vuelve a ejecutar `npm run dev`: los cambios del `.env` solo se leen al iniciar.

Cómo saber que está conectado a tu API: separa una moto (prueba 1). Si al guardar sale «No se pudo registrar al comprador: codtdo debe ser un entero positivo» o «La API conectada todavía no tiene la separación», el panel sigue usando la API de Render: revisa el paso 4 de «Antes de empezar» y reinicia el panel.

## Paso 3: pruebas

Usa datos de prueba que no sean de personas reales, por ejemplo Rosa Prueba Quispe con celular `987654321`. Para la captura sirve cualquier imagen JPG o PNG, por ejemplo una captura de pantalla.

| # | Quién | Qué haces | Qué debe pasar |
|---|---|---|---|
| 1 | Vendedor | Separar una moto: escribe nombres, apellido paterno, apellido materno y celular (9 dígitos que empiezan con 9); monto 300,50, Transferencia, N° de operación, captura, gerente, casilla de confirmación y techo «Con techo», tipo «Lona». | Los errores salen mientras escribes. Sale «Moto separada». En Disponibilidad la moto aparece Separada y sin botón Separar. En su ficha está «Separación activa» con «Lona, elegido por el comprador, por armar» y **Ver captura**. En Preparación la moto figura «Pendiente de armado del techo». |
| 2 | Vendedor | En otra moto, Transferencia con captura pero sin marcar la casilla de confirmación. | No deja guardar: «La captura sola no confirma el pago». La moto sigue libre. |
| 3 | Administradora | En esa misma moto, el mismo comprador (mismos nombres y celular), Efectivo con observación y la casilla «Recibí el dinero». | Se separa sin pedir captura. En la ficha, «Recibido por» es la administradora. En Supabase el comprador figura una sola vez. |
| 4 | Dos personas | Con dos navegadores (uno en ventana de incógnito), abran Separar en la misma moto y guarden casi a la vez. | Una se guarda; la otra ve «La unidad ya tiene una separación activa» y no se guarda nada más. |
| 5 | Cualquiera | Llena una separación, apaga el wifi, pulsa «Separar moto» y «Sí, separar»; vuelve a conectar y pulsa otra vez. | La primera vez avisa que no se pudo confirmar y no muestra éxito. La segunda la guarda (o dice «ya estaba guardada») y hay una sola separación. |
| 6 | Cualquiera | Busca una moto que ya está separada. | No muestra el botón Separar. |
| 7 | Cualquiera | Pulsa «Separar moto» con el formulario vacío; luego monto 0; luego un archivo que no sea imagen. | Muestra el error en cada campo y no guarda nada. |
| 7b | Cualquiera | En Monto escribe `-300.50`; luego pega `-300,50`; luego `0`. Después `300.50` y `300,50`. | Las tres primeras: el campo conserva el signo, sale «El adelanto debe ser mayor que cero» y no deja separar. Las dos últimas son válidas; al separar con `300,50` la ficha muestra S/ 300.50. |
| 7c | Cualquiera | En Celular escribe letras, `5…`, `999999999` y pega `+51 987 654 321`. | No acepta letras; avisa que empieza con 9, que no pueden ser todos iguales y cuántos dígitos faltan; lo pegado queda `987654321`. |
| 7d | Cualquiera | En Nombres y apellidos escribe o pega `Rosa2@ María!`, `Quis-pe.`; en N° de operación `op 12/34*56` y luego `OP-ABC`; en Observación `....123`; en Fecha una de hace 31 días. | Los nombres quedan `Rosa María` y `Quispe` (no entran números ni símbolos); la operación queda `OP123456` y sin números avisa; la observación pide palabras; la fecha avisa «no puede ser de hace más de 30 días». |
| 8 | Cualquiera | Separa una moto que está en Ancón o en tránsito. | Se separa; su ubicación y su preparación siguen iguales. |
| 9 | Gerente | Separa con un comprador de un solo apellido (materno vacío), Transferencia y un techo. Luego pulsa «Ir a Preparación» y registra el techo instalado. | Se separa sin apellido materno. El gerente aparece ya elegido como quien confirmó. Con el techo instalado, la moto queda «Lista para entrega». |
| 10 | Cualquiera | Con la ventana de Separar ya llena, detén la API (Ctrl+C en la terminal 1) y pulsa separar; luego vuelve a iniciarla (`npm run dev`) y pulsa otra vez. | Sin API no anuncia éxito ni guarda nada; con la API de nuevo, se guarda una sola vez. |
| 11 | Cualquiera | En Monto escribe `5000000`; luego un sol más que el precio de lista que sale en la cabecera; luego el precio exacto. | Las dos primeras veces sale «El adelanto no puede superar el precio de lista de la moto (S/ …)» mientras escribes y no deja separar. Con el precio exacto, sí. |
| 12 | Cualquiera | Separa con techo «Por definir». | Se separa. En la ficha: «Por definir: el comprador aún no decide» y el botón **Elegir techo**. En Preparación no aparece. En Disponibilidad, techo «Por definir». |
| 13 | Cualquiera | En la ficha de esa moto pulsa **Elegir techo**, elige «Sin techo» y guarda. Repite en otra moto con «Con techo». | Ya no ofrece «Por definir». La ficha muestra «Sin techo, elegido por el comprador» y quién lo registró; con techo, la moto pasa a «Pendiente de armado del techo». |
| 14 | Cualquiera | Llena una separación con «Con techo». Antes de confirmar, abre las herramientas del navegador (F12), menú ⋮ › **More tools** › **Network request blocking**; marca **Enable network request blocking**, pulsa **+** y escribe `*separacion/techo*`. Separa. Luego desmarca **Enable network request blocking** y pulsa **Reintentar**. | Primero: «Moto separada» y «Lona, elegido por el comprador: pendiente de guardar» con el aviso para reintentar (no dice «Por definir»). Al reintentar: «Techo guardado». En Supabase hay una sola separación con un solo adelanto. Si cierras la ventana antes de reintentar, la ficha muestra lo mismo con su botón **Reintentar**. |

## Revisar en Supabase (SQL Editor)

```sql
SELECT s.codsep, s.coduni, u.nummotuni AS motor, u.estcomuni AS situacion,
       c.nomcli AS nombres, c.apepatcli AS paterno, c.apematcli AS materno, c.telcli AS celular, s.metpagsep AS medio, s.monadesep AS monto,
       s.fecpagsep AS fecha_pago, s.ingconfsep AS confirmado, s.fecconfsep AS confirmado_el,
       s.rutavouchersep AS captura, s.fecsep AS registrada,
       s.dectechosep AS decision_techo, t.nomtte AS techo, s.fecdectechosep AS techo_registrado_el
FROM public.separacion AS s
JOIN public.unidad AS u ON u.coduni = s.coduni
JOIN public.cliente AS c ON c.codcli = s.codcli
LEFT JOIN public.tipotecho AS t ON t.codtte = s.codttesep
WHERE s.estsep = 'Activa'
ORDER BY s.codsep DESC;
```

## Limpieza opcional de las pruebas

Solo si quieres dejar las motos de prueba como estaban. Primero revisa con la consulta anterior; luego cambia los números de moto (`coduni`) y los celulares de prueba, y ejecuta. Las motos vuelven a «Libre para vender». El techo que elegiste queda configurado en la moto; si quieres quitarlo, hazlo desde su ficha (Configuración de techo). Las capturas quedan en Storage (no estorban; si quieres, bórralas desde Storage, carpeta `separaciones-evidencia/separaciones/<coduni>`).

```sql
BEGIN;
-- Cambia estos números por las motos que separaste en las pruebas
DELETE FROM public.separacion WHERE estsep = 'Activa' AND coduni = ANY (ARRAY[0, 0]::bigint[]);
UPDATE public.unidad SET estcomuni = 'Disponible'
WHERE estcomuni = 'Separada' AND coduni = ANY (ARRAY[0, 0]::bigint[])
  AND NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = unidad.coduni AND s.estsep = 'Activa');
-- Compradores de prueba (por su celular) que ya no tienen separaciones, ventas ni leads
DELETE FROM public.cliente AS c
WHERE c.telcli IN ('987654321')
  AND NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.codcli = c.codcli)
  AND NOT EXISTS (SELECT 1 FROM public.venta AS v WHERE v.codcli = c.codcli)
  AND NOT EXISTS (SELECT 1 FROM public.lead AS l WHERE l.codcli = c.codcli);
COMMIT;
```

## Cuando todo pase

1. Quita o comenta las dos líneas de `frontend/.env` si quieres volver a usar Render en local (Netlify no las usa).
2. Al subir el PR, Adrián despliega la API en Render y después el panel en Netlify. El SQL ya está ejecutado.
3. Con lo desplegado, repite las pruebas 1, 7b, 11 y 14 una vez en la web publicada.
