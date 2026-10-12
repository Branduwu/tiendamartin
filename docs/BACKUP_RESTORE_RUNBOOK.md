# SmartRetail â€” runbook de backup y recuperaciÃ³n

Estado: **P0 OPEN â€” no usar como evidencia de recuperaciÃ³n completada.**

Este runbook documenta el estado comprobado el 2026-10-10 y el procedimiento propuesto para conseguir una restauraciÃ³n verificable. No contiene credenciales, URLs de conexiÃ³n, dumps ni documentos de clientes.

## Entorno aislado confirmado para el drill

El usuario confirmÃ³ el 2026-10-10 que `smartretail-restore-drill` existe como proyecto distinto de producciÃ³n en `Branduwu's Org`, con ref `lxofwmtfqxfuppzujlbt`, regiÃ³n `us-east-1`, estado Healthy y plan Free. Registro y proveedor Email estÃ¡n deshabilitados. El entorno no se vincularÃ¡ a dominios, buckets, API keys, poolers, webhooks ni datos de `kffmliytjcbbsfefbupc`.

Supabase CLI 2.120.0, Restic 0.19.1 y Gitleaks 8.30.1 estÃ¡n disponibles en esta sesiÃ³n por instalaciones de usuario fuera del monorepo. Se verificaron sus versiones y el ZIP de Restic/Gitleaks contra los checksums SHA-256 publicados por sus proyectos oficiales. El 2026-10-11 se enlazÃ³ y se aplicaron las 27 migraciones canÃ³nicas exclusivamente al proyecto aislado `lxofwmtfqxfuppzujlbt`, con evidencia sanitizada en `C:\SmartRetailRestoreStage\evidence\apply-20261011T061012Z.md`; no se ejecutÃ³ ningÃºn comando contra producciÃ³n.

## Estado actual comprobado

| Componente | Estado | Evidencia | ImplicaciÃ³n |
| --- | --- | --- | --- |
| Supabase Database | OrganizaciÃ³n Free; proyecto activo; PITR desactivado; API de backups sin backups recuperables listados. | Management API, lectura 2026-10-10. | No existe restore gestionado acreditado. |
| Supabase Storage | Buckets privados `product-images` y `purchase-documents`. | Management API, lectura 2026-10-10. | Database backup no incluye binarios Storage. |
| Objetos Storage | 3 objetos en `purchase-documents`, 0 en `product-images`; los 3 documentos tienen una compra existente asociada por ruta. | Consulta de metadatos y conteos, sin leer contenidos. | La copia de Storage y su manifest son obligatorios. |
| Schema y controles | 29 migraciones aplicadas; 58 tablas `retail`; 57 tienen RLS y FORCE RLS. | Consulta de metadatos, sin datos de negocio. | `role_permissions` es estÃ¡tica y no tiene tenant/RLS; revisar este supuesto al restaurar. |
| Vercel | Plan Hobby; deployment productivo Ready; sin rollback activo. | Vercel CLI, lectura 2026-10-10. | SÃ³lo puede revertir al deployment anterior; no recupera DB, Storage ni variables. |
| Resend / SMTP | ConfiguraciÃ³n histÃ³rica de SMTP/Auth existe, pero su cuenta, cuotas y recuperaciÃ³n no se verificaron en esta tarea. | DocumentaciÃ³n existente. | La continuidad de correo queda NO VERIFICADA. |

