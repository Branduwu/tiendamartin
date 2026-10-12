# SmartRetail — runbook de backup y recuperación

Estado: **P0 OPEN — no usar como evidencia de recuperación completada.**

Este runbook documenta el estado comprobado el 2026-10-10 y el procedimiento propuesto para conseguir una restauración verificable. No contiene credenciales, URLs de conexión, dumps ni documentos de clientes.

## Entorno aislado confirmado para el drill

El usuario confirmó el 2026-10-10 que `smartretail-restore-drill` existe como proyecto distinto de producción en `Branduwu's Org`, con ref `lxofwmtfqxfuppzujlbt`, región `us-east-1`, estado Healthy y plan Free. Registro y proveedor Email están deshabilitados. El entorno no se vinculará a dominios, buckets, API keys, poolers, webhooks ni datos de `kffmliytjcbbsfefbupc`.

Supabase CLI 2.120.0, Restic 0.19.1 y Gitleaks 8.30.1 están disponibles en esta sesión por instalaciones de usuario fuera del monorepo. Se verificaron sus versiones y el ZIP de Restic/Gitleaks contra los checksums SHA-256 publicados por sus proyectos oficiales. El 2026-10-11 se enlazó y se aplicaron las 27 migraciones canónicas exclusivamente al proyecto aislado `lxofwmtfqxfuppzujlbt`, con evidencia sanitizada en `C:\SmartRetailRestoreStage\evidence\apply-20261011T061012Z.md`; no se ejecutó ningún comando contra producción.

## Estado actual comprobado

| Componente | Estado | Evidencia | Implicación |
| --- | --- | --- | --- |
| Supabase Database | Organización Free; proyecto activo; PITR desactivado; API de backups sin backups recuperables listados. | Management API, lectura 2026-10-10. | No existe restore gestionado acreditado. |
| Supabase Storage | Buckets privados `product-images` y `purchase-documents`. | Management API, lectura 2026-10-10. | Database backup no incluye binarios Storage. |
| Objetos Storage | 3 objetos en `purchase-documents`, 0 en `product-images`; los 3 documentos tienen una compra existente asociada por ruta. | Consulta de metadatos y conteos, sin leer contenidos. | La copia de Storage y su manifest son obligatorios. |
| Schema y controles | 29 migraciones aplicadas; 58 tablas `retail`; 57 tienen RLS y FORCE RLS. | Consulta de metadatos, sin datos de negocio. | `role_permissions` es estática y no tiene tenant/RLS; revisar este supuesto al restaurar. |
| Vercel | Plan Hobby; deployment productivo Ready; sin rollback activo. | Vercel CLI, lectura 2026-10-10. | Sólo puede revertir al deployment anterior; no recupera DB, Storage ni variables. |
| Resend / SMTP | Configuración histórica de SMTP/Auth existe, pero su cuenta, cuotas y recuperación no se verificaron en esta tarea. | Documentación existente. | La continuidad de correo queda NO VERIFICADA. |

