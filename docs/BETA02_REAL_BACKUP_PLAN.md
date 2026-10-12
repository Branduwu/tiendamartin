# BETA02 — Plan de backup real de Database y Storage

Estado: **BETA02 PARCIAL / P0 OPEN / NO-GO**. Este plan prepara el primer backup real; no autoriza conectarse, pausar escrituras, copiar datos productivos, crear un repositorio productivo ni restaurar nada.

## Alcance y límites

El origen futuro es únicamente producción `kffmliytjcbbsfefbupc`. El proyecto `lxofwmtfqxfuppzujlbt` ya tiene esquema de ensayo y **no se debe sobrescribir**. El repositorio `C:\SmartRetailBackupDrill\restic-repository` es sólo sintético y no se reutilizará para datos reales.

Un dump de Postgres no descarga objetos de Supabase Storage: sus tablas contienen metadata, mientras que los bytes de cada archivo se copian por separado. Las copias lógicas tampoco prometen restaurar contraseñas de roles, secretos de Vault, API keys, claves de cifrado, secretos SMTP, configuraciones de Vercel/DNS/Resend ni todos los estados Auth. La guía de Supabase confirma la separación de objetos Storage, la restauración manual y el tratamiento especial de roles, migraciones y customizaciones `auth`/`storage` ([backup y restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [backups](https://supabase.com/docs/guides/platform/backups)).

## Método propuesto para Database

### Herramienta y conexión

Usar el flujo oficial `supabase db dump` con **Session Pooler** obtenido literalmente de **Supabase Dashboard → Connect**. No componer el host con la región y no usar Transaction Pooler para el dump o restore administrativo. Supabase recomienda Session Pooler por defecto cuando la red no dispone de IPv6; el pooler compartido usa IPv4 y el usuario debe incluir el Project Ref. TLS debe permanecer activo y validado. [Conexión a Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)

La estación actual tiene Supabase CLI 2.120.0 y Restic 0.19.1, pero no tiene `pg_dump`, `psql` ni `pg_restore` en PATH, y Docker Desktop no tiene servidor disponible. Antes de ejecutar, se requiere una de estas opciones autorizadas:

1. Instalar y verificar PostgreSQL client tools oficiales, incluyendo `pg_dump`, `psql` y `pg_restore`; o
2. Iniciar Docker Desktop y verificarlo, porque Supabase CLI ejecuta `pg_dump` en un contenedor.

La contraseña administrativa sólo se introduce mediante prompt nativo o un gestor de secretos aprobado. Nunca se registra en comando, historial, `.env`, variable de entorno, Git, log ni evidencia. El rol runtime `smartretail_api` nunca se usa para backup ni se eleva.

### Artefactos de un run real

En un directorio local temporal cifrado, fuera del workspace y del repositorio Restic productivo, crear con el mismo `RUN_ID`:

- `roles.sql`: roles personalizados y grants, mediante `supabase db dump --role-only`.
- `schema.sql`: estructura de esquemas de usuario, tablas, constraints, funciones, triggers, políticas y FORCE RLS.
- `data.sql`: datos con `--data-only --use-copy`; conservar explícitamente metadata `storage.buckets` y `storage.objects` que el flujo oficial incluya.
- `history_schema.sql` y `history_data.sql`: esquema y datos de `supabase_migrations`, como prescribe Supabase para preservar historial.
- `managed-customizations.sql`: sólo customizaciones propias a `auth`/`storage` detectadas por diff y/o migraciones; no asumir que el dump por defecto cubre objetos gestionados.
- `storage-buckets.copy` y `storage-objects.copy`: exportaciones canónicas, ordenadas y con cabecera de **todas** las columnas presentes de `storage.buckets` y `storage.objects`. Son artefactos obligatorios aun si el dump estándar los incluyera; el manifiesto registra su `COUNT(*)`, SHA-256 y el esquema/columnas observados para evitar depender de cobertura implícita de schemas gestionados.
- `storage-policies.json`: inventario canónico de definiciones efectivas de políticas sobre `storage.objects`, incluyendo nombre, rol, comando, modo y expresiones `USING`/`WITH CHECK`, además de `public`, límites y tipos MIME de cada bucket. Se captura con una consulta administrativa de sólo lectura, se hashea y se compara con el destino antes de aceptar el restore.
- `database-manifest.json`: versión de CLI/herramientas, hashes SHA-256 de cada artefacto, versiones de migración, conteos por tabla crítica, conteo de políticas/RLS/FORCE RLS, y hashes agregados de ledger/stock sin imprimir filas.

La extracción de metadata Storage se hace con una consulta administrativa de sólo lectura que enumere las columnas reales mediante `information_schema`, exporte ambos conjuntos en orden estable y produzca el conteo y SHA-256 descritos. No se permite sustituirla por una inferencia desde objetos descargados.

Plantilla de artefactos, **no ejecutar todavía**. El mecanismo de autenticación de `db dump` todavía es un preflight bloqueante: una URI que contiene contraseña no puede aparecer como argumento, historial ni lista de procesos. Antes de cualquier uso real se debe ensayar y aprobar en el proyecto aislado un método interactivo o de gestor de secretos que mantenga la contraseña fuera de argumentos, logs y Git. Hasta que exista esa evidencia, estos comandos son una referencia de cobertura, no un runbook ejecutable:

```powershell
# El destino debe estar fuera del workspace/Git y con ACL privada.
supabase db dump <MECANISMO_DE_CONEXION_APROBADO> --role-only --file "<RUN_DIR>\roles.sql"
supabase db dump <MECANISMO_DE_CONEXION_APROBADO> --file "<RUN_DIR>\schema.sql"
supabase db dump <MECANISMO_DE_CONEXION_APROBADO> --data-only --use-copy --file "<RUN_DIR>\data.sql"
supabase db dump <MECANISMO_DE_CONEXION_APROBADO> --schema supabase_migrations --file "<RUN_DIR>\history_schema.sql"
supabase db dump <MECANISMO_DE_CONEXION_APROBADO> --schema supabase_migrations --data-only --use-copy --file "<RUN_DIR>\history_data.sql"
```

No usar `--password`, `--debug`, `db reset`, `db pull`, `migration repair` ni redirección a rutas dentro del repositorio. Antes del run se prueba el mecanismo sólo contra un recurso aislado autorizado; la CLI oficial también documenta que los dumps por defecto excluyen schemas administrados y no incluyen datos/roles sin flags explícitos. [Referencia `db dump`](https://supabase.com/docs/reference/cli/v0/supabase-db-dump)

### Auth y configuración excluida o condicionada

`auth.users` y sus datos deben validarse explícitamente en el manifest del dump y en el restore; no se promete recuperar sesiones activas, MFA, contraseñas utilizables, proveedores OAuth, plantillas, Site URL, redirects ni SMTP. La restauración manual a un proyecto nuevo exige revisar la clave raíz de cifrado y la configuración Auth según la guía oficial; si no se aprueba esa operación, el plan alterno es recrear configuración y reinvitar usuarios. Las contraseñas de roles LOGIN se restablecen en el destino con valores nuevos, nunca se copian ni se reportan.

Configuración externa se captura como checklist redactado, no como secretos: Supabase Auth/SMTP/redirects, Vercel nombres de variables, dominio/DNS, Resend, proveedor de almacenamiento de backup, operadores y contactos de escalamiento.

## Método propuesto para Storage

Los buckets a exportar son privados: `product-images` y `purchase-documents`. No se modifican sus políticas RESTRICTIVE. La exportación usa un mecanismo administrativo de lectura independiente, preferentemente S3-compatible desde **Storage → Configuration → S3**. Antes de usarlo se acredita por escrito el permiso efectivo: listar/leer únicamente esos dos buckets, fecha de expiración/revocación y denegación de `Put`/`Delete`. Si la credencial S3 disponible no puede demostrar ese mínimo privilegio, no se usa; se evalúa el mecanismo oficial alterno con el mismo ensayo de denegación. Supabase indica que CLI puede listar/copiar objetos y que S3-compatible/rclone es más eficiente para volúmenes altos; generar claves S3 requiere guardarlas al crearlas, por lo que sólo se hará con aprobación y gestor de secretos. [Descarga de objetos](https://supabase.com/docs/guides/storage/management/download-objects)

Con un `RUN_ID` común al dump, el operador hará:

1. Listar recursivamente ambos buckets y guardar ruta, tamaño, MIME, `updated_at` y metadata en un manifest local.
2. Descargar cada objeto a `storage/<bucket>/<object-path>` sin cambiar metadata ni políticas.
3. Calcular SHA-256 local de cada archivo descargado y anexarlo al manifest.
4. Comparar `retail.product_images.object_path` y rutas derivables de documentos (`<tenant>/<purchase>/original`) con `storage.objects` y con los archivos descargados.
5. Clasificar referencias faltantes, metadata sin byte y objetos huérfanos; cualquier diferencia bloquea la declaración de consistencia.

`supabase storage ls`/`cp` son una alternativa oficial para pocos objetos; para volumen real se prefiere herramienta S3/rclone y concurrencia limitada. No se emplean service key, S3 secret ni URLs firmadas en logs. Exportar `storage.objects` sin descargar bytes es incompleto.

## Ventana de consistencia y rollback operativo

Database y Storage no comparten una transacción atómica. Antes de tomar el corte se requiere aprobación explícita para una ventana de sólo lectura: bloquear nuevas ventas, compras, ajustes, caja, altas/edición de productos y cargas de imagen/documento; registrar inicio/fin UTC, responsable y estado. Durante la ventana, obtener dump + metadata + objetos con el mismo `RUN_ID`; sólo reabrir escritura después de que los manifiestos DB↔Storage cierren sin diferencias.

No hay rollback de un dump de sólo lectura. Si falla una fase, se elimina únicamente el conjunto temporal incompleto, se conserva evidencia sanitizada del fallo y se reprograma; no se toca producción ni se modifica ledger. Si una ventana no puede detener escrituras, el resultado se marca **no consistente** y no acredita RPO/RTO.

## Repositorio productivo y destino externo

Recomendación principal: un bucket Backblaze B2 dedicado, privado y exclusivo para Restic, con una cuenta separada de producción, MFA, application key limitada a ese bucket, Object Lock/retención obligatorio y un segundo custodio de la contraseña. Restic cifra antes de subir; B2 añade almacenamiento externo y S3-compatible. El precio publicado actualmente parte de **USD 6.95/TB-mes**, con egress gratuito hasta 3× almacenamiento; confirmar precio, impuestos y región antes de contratar. [B2 pricing](https://www.backblaze.com/cloud-storage/pricing)

Alternativa económica: disco externo cifrado, dedicado y desconectado tras el backup, guardado fuera del sitio principal, más una segunda copia independiente. Coste inicial de hardware y rotación manual; no sustituye por sí solo una copia off-site ni protege contra pérdida física simultánea. Ninguna opción se crea, contrata o recibe datos sin autorización.

El repositorio productivo será distinto del sintético, con contraseña exclusiva generada en prompt, custodia en gestor aprobado, recuperación de clave probada con suplente, retención propuesta 7 diarias + 4 semanales + 3 mensuales, y pruebas de restauración trimestrales. Para que el backup real contribuya al cierre del P0, la retención inmutable/Object Lock debe estar habilitada y verificada antes del primer snapshot; las credenciales de escritura, eliminación/retención y administración de cuenta serán separadas, con MFA. Se prueba que el operador de backup no puede eliminar un snapshot dentro de la retención. Antes de Restic, cifrar/ACL-proteger la zona temporal y excluirla de Git; después, añadir dumps, manifests y Storage descargado como una unidad de snapshot.

## Restore aislado futuro

Crear **un proyecto Supabase nuevo y descartable**, no reutilizar `lxofwmtfqxfuppzujlbt`, tras aprobación. Antes de restore: Email/SMTP/OAuth/webhooks/jobs externos deshabilitados, dominio no productivo, claves nuevas, destino sin integraciones productivas y plan de Auth aprobado. Restaurar roles/schema/data/historial/customizaciones según el orden oficial, con contraseñas nuevas para roles LOGIN. Después restaurar buckets privados y objetos desde manifest; nunca cambiar a público.

Secuencia de restore obligatoria y ensayable: (1) verificar snapshot/hashes y el manifiesto antes de importar; (2) certificar destino nuevo, descartable y aislado, con Email/SMTP/OAuth/webhooks/cron/jobs externos deshabilitados y egress denegado; inspeccionar funciones, triggers, event triggers y extensiones para detectar salida de red; (3) restaurar roles sin credenciales reutilizadas y grants mínimos; (4) restaurar schema de aplicación, políticas y FORCE RLS; (5) restaurar datos de aplicación y, sólo si se aprobó explícitamente, Auth; (6) importar metadata Storage (`storage.buckets` antes de `storage.objects`) y customizaciones permitidas de `auth`/`storage`; (7) restaurar objetos privados desde el manifiesto; (8) restaurar historial `supabase_migrations` únicamente tras confirmar que schema y migraciones coinciden; (9) generar credenciales nuevas, efectuar validaciones y destruir el destino. Cualquier dependencia observada durante el ensayo se añade al manifiesto y bloquea el cierre hasta repetir la restauración completa.

Validar: hashes de dumps/objetos, conteos por tabla, migraciones, constraints, funciones, triggers, policies, RLS/FORCE RLS, configuración y privacidad de buckets, roles/grants, integridad monetaria/ledger/stock, referencias DB↔Storage, acceso anónimo/cross-tenant denegado, y ausencia de salida de correo. Medir inicio/fin de backup y restore; sólo entonces comparar con RPO 24 h y RTO 8 h propuestos.

## Preflight, evidencia y autorizaciones necesarias

Preflight obligatorio: proyecto producción/ref confirmado verbalmente, proyecto restore nuevo aprobado, Dashboard Connect abierto sin copiar secretos a chat, herramienta DB disponible, método de autenticación de dump ensayado sin secreto en argumentos, destino externo creado/cifrado/con retención inmutable, credenciales separadas y MFA verificados, responsables de operador/revisor definidos, capacidad/cuota y coste revisados, ventana de sólo lectura aprobada y plan de comunicación preparado.

Evidencia mínima: `RUN_ID`, versiones, inicio/fin UTC, hashes, tamaños, conteos, resultado de `restic check --read-data`, snapshot ID, restore hash comparison, diferencias/decisiones y borrado de temporales. No incluir PII, bytes de documentos, passwords, JWT, API keys ni connection strings.

Autorizaciones pendientes: instalar herramientas o iniciar Docker; crear credencial temporal DB/Storage; elegir y contratar/crear destino externo; designar suplente/custodia; aprobar ventana de sólo lectura; crear destino de restore nuevo; aprobar captura de producción y posterior restore aislado.
