# HU-006 — prueba controlada de concurrencia

Esta prueba valida el comportamiento de dos solicitudes HTTP simultáneas desde
clientes independientes. No sustituye una prueba con sesiones PostgreSQL
independientes ni se ejecuta durante el desarrollo local con PGlite.

## Preparación en QA

1. Usar una unidad de QA identificada, `Disponible`, sin venta ni separación
   activa. Reservar esa unidad para esta prueba.
2. Usar un comprador activo, un responsable comercial activo y una sede activa.
3. Confirmar que el precio base del modelo está configurado. Usar `Por definir`
   para no introducir un adicional de techo en este escenario.
4. Obtener un token de usuario comercial de QA. No guardar el token en archivos,
   consola compartida ni logs.

## Dos solicitudes en paralelo

En PowerShell, completar los identificadores y el host de QA. Ejecutar desde una
terminal que tenga `EPSA_QA_TOKEN` configurado en su sesión. Las dos claves deben
ser UUID diferentes.

```powershell
$url = 'https://<host-qa>/api/unidades/<coduni>/ventas'
$body = @{
  codcli = <codcli>
  codusuResponsable = <codusu>
  codsedAtencion = <codsed>
  fechaVenta = (Get-Date -Format 'yyyy-MM-dd')
  modalidad = 'Crédito'
  techo = @{ decision = 'Por definir' }
  pagos = @()
} | ConvertTo-Json -Depth 8 -Compress

$keyA = [guid]::NewGuid().ToString()
$keyB = [guid]::NewGuid().ToString()
$jobs = @(
  Start-Job -ArgumentList $url,$body,$env:EPSA_QA_TOKEN,$keyA -ScriptBlock {
    param($url,$body,$token,$key)
    try {
      $r = Invoke-WebRequest -Method Post -Uri $url -Headers @{
        Authorization = "Bearer $token"; 'Idempotency-Key' = $key
      } -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
      [pscustomobject]@{ key=$key; status=[int]$r.StatusCode; body=$r.Content }
    } catch { [pscustomobject]@{ key=$key; error=$_.Exception.Message } }
  }
  Start-Job -ArgumentList $url,$body,$env:EPSA_QA_TOKEN,$keyB -ScriptBlock {
    param($url,$body,$token,$key)
    try {
      $r = Invoke-WebRequest -Method Post -Uri $url -Headers @{
        Authorization = "Bearer $token"; 'Idempotency-Key' = $key
      } -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
      [pscustomobject]@{ key=$key; status=[int]$r.StatusCode; body=$r.Content }
    } catch { [pscustomobject]@{ key=$key; error=$_.Exception.Message } }
  }
)
$jobs | Wait-Job | Receive-Job
$jobs | Remove-Job
```

Esperado: exactamente una respuesta `201`; la otra debe ser un conflicto `409`
con mensaje seguro. Debe existir una venta para la unidad, estar la unidad en
`Vendida`, y no debe haber dos ventas ni dos conversiones de separación.

Después, repetir con una sola clave y body idéntico. Se espera una respuesta
`201` y otra `200` con el mismo `codven`; pagos, adelanto y desglose no deben
duplicarse.

## Evidencia que debe conservar QA

- Fecha/hora con zona horaria, host/entorno y `coduni` de QA.
- `Idempotency-Key` de cada intento, HTTP status y cuerpo de ambas respuestas.
- `codven` devuelto, si existe. No adjuntar tokens ni datos personales.
- En logs del backend: correlación de cada request y el `code` de Supabase sin
  incluir el token, body íntegro ni datos personales.
- En los logs PostgreSQL de Supabase, buscar por hora y función
  `hu006_crear_venta`; registrar SQLSTATE, contexto de función y si hubo espera,
  deadlock o timeout. El API oculta esos detalles al cliente deliberadamente.

La lectura de estado en QA se debe hacer con el acceso administrativo autorizado
del entorno, después de las solicitudes. No ejecutar esta verificación durante
esta tarea ni contra producción.