Supabase documenta que Free no ofrece backups descargables; recomienda `supabase db dump`/`pg_dump` y una copia fuera del proyecto. PITR requiere un plan de pago y add-on. Las copias de Database no incluyen objetos de Storage. Fuentes: [backups de Supabase](https://supabase.com/docs/guides/platform/backups) y [restore por CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Responsables

| Función | Responsable | Decisión o acción |
| --- | --- | --- |
| Propietario de continuidad y custodio provisional | **Propietario de SmartRetail, designado por el usuario el 2026-10-10.** | Aprueba RPO/RTO, coste, acceso, destino externo y prueba de restore. |
| Operador de backup | **PENDIENTE DE DESIGNACIÓN** | Ejecuta dump/copia Storage, cifra y verifica manifiestos. |
| Revisor de restore | **PENDIENTE DE DESIGNACIÓN** | Confirma destino aislado, integridad, tiempo y limpieza. |
| Escalamiento Supabase/Vercel/Resend | **PENDIENTE DE DESIGNACIÓN** | Abre incidente con proveedor sin adjuntar secretos o documentos. |

## Inventario y cobertura necesaria

| Datos críticos | Copia Database | Copia Storage | Configuración/reconstrucción |
| --- | --- | --- | --- |
| Empresas, sucursales, membresías, roles | Sí para `retail`; un dump lógico estándar no debe asumirse como copia de `auth`. | No aplica. | Auth, Site URL, redirects y SMTP se reconstruyen y prueban por separado. |
| Productos, inventario, ledger, compras, ventas, devoluciones, caja, pagos, soporte | Sí: esquema, datos, roles/migraciones y auditoría. | No aplica salvo originales adjuntos. | Runtime DB restringido y variables se reconstruyen desde el gestor de secretos. |
| Imágenes de producto | Metadatos/referencias en Database. | Sí, cada objeto y manifest de hash/tamaño/ruta. | Bucket privado, MIME y políticas deben verificarse. |
| Documentos de compra | Compra y ruta derivable en Database. | Sí, cada original y manifest de hash/tamaño/ruta. | Bucket privado, límite 4 MiB y política de acceso deben verificarse. |
| Auth | No cubierto por el procedimiento Free propuesto hasta que se apruebe un método oficial de migración. | No aplica. | Definir si se re-invitan usuarios, se usa clone de proyecto de pago o se ejecuta otro procedimiento oficial; no prometer restaurar passwords/sesiones. |
| Vercel, DNS y Resend | No aplica. | No aplica. | Restaurar nombres de variables, dominio, redirects, SMTP y DNS desde sus gestores, sin exportar secretos a Git. |

## Objetivos propuestos, no acreditados

| Objetivo | Propuesta para aprobación | Capacidad demostrada | Brecha |
| --- | --- | --- | --- |
| RPO | Hasta 24 horas. | No demostrada. | Free no muestra backup recuperable; requiere backup lógico externo periódico. |
| RTO | Hasta 8 horas. | No demostrada. | Ningún restore integral aislado se ha ejecutado ni medido. |
| Retención | 7 copias diarias, 4 semanales y 3 mensuales, cifradas fuera de producción. | No implementada. | Requiere propietario, destino autorizado y coste aprobado. |
| Prueba | Restore trimestral y tras cambios de esquema/Storage relevantes. | No implementada. | Primer drill debe preceder beta. |

Estos valores son propuestas operativas; no son SLA ni compromiso aprobado. Si el POS requiere menos de 24 h de pérdida tolerable, el propietario debe aprobar un RPO menor y el costo correspondiente.

## Estrategia propuesta

1. Antes de cada backup, confirmar proyecto, entorno y destino fuera de producción; registrar fecha, operador, hash de versiones de migración y sin secretos. Para una copia consistente, abrir una ventana operativa de sólo lectura: detener nuevas ventas, compras, ajustes, caja y cargas; registrar inicio/fin UTC y responsable. Si no se puede detener escritura, el backup queda marcado como no consistente y no acredita RPO/RTO.
2. Obtener dump lógico de roles, esquema y datos mediante el método oficial `supabase db dump`/`pg_dump`, usando una credencial administrativa autorizada únicamente en memoria o en un almacén de secretos. El runtime `smartretail_api` no debe convertirse en owner ni usar privilegios de backup.
3. Crear un manifest de Database: ID de ejecución, hora de corte UTC, herramienta y versión, hashes de roles/esquema/datos, versión de migraciones, conteos por tabla crítica y hashes agregados de ledger/stock sin exportar datos a Git. Firmar o hashear el manifest final.
4. Sin reabrir escritura, listar y copiar los dos buckets privados mediante una credencial de Storage protegida. Copiar cada objeto a un destino de backup cifrado y separado; registrar el mismo ID de ejecución, ruta, tamaño, hash SHA-256, MIME, fecha y hash del manifest Database. Antes de reabrir, comparar referencias Database ↔ Storage: cada `product_images.object_path` debe existir; cada documento debe respetar `<tenant>/<purchase>/original` y corresponder a una compra autorizada. Investigar faltantes u huérfanos antes de declarar el backup válido.
5. Para el primer drill sintético se propone Restic en un repositorio local privado fuera del código, por ejemplo `C:\SmartRetailBackupDrill`; no constituye copia externa ni satisface la retención definitiva. Restic cifra cada archivo antes de escribirlo. La contraseña se generará y tecleará sólo en el prompt nativo, nunca se pondrá en comandos, Git, `.env`, logs ni este runbook. El custodio provisional conserva la contraseña en un gestor de secretos aprobado; antes del backup real debe designar un suplente, un método de recuperación de la clave y una frecuencia de rotación documentada.
6. Para datos reales, el destino externo permanece pendiente de aprobación expresa. Debe ser un repositorio privado con cifrado de origen Restic, acceso mínimo por identidad nominativa, auditoría de acceso y retención aprobada. Nunca guardar dumps, manifests u objetos en Git, el workspace, un bucket productivo ni almacenamiento personal no aprobado.

## Ensayo sintético aislado obligatorio

No iniciar este procedimiento sin un destino aislado autorizado, sin clientes, con correo/SMTP saliente deshabilitado y sin dominios productivos. El destino no debe compartir URL, bucket, API key, pooler, DNS ni variables con producción. Esta fase usa exclusivamente migraciones y datos sintéticos; no acredita recuperación de datos reales.

### Secuencia del drill: progreso actual y pasos pendientes

1. En un terminal con las versiones informadas, verificar `supabase --version`, `restic version` y que el ref objetivo sea exactamente `lxofwmtfqxfuppzujlbt`; no enlazar ni ejecutar comandos contra `kffmliytjcbbsfefbupc`.
2. Histórico: el repositorio Restic local ya fue inicializado para el ensayo sintético. No ejecutar nuevamente `restic init` ni sobrescribir `C:\SmartRetailBackupDrill\restic-repository`. Para un repositorio nuevo autorizado, Restic debe pedir la contraseña interactivamente; no usar `RESTIC_PASSWORD`, archivos de contraseña, historial de shell ni argumentos con secretos. El repositorio local sólo sirve al ensayo sintético. Todo dump, manifest y archivo temporal se crea fuera del workspace, bajo `C:\SmartRetailBackupDrill` o `C:\SmartRetailRestoreStage`; antes y después se revisa `git status --short`.
3. Completado el 2026-10-11: se prepararon las migraciones canónicas con `node scripts/prepare-supabase.mjs C:\SmartRetailRestoreStage`, se verificaron hashes, se confirmó el ref local y se ejecutaron `db push --dry-run --linked` y posteriormente `db push --linked` con autorización expresa. Las 27 migraciones 001–027 quedaron aplicadas sólo al aislado. La contraseña administrativa no fue solicitada ni almacenada. Permanecen prohibidos `--db-password`, variables de entorno, archivos de contraseña, `--debug`, redirecciones de salida y sesiones grabadas.
4. Completado el 2026-10-11: se inicializaron, con autorización separada, los buckets sintéticos privados desde `supabase/product-images.sql` y `supabase/purchase-documents.sql`, fuera de las 27 migraciones. Ambos permanecen vacíos; las políticas RESTRICTIVE impiden operaciones directas de `anon` y `authenticated` en cada bucket protegido. Evidencia sanitizada: `C:\SmartRetailRestoreStage\evidence\storage-20261011T061516Z.md`. No importar dumps ni objetos de producción.
5. Completado parcialmente el 2026-10-11: con la clave pública anon sólo en memoria, los listados quedaron vacíos y las cargas JPEG fueron denegadas por RLS; una transacción rollback con rol anon no pudo leer ni actualizar una fila ficticia. No se creó objeto. La prueba de DELETE por Storage API y el JWT authenticated real permanecen pendientes de un objeto y usuario sintéticos autorizados. No había navegador para recertificar Dashboard Auth; antes de crear datos sintéticos, comprobar manualmente: Authentication > Providers > Email deshabilitado; Authentication > Configuration > User signups deshabilitado; Users vacío; Project Settings > Auth sin SMTP personalizado/productivo; Integrations sin proveedores o webhooks productivos. Guardar únicamente estados y fecha, nunca claves, tokens ni contraseñas. Evidencia: `C:\SmartRetailRestoreStage\evidence\auth-storage-negative-20261011T062526Z.md`.
6. BETA02C confirmó por código que las políticas restrictivas son intencionales: el navegador no usa Storage directo. Producto opera exclusivamente por API backend con sesión, pertenencia, `products.read/write`, same-origin de mutaciones, rutas derivadas y auditoría; compras aplican sesión, pertenencia, `purchases.read/write`, ubicación, same-origin y ruta derivada. La clave Storage es server-only; el documento es inmutable y no tiene DELETE/reemplazo. No se añadió política PERMISSIVE. La prueba backend aislada requiere Auth recertificado y un runtime explícitamente configurado contra staging; no se redirige producción. Matriz: `C:\SmartRetailRestoreStage\evidence\storage-architecture-20261011T173851Z.md`.
7. BETA02D ejecutó una prueba mínima reversible de Auth: ajustes efectivos con registro/Email/Phone deshabilitados y sin proveedores externos; usuario confirmado ficticio creado y eliminado por Admin API server-side; password login HTTP 422, sin correo ni cambio de Auth. El recuento volvió a cero usuarios/objetos. No se obtuvo JWT ni se ejecutó backend aislado. Para continuar esa matriz se requiere una vía autorizada de Management API/Dashboard que habilite y restaure Email temporalmente, o un mecanismo oficial equivalente de sesión confirmada. Evidencia: `C:\SmartRetailRestoreStage\evidence\auth-synthetic-20261011T174500Z.md`.
8. Generar dump y manifest sintéticos, subirlos al repositorio Restic, y validar `restic snapshots` y `restic check` sin imprimir rutas con datos ni contraseñas.
9. Histórico de preparación: antes de BETA02G estaba prohibido todo restore. El restore local de archivos exclusivamente sintéticos de Restic ya fue autorizado y ejecutado; sigue prohibido restaurar Database, objetos Storage, dumps o datos reales hasta registrar inicio UTC, ref aislado, hashes de origen, objetivo RTO y autorización explícita. Ese restore futuro debe validar tablas, RLS/FORCE RLS, buckets privados, hashes y referencias Database ↔ Storage.

### Controles de preflight y evidencia que se conservará

Antes del drill, un operador debe registrar el resultado de estas lecturas sin volcar secretos:

| Control | Consulta o comprobación de sólo lectura | Resultado esperado / evidencia |
| --- | --- | --- |
| Ref aislado | archivo `supabase/.temp/project-ref` del staging después de `supabase link` | Igual a `lxofwmtfqxfuppzujlbt`; cualquier otro valor aborta. |
| Aislamiento | Dashboard del proyecto aislado: Auth Email y nuevos registros deshabilitados; sin dominios, webhooks, integraciones, buckets, URL, pooler ni variables que apunten a producción. | Lista de nombres/estados, sin valores secretos ni capturas con credenciales. |
| Tablas | `SELECT count(*) FROM information_schema.tables WHERE table_schema='retail' AND table_type='BASE TABLE';` | Conteo anotado y comparado contra el manifest sintético. |
| RLS/FORCE RLS | `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='retail' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;` | Conteo anotado; la excepción estática `role_permissions` se revisa explícitamente. |
| Storage | `SELECT bucket_id,count(*) FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;` y manifest con ruta, tamaño, MIME y SHA-256. | Conteos y hashes exactamente iguales al dataset sintético. |
| Referencias | Consultar `retail.product_images.object_path` y derivar `<tenant>/<purchase>/original` para documentos; comparar ambos conjuntos con el manifest. | Cero referencias faltantes y cero objetos huérfanos en el dataset sintético. |
| Correo | Configuración Auth leída en Dashboard y no crear usuarios ni invocar endpoints de correo. | Email/registro deshabilitados y ningún correo enviado. |
| RTO | Hora UTC antes de iniciar y hora UTC al terminar la comprobación. | Duración registrada, intervención manual y comparación con 8 h propuesta. |

### Inventario local verificable

- `packages/database/migrations/001_inventory.sql` a `027_product_images.sql`: 27 migraciones canónicas disponibles para poblar sólo el entorno aislado.
- `supabase/product-images.sql`: bucket privado `product-images`, límite 1.5 MiB, sólo JPEG y política restrictiva que deniega acceso directo a `anon`/`authenticated`.
- `supabase/purchase-documents.sql`: bucket privado `purchase-documents`, límite 4 MiB, JPEG/PNG/WebP/PDF y la misma denegación directa.
- Las referencias de imagen se materializan en `retail.product_images.object_path`; los documentos siguen la ruta derivable `<tenant>/<purchase>/original`.

### Procedimiento futuro del drill sintético — no ejecutar durante esta preparación

1. Registrar destino, responsable, inicio y confirmación de que no apunta a producción.
2. Crear/restaurar Database desde roles, esquema y datos sintéticos; aplicar sólo el procedimiento compatible con el dump. No usar `db reset --linked` contra producción.
3. Restaurar configuración mínima del destino: Auth sin correo real, Storage privado, variables de prueba y dominio no productivo. Rotar/crear secretos sólo en el gestor del destino.
4. Crear buckets privados y restaurar objetos desde el manifest. Comprobar hash, MIME, tamaño y cantidad sin abrir documentos de clientes innecesariamente.
5. Validar: migraciones, constraints, RLS/FORCE RLS, membresías sintéticas, producto/compra/venta/stock/ledger sintéticos, Storage sintético, hashes, referencias Database ↔ Storage y que SMTP no sale. Auth real queda fuera de esta fase.
6. Ejecutar negativas en el destino: tenant ajeno denegado, objeto privado anónimo denegado y rol runtime sin BYPASSRLS.
7. Medir el tiempo desde inicio hasta integridad validada; comparar contra RTO propuesto. Registrar intervención manual, elementos no recuperados y causa.
8. Revocar sesiones/secretos de prueba y destruir el destino aislado sólo tras conservar la evidencia mínima aprobada. Registrar identificador del repositorio, archivos temporales, objetos restaurados, secretos revocados, periodo de retención del proveedor y confirmación de borrado; para SSD no alegar sobrescritura como garantía. Conservar únicamente manifest, tiempo y resultado durante la retención aprobada. Nunca borrar producción ni sus backups como parte del drill.

## Restore de datos reales, pendiente de aprobación

No iniciar hasta tener una copia cifrada de Database y Storage, destino externo privado aprobado, procedimiento de Auth aprobado y ventana de sólo lectura. El ejercicio debe restaurar en un destino aislado, comparar tablas, RLS, constraints, hashes, ledger/stock y todos los objetos Storage con el manifest; comprobar referencias Database ↔ Storage y acceso anónimo/cross-tenant denegado. No se usarán documentos personales ni servicios productivos en el destino. Este es el único ejercicio que puede acreditar la recuperabilidad de datos reales, RPO/RTO y el cierre del P0.

## Escenarios y respuesta

| Escenario | Primera respuesta | Recuperación requerida |
| --- | --- | --- |
| Borrado accidental | Suspender acciones destructivas, preservar auditoría y seleccionar backup anterior. | Restore aislado, validación y plan de compensación; no editar ledger histórico. |
| Despliegue defectuoso | Usar rollback de Vercel sólo para código. | Verificar compatibilidad de migración antes de revertir app; Vercel no restaura datos. |
| Corrupción de Database | Detener escrituras según incidente y preservar evidencia. | Restaurar Database y validar ledger/RLS/constraints; evaluar pérdida contra RPO. |
| Pérdida de objetos Storage | Comparar manifest y restaurar sólo rutas faltantes al destino validado. | Revalidar hashes y referencias antes de reabrir acceso. |
| Pérdida de acceso a proveedor | Usar cuentas de recuperación y escalamiento designados. | Recuperar organización, secretos y DNS; nunca compartir credenciales por chat. |

## Monitorización propuesta

Sin servicios de pago nuevos hasta aprobación: alerta de backup faltante o más viejo que 24 h, manifest Storage incompleto, restore drill vencido, error de copia, cuota cercana al límite y pérdida de acceso a Supabase/Vercel/Resend. La alerta debe llegar al responsable designado y abrir un registro de incidente sin PII ni secretos.

## Evidencia pendiente para cerrar P0

- [ ] Dashboard confirma `smartretail-restore-drill` en Free, sin tarjeta, plan de pago ni cargo.
- [ ] Credencial administrativa de Database disponible de forma segura, sin exponerla en chat/Git.
- [ ] Backup lógico de Database y manifest cifrados fuera de producción.
- [ ] Copia de todos los objetos Storage y manifest de hashes.
- [ ] Restore integral ejecutado, con tiempo medido y validación de integridad/aislamiento.
- [ ] RPO/RTO, retención y responsables aprobados por el propietario.

Hasta reunir esta evidencia, el dictamen es **P0 OPEN — NO-GO**.

## BETA02G — ensayo Restic sintético (2026-10-11)

El repositorio local externo `C:\SmartRetailBackupDrill\restic-repository` ya existía y no se reinicializó. El operador ejecutó interactivamente `restic check --read-data` sobre el snapshot `937663ac` (repositorio `0af7caba96`): 2/2 packs leídos, sin errores. Restauró el snapshot en `C:\SmartRetailBackupDrill\synthetic-restore`, que reconstruyó el árbol Windows bajo `C\SmartRetailBackupDrill\synthetic-source`; los cuatro archivos ficticios, incluido `SHA256SUMS.txt`, tienen hashes SHA-256 origen/restaurado idénticos. Backup reportado: 6 s; duración de restore no medida por fallo previo de redirección del prompt, no se infiere. Evidencia externa sanitizada: `C:\SmartRetailBackupDrill\evidence-restic-synthetic-20261011.md`. El ensayo acredita cifrado, snapshot, lectura de datos y restore local sintético; no acredita backup/restauración de Database ni Storage reales, custodia externa, retención, RPO/RTO ni cierra P0.

Diagnóstico BETA02G: el endpoint directo aislado `db.lxofwmtfqxfuppzujlbt.supabase.co:5432` resuelve sólo AAAA y no conectó desde esta red; el runtime local anterior usó ese camino en modo development. Producción valida exclusivamente pooler TLS `:6543` con usuario `smartretail_api.<ref>`, pero el host exacto debe copiarse del diálogo Connect de Supabase y no se puede derivar de región. El rol aislado existe, conserva `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, USAGE de `retail` y permisos necesarios; no se modificó. Por tanto, 500/503 no se atribuyen a RLS ni a una causa única: faltan una cadena pooler oficial y credencial runtime administrada para clasificar DNS/TCP/TLS/autenticación/query sin relajar controles. BETA02 continúa PARCIAL / P0 OPEN / NO-GO.

## BETA02H — plan de backup real preparado

El procedimiento ejecutable y sus límites están en [BETA02_REAL_BACKUP_PLAN.md](BETA02_REAL_BACKUP_PLAN.md). No se hizo dump ni lectura de datos productivos. En esta estación faltan `pg_dump`/`psql`/`pg_restore` y Docker Desktop no tiene servidor disponible, por lo que cualquier extracción queda bloqueada hasta instalar/iniciar una vía oficial aprobada. El método seleccionado requiere Session Pooler copiado literalmente desde Dashboard Connect, dump separado de roles/esquema/datos/historial, revisión explícita de Auth/managed schemas, y descarga física independiente de Storage con manifiesto de hashes; no se reutiliza el repositorio sintético. BETA02 permanece P0 OPEN / NO-GO.

## BETA02H — Gates before a production backup

`BETA02_REAL_BACKUP_PLAN.md` is the mandatory preflight for any production capture. It adds mandatory, deterministic `storage-buckets.copy` and `storage-objects.copy` artifacts, each with observed columns, counts and SHA-256; downloaded Storage bytes alone are never sufficient. No password-bearing connection URI may be placed in a command line, shell history, process list, Git, logs or evidence: the approved interactive/secret-manager injection method must first be demonstrated in the isolated project.

A real run also requires a credential proven to list/read only `product-images` and `purchase-documents`, with denied Put/Delete and documented expiry/revocation; otherwise it stops. The external Restic destination must have verified immutable retention/Object Lock, MFA and distinct write, deletion/retention and account-administration credentials. The restore sequence is: verify snapshot; certify fresh destination with egress and integrations disabled; roles/grants; application schema/policies/FORCE RLS; approved data/Auth; Storage metadata (`storage.buckets` then `storage.objects`) and permitted customizations; private objects; migration history; new credentials and verification. Do not execute this section without specific authorization.

## BETA02K — GitHub private synthetic transport drill

A 770-byte fictitious source set was backed up to an independent Restic repository (`fad12c46`, snapshot `f71f0d2e`), whose `check --read-data` passed with 2/2 packs. Only the encrypted Restic repository was packaged as `BETA02K-restic-f71f0d2e.zip` (29,277 bytes, SHA-256 `74CACA57B9883E8420B2B87744CCD54DB806CDD0988C3740FF8257BE54C0AE33`) and committed to the private repository at `0871336`; Git LFS was not enabled. A fresh GitHub clone downloaded the same hash, passed `check --read-data` (8.166 s), restored without the original local repository (2.876 s), and matched all four fictitious-file hashes. The ZIP is a transport container; only Restic encryption is asserted. This proves a small synthetic transport path, not production backup viability: GitHub Apps access remains reported, deletion is not immutable, history grows, quota/budget for real volume is unverified, and no independent second copy exists. Database/Storage production capture and restore remain prohibited without a separate approved procedure. BETA02 remains PARCIAL / P0 OPEN / NO-GO.