Supabase documenta que Free no ofrece backups descargables; recomienda `supabase db dump`/`pg_dump` y una copia fuera del proyecto. PITR requiere un plan de pago y add-on. Las copias de Database no incluyen objetos de Storage. Fuentes: [backups de Supabase](https://supabase.com/docs/guides/platform/backups) y [restore por CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Responsables

| FunciÃ³n | Responsable | DecisiÃ³n o acciÃ³n |
| --- | --- | --- |
| Propietario de continuidad y custodio provisional | **Propietario de SmartRetail, designado por el usuario el 2026-10-10.** | Aprueba RPO/RTO, coste, acceso, destino externo y prueba de restore. |
| Operador de backup | **PENDIENTE DE DESIGNACIÃ“N** | Ejecuta dump/copia Storage, cifra y verifica manifiestos. |
| Revisor de restore | **PENDIENTE DE DESIGNACIÃ“N** | Confirma destino aislado, integridad, tiempo y limpieza. |
| Escalamiento Supabase/Vercel/Resend | **PENDIENTE DE DESIGNACIÃ“N** | Abre incidente con proveedor sin adjuntar secretos o documentos. |

## Inventario y cobertura necesaria

| Datos crÃ­ticos | Copia Database | Copia Storage | ConfiguraciÃ³n/reconstrucciÃ³n |
| --- | --- | --- | --- |
| Empresas, sucursales, membresÃ­as, roles | SÃ­ para `retail`; un dump lÃ³gico estÃ¡ndar no debe asumirse como copia de `auth`. | No aplica. | Auth, Site URL, redirects y SMTP se reconstruyen y prueban por separado. |
| Productos, inventario, ledger, compras, ventas, devoluciones, caja, pagos, soporte | SÃ­: esquema, datos, roles/migraciones y auditorÃ­a. | No aplica salvo originales adjuntos. | Runtime DB restringido y variables se reconstruyen desde el gestor de secretos. |
| ImÃ¡genes de producto | Metadatos/referencias en Database. | SÃ­, cada objeto y manifest de hash/tamaÃ±o/ruta. | Bucket privado, MIME y polÃ­ticas deben verificarse. |
| Documentos de compra | Compra y ruta derivable en Database. | SÃ­, cada original y manifest de hash/tamaÃ±o/ruta. | Bucket privado, lÃ­mite 4 MiB y polÃ­tica de acceso deben verificarse. |
| Auth | No cubierto por el procedimiento Free propuesto hasta que se apruebe un mÃ©todo oficial de migraciÃ³n. | No aplica. | Definir si se re-invitan usuarios, se usa clone de proyecto de pago o se ejecuta otro procedimiento oficial; no prometer restaurar passwords/sesiones. |
| Vercel, DNS y Resend | No aplica. | No aplica. | Restaurar nombres de variables, dominio, redirects, SMTP y DNS desde sus gestores, sin exportar secretos a Git. |

## Objetivos propuestos, no acreditados

| Objetivo | Propuesta para aprobaciÃ³n | Capacidad demostrada | Brecha |
| --- | --- | --- | --- |
| RPO | Hasta 24 horas. | No demostrada. | Free no muestra backup recuperable; requiere backup lÃ³gico externo periÃ³dico. |
| RTO | Hasta 8 horas. | No demostrada. | NingÃºn restore integral aislado se ha ejecutado ni medido. |
| RetenciÃ³n | 7 copias diarias, 4 semanales y 3 mensuales, cifradas fuera de producciÃ³n. | No implementada. | Requiere propietario, destino autorizado y coste aprobado. |
| Prueba | Restore trimestral y tras cambios de esquema/Storage relevantes. | No implementada. | Primer drill debe preceder beta. |

Estos valores son propuestas operativas; no son SLA ni compromiso aprobado. Si el POS requiere menos de 24 h de pÃ©rdida tolerable, el propietario debe aprobar un RPO menor y el costo correspondiente.

## Estrategia propuesta

1. Antes de cada backup, confirmar proyecto, entorno y destino fuera de producciÃ³n; registrar fecha, operador, hash de versiones de migraciÃ³n y sin secretos. Para una copia consistente, abrir una ventana operativa de sÃ³lo lectura: detener nuevas ventas, compras, ajustes, caja y cargas; registrar inicio/fin UTC y responsable. Si no se puede detener escritura, el backup queda marcado como no consistente y no acredita RPO/RTO.
2. Obtener dump lÃ³gico de roles, esquema y datos mediante el mÃ©todo oficial `supabase db dump`/`pg_dump`, usando una credencial administrativa autorizada Ãºnicamente en memoria o en un almacÃ©n de secretos. El runtime `smartretail_api` no debe convertirse en owner ni usar privilegios de backup.
3. Crear un manifest de Database: ID de ejecuciÃ³n, hora de corte UTC, herramienta y versiÃ³n, hashes de roles/esquema/datos, versiÃ³n de migraciones, conteos por tabla crÃ­tica y hashes agregados de ledger/stock sin exportar datos a Git. Firmar o hashear el manifest final.
4. Sin reabrir escritura, listar y copiar los dos buckets privados mediante una credencial de Storage protegida. Copiar cada objeto a un destino de backup cifrado y separado; registrar el mismo ID de ejecuciÃ³n, ruta, tamaÃ±o, hash SHA-256, MIME, fecha y hash del manifest Database. Antes de reabrir, comparar referencias Database â†” Storage: cada `product_images.object_path` debe existir; cada documento debe respetar `<tenant>/<purchase>/original` y corresponder a una compra autorizada. Investigar faltantes u huÃ©rfanos antes de declarar el backup vÃ¡lido.
5. Para el primer drill sintÃ©tico se propone Restic en un repositorio local privado fuera del cÃ³digo, por ejemplo `C:\SmartRetailBackupDrill`; no constituye copia externa ni satisface la retenciÃ³n definitiva. Restic cifra cada archivo antes de escribirlo. La contraseÃ±a se generarÃ¡ y teclearÃ¡ sÃ³lo en el prompt nativo, nunca se pondrÃ¡ en comandos, Git, `.env`, logs ni este runbook. El custodio provisional conserva la contraseÃ±a en un gestor de secretos aprobado; antes del backup real debe designar un suplente, un mÃ©todo de recuperaciÃ³n de la clave y una frecuencia de rotaciÃ³n documentada.
6. Para datos reales, el destino externo permanece pendiente de aprobaciÃ³n expresa. Debe ser un repositorio privado con cifrado de origen Restic, acceso mÃ­nimo por identidad nominativa, auditorÃ­a de acceso y retenciÃ³n aprobada. Nunca guardar dumps, manifests u objetos en Git, el workspace, un bucket productivo ni almacenamiento personal no aprobado.

## Ensayo sintÃ©tico aislado obligatorio

No iniciar este procedimiento sin un destino aislado autorizado, sin clientes, con correo/SMTP saliente deshabilitado y sin dominios productivos. El destino no debe compartir URL, bucket, API key, pooler, DNS ni variables con producciÃ³n. Esta fase usa exclusivamente migraciones y datos sintÃ©ticos; no acredita recuperaciÃ³n de datos reales.

### Secuencia del drill: progreso actual y pasos pendientes

1. En un terminal con las versiones informadas, verificar `supabase --version`, `restic version` y que el ref objetivo sea exactamente `lxofwmtfqxfuppzujlbt`; no enlazar ni ejecutar comandos contra `kffmliytjcbbsfefbupc`.
2. Histórico: el repositorio Restic local ya fue inicializado para el ensayo sintético. No ejecutar nuevamente `restic init` ni sobrescribir `C:\SmartRetailBackupDrill\restic-repository`. Para un repositorio nuevo autorizado, Restic debe pedir la contraseña interactivamente; no usar `RESTIC_PASSWORD`, archivos de contraseña, historial de shell ni argumentos con secretos. El repositorio local sólo sirve al ensayo sintético. Todo dump, manifest y archivo temporal se crea fuera del workspace, bajo `C:\SmartRetailBackupDrill` o `C:\SmartRetailRestoreStage`; antes y después se revisa `git status --short`.
3. Completado el 2026-10-11: se prepararon las migraciones canÃ³nicas con `node scripts/prepare-supabase.mjs C:\SmartRetailRestoreStage`, se verificaron hashes, se confirmÃ³ el ref local y se ejecutaron `db push --dry-run --linked` y posteriormente `db push --linked` con autorizaciÃ³n expresa. Las 27 migraciones 001â€“027 quedaron aplicadas sÃ³lo al aislado. La contraseÃ±a administrativa no fue solicitada ni almacenada. Permanecen prohibidos `--db-password`, variables de entorno, archivos de contraseÃ±a, `--debug`, redirecciones de salida y sesiones grabadas.
4. Completado el 2026-10-11: se inicializaron, con autorizaciÃ³n separada, los buckets sintÃ©ticos privados desde `supabase/product-images.sql` y `supabase/purchase-documents.sql`, fuera de las 27 migraciones. Ambos permanecen vacÃ­os; las polÃ­ticas RESTRICTIVE impiden operaciones directas de `anon` y `authenticated` en cada bucket protegido. Evidencia sanitizada: `C:\SmartRetailRestoreStage\evidence\storage-20261011T061516Z.md`. No importar dumps ni objetos de producciÃ³n.
5. Completado parcialmente el 2026-10-11: con la clave pÃºblica anon sÃ³lo en memoria, los listados quedaron vacÃ­os y las cargas JPEG fueron denegadas por RLS; una transacciÃ³n rollback con rol anon no pudo leer ni actualizar una fila ficticia. No se creÃ³ objeto. La prueba de DELETE por Storage API y el JWT authenticated real permanecen pendientes de un objeto y usuario sintÃ©ticos autorizados. No habÃ­a navegador para recertificar Dashboard Auth; antes de crear datos sintÃ©ticos, comprobar manualmente: Authentication > Providers > Email deshabilitado; Authentication > Configuration > User signups deshabilitado; Users vacÃ­o; Project Settings > Auth sin SMTP personalizado/productivo; Integrations sin proveedores o webhooks productivos. Guardar Ãºnicamente estados y fecha, nunca claves, tokens ni contraseÃ±as. Evidencia: `C:\SmartRetailRestoreStage\evidence\auth-storage-negative-20261011T062526Z.md`.
6. BETA02C confirmÃ³ por cÃ³digo que las polÃ­ticas restrictivas son intencionales: el navegador no usa Storage directo. Producto opera exclusivamente por API backend con sesiÃ³n, pertenencia, `products.read/write`, same-origin de mutaciones, rutas derivadas y auditorÃ­a; compras aplican sesiÃ³n, pertenencia, `purchases.read/write`, ubicaciÃ³n, same-origin y ruta derivada. La clave Storage es server-only; el documento es inmutable y no tiene DELETE/reemplazo. No se aÃ±adiÃ³ polÃ­tica PERMISSIVE. La prueba backend aislada requiere Auth recertificado y un runtime explÃ­citamente configurado contra staging; no se redirige producciÃ³n. Matriz: `C:\SmartRetailRestoreStage\evidence\storage-architecture-20261011T173851Z.md`.
7. BETA02D ejecutÃ³ una prueba mÃ­nima reversible de Auth: ajustes efectivos con registro/Email/Phone deshabilitados y sin proveedores externos; usuario confirmado ficticio creado y eliminado por Admin API server-side; password login HTTP 422, sin correo ni cambio de Auth. El recuento volviÃ³ a cero usuarios/objetos. No se obtuvo JWT ni se ejecutÃ³ backend aislado. Para continuar esa matriz se requiere una vÃ­a autorizada de Management API/Dashboard que habilite y restaure Email temporalmente, o un mecanismo oficial equivalente de sesiÃ³n confirmada. Evidencia: `C:\SmartRetailRestoreStage\evidence\auth-synthetic-20261011T174500Z.md`.
8. Generar dump y manifest sintÃ©ticos, subirlos al repositorio Restic, y validar `restic snapshots` y `restic check` sin imprimir rutas con datos ni contraseÃ±as.
9. Histórico de preparación: antes de BETA02G estaba prohibido todo restore. El restore local de archivos exclusivamente sintéticos de Restic ya fue autorizado y ejecutado; sigue prohibido restaurar Database, objetos Storage, dumps o datos reales hasta registrar inicio UTC, ref aislado, hashes de origen, objetivo RTO y autorización explícita. Ese restore futuro debe validar tablas, RLS/FORCE RLS, buckets privados, hashes y referencias Database ↔ Storage.

### Controles de preflight y evidencia que se conservarÃ¡

Antes del drill, un operador debe registrar el resultado de estas lecturas sin volcar secretos:

| Control | Consulta o comprobaciÃ³n de sÃ³lo lectura | Resultado esperado / evidencia |
| --- | --- | --- |
| Ref aislado | archivo `supabase/.temp/project-ref` del staging despuÃ©s de `supabase link` | Igual a `lxofwmtfqxfuppzujlbt`; cualquier otro valor aborta. |
| Aislamiento | Dashboard del proyecto aislado: Auth Email y nuevos registros deshabilitados; sin dominios, webhooks, integraciones, buckets, URL, pooler ni variables que apunten a producciÃ³n. | Lista de nombres/estados, sin valores secretos ni capturas con credenciales. |
| Tablas | `SELECT count(*) FROM information_schema.tables WHERE table_schema='retail' AND table_type='BASE TABLE';` | Conteo anotado y comparado contra el manifest sintÃ©tico. |
| RLS/FORCE RLS | `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='retail' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;` | Conteo anotado; la excepciÃ³n estÃ¡tica `role_permissions` se revisa explÃ­citamente. |
| Storage | `SELECT bucket_id,count(*) FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;` y manifest con ruta, tamaÃ±o, MIME y SHA-256. | Conteos y hashes exactamente iguales al dataset sintÃ©tico. |
| Referencias | Consultar `retail.product_images.object_path` y derivar `<tenant>/<purchase>/original` para documentos; comparar ambos conjuntos con el manifest. | Cero referencias faltantes y cero objetos huÃ©rfanos en el dataset sintÃ©tico. |
| Correo | ConfiguraciÃ³n Auth leÃ­da en Dashboard y no crear usuarios ni invocar endpoints de correo. | Email/registro deshabilitados y ningÃºn correo enviado. |
| RTO | Hora UTC antes de iniciar y hora UTC al terminar la comprobaciÃ³n. | DuraciÃ³n registrada, intervenciÃ³n manual y comparaciÃ³n con 8 h propuesta. |

### Inventario local verificable

- `packages/database/migrations/001_inventory.sql` a `027_product_images.sql`: 27 migraciones canÃ³nicas disponibles para poblar sÃ³lo el entorno aislado.
- `supabase/product-images.sql`: bucket privado `product-images`, lÃ­mite 1.5 MiB, sÃ³lo JPEG y polÃ­tica restrictiva que deniega acceso directo a `anon`/`authenticated`.
- `supabase/purchase-documents.sql`: bucket privado `purchase-documents`, lÃ­mite 4 MiB, JPEG/PNG/WebP/PDF y la misma denegaciÃ³n directa.
- Las referencias de imagen se materializan en `retail.product_images.object_path`; los documentos siguen la ruta derivable `<tenant>/<purchase>/original`.

### Procedimiento futuro del drill sintÃ©tico â€” no ejecutar durante esta preparaciÃ³n

1. Registrar destino, responsable, inicio y confirmaciÃ³n de que no apunta a producciÃ³n.
2. Crear/restaurar Database desde roles, esquema y datos sintÃ©ticos; aplicar sÃ³lo el procedimiento compatible con el dump. No usar `db reset --linked` contra producciÃ³n.
3. Restaurar configuraciÃ³n mÃ­nima del destino: Auth sin correo real, Storage privado, variables de prueba y dominio no productivo. Rotar/crear secretos sÃ³lo en el gestor del destino.
4. Crear buckets privados y restaurar objetos desde el manifest. Comprobar hash, MIME, tamaÃ±o y cantidad sin abrir documentos de clientes innecesariamente.
5. Validar: migraciones, constraints, RLS/FORCE RLS, membresÃ­as sintÃ©ticas, producto/compra/venta/stock/ledger sintÃ©ticos, Storage sintÃ©tico, hashes, referencias Database â†” Storage y que SMTP no sale. Auth real queda fuera de esta fase.
6. Ejecutar negativas en el destino: tenant ajeno denegado, objeto privado anÃ³nimo denegado y rol runtime sin BYPASSRLS.
7. Medir el tiempo desde inicio hasta integridad validada; comparar contra RTO propuesto. Registrar intervenciÃ³n manual, elementos no recuperados y causa.
8. Revocar sesiones/secretos de prueba y destruir el destino aislado sÃ³lo tras conservar la evidencia mÃ­nima aprobada. Registrar identificador del repositorio, archivos temporales, objetos restaurados, secretos revocados, periodo de retenciÃ³n del proveedor y confirmaciÃ³n de borrado; para SSD no alegar sobrescritura como garantÃ­a. Conservar Ãºnicamente manifest, tiempo y resultado durante la retenciÃ³n aprobada. Nunca borrar producciÃ³n ni sus backups como parte del drill.

## Restore de datos reales, pendiente de aprobaciÃ³n

No iniciar hasta tener una copia cifrada de Database y Storage, destino externo privado aprobado, procedimiento de Auth aprobado y ventana de sÃ³lo lectura. El ejercicio debe restaurar en un destino aislado, comparar tablas, RLS, constraints, hashes, ledger/stock y todos los objetos Storage con el manifest; comprobar referencias Database â†” Storage y acceso anÃ³nimo/cross-tenant denegado. No se usarÃ¡n documentos personales ni servicios productivos en el destino. Este es el Ãºnico ejercicio que puede acreditar la recuperabilidad de datos reales, RPO/RTO y el cierre del P0.

## Escenarios y respuesta

| Escenario | Primera respuesta | RecuperaciÃ³n requerida |
| --- | --- | --- |
| Borrado accidental | Suspender acciones destructivas, preservar auditorÃ­a y seleccionar backup anterior. | Restore aislado, validaciÃ³n y plan de compensaciÃ³n; no editar ledger histÃ³rico. |
| Despliegue defectuoso | Usar rollback de Vercel sÃ³lo para cÃ³digo. | Verificar compatibilidad de migraciÃ³n antes de revertir app; Vercel no restaura datos. |
| CorrupciÃ³n de Database | Detener escrituras segÃºn incidente y preservar evidencia. | Restaurar Database y validar ledger/RLS/constraints; evaluar pÃ©rdida contra RPO. |
| PÃ©rdida de objetos Storage | Comparar manifest y restaurar sÃ³lo rutas faltantes al destino validado. | Revalidar hashes y referencias antes de reabrir acceso. |
| PÃ©rdida de acceso a proveedor | Usar cuentas de recuperaciÃ³n y escalamiento designados. | Recuperar organizaciÃ³n, secretos y DNS; nunca compartir credenciales por chat. |

## MonitorizaciÃ³n propuesta

Sin servicios de pago nuevos hasta aprobaciÃ³n: alerta de backup faltante o mÃ¡s viejo que 24 h, manifest Storage incompleto, restore drill vencido, error de copia, cuota cercana al lÃ­mite y pÃ©rdida de acceso a Supabase/Vercel/Resend. La alerta debe llegar al responsable designado y abrir un registro de incidente sin PII ni secretos.

## Evidencia pendiente para cerrar P0

- [ ] Dashboard confirma `smartretail-restore-drill` en Free, sin tarjeta, plan de pago ni cargo.
- [ ] Credencial administrativa de Database disponible de forma segura, sin exponerla en chat/Git.
- [ ] Backup lÃ³gico de Database y manifest cifrados fuera de producciÃ³n.
- [ ] Copia de todos los objetos Storage y manifest de hashes.
- [ ] Restore integral ejecutado, con tiempo medido y validaciÃ³n de integridad/aislamiento.
- [ ] RPO/RTO, retenciÃ³n y responsables aprobados por el propietario.

Hasta reunir esta evidencia, el dictamen es **P0 OPEN â€” NO-GO**.

## BETA02G â€” ensayo Restic sintÃ©tico (2026-10-11)

El repositorio local externo `C:\SmartRetailBackupDrill\restic-repository` ya existÃ­a y no se reinicializÃ³. El operador ejecutÃ³ interactivamente `restic check --read-data` sobre el snapshot `937663ac` (repositorio `0af7caba96`): 2/2 packs leÃ­dos, sin errores. RestaurÃ³ el snapshot en `C:\SmartRetailBackupDrill\synthetic-restore`, que reconstruyÃ³ el Ã¡rbol Windows bajo `C\SmartRetailBackupDrill\synthetic-source`; los cuatro archivos ficticios, incluido `SHA256SUMS.txt`, tienen hashes SHA-256 origen/restaurado idÃ©nticos. Backup reportado: 6 s; duraciÃ³n de restore no medida por fallo previo de redirecciÃ³n del prompt, no se infiere. Evidencia externa sanitizada: `C:\SmartRetailBackupDrill\evidence-restic-synthetic-20261011.md`. El ensayo acredita cifrado, snapshot, lectura de datos y restore local sintÃ©tico; no acredita backup/restauraciÃ³n de Database ni Storage reales, custodia externa, retenciÃ³n, RPO/RTO ni cierra P0.

DiagnÃ³stico BETA02G: el endpoint directo aislado `db.lxofwmtfqxfuppzujlbt.supabase.co:5432` resuelve sÃ³lo AAAA y no conectÃ³ desde esta red; el runtime local anterior usÃ³ ese camino en modo development. ProducciÃ³n valida exclusivamente pooler TLS `:6543` con usuario `smartretail_api.<ref>`, pero el host exacto debe copiarse del diÃ¡logo Connect de Supabase y no se puede derivar de regiÃ³n. El rol aislado existe, conserva `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, USAGE de `retail` y permisos necesarios; no se modificÃ³. Por tanto, 500/503 no se atribuyen a RLS ni a una causa Ãºnica: faltan una cadena pooler oficial y credencial runtime administrada para clasificar DNS/TCP/TLS/autenticaciÃ³n/query sin relajar controles. BETA02 continÃºa PARCIAL / P0 OPEN / NO-GO.

## BETA02H — plan de backup real preparado

El procedimiento ejecutable y sus límites están en [BETA02_REAL_BACKUP_PLAN.md](BETA02_REAL_BACKUP_PLAN.md). No se hizo dump ni lectura de datos productivos. En esta estación faltan `pg_dump`/`psql`/`pg_restore` y Docker Desktop no tiene servidor disponible, por lo que cualquier extracción queda bloqueada hasta instalar/iniciar una vía oficial aprobada. El método seleccionado requiere Session Pooler copiado literalmente desde Dashboard Connect, dump separado de roles/esquema/datos/historial, revisión explícita de Auth/managed schemas, y descarga física independiente de Storage con manifiesto de hashes; no se reutiliza el repositorio sintético. BETA02 permanece P0 OPEN / NO-GO.

## BETA02H — Gates before a production backup

`BETA02_REAL_BACKUP_PLAN.md` is the mandatory preflight for any production capture. It adds mandatory, deterministic `storage-buckets.copy` and `storage-objects.copy` artifacts, each with observed columns, counts and SHA-256; downloaded Storage bytes alone are never sufficient. No password-bearing connection URI may be placed in a command line, shell history, process list, Git, logs or evidence: the approved interactive/secret-manager injection method must first be demonstrated in the isolated project.

A real run also requires a credential proven to list/read only `product-images` and `purchase-documents`, with denied Put/Delete and documented expiry/revocation; otherwise it stops. The external Restic destination must have verified immutable retention/Object Lock, MFA and distinct write, deletion/retention and account-administration credentials. The restore sequence is: verify snapshot; certify fresh destination with egress and integrations disabled; roles/grants; application schema/policies/FORCE RLS; approved data/Auth; Storage metadata (`storage.buckets` then `storage.objects`) and permitted customizations; private objects; migration history; new credentials and verification. Do not execute this section without specific authorization.

## BETA02K — GitHub private synthetic transport drill

A 770-byte fictitious source set was backed up to an independent Restic repository (`fad12c46`, snapshot `f71f0d2e`), whose `check --read-data` passed with 2/2 packs. Only the encrypted Restic repository was packaged as `BETA02K-restic-f71f0d2e.zip` (29,277 bytes, SHA-256 `74CACA57B9883E8420B2B87744CCD54DB806CDD0988C3740FF8257BE54C0AE33`) and committed to the private repository at `0871336`; Git LFS was not enabled. A fresh GitHub clone downloaded the same hash, passed `check --read-data` (8.166 s), restored without the original local repository (2.876 s), and matched all four fictitious-file hashes. The ZIP is a transport container; only Restic encryption is asserted. This proves a small synthetic transport path, not production backup viability: GitHub Apps access remains reported, deletion is not immutable, history grows, quota/budget for real volume is unverified, and no independent second copy exists. Database/Storage production capture and restore remain prohibited without a separate approved procedure. BETA02 remains PARCIAL / P0 OPEN / NO-GO.
