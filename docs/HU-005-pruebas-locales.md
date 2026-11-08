# HU-005: probar la separación en tu computadora

Con esta guía pruebas la separación completa sin desplegar nada: la API y el panel corren en tu computadora y guardan en el mismo Supabase del equipo. Cuando todo pase, se sube el PR y Adrián despliega una sola vez.

Importante: lo que pruebes queda guardado de verdad en Supabase (separaciones, compradores y capturas). Usa pocas motos, anota sus números y, si quieres dejarlas como estaban, usa la limpieza del final.

## Antes de empezar

1. Los SQL `supabase/migrations/202611070001_hu005_comprador_evidencia.sql` y `supabase/migrations/202611080001_hu005_techo_y_venta.sql` deben estar ejecutados en Supabase, en ese orden (una sola vez basta).
2. Estar en la rama del PR con lo último:

```
git checkout feature/HU-005-separar-moto
git pull
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

Cómo saber que está conectado a tu API: en Disponibilidad, pestaña Lista, pulsa **Separar** en una moto. Si aparece la sección «Comprador» para escribir el documento, está bien. Si sale «La API conectada todavía no tiene la separación», el panel sigue usando Render: revisa el paso 4 de «Antes de empezar» y reinicia el panel.

## Paso 3: pruebas

Usa datos de prueba que no sean de personas reales, por ejemplo DNI `12345678` (Rosa Prueba Quispe) y, para empresa, RUC `20609876540` (Transportes Prueba S.A.C.). Para la captura sirve cualquier imagen JPG o PNG, por ejemplo una captura de pantalla.

| # | Quién | Qué haces | Qué debe pasar |
|---|---|---|---|
| 1 | Vendedor | Separar una moto: DNI nuevo, completa nombres, apellido, celular (9 dígitos que empiezan con 9) y correo; monto 300, Transferencia, N° de operación, captura, gerente, casilla de confirmación y techo «Lona». | Los errores salen mientras escribes. Sale «Moto separada». En Disponibilidad la moto aparece Separada y sin botón Separar. En su ficha está «Separación activa» con el techo y **Ver captura**. En Preparación la moto figura «Pendiente de armado del techo». |
| 2 | Vendedor | En otra moto, Transferencia con captura pero sin marcar la casilla de confirmación. | No deja guardar: «La captura sola no confirma el pago». La moto sigue libre. |
| 3 | Administradora | En esa misma moto, mismo DNI (aparece en verde), Efectivo con observación y la casilla «Recibí el dinero». | Se separa sin pedir captura. En la ficha, «Recibido por» es la administradora. |
| 4 | Dos personas | Con dos navegadores (uno en ventana de incógnito), abran Separar en la misma moto y guarden casi a la vez. | Una se guarda; la otra ve «La unidad ya tiene una separación activa» y no se guarda nada más. |
| 5 | Cualquiera | Llena una separación, apaga el wifi, pulsa «Separar moto» y «Sí, separar»; vuelve a conectar y pulsa otra vez. | La primera vez avisa que no se pudo confirmar y no muestra éxito. La segunda la guarda (o dice «ya estaba guardada») y hay una sola separación. |
| 6 | Cualquiera | Busca una moto que ya está separada. | No muestra el botón Separar. |
| 7 | Cualquiera | Pulsa «Separar moto» con el formulario vacío; luego monto 0; luego un archivo que no sea imagen. | Muestra el error en cada campo y no guarda nada. |
| 8 | Cualquiera | Separa una moto que está en Ancón o en tránsito. | Se separa; su ubicación y su preparación siguen iguales. |
| 9 | Gerente | Separa con RUC `20609876540`, Transferencia y un techo. Luego pulsa «Ir a Preparación» y registra el techo instalado. | Pide razón social y no pide apellidos. El gerente aparece ya elegido como quien confirmó. Con el techo instalado, la moto queda «Lista para entrega». |
| 10 | Cualquiera | Con la ventana de Separar ya llena, detén la API (Ctrl+C en la terminal 1) y pulsa separar; luego vuelve a iniciarla (`npm run dev`) y pulsa otra vez. | Sin API no anuncia éxito ni guarda nada; con la API de nuevo, se guarda una sola vez. |

## Revisar en Supabase (SQL Editor)

```sql
SELECT s.codsep, s.coduni, u.nummotuni AS motor, u.estcomuni AS situacion,
       c.numdoccli AS documento, c.nomcli AS comprador, s.metpagsep AS medio, s.monadesep AS monto,
       s.fecpagsep AS fecha_pago, s.ingconfsep AS confirmado, s.fecconfsep AS confirmado_el,
       s.rutavouchersep AS captura, s.fecsep AS registrada
FROM public.separacion AS s
JOIN public.unidad AS u ON u.coduni = s.coduni
JOIN public.cliente AS c ON c.codcli = s.codcli
WHERE s.estsep = 'Activa'
ORDER BY s.codsep DESC;
```

## Limpieza opcional de las pruebas

Solo si quieres dejar las motos de prueba como estaban. Primero revisa con la consulta anterior; luego cambia los números de moto (`coduni`) y los documentos de prueba, y ejecuta. Las motos vuelven a «No disponible»; si alguna estaba a la venta, vuelve a ponerla desde su ficha con «Poner a la venta». Las capturas quedan en Storage (no estorban; si quieres, bórralas desde Storage, carpeta `separaciones-evidencia/separaciones/<coduni>`).

```sql
BEGIN;
-- Cambia estos números por las motos que separaste en las pruebas
DELETE FROM public.separacion WHERE estsep = 'Activa' AND coduni = ANY (ARRAY[0, 0]::bigint[]);
UPDATE public.unidad SET estcomuni = 'No disponible'
WHERE estcomuni = 'Separada' AND coduni = ANY (ARRAY[0, 0]::bigint[])
  AND NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.coduni = unidad.coduni AND s.estsep = 'Activa');
-- Compradores de prueba que ya no tienen separaciones, ventas ni leads
DELETE FROM public.cliente AS c
WHERE c.numdoccli IN ('12345678', '20609876540')
  AND NOT EXISTS (SELECT 1 FROM public.separacion AS s WHERE s.codcli = c.codcli)
  AND NOT EXISTS (SELECT 1 FROM public.venta AS v WHERE v.codcli = c.codcli)
  AND NOT EXISTS (SELECT 1 FROM public.lead AS l WHERE l.codcli = c.codcli);
COMMIT;
```

## Cuando todo pase

1. Quita o comenta las dos líneas de `frontend/.env` si quieres volver a usar Render en local (Netlify no las usa).
2. Avísale a Adrián en el PR que las pruebas locales pasaron: él despliega la API en Render y después el panel en Netlify. El SQL ya está ejecutado.
3. Con lo desplegado, repite la prueba 1 una vez en la web publicada.
