# Primer despliegue: Supabase y Vercel

Estado TASK-014B: producción verificada en https://smartretail-sepia.vercel.app. Supabase SmartRetail (`kffmliytjcbbsfefbupc`, us-east-1) pertenece a una organización Free; Vercel `smartretail` pertenece al equipo `branduwus-projects`, plan Hobby. Migraciones001–005 aplicadas tras dry-run y comprobación de hashes. No recrear recursos ni repetir el bootstrap de smoke para utilizar este despliegue.

## Sesiones y recursos gratuitos

Autenticar las CLI desde una terminal propia con `supabase login` y `vercel login`. No poner tokens en argumentos, Git, chat o documentación. Comprobar la identidad, organización y plan antes de crear/utilizar un proyecto **dedicado** a SmartRetail; detener cualquier paso que requiera tarjeta, pago o add-ons. El proyecto Vercel debe ser Hobby/gratuito y el Supabase Free; no reutilizar bases ajenas. Las CLI de esta ejecución están en `%TEMP%/smartretail-task014/tools` (Supabase2.119.0, Vercel62.1.0), fuera de las dependencias del workspace.

## Migraciones

La fuente canónica es `packages/database/migrations/001–005`. Para el formato de Supabase CLI, preparar copias verificadas por SHA256 en un directorio externo:

```powershell
node scripts/prepare-supabase.mjs "$env:TEMP/smartretail-task014/supabase-final"
```

El staging produce versiones `20261001001000` a `20261001005000`, sin alterar el SQL. No editar las copias ni mezclar otro historial. Usando `--workdir` con ese directorio: `supabase projects list`, `supabase link --project-ref <REF_VERIFICADO>`, confirmar la referencia vinculada y la base dedicada; después `supabase db push --dry-run`, revisar las cinco migraciones y sólo entonces `supabase db push`. No usar el Transaction Pooler para migrar; obtener la conexión administrativa directa o Session Pooler del diálogo Connect si la red es IPv4. No pasar passwords en argumentos ni usar `--debug` con credenciales.

El administrador debe poder crear los roles y `SET ROLE smartretail_owner`. La migración005 crea `smartretail_api` como NOLOGIN, miembro de `smartretail_app`, sin SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB. Después del push, generar una contraseña fuerte y habilitar LOGIN mediante sesión administrativa segura; la contraseña queda sólo en el gestor de variables de Vercel. No concederle owner, bootstrap, escrituras de membresías ni privilegios extra. Verificar todas las tablas/constraints, nueve tablas empresariales con ENABLE/FORCE RLS, matriz de permisos, ledger y flags/membresías de roles después del push. Los IDs históricos del ledger conservan su tipo original.

## Runtime y Auth

Copiar el **hostname real** del Transaction Pooler desde Connect; puerto6543 y usuario `smartretail_api.<project-ref>`. Comprobar una conexión con el custom role y TLS validado antes del deploy. `apps/web/lib/database-config.ts` exige ese formato en producción, pool compartido/max1 y certificado válido; no acepta `sslmode=disable`, `no-verify`, archivos SSL ni opciones de sesión inyectadas por URL. `sslmode=verify-full`/`require` se retira del URL para que no sustituya el objeto TLS verificado de `pg`. Si falta confianza en el certificado, investigar el CA oficial; nunca desactivar su validación. Local sin SSL sólo en loopback y fuera de producción.

El pooler real requirió la CA pública oficial de Supabase. `apps/web/lib/supabase-root-certificate.ts` incorpora exclusivamente esa CA, obtenida de la URL que usa [Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json), con fingerprint SHA256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`. Se aplica sólo a hosts `.pooler.supabase.com`, manteniendo validación de cadena y hostname. Expira el 26 de abril de 2031; revisar su rotación desde la fuente oficial antes de esa fecha. No es una credencial.

No hay prepared statements nombrados. `app.user_id`, `app.tenant_id` y `statement_timeout` se fijan dentro de cada transacción y se restauran al terminar. Cada operación comprueba el rol DB, identidad verificada y permisos actuales. Auth conserva `getClaims()`.

Sólo tres variables de producción: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `DATABASE_URL`. Las dos primeras son públicas; la tercera es secreta/server-side. No agregar claves administrativas a Vercel ni al bundle. La configuración Supabase del staging desactiva signup local; **no demuestra** que Auth cloud tenga signup desactivado: comprobar/configurar el servicio real explícitamente.

## Vercel

Vincular desde la raíz del monorepo con la CLI autenticada. Crear un proyecto dedicado, Root Directory `apps/web`, incluir archivos fuera de Root Directory y Node24.x. `apps/web/vercel.json` fija pnpm11.27.1 mediante `npx`, frozen install desde la raíz y build `@smartretail/web`; la versión exacta debe comprobarse en los logs remotos, pues la autodetección documentada puede seleccionar otra. No hace falta GitHub, push, commits ni Turborepo.

Configurar las tres variables anteriores para Production antes de ejecutar `vercel deploy --prod` desde la raíz vinculada. Con el dominio HTTPS real, establecer Site URL de Supabase Auth y redirects exactos necesarios (sin wildcards amplios), desactivar signup público no requerido y redeploy si cambian variables. No activar servicios de IA ni integraciones automáticas de pago. El primer build remoto encontró un script sin decisión explícita: `pnpm-workspace.yaml` bloquea específicamente `unrs-resolver@1.12.2` mediante `allowBuilds: false`; no permite scripts nuevos ni desactiva el control estricto. El siguiente frozen install con pnpm11.27.1 y build Next completaron correctamente.

## Bootstrap, smoke y limpieza

Si no hay credenciales de propietario proporcionadas de forma segura, crear un usuario Auth temporal con email `SMOKE-*`, contraseña aleatoria y tenant UUID de smoke. Bootstrap sólo por administrador: tenant y membership owner con el UUID real del usuario; el runtime no puede autoconcederse permisos. No crear propietario permanente inventado. No guardar secretos en scripts, grabaciones de navegador ni reportes.

En la URL pública: health200/login; APIs privadas sin sesión401; login Auth real/cookies; tenant/productos/inventario; producto SMOKE-* creado/listado/editado; ubicaciones SMOKE-*; receive/issue/count/transfer y balances confirmados por servidor. Verificar tenant ajeno403, identidad/role forjados sin efecto, respuestas sin SQL, RLS/custom role y que DATABASE_URL no aparece en assets del navegador. Una validación local con fixture no sustituye estas comprobaciones.

Eliminar el usuario temporal mediante Auth administrativo al terminar cuando sea seguro; revocar su membership. No borrar ledger ni modificar saldos históricos ni desactivar protecciones para limpiar. Mantener identificados los datos SMOKE-* si la arquitectura no permite borrado seguro; registrar tenant, producto, ubicaciones y movimientos que queden, sin credenciales. QA/SECURITY deben distinguir checks locales y smoke cloud ejecutado.

Fuentes oficiales: [conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [migraciones CLI](https://supabase.com/docs/guides/local-development/database-migrations), [SSL de pg](https://node-postgres.com/features/ssl), [monorepos Vercel](https://vercel.com/docs/monorepos), [versiones de gestores](https://vercel.com/docs/package-managers).

## Estado operacional comprobado — 2026-10-01

Runtime real: `smartretail_api` con LOGIN, sin SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE ni membresía del owner. Conexión TLS validada al hostname obtenido de Management API, Transaction Pooler6543; adapter actual probado contra cloud. SSL enforcement cloud activado y aplicado; startup sin TLS rechazado por el servidor sin enviar contraseña, y reconexión con CA verificada aprobada. Nueve tablas empresariales tienen ENABLE/FORCE RLS, con62 constraints y26 permisos. El bootstrap administrativo concedió permisos de inserción sólo al administrador dentro de una transacción y los revocó antes del COMMIT; el runtime nunca recibió escrituras de membresías.

Site URL: https://smartretail-sepia.vercel.app; redirects exactos `/login`, `/products` y `/inventory`, sin wildcards. Signup público desactivado. Auth real/getClaims y login/cookies en Chromium pasaron. Smoke remoto: health200/login200/cuatro APIs privadas401; producto creado/listado/editado; dos ubicaciones; receive10, issue2, count7 y transfer3, saldos servidor/UI4 y3. Tenant ajeno403, identidad/role forjados rechazados, conflicto SQL409 sanitizado;11 assets JS y3 documentos HTML sin URL/password reales de DB. RLS directo del runtime permitió al miembro ver su producto y rechazó identidad ajena y escritura en tenant sin membresía.

Limpieza: usuario Auth temporal eliminado y verificado; membership permanece inactive y la sesión anterior recibe403. Tenant ajeno vacío eliminado. Para conservar integridad quedan fixtures de smoke identificados internamente, con balances y ledger conservados. No se borraron movimientos ni se alteraron saldos para limpiar. Al cerrar TASK-014B todavía no existía propietario permanente; su aprovisionamiento posterior se registra a continuación.

## Propietario permanente — TASK-014C — 2026-10-02

Tenant principal SmartRetail: `[TENANT_PRINCIPAL_UUID]`. El usuario Auth permanente `[AUTH_OWNER_UUID]`, identificado como único usuario confirmado, tiene exactamente una membership owner/active en ese tenant. Se creó un tenant vacío para mantener separados producto/saldos/ledger SMOKE. La tabla tenants sólo contiene UUID; SmartRetail es su designación operacional, sin columna de nombre ni cambios de esquema/UI.

Bootstrap administrativo transaccional con grants INSERT temporales a postgres revocados antes del COMMIT. Matriz de26 permisos y runtime restringido intactos. Verificación con adapter normal: diez permisos owner, escritura de productos/lectura de inventario permitidas sólo en el principal y tenant SMOKE denegado. Smoke en la URL de producción: sesión real Supabase/getClaims, tenant visible, /products y /inventory, producto creado/listado e inventario200. Tenant SMOKE y UUID arbitrario403. Sólo el producto de prueba sin referencias fue eliminado; principal queda sin productos/saldos, históricos conservados y grant DELETE administrativo revocado.

La autenticación del smoke usó un enlace de un solo uso generado administrativamente y verificado por el cliente público Supabase; no se enviaron correos ni se solicitaron/mostraron credenciales, y no se cambió contraseña. Se revocó únicamente esa sesión de prueba. El formulario con la contraseña del usuario no fue probado; se solicitó al usuario una comprobación manual sin compartirla. QA Galileo y SECURITY Avicenna revisaron de forma independiente sin hallazgos bloqueantes, distinguiendo ejecución propia de evidencia aportada. No hay cambios de código, dependencias ni redeploy por TASK-014C.
