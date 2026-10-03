# Decisiones técnicas — TASK-002

Fecha de consulta y evaluación: **2026-09-22**. Fuente principal de propuestas tecnológicas de SmartRetail. Estado: **propuesta para aprobación**, no infraestructura implementada ni aprobación de negocio. Los controles de seguridad de AGENTS.md son obligatorios; la selección de herramientas sigue siendo propuesta.

Actualización TASK-003A: raíz con Git y pnpm workspaces, gestor seleccionado **11.27.1** tras comparación local. El resto de la arquitectura y versiones de aplicaciones conserva su estado propuesto. §7 conserva la evidencia histórica de TASK-003; §8 y PROJECT_STATE describen la decisión y configuración vigentes.

Actualización TASK-004: `apps/web` implementada y validada localmente. Las versiones web efectivas y las desviaciones de la matriz histórica se registran en §9; móvil, persistencia e infraestructura siguen pendientes.

## 1. Evidencia y política de versiones

Se leyeron los cinco documentos y se confirmó el inventario esperado, sin cambios ajenos detectados respecto al cierre documentado de TASK-001. No hay Git, aplicaciones ni dependencias del proyecto. Consultas locales: Node **24.13.1**, npm **11.8.0** mediante `npm.cmd`, Git **2.51.0.windows.1**; pnpm no encontrado en PATH. `npm --version` fue bloqueado por la política de scripts de PowerShell; no se modificó esa política.

**Verificada documentalmente (VD)** significa que una fuente oficial respalda la línea o requisito indicado, no que se instaló, compiló o probó el conjunto. **Pendiente (P)** identifica lo no demostrado. `x` representa una línea recomendada, no una versión exacta instalable. Antes de instalar en una tarea autorizada, resolver y registrar versiones exactas, engines, peer dependencies, avisos de seguridad y lockfile; no utilizar `latest` sin revisión. No considerar la versión local de Node como el parche de seguridad vigente.

| Tecnología | Versión recomendada | Compatibilidad y motivo | Riesgo y estado | Fuente oficial consultada el 2026-09-22 |
| --- | --- | --- | --- | --- |
| Node.js | 24.x LTS; parche exacto P | Línea LTS común para herramientas y API; 24.13.1 comprobada localmente. | VD: línea LTS y disponibilidad en Vercel; P: parche vigente y builds. Vercel administra parches del runtime. | [Node](https://nodejs.org/en/about/previous-releases), [Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) |
| TypeScript | 5.9.x; parche P | Base conservadora, superior a mínimos Next 5.1 y Zod 5.5; activar strict. | VD: línea publicada y mínimos; P: comprobar tipos/peers del SDK Expo y ESLint elegidos. No asumir compatibilidad integral. | [TS 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html), fuentes Next/Zod abajo |
| pnpm | **11.27.1**, seleccionada y fijada en TASK-003A | Node 24.13.1 satisface engines >=22.13; workspace y lockfile de un documento comprobados en Windows x64. | Verificado: comparación, grafo desechable y frozen/offline. P: Metro y aplicaciones futuras. | [Release 11.27.1](https://github.com/pnpm/pnpm/releases/tag/v11.27.1), [registro](https://registry.npmjs.org/pnpm/11.27.1); decisión §8 |
| Next.js | 16.3.6 como candidato documental | App Router y Route Handlers en runtime Node; documentación muestra esta versión y mínimo Node 20.9 / TS 5.1. | VD: referencia publicada; P: avisos, peers exactos y compilación. No equivale a declarar el parche libre de vulnerabilidades. | [Instalación](https://nextjs.org/docs/app/getting-started/installation) |
| React / react-dom | Web 19.2.x, ambos con mismo parche por resolver; móvil 19.2.3 según Expo | Compartir contratos sin React; cada aplicación resuelve su runtime. App Router integra su propio React para servidor. | VD: familia React 19 en Next y combinación móvil de Expo; P: peers web/parche seguro. No forzar overrides globales para igualar web y móvil. | [Next](https://nextjs.org/docs/app/getting-started/installation), [matriz Expo](https://docs.expo.dev/versions/latest/) |
| Expo | SDK 57; parche del paquete expo P | Matriz oficial vincula 57.0.0 con RN 0.86 y React 19.2.3; mínimo Node 22.13.x. | VD: matriz; P: build local/EAS y módulos concretos. Revisar dispositivos soportados antes del MVP. | [SDK](https://docs.expo.dev/versions/latest/) |
| React Native | 0.86.x; parche determinado por Expo 57, P | No seleccionar RN independientemente de Expo. | VD: combinación de líneas; P: parche y bibliotecas nativas. Evitar versiones duplicadas dentro de la app. | [SDK](https://docs.expo.dev/versions/latest/), [monorepos](https://docs.expo.dev/guides/monorepos/) |
| PostgreSQL | 17.x; 17.11 es referencia upstream consultada | Soporte upstream y presencia de PG17 documentada por Supabase; transacciones y RLS. | VD: familia y referencia; P: build exacta ofrecida por el futuro proyecto Supabase y paridad local/CI. No asumir que su versión se elige libremente. | [Versiones](https://www.postgresql.org/support/versioning/), [Supabase upgrades](https://supabase.com/docs/guides/platform/upgrading) |
| Supabase | Servicio gestionado sin versión monolítica fijable; supabase-js 2.x, parche P | Auth/Storage y PostgreSQL; SDK para identidad, no CRUD comercial desde frontend. | VD: SDK v2; P: CLI, SDK SSR si se requiere, versión de servicios y compatibilidad exacta. No instalar CLI hasta necesitar entorno local. | [SDK](https://supabase.com/docs/reference/javascript/installing), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser) |
| Zod | 4.6.x; parche P | Contratos y validación en ejecución; documentación requiere TS >=5.5 y strict. | VD: línea/requisitos; P: interoperabilidad real con Metro y contratos. Validación no sustituye autorización. | [Zod](https://zod.dev/) |
| Vitest | 5.x; parche y Vite exactos P | Unitarias e integración Node sin arrancar navegador; guía actual requiere Node >=22.12 y Vite >=6.4. | VD: guía de v5/requisitos; P: resolución exacta. No usarlo como prueba de UI nativa o RSC asíncronos. | [Guía](https://vitest.dev/guide/) |
| Playwright | 1.63.x; parche P | E2E web separado de React; Node 24 está entre las líneas soportadas. | VD: notas 1.63 y requisitos; P: SO local compatible y binarios. Navegadores y runner deben corresponder; no automatiza apps nativas. | [Versiones](https://playwright.dev/docs/release-notes), [requisitos](https://playwright.dev/docs/intro) |

No hay prueba de compatibilidad global: la documentación proporciona una base comprobable y deja explícitos los puntos de resolución. Para TASK-003, comprobar primero manifiestos oficiales exactos y soporte vigente de cada candidato, sobre todo TypeScript/pnpm/Vitest; si un parche o peer obliga a cambiar la línea, actualizar esta decisión antes de instalar. No resolver conflictos con `--force` ni ignorar peers. El SDK Expo gobierna las versiones nativas; usar después sus comprobaciones de compatibilidad y un build real. Fuentes dinámicas pueden cambiar después de esta consulta.

## 2. Monorepositorio y dependencias

Proponer **pnpm workspaces sin Turborepo inicialmente**. Workspaces resuelve paquetes locales, instalación y ejecución filtrada; Turborepo añadiría grafo de tareas y caché de resultados, pero también configuración e invalidación que aún no se justifican. Incorporarlo solo al medir repetición de builds/tiempos de CI. No confundirlo con Turbopack, bundler de Next. Un solo lockfile; paquetes internos con protocolo `workspace:`. Empezar con resolución aislada y dependencias explícitas, sin hoisting global salvo problema reproducible revisado. Expo documenta soporte de instalaciones aisladas desde SDK54 y riesgos de módulos duplicados en su [guía de monorepos](https://docs.expo.dev/guides/monorepos/).

La estructura de [ARCHITECTURE](ARCHITECTURE.md) define ubicaciones. Flecha significa importación permitida; no se permiten ciclos:

| Consumidor | Dependencias internas permitidas | Responsabilidad |
| --- | --- | --- |
| web: componentes cliente | contracts, api-client | Presentación; operaciones comerciales por HTTP. |
| mobile | contracts, api-client | Presentación nativa; nunca application/database o módulos Node exclusivos del servidor. |
| web: composición API/servidor | contracts, application, database | Verificar identidad, adaptar HTTP, inyectar persistencia y ejecutar casos de uso. |
| application (servidor) | domain, contracts | Autorización, casos de uso y puertos transaccionales. No importa database ni Next. |
| database (servidor) | tipos de puertos de application, domain | SQL parametrizado, unidad de trabajo, mapeo, rol y contexto. No reglas HTTP. |
| api-client | contracts | Fetch, errores y transporte; no conoce SQL ni privilegios. |
| contracts | ninguna interna | Esquemas Zod y DTO serializables sin dependencias de plataforma. |
| domain | ninguna interna | Reglas puras independientes de IO; dinero exacto. |
| config | ninguna interna | Bases de TypeScript/ESLint/formato, solo desarrollo. Todos pueden extenderlas. |

Cliente y servidor de `apps/web` tienen fronteras de importación verificadas por lint y exports; los módulos de entrada de servidor usarán protección apropiada (`server-only` en Next). Ni cliente web ni móvil importan database/application. No hay acceso directo desde frontend a tablas comerciales por Supabase REST, GraphQL o Realtime; denegarlo también en privilegios. No se añade ORM, tRPC, biblioteca de estado ni kit UI por anticipado.

## 3. PostgreSQL: comparación y decisión concreta

| Aspecto | A: API → Data API/PostgREST con JWT de usuario + RPC | B: API → SQL con rol restringido y contexto transaccional |
| --- | --- | --- |
| Identidad | API valida sesión; PostgREST verifica JWT y expone identidad para RLS. | API valida token con Auth; SQL no hereda Auth. La API establece actor verificado explícitamente. |
| Empresa/autorización | RLS consulta membresía; RPC debe repetir permisos. | Casos de uso y RLS comprueban membresía vigente, empresa y permiso. |
| Roles | authenticated con grants mínimos, funciones invoker preferidas; nunca service role habitual. | Login dedicado no propietario, NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB, sin acceso a roles elevados. |
| RLS | Natural con JWT; cuidado con funciones definer y acceso directo al endpoint público. | Contexto local, USING y WITH CHECK; denegar ante actor/empresa ausentes. |
| Pooling | Gestionado por Data API, sin driver TCP en API. | Supavisor en modo transacción; controlar pool y estado de conexión. |
| Transacciones | Una RPC para operación atómica completa; múltiples peticiones no son una transacción. | BEGIN/COMMIT/ROLLBACK en un mismo cliente; natural para casos de uso TypeScript. |
| Complejidad | Menos conexiones, más lógica SQL/RPC; para imponer API exclusiva deben impedirse rutas CRUD directas y controlarse RPC. | Más responsabilidad en identidad/contexto/privilegios; reglas y coordinación en TypeScript, fronteras explícitas. |
| Prueba esencial | JWT A sobre registros B, incluyendo RPC y endpoint directo. | Contexto A sobre registros B, ausencia de contexto, rol efectivo y reutilización tras commit/rollback. |

Ambas son viables con sus controles. PostgREST delimita cada petición en una transacción según su [referencia](https://postgrest.org/en/stable/references/transactions.html). **Se recomienda B** para SmartRetail: SQL parametrizado con **node-postgres (`pg`, versión exacta pendiente)**, API Next en runtime Node, esquema comercial privado no expuesto por Data API, y rol dedicado `smartretail_api`. No usar login `postgres`, service role ni credenciales de migración en la API. El driver no implica un ORM.

### Modelo de confianza y flujo obligatorio de B

1. API recibe token/sesión y empresa seleccionada. Verifica identidad mediante `supabase.auth.getUser(token)` contra el proyecto Auth del ambiente, rechazando errores o ausencia de usuario. No basta decodificar JWT ni confiar en `getSession` recibido del cliente. La [referencia getUser](https://supabase.com/docs/reference/javascript/auth-getuser) respalda la consulta a Auth. Diseñar renovación/revocación por separado; no asumir revocación instantánea de todo access token después de logout.
2. Derivar actor exclusivamente del usuario verificado, validar UUID de empresa, comando y recursos. Obtener una conexión como `smartretail_api` y abrir transacción antes de toda consulta comercial, incluso lecturas. El rol nunca posee tablas; propietario/migrador separados y no asumibles por la API. Revocar DDL, TRUNCATE, creación de funciones/esquemas y grants heredados innecesarios; no permitir cambiar a rol privilegiado.
3. Establecer actor y empresa con `set_config('app.user_id', actor, true)` y `set_config('app.tenant_id', empresa, true)`, con valores parametrizados, en la misma conexión y transacción. `true` limita el ajuste a la transacción, según [set_config](https://www.postgresql.org/docs/17/functions-admin.html). Los nombres de contexto son constantes internas, no entradas del usuario.
4. Verificar membresía activa y permiso de la operación en esa transacción antes de acceder a datos comerciales. Proponer tabla de membresías protegida cuya política de lectura permita únicamente filas del actor y empresa del contexto, sin consultar recursivamente su propia tabla. La API no tiene escritura sobre membresías/roles en el MVP; cambios de acceso requieren un flujo administrativo futuro revisado. Las políticas comerciales comprueban empresa y existencia de membresía activa; para escrituras, también el permiso correspondiente. Evitar que el cliente pueda asignarse empresa o privilegios mediante metadatos o campos de entrada.
5. RLS habilitada y FORCE RLS en tablas comerciales; políticas específicas por comando con USING para filas existentes y WITH CHECK para filas nuevas/modificadas. Ausencia, cadena vacía o UUID inválido en contexto debe denegar, nunca abrir acceso; normalizar valores vacíos antes de convertir. Índices de membresía y claves/foráneas compuestas por empresa evitan referencias cruzadas. Revisar vistas y funciones para que no eludan la política. Los detalles de bypass por propietario/superusuario están en [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
6. Ejecutar operación, movimientos, saldo derivado, registro de idempotencia y auditoría atómicamente. No editar historial contabilizado. Finalizar con COMMIT; ante cualquier error ejecutar ROLLBACK antes de liberar el cliente. Si rollback falla o el estado es incierto, destruir esa conexión. [node-postgres](https://node-postgres.com/features/transactions) exige el mismo cliente para toda la transacción; no repartirla entre llamadas `pool.query`.
7. Prohibir SET de sesión para actor/empresa. `SET LOCAL` revierte al valor previo al terminar por commit o rollback, no garantiza borrar un valor de sesión preexistente: iniciar sesiones sin contexto y prohibir defaults de rol/base que lo rellenen. Leer datos solo mediante la unidad transaccional que establece ambos valores. Si se usan savepoints, no continuar tras retroceder a uno anterior al contexto sin reestablecerlo. La semántica está documentada en [SET](https://www.postgresql.org/docs/17/sql-set.html).

**Límite deliberado:** el login de API puede establecer esos parámetros; RLS protege frente a omisiones de filtros y solicitudes de usuarios maliciosos, pero no autentica criptográficamente los parámetros ni resiste una API totalmente comprometida o robo de su credencial SQL. La API es una frontera de confianza. Mitigar con consultas parametrizadas, prohibición de SQL arbitrario, secreto restringido, auditoría, rotación y privilegios mínimos; el compromiso de servidor exige respuesta a incidentes. No presentar GUCs como credenciales infalsificables.

### Conexiones y superficies

Usar TLS con verificación de certificado, Supavisor transaction pooling para Vercel, pool pequeño con límites/timeout determinados mediante capacidad y carga; sin prepared statements nombrados ni estado de sesión persistente. Supabase recomienda ese modo para serverless y documenta sus límites en [conexiones](https://supabase.com/docs/guides/database/connecting-to-postgres). Comprobar login personalizado, grants y rol efectivo en el ambiente de pruebas antes de persistencia; no sustituir un fallo de conexión por `postgres`.

Migraciones usan identidad separada y conexión directa o sesión compatible, solo en tarea autorizada. Ningún migrador en variables runtime. `anon`, `authenticated` y PUBLIC sin acceso al esquema comercial, tablas, secuencias ni funciones comerciales; no exponer ese esquema a REST/GraphQL. Revisar grants por defecto de objetos futuros. Auth y Storage tienen sus propios endpoints/políticas; no modificar sus esquemas internos para escribir archivos mediante SQL. Acceso a Storage con JWT del usuario y políticas revisadas, no reutilizando la credencial SQL como autorización de archivos.

### Prueba negativa obligatoria antes de persistencia

Diseño, **no ejecutado**: fixture sintética con empresas A/B, usuarios uA/uB, membresías distintas y productos/movimientos de cada una. Crear datos con fixture administrativa solo en base desechable; ejecutar comprobaciones con el rol real de API y usuarios reales de prueba.

- API: token uA + empresa B → 403; token uA + empresa A + ID de producto B → 404 sin revelar existencia. GET/listas/exportación y UPDATE/DELETE/venta no devuelven ni alteran B; INSERT con tenant B o referencia a B se rechaza. Token ausente/expirado/inválido → 401. Positivo uA/A funciona para evitar una prueba trivial de denegación total.
- SQL: establecer contexto uA/A, hacer SELECT sin filtro de empresa → solo A; UPDATE/DELETE sobre B → cero filas; INSERT o cambio de tenant a B → error RLS/restricción. Probar también uA/B con contexto válido pero sin membresía: sin acceso. Comprobar por observador de pruebas que B y sus saldos no cambiaron, incluida auditoría comercial.
- Conexión nueva sin contexto, contexto vacío y actor inválido → sin datos o error controlado. Después de COMMIT y ROLLBACK, reutilizar cliente con pool de tamaño 1: operación sin contexto denegada y operación uB/B sin filas A. Ejecutar equivalente a través de Supavisor en staging y registrar evidencia; no asumir que reutilizar cliente fuerza el mismo backend del pooler.
- Membresía revocada o permiso insuficiente → denegación; rol API incapaz de editar membresías, crear funciones, desactivar RLS, TRUNCATE o asumir propietario. Verificar atributos del rol y privilegios efectivos. Denegar acceso comercial por Data API usando JWT uA, incluso si se conoce URL/ID.
- Correr pruebas de fallos intermedios/rollback, reintento idempotente, referencias cruzadas y dos ventas concurrentes de la última unidad. Pruebas de RLS nunca ejecutadas como propietario ni rol privilegiado, salvo fixture/observador separados.

## 4. Calidad, seguridad y consumo

Herramientas propuestas; **ninguna se instala/configura en TASK-002**. Versiones exactas de auxiliares se resolverán antes de su incorporación, sin inventar compatibilidad.

| Área | Herramienta/control y criterio de integración |
| --- | --- |
| Tipos | TypeScript strict, noUncheckedIndexedAccess y exactOptionalPropertyTypes; `tsc --noEmit` por paquete. Errores bloquean. Configuraciones de plataforma separadas. |
| Lint | ESLint con flat config, typescript-eslint y config de Next compatibles; reglas de importación servidor/cliente y ciclos. Versiones P según peers. Errores y warnings nuevos bloquean. [ESLint](https://eslint.org/docs/latest/use/getting-started). |
| Formato | Prettier, versión exacta P; `--check` en CI, sin correcciones silenciosas. Evitar duplicar reglas de formato en ESLint. [Prettier](https://prettier.io/docs/install). |
| Unitarias | Vitest en Node para domain, contracts, application y api-client; dinero, límites, errores y permisos. Fallos bloquean; cambios críticos requieren casos positivos y negativos. |
| Integración | Vitest + PostgreSQL desechable del mismo major/build relevante; fixtures aisladas y rol API real. Probar RLS, transacciones, pooling y migraciones. Suite local no sustituye la comprobación Supavisor en staging. |
| Web E2E | Playwright sobre build web y datos sintéticos: login, denegaciones y flujos críticos. Chromium como gate inicial; Firefox/WebKit antes de release y en cambios de compatibilidad. |
| Móvil posterior | jest-expo/React Native Testing Library para componentes, versiones alineadas al SDK; E2E en dispositivos/emuladores con herramienta por decidir (Maestro candidata). Vitest cubre paquetes puros compartidos. [Expo unit testing](https://docs.expo.dev/develop/unit-testing/). |
| Dependencias | pnpm audit sobre todo el lockfile, incluidos paquetes de desarrollo; revisión de nuevas dependencias, procedencia, licencia y scripts. Bloquean vulnerabilidades high/critical sin excepción aprobada y documentada con responsable, mitigación y vencimiento; otras se evalúan por impacto. Fallo del servicio de auditoría es comprobación incompleta, no aprobado. [pnpm audit](https://pnpm.io/10.x/cli/audit). |
| Secretos | Gitleaks CLI fijado y verificado, con redacción de salida; archivos e historial cuando exista Git. Coincidencias reales bloquean y exigen revocación/rotación si hubo exposición, no solo borrar el texto. Falsos positivos con excepción acotada y revisada. [Gitleaks](https://github.com/gitleaks/gitleaks). |
| Migraciones | Revisión DEVELOPER + QA + SECURITY de grants/RLS, restricciones, índices, locks y compatibilidad. Probar base vacía y actualización desde versión anterior; plan de restauración/roll-forward y respaldo antes de cambios destructivos. |
| Autorización | Matriz rol × operación × empresa y prueba negativa de §3 obligatorias cuando cambie identidad, permisos, SQL o esquema. No omitirlas mediante filtros de archivos incompletos. |

Proponer CI en GitHub Actions si se adopta GitHub (proveedor aún no confirmado). Permisos mínimos de token, acciones externas fijadas por SHA completo verificado, runners efímeros, lockfile congelado, scripts de instalación de dependencias bajo lista revisada y secretos fuera de PR no confiables. No ejecutar código de forks con secretos ni usar `pull_request_target` para checkout/ejecución de código de PR. Separar CI de despliegue y proteger cambios de workflows/migraciones. Preferir identidad temporal donde el proveedor la soporte; secretos duraderos con rotación y acceso acotado. Controles basados en [seguridad de Actions](https://docs.github.com/en/actions/reference/security/secure-use).

Gate propuesto: tipos, lint, formato, unitarias, integraciones/E2E aplicables, build afectado, auditoría de dependencias, secretos y revisiones pertinentes pasan antes de integrar. Un control no aplicable necesita justificación; uno requerido que no pudo correr bloquea. Escaneo completo periódico además del análisis de cambios. Nada sustituye revisión humana de autorización y migraciones.

Reducir consumo con filtros que incluyan dependientes, caché de paquetes validada por lockfile/plataforma, concurrencia limitada y cancelación de ejecuciones obsoletas. No cachear resultados de pruebas con secretos o datos compartidos; no habilitar caché remota de tareas inicialmente. Pruebas nativas costosas al introducir móvil y antes de publicar, sin sustituirlas por emulación web.

## 5. Ambientes y despliegue futuro

| Ambiente | Recursos y responsabilidad |
| --- | --- |
| Local | Supabase local cuando se autorice CLI/contenedores, o proyecto de desarrollo aislado; PostgreSQL alineado, fixtures sintéticas, Auth/Storage de desarrollo. No copiar datos ni secretos productivos. |
| Preview | Backend y buckets desechables por cambio si hay presupuesto. Si no, preview sin operaciones persistentes; no reutilizar producción ni staging silenciosamente. PR no confiable: sin secretos y sin backend comercial. |
| Staging | Proyecto Supabase, credenciales, buckets y Vercel separados; simular pagos, ensayar migración, pooling y restauración. Datos sintéticos; no es respaldo de producción. |
| Producción | Proyecto Supabase y proyecto Vercel exclusivos, credenciales propias, acceso restringido y despliegue autorizado. RPO/RTO, región, presupuesto y retención por confirmar antes de habilitar. |

Vercel → Supabase: credencial SQL restringida solo en variables de servidor del ambiente, nunca prefijos NEXT_PUBLIC_/EXPO_PUBLIC_, repositorio ni logs. Claves públicas de Auth no conceden acceso comercial. No inyectar credenciales de migración/service role en runtime o build ordinario. Variables por ambiente según [Vercel](https://vercel.com/docs/environment-variables); revisar cualquier integración automática antes de permitir que copie credenciales.

Defensa contra preview→producción: proyecto Vercel de producción separado con previews automáticas desactivadas; proyecto no productivo sin secretos productivos. Lista explícita de pares ambiente/host SQL/proyecto Auth/bucket permitidos validada al arrancar y antes de migrar; rechazar configuración incompleta o incoherente sin fallback. El pipeline de producción protegido aporta su configuración, no la rama de PR. Probar una configuración deliberadamente cruzada y comprobar fallo sin conexión comercial. Los nombres de ambiente y las validaciones no compensan entregar credenciales productivas a código no confiable.

Separar redirects de Auth, cookies/dominios, claves, permisos de Storage, perfiles EAS y canales de actualización. API `/api/v1` con cambios aditivos compatibles; propuesta de soportar la versión móvil actual y la anterior al menos 90 días tras relevo, por confirmar con negocio. Documentar deprecación y actualizar antes de retirar endpoints. Contratos testeados con clientes soportados; migraciones expand/contract. No reutilizar un artefacto móvil de staging como producción sin su configuración y revisión. Cambios nativos requieren build compatible; una actualización OTA no resuelve incompatibilidad binaria.

## 6. Valores de negocio propuestos y pendientes

| Tema | Propuesta inicial | Confirmación necesaria |
| --- | --- | --- |
| Moneda | MXN principal | Negocio; otras monedas y conversión fuera del inicio. |
| Operación MVP | Una empresa, una sucursal y una ubicación de inventario | Negocio; mantener tenant explícito y pruebas con dos empresas desde el principio. |
| Conectividad | Operación conectada; no confirmar venta sin servidor | Negocio; política ante interrupción. Offline requiere diseño propio. |
| Existencias | Inventario negativo deshabilitado por defecto | Negocio; excepciones futuras y permisos. |
| Dinero | Totales en centavos enteros; intermediarios decimales exactos, sin coma flotante binaria | Proponer redondeo half-up a dos decimales en total de línea y sumar líneas; confirmar descuentos, impuestos, devoluciones y productos fraccionados antes de lógica monetaria. |

Proponer transportar importes como cadenas decimales/unidades mínimas serializadas y usar representación exacta con límites explícitos; nunca convertir BIGINT/NUMERIC sin comprobar precisión. Moneda, precisión de cantidades y política fiscal siguen pendientes de negocio, sin afirmar cumplimiento fiscal.

Pendientes técnicos no resueltos por esta tarea: pins y peer dependencies exactos, soporte de módulos nativos/dispositivos, proveedor CI, región/planes, sesiones web/móvil y CSRF según transporte, observabilidad/retención y recuperación. Estrategia de aislamiento **sí definida** en §3, pendiente de aprobación e implementación/pruebas; no queda como elección abierta entre A y B. Antes de persistencia, comprobar el rol personalizado, pooling y pruebas negativas; si fallan, bloquear esa implementación, no omitir RLS. TASK-003 debe acotar únicamente inicialización autorizada y resolver sus pins, sin asumir permiso para producción ni lógica comercial.

## 7. Configuración histórica — TASK-003 (sustituida por §8)

Implementado el 2026-09-22: package.json privado `smartretail@0.0.0`, `packageManager: pnpm@12.5.1`, engines Node `>=24.13.1 <25` y pnpm `12.5.1`. Sin dependencias ni scripts raíz: aún no existen operaciones de build, lint o test. pnpm-workspace.yaml declara `apps/*` y `packages/*`, `strictPeerDependencies: true` y `engineStrict: true`; los directorios futuros no se materializaron. El gestor reconoce únicamente la raíz. El TypeScript del monorepositorio sigue pendiente de una tarea que autorice su configuración.

### Gestor e integridad

Se consultaron el [registro pnpm 12.5.1](https://registry.npmjs.org/pnpm/12.5.1), el [paquete oficial Windows x64](https://registry.npmjs.org/@pnpm%2fexe.win32-x64/12.5.1), release e instalación oficial; no se seleccionó automáticamente otra versión. El paquete nativo no declara scripts. Se descargó su tarball HTTPS y se comparó SHA-512 con `dist.integrity` antes de extraer/ejecutar:

```text
sha512-ePUmQFPAPJFNMwg1lelDx2PdjHqYRiF0yfg5e6qeDbPNOu97QNo557Ru/SxmCrmt8ydQWNuZXWpdEp019md5vw==
```

También se consultaron avisos oficiales [GHSA-vq4v-j7r6-jq4m](https://github.com/pnpm/pnpm/security/advisories/GHSA-vq4v-j7r6-jq4m), [GHSA-c59q-g84q-2gj5](https://github.com/pnpm/pnpm/security/advisories/GHSA-c59q-g84q-2gj5) y [GHSA-vx52-2968-3vc6](https://github.com/pnpm/pnpm/security/advisories/GHSA-vx52-2968-3vc6): sus rangos afectados no incluyen 12.5.1. Las notas de release no identifican un impedimento para este workspace mínimo. Revisión acotada, no certificación de ausencia de vulnerabilidades ni de compatibilidad futura.

Instalación limitada a `%TEMP%\smartretail-task003-pnpm-12.5.1`: tarball y contenido oficial `package/` (exe, manifiesto y licencias). Sin instalación global, modificación de PATH, habilitación global de Corepack ni scripts de terceros. Node, npm, Git y la política de PowerShell no se modificaron. Corepack 0.34.6 estaba disponible, pero no fue necesario para ejecutar el binario nativo.

Comandos históricos de TASK-003; para la versión vigente usar §8:

```powershell
$taskPnpm = Join-Path ([System.IO.Path]::GetTempPath()) 'smartretail-task003-pnpm-12.5.1\package\pnpm.exe'
& $taskPnpm --version
& $taskPnpm list --recursive --depth -1 --json
& $taskPnpm install --frozen-lockfile --ignore-scripts --offline
```

En otra máquina o tras limpiar TEMP, provisionar de nuevo la versión exacta desde el paquete oficial correspondiente a su plataforma y verificar integridad antes de ejecutar; no asumir que `pnpm` está en PATH. La ruta anterior y su hash son específicos de Windows x64. El pin del manifiesto no instala por sí solo el gestor.

### Lockfile, Git y alcance

pnpm generó `pnpm-lock.yaml` mediante `install --lockfile-only --ignore-scripts --offline`, sin edición manual. Su formato contiene dos documentos YAML: resolución del propio gestor y binarios opcionales de plataformas, y el importer raíz de aplicación vacío. Esas entradas no son dependencias comerciales. La verificación `install --frozen-lockfile --ignore-scripts --offline` terminó correctamente y no cambió el hash del lockfile.

La instalación mínima solo produjo dos metadatos ignorados bajo node_modules; no hay paquetes de aplicaciones. El store usado es `%LOCALAPPDATA%\pnpm\store\v11`, donde se observó `index.db`; se observaron además 15 archivos de metadatos recientes del gestor/binarios bajo `%LOCALAPPDATA%\pnpm-cache\v11`. El detalle de incidencias y efectos locales queda en PROJECT_STATE.

Git se inicializó solo en la raíz con `main`, sin commits, staging ni remotos; no hubo cambios de configuración global. `.gitignore` excluye dependencias, entornos reales, claves, cachés y artefactos y mantiene ejemplos `.env.example`/`.env.*.example`, manifiestos, lockfile y documentación. Los ejemplos deben revisarse para garantizar que no contengan secretos. `.editorconfig` fija UTF-8/LF/dos espacios; `.gitattributes` normaliza texto a LF y CMD/BAT a CRLF para Windows. No hay Next.js, Expo, CI, servicios o pruebas funcionales configurados.

## 8. Decisión vigente de gestor/lockfile — TASK-003A

**Seleccionado pnpm 11.27.1**, no una actualización flotante. Conserva Node `>=24.13.1 <25`, raíz privada y cero dependencias/scripts; packageManager y engines.pnpm fijan 11.27.1. pnpm-workspace.yaml permanece intacto, incluidos engineStrict y strictPeerDependencies. El lockfile fue regenerado por el gestor, sin edición manual; contiene un documento YAML, importer raíz vacío y ninguna referencia a pnpm 12. No se activó `pmOnFail: ignore` ni se relajaron controles.

### Fuentes y límites de la investigación (2026-09-22)

- **Oficial:** [release 11.27.1](https://github.com/pnpm/pnpm/releases/tag/v11.27.1) del 20 de septiembre y [release 12.5.1](https://github.com/pnpm/pnpm/releases/tag/v12.5.1) del 18 de septiembre muestran actividad de ambas líneas. No equivalen a promesa de duración de soporte. La primera incluye correcciones de ejecución de binarios hermanos y deduplicación; ninguna sustituye esta prueba local.
- **Oficial:** metadatos del registro exigen Node >=22.13 para 11.27.1; el paquete wrapper de 12.5.1 declara >=18.*, mientras la [guía de instalación](https://pnpm.io/installation) exige >=22.13 para instalar 12 por npm. El ejecutable nativo 12 no necesita Node para funcionar. Node 24.13.1 fue compatible con ambas pruebas.
- **Oficial:** [configDependencies](https://pnpm.io/config-dependencies) documenta el documento de entorno. No afirmar que toda configuración pnpm 11 siempre produce un único documento: otras funciones pueden añadirlo. La [referencia pmOnFail](https://pnpm.io/settings/cli#pmonfail) explica el cambio automático al gestor fijado. Una consulta preliminar al launcher 11 desde la raíz aún fijada a 12 devolvió 12.5.1; no se contó como prueba de 11. Los ensayos válidos comprobaron explícitamente su versión dentro de cada fixture.
- **Reportes, no evidencia de SmartRetail en GitHub:** [pnpm #13805](https://github.com/pnpm/pnpm/issues/13805) aparece cerrado; [dependabot-core #15904](https://github.com/dependabot/dependabot-core/issues/15904) aparece abierto y reporta interpretación incompleta del grafo. No hay remoto, commits ni ejecución GitHub en este proyecto. La incompatibilidad reproducida aquí es la del parser de documento único, no la del servicio GitHub.
- **Seguridad acotada:** se revisaron otra vez los tres avisos oficiales enlazados en §7: sus rangos afectados no incluyen 11.27.1 ni 12.5.1. No se declara ausencia total de vulnerabilidades ni se instaló un escáner nuevo.

### Comparación reproducida fuera del proyecto

Fixtures bajo `%TEMP%\smartretail-task003a\workspace-<versión>`, con nombre/versión/privacidad/engines equivalentes, pin propio y copia idéntica del workspace YAML. Ambas usaron Node 24.13.1, Windows x64 y el store de usuario; no son mediciones de rendimiento ni de caché inicialmente vacía. Distribuciones oficiales: paquete JavaScript pnpm 11.27.1 extraído y ejecutado con Node, y binario nativo 12.5.1 de TASK-003 revalidado. SHA-512 de ambos tarballs contrastado con `dist.integrity` del registro antes de la comparación. Para 11:

```text
sha512-qB1MIbmwmksK6/kO9eUn1CYr3aMi0mCCl4y1SQI6xtnK/Jixn/+qXHHbQ4pl9wIk7beNcxEYeGH/lkgNHNyiPA==
```

Secuencia por gestor: comprobar `--version`; `install --ignore-scripts`; `list --recursive --depth -1 --json`; frozen online y frozen offline; añadir **yaml@2.8.1** exclusivamente en fixture mediante `add yaml@2.8.1 --save-exact --workspace-root --ignore-scripts`; repetir frozen online/offline y generación normal. Finalmente borrar solo node_modules temporal, validar ruta y restaurar con frozen offline. Todas las operaciones terminaron con código 0; hashes permanecieron idénticos dentro de cada fase. No se ejecutaron scripts de dependencias ni se alteraron TLS/peers/política PowerShell.

| Evidencia local | pnpm 12.5.1 | pnpm 11.27.1 |
| --- | --- | --- |
| Workspace privado reconocido | Solo raíz temporal | Solo raíz temporal |
| YAML vacío / con yaml@2.8.1 | 2 / 2 documentos | 1 / 1 documento |
| Estructura | Primero gestor + binarios; segundo importer de producto | Importer de producto en único documento |
| Grafo real | yaml 2.8.1 en segundo documento | yaml 2.8.1 en único documento |
| Integridad de yaml en resolución | Coincide con dist.integrity del registro | Coincide con dist.integrity del registro |
| Frozen online/offline y restauración sin node_modules | Pasan | Pasan |
| Repetición equivalente byte-estable | Sí | Sí |
| Parser `yaml.parseAllDocuments`, sin errores | Lee ambos documentos | Lee un documento |
| Parser de documento único `yaml.parse` | Rechaza con MULTIPLE_DOCS | Acepta |

yaml fue elegida como dependencia pequeña sin dependencias transitivas, además de permitir comprobar el formato con un parser real. Tiene scripts de desarrollo/publicación, pero ningún lifecycle de instalación requerido; se usó siempre ignore-scripts. pnpm 11 notificó que había yaml 2.9.1 disponible: se mantuvo deliberadamente 2.8.1 para igualdad del ensayo. El mensaje del gestor sobre políticas de cadena de suministro no se interpreta como auditoría exhaustiva.

Hashes SHA-256 preservados:

| Fase | 12.5.1 | 11.27.1 |
| --- | --- | --- |
| Vacío | `59FEBE21687F411CF0F7836853B7998823365C61129CCA7937D6817CD257B0F6` | `17C814B167307942D3609C7B9D916CEDDB85839573AB39BAA114E30EDB132A1A` |
| Con yaml | `5636F46D3E706B53FC4F25B2DF2BF16B76D8314273E5142B60ED99D12C8DD7A3` | `2EA68EAD349911BB8666FC6DC8198C7E3B965C824893AF6B3EDC5E1CFE466EE9` |

La decisión favorece 11 porque conserva reproducibilidad e integridad observadas y elimina la barrera de lectura reproducida en nuestra configuración. Mantener 12 sería viable con consumidores multidocumento verificados, pero hoy añadiría una condición de interoperabilidad innecesaria. No se degrada por el número mayor ni solo por un reporte. Next/Expo/Metro siguen sin instalarse: su compatibilidad real exige otra tarea.

### Uso, controles futuros y efectos locales

Gestor temporal seleccionado (sin PATH/global/Corepack):

```powershell
$taskPnpm11 = Join-Path ([System.IO.Path]::GetTempPath()) 'smartretail-task003a\manager11\package\bin\pnpm.mjs'
node $taskPnpm11 --version
node $taskPnpm11 install --frozen-lockfile --ignore-scripts
```

Antes de ejecutar, situarse en la raíz del workspace y comprobar 11.27.1. Si TEMP se limpia, obtener nuevamente el paquete oficial exacto y verificar integridad; no reemplazar por latest. Se conservan gestor, metadatos, snapshots de los cuatro lockfiles y resultados de comparación fuera del proyecto para trazabilidad; los workspaces desechables se eliminan después de las revisiones. Store/cachés del usuario recibieron paquetes/metadatos de los gestores y yaml; no se purgan cachés compartidas. Los metadatos ignorados de node_modules raíz pueden actualizarse al instalar; no contienen una dependencia de producto.

La futura TASK de CI debe combinar **auditoría nativa del gestor, escaneo de secretos, análisis independiente de vulnerabilidades de todas las dependencias (incluido servidor y desarrollo), revisión del lockfile y actualizaciones controladas**. No depender exclusivamente del frontend, GitHub Dependency Graph ni una sola fuente. Antes de adoptar un consumidor comprobar con un fixture no vacío que identifica paquetes/versiones y declara errores de parseo, no un falso resultado de cero dependencias. Si aparecen documentos de entorno por configuraciones futuras, revisar todos los documentos o generar un inventario/SBOM comprobado sin perder configDependencies/gestor. Auditar también el gestor fuera del grafo de producto. Estas herramientas no se instalan ni se configura CI en TASK-003A.

## 9. TASK-004 — base web ejecutada — 2026-09-22

Siete dependencias directas exactas: Next **16.3.6**, React y React DOM **19.3.0**; desarrollo: TypeScript **7.0.2**, @types/node **24.13.6**, @types/react y @types/react-dom **19.3.0**. Node local **24.13.1**, pnpm **11.27.1**. Se consultaron metadatos del registro por versión, sin instalar tags ni prereleases. Next exige Node >=20.9 y admite React/DOM ^19.0.0; React DOM exige React ^19.3.0 y sus tipos exigen @types/react ^19.3.0. TypeScript 7.0.2 exige Node >=16.20.0. Peers estrictos y engines no se relajaron.

Fuentes: [Next exacto](https://registry.npmjs.org/next/16.3.6), [React](https://registry.npmjs.org/react/19.3.0), [React DOM](https://registry.npmjs.org/react-dom/19.3.0), [TypeScript](https://registry.npmjs.org/typescript/7.0.2), [tipos Node](https://registry.npmjs.org/@types/node/24.13.6), [tipos React](https://registry.npmjs.org/@types/react/19.3.0), [tipos React DOM](https://registry.npmjs.org/@types/react-dom/19.3.0).

Desviaciones verificadas: React web pasa de la propuesta 19.2.x a 19.3.0 estable compatible. La instalación inicial TS5.9.3 resolvió peers, pero typecheck falló con cuatro errores de declaraciones Next (`URLPatternInput`/`URLPatternOptions` ausentes). TS7.0.2 estable resolvió esos errores: typecheck y build de producción terminaron con código 0, sin shims ni supresión de controles. Esta compatibilidad sólo cubre la aplicación mínima local Windows; no acredita Expo ni herramientas futuras.

App Router con Server Components; ocho archivos fuente/configuración, CSS local y fuentes del sistema. Endpoint GET /api/v1/health constante sin IO. `next.config.ts` sólo fija `poweredByHeader: false`. `typecheck` ejecuta `next typegen && tsc --noEmit`, generando antes los tipos de rutas. `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` activos y `skipLibCheck: false`. Primera ejecución de typegen reformateó tsconfig y añadió únicamente `allowJs: true`; se fijó explícitamente **false** y siguientes typecheck/build no redujeron controles. Next regeneró next-env.d.ts con imports de `.next/types/routes.d.ts` y `root-params.d.ts` y comentario oficial. Los artefactos .next y tsbuildinfo ya están ignorados.

### Excepción temporal de antigüedad y reproducibilidad

pnpm añadió automáticamente diez excepciones minimumReleaseAgeExclude al instalar el parche Next publicado el mismo día. Se retiraron exclusivamente esas adiciones y se restauró el SHA-256 original de pnpm-workspace.yaml: `82CA0505CA29F1E1313C22AA260E229837A13968B615A7F201974B79B96E77CB`. Sin cambios globales ni desactivación general del control. Una instalación congelada posterior sin excepciones falló por antigüedad; el intento CLI con patrón @next/* más versión fue rechazado por sintaxis, sin modificación del proyecto.

Para reproducir las comprobaciones mientras el parche no alcanza la antigüedad mínima, se usaron **diez excepciones exactas sólo del proceso**:

```powershell
$taskPnpm = Join-Path $env:TEMP 'smartretail-task003a\manager11\package\bin\pnpm.mjs'
$taskNames = @('next', '@next/env', '@next/swc-darwin-arm64', '@next/swc-darwin-x64', '@next/swc-linux-arm64-gnu', '@next/swc-linux-arm64-musl', '@next/swc-linux-x64-gnu', '@next/swc-linux-x64-musl', '@next/swc-win32-arm64-msvc', '@next/swc-win32-x64-msvc')
$taskExceptions = @($taskNames | ForEach-Object { '--config.minimum-release-age-exclude=' + $_ + '@16.3.6' })
node $taskPnpm --version
node $taskPnpm install --frozen-lockfile --ignore-scripts @taskExceptions
node $taskPnpm install --frozen-lockfile --ignore-scripts @taskExceptions
node $taskPnpm @taskExceptions --filter @smartretail/web typecheck
node $taskPnpm @taskExceptions --filter @smartretail/web build
node $taskPnpm @taskExceptions --filter @smartretail/web start --hostname 127.0.0.1 --port 31404
```

Los flags también son necesarios temporalmente para scripts cuando pnpm revalida dependencias antes de ejecutarlos. No omitir silenciosamente la condición ni afirmar que frozen sin flags pasó sobre el grafo final. Después del período mínimo se podrá prescindir de estas excepciones; no se comprobó anticipadamente ese escenario. SECURITY consideró aceptable la excepción acotada al pin exigido: [advisory oficial GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) identifica 16.3.6 como corrección de CVE-2026-94545. No constituye garantía de ausencia de vulnerabilidades o malware.

Lockfile generado exclusivamente por pnpm. Dos frozen finales código 0; hash antes/después idéntico `C10CBF2B37559D1B480C65065AFCBB71FC52AC191C27A2AA0806AF023E65F6AA`. Auditoría final de todo el grafo: 0 info/low/moderate/high/critical, 80 entradas reportadas (incluyen variantes opcionales de plataforma, no 80 dependencias directas). Instalaciones con --ignore-scripts; no se autorizaron hooks de terceros. Sin dependencias adicionales de producto ni duplicados inesperados de React.

Durante las comprobaciones Next se usó `NEXT_TELEMETRY_DISABLED=1` sólo en el proceso PowerShell y sus hijos, mecanismo [documentado](https://nextjs.org/telemetry). No se ejecutó telemetry disable ni se persistió configuración del usuario. Sin telemetría propia ni archivos .env.

## 10. TASK-005 — base móvil Expo ejecutada

Versiones exactas: Expo57.0.24 (SDK57 estable), React Native0.86.3, React/DOM19.2.3, TypeScript6.0.3; tipos React19.2.14 y react-native__assets-registry0.84.0; Expo Doctor1.21.1 como herramienta de desarrollo reproducible. Node24.13.1 y pnpm11.27.1. Matriz obtenida de bundledNativeModules.json del tarball Expo oficial, integridad SHA512 contrastada con registro. [Expo exacto](https://registry.npmjs.org/expo/57.0.24), [React Native](https://registry.npmjs.org/react-native/0.86.3), [TypeScript](https://registry.npmjs.org/typescript/6.0.3), [matriz SDK](https://docs.expo.dev/versions/latest/), [monorepos](https://docs.expo.dev/guides/monorepos/).

Inicialización manual de cinco archivos, sin Router, navegación, soporte web ni configuración Metro/hoisting personalizada. registerRootComponent registra App; pantalla estática nativa con texto solicitado. Sólo iOS/Android en platforms. React DOM19.2.3 se declara para satisfacer el peer opcional de Expo: sin pin local pnpm enlazó DOM19.3.0 de web con React19.2.3 y falló strictPeerDependencies. No se importa DOM desde código móvil ni se instala react-native-web. React web sigue19.3.0; no se modificó apps/web. Un ensayo dedupe-peer-dependents=false no demostró resolver la causa (resolución omitida); no se conserva ese ajuste.

TS5.9.3 inicial pasó tras quitar DOM de lib y añadir los tipos reales del registro de assets, pero Doctor exigió ~6.0.3. Se fijó6.0.3 y typecheck pasó nuevamente. Config extiende expo/tsconfig.base, sobrescribe lib a ESNext para entorno nativo, types a react, skipLibCheck false y activa strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes. Sin any propio, shims ni exclusiones de Doctor. Expo Doctor final21/21, código0.

### Reproducción en PowerShell desde la raíz

Usar el gestor temporal descrito en §8 y las diez excepciones exactas Next16.3.6 de §9 mientras no alcanza antigüedad mínima. No son excepciones nuevas para Expo. Instalaciones explícitas validan peers/engines/integridad. pnpm puede reinstalar antes de scripts y perder los flags de excepciones del proceso padre: para esas ejecuciones se desactiva **sólo la reinstalación automática**, tras verificar instalación explícita, sin cambiar políticas persistentes.

```powershell
# Definir $taskPnpm y $taskExceptions exactamente como en §9.
node $taskPnpm install --frozen-lockfile --ignore-scripts @taskExceptions
node $taskPnpm install --frozen-lockfile --ignore-scripts @taskExceptions
node $taskPnpm --config.verify-deps-before-run=false --filter @smartretail/mobile run typecheck
node $taskPnpm --config.verify-deps-before-run=false --filter @smartretail/mobile run doctor
node $taskPnpm --config.verify-deps-before-run=false --filter @smartretail/mobile run export:android
node $taskPnpm --config.verify-deps-before-run=false --filter @smartretail/mobile run export:ios
node $taskPnpm --config.verify-deps-before-run=false --filter @smartretail/mobile exec expo config --type introspect --json
node $taskPnpm audit --json
```

`run doctor` es necesario para evitar colisión con el comando interno pnpm doctor. CI=1 se usó sólo en procesos de validación. Exports de producción Hermes en dist/android y dist/ios, ignorados por reglas existentes. No son binarios nativos ni acreditan ejecución en dispositivos. No EAS/prebuild/build nativo. Bundle/export iOS generado correctamente; compilación nativa iOS no realizada en Windows.

### Permisos y riesgo residual

android.permissions[] no elimina permisos transitivos. SECURITY detectó READ/WRITE_EXTERNAL_STORAGE en expo-file-system; se bloquearon explícitamente, junto con SYSTEM_ALERT_WINDOW y VIBRATE del template por ser innecesarios. Introspección final confirmó tools:node=remove para los cuatro; INTERNET permanece como permiso base. Sin solicitudes propias de cámara, micrófono, ubicación, contactos, Bluetooth, biometría, fotos o notificaciones ni claves iOS de UsageDescription para esas capacidades. [Modelo de permisos Expo](https://docs.expo.dev/guides/permissions/). No se inspeccionaron manifests fusionados de binarios ni permisos reales en dispositivos; Expo Go tiene sus propios permisos. Introspect iOS conserva NSAllowsArbitraryLoads del template: sin tráfico propio en esta base; revisar ATS antes de distribución o incorporar red. Identificadores inferidos en introspect son placeholders, no decisiones de publicación.

Auditoría final: **1 MODERATE**, 0 info/low/high/critical; 539 entradas del grafo completo. uuid7.0.3 de expo > @expo/config-plugins > xcode3.0.1 (varias rutas) afectado por [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). SECURITY verificó que xcode llama sólo uuid.v4() sin buffer/offset, mientras el aviso afecta v3/v5/v6 con buffer: no se observó vector aplicable en esta cadena. El parche >=11.1.1 no satisface ^7.0.3 requerido por xcode; no se impuso un salto mayor sin compatibilidad demostrada. Se conserva aviso residual/deprecación, no se declara resuelto ni audit limpio. Reexaminar al actualizar Expo/xcode. Dependencias instaladas con ignore-scripts; sin funcionalidades comerciales o secretos propios.

## 11. TASK-005A — higiene de dependencias — 2026-09-23

Decisión: conservar las ocho dependencias directas exactas de TASK-005. No se demostró una eliminación compatible dentro de la configuración actual ni una actualización soportada que suprima el advisory. Se consultaron árboles reales con pnpm why react-dom/uuid, peers instalados y registro oficial, sin inferir necesidad sólo por nombres.

### React DOM: opcional nativo, pin necesario para esta resolución

Expo57.0.24 declara react-dom:* con peerDependenciesMeta.optional=true; @expo/router-server57.0.10, introducido por @expo/cli57.0.26, también declara ese peer opcional. La [guía oficial de Expo web](https://docs.expo.dev/workflow/web/) instala React DOM al habilitar web: no es un requisito general de una interfaz exclusivamente nativa. Nuestra aplicación no lo importa. Es dependencia directa móvil19.2.3 y peer resuelto de Expo/herramientas; web usa19.3.0.

Ensayo real mediante `pnpm --filter @smartretail/mobile remove react-dom --config.ignore-scripts=true` con las excepciones exactas Next de §9. El primer intento con --ignore-scripts fue rechazado antes de modificar archivos: remove requiere la forma config. La retirada terminó0 con warning de peers. Typecheck0, Doctor21/21, exports Android/iOS0, frozen0, auditoría1MODERATE. **pnpm peers check terminó1**: React DOM19.3.0 pide React^19.3.0 y encuentra19.2.3 en móvil. pnpm why mostró DOM19.3.0 y una resolución transitiva19.2.3; retirar la dependencia directa no demostró ausencia total de DOM. Esas pruebas no acreditan que Expo nativo necesite DOM para renderizar ni que el árbol sin pin sea compatible.

Se restauró react-dom19.2.3 mediante pnpm add exacto, sin cambiar React móvil/web ni relajar peers. Metadatos de resolución conservaron el conflicto intermedio; resolución forzada por --resolution-only y retirada sólo del lock raíz no lo limpiaron. Se respaldaron lock raíz y lock interno de node_modules y se regeneraron exclusivamente con pnpm: peers0. Esa regeneración resolvió incidentalmente PostCSS8.5.28 dentro de un rango transitivo. Se descartó esa actualización fuera del objetivo restaurando **snapshots completos originales producidos por pnpm**, sin editar entradas del lockfile; dos frozen finales y peers check pasaron. Manifiesto móvil y lock final son byte a byte iguales al baseline. No overrides, hoisting, --force, cambios globales o alteraciones de web.

### UUID: cadena, posibilidad de corrección y riesgo residual

Cadena completa más corta comprobada: **@smartretail/mobile@0.0.0 → expo@57.0.24 → @expo/config-plugins@57.0.9 → xcode@3.0.1 → uuid@7.0.3**. La auditoría muestra otras nueve rutas vía @expo/cli, @expo/config, @expo/metro-config, @expo/prebuild-config, @expo/inline-modules y @expo/local-build-cache-provider que confluyen en el mismo xcode/uuid. No es dependencia directa de la app; añadir uuid directo no reemplazaría esas resoluciones.

[Advisory upstream GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq): MODERATE, afecta v3/v5/v6 cuando se proporciona buffer, primera versión corregida11.1.1; las ramas12/13 requieren12.0.1/13.0.1 (12.0.0 y13.0.0 también están afectadas). SECURITY consultó nuevamente el [registro Expo](https://registry.npmjs.org/expo), [config-plugins](https://registry.npmjs.org/@expo/config-plugins) y [xcode](https://registry.npmjs.org/xcode): máximos estables compatibles publicados observados57.0.24,57.0.9 y3.0.1; rangos ~57.0.9, ^3.0.1 y ^7.0.3 respectivamente. No hay parche publicado en esa cadena compatible que adopte UUID fuera de los rangos afectados. No se instaló SDK58 beta ni se impuso un override mayor.

Superficie observada: herramientas de configuración de proyectos Xcode; xcode/lib/pbxProject.js:90 llama uuid.v4() sin buffer/offset para generar identificadores. No se observó uso afectado v3/v5/v6 en esa cadena. Mitigación actual: app sin importación UUID/entradas dirigidas a esos métodos, uso examinado v4 sin argumentos, instalaciones ignore-scripts y ausencia de operaciones nativas de distribución en esta base. Esto limita aplicabilidad observada, **no corrige el paquete ni garantiza inexploitabilidad general**. Condición de eliminación: una publicación soportada de Expo57/config-plugins/xcode que resuelva una versión corregida, seguida de Doctor, typecheck, ambos exports y auditoría sin advisory. Reabrir evaluación si cambia el uso de UUID o la cadena.

### Clasificación de dependencias directas finales

| Paquete exacto | Clasificación y necesidad comprobada |
| --- | --- |
| expo57.0.24 | Runtime e integración/tooling Expo, registra componente raíz y aporta CLI/Metro. |
| react19.2.3 | Runtime requerido por matriz Expo57/RN. |
| react-native0.86.3 | Runtime/renderizador nativo requerido por Expo57. |
| react-dom19.2.3 | Compatibilidad de peers Expo en este monorepo; no importado por UI nativa. Retirada deja conflicto demostrado. |
| typescript6.0.3 | Desarrollo: typecheck y versión requerida por Doctor. |
| @types/react19.2.14 | Desarrollo: declaraciones React para TSX. |
| @types/react-native__assets-registry0.84.0 | Desarrollo: declaraciones faltantes de assets-registry, requeridas al comprobar dependencias con skipLibCheck false. |
| expo-doctor1.21.1 | Desarrollo: validación oficial reproducible mediante script doctor. |

No se agregó una dependencia nueva ni se eliminó ninguna con evidencia suficiente. Regresiones/comandos conservan las condiciones documentadas en §10: pnpm11.27.1, excepciones temporales exactas Next para instalaciones, verify-deps-before-run=false sólo para scripts tras instalación explícita verificada. Auditoría final1MODERATE y0HIGH/CRITICAL. Los avisos de deprecación UUID y NO_COLOR/FORCE_COLOR del ensayo no se presentan como errores de compilación.

## 12. TASK-006A — controles locales de calidad y seguridad — 2026-09-23

**Estado parcial por incompatibilidad documentada del parser web.** TS web7.0.2 y móvil6.0.3 no se cambiaron. Se consultaron metadatos oficiales antes de instalar: ESLint10.11.0 candidato no satisface peers de eslint-plugin-react7.37.5 (hasta^9.7) ni eslint-plugin-import2.32.0 (hasta^9). Se eligió **ESLint9.39.5** exacto en ambas apps, compatible con esos peers; el registro lo marca deprecated, límite explícito que requiere revisar soporte de plugins antes de migrar a10. No se ignoró ningún conflicto.

Herramientas instaladas: Prettier3.9.9 raíz; eslint-config-expo57.0.2 y eslint-config-prettier10.1.8 móvil. Nuevos pins directos exactos. Config Expo resuelve @typescript-eslint/parser y plugin8.70.1, compatible con móvil6.0.3. [Metadata ESLint seleccionado](https://registry.npmjs.org/eslint/9.39.5), [Prettier](https://registry.npmjs.org/prettier/3.9.9), [Expo config](https://registry.npmjs.org/eslint-config-expo/57.0.2), [config-prettier](https://registry.npmjs.org/eslint-config-prettier/10.1.8).

### Bloqueo web y alcance real de lint

eslint-config-next16.3.6 requiere typescript-eslint^8.46; máximo estable consultado8.70.1 declara TS>=4.8.4<6.1.0. [Soporte oficial](https://typescript-eslint.io/users/dependency-versions/) excluye7.0.2; [Next ESLint](https://nextjs.org/docs/app/api-reference/config/eslint) recomienda core-web-vitals/typescript o plugin directo con parser propio. No se encontró una alternativa oficialmente soportada que cubra TS7. No se instaló config-next incompatible, cambió TS, desactivó warning ni omitió fuentes para simular éxito.

`apps/web/eslint.config.mjs` es un **bloqueo explícito**, no una configuración funcional de reglas Next. El script real `eslint . --max-warnings 0` termina2 con explicación. Quedan pendientes lint web, reglas recomendadas React/Hooks/Next/Core Web Vitals y su validación con parser soportado. No se presenta el bloqueo como prueba negativa de regla ni como análisis de fuentes web ejecutado. Eliminar ese bloqueo requiere reevaluación de compatibilidad y pruebas; no basta borrar el throw.

Móvil usa flat config oficial Expo57 más config-prettier, con dist/.expo/build/coverage ignorados; App.tsx e index.ts revisados. Reglas efectivas incluyen import/no-unresolved y react-hooks/rules-of-hooks como errores, no-unused-vars TS como warning; max-warnings0 hace fallar warnings. [Guía oficial Expo](https://docs.expo.dev/guides/using-eslint/). Sin reglas cosméticas añadidas.

Prettier separado de ESLint, configuración mínima endOfLine lf. format:check cubre manifiestos raíz/apps, configuraciones ESLint y fuentes TS/TSX/JS/JSX/CSS. Excluye artefactos y next-env generado. No incluye documentación histórica, lockfile ni configuraciones JSON fuera del alcance (app.json/tsconfig); estas limitaciones son de formato, no del scanner de secretos. Único cambio en fuente funcional: formato de App.tsx (saltos de línea), sin cambios de comportamiento.

Scripts raíz secuenciales y compatibles con Windows sin pnpm global: pequeños lanzadores Node reutilizan process.execPath y npm_execpath del gestor activo, propagan errores/códigos de salida, sin shell construido. lint ejecuta móvil y después web; typecheck ejecuta web y móvil; audit:deps ejecuta pnpm audit --audit-level high sobre todo el workspace y conserva salida MODERATE; check encadena formato → lint → tipos → auditoría y se detiene al primer fallo. No incluye builds/exports, CI ni framework de pruebas. La prueba inicial con comandos pnpm anidados falló porque pnpm no está en PATH; los lanzadores lo corrigen sin modificar PATH global.

### Reproducción local y gestor

La distribución pnpm temporal anterior desapareció durante la tarea; se repuso **11.27.1** en TEMP/smartretail-task006a/manager desde registro oficial, verificando SHA512 contra dist.integrity. No instalación global. Prettier3.9.9 recién publicado provocó una excepción automática en pnpm-workspace.yaml; se revirtió y verificó hash original82CA0505CA29F1E1313C22AA260E229837A13968B615A7F201974B79B96E77CB. Instalaciones finales sólo exceptúan por proceso ese paquete exacto; Next ya pasó el control de antigüedad sin excepciones adicionales.

```powershell
$taskPnpm = Join-Path $env:TEMP 'smartretail-task006a/manager/package/bin/pnpm.mjs'
node $taskPnpm --version
node $taskPnpm install --frozen-lockfile --ignore-scripts --config.minimum-release-age-exclude=prettier@3.9.9
node $taskPnpm install --frozen-lockfile --ignore-scripts --config.minimum-release-age-exclude=prettier@3.9.9
# Sólo para la sesión validada, después de la instalación explícita:
$env:pnpm_config_verify_deps_before_run = 'false'
$env:NEXT_TELEMETRY_DISABLED = '1'
node $taskPnpm run format:check
node $taskPnpm --filter @smartretail/mobile run lint
node $taskPnpm run typecheck
node $taskPnpm run audit:deps
node $taskPnpm run check # Esperado actualmente: 2 por lint web bloqueado.
```

Si TEMP se limpia, volver a obtener/verificar gestor exacto; no sustituir por latest. Estas variables no se persistieron: evitan reinstalación automática de scripts que pierde flags temporales y telemetría Next sólo de esta sesión. La desactivación de reinstalación no omite la comprobación explícita de integridad, peers, frozen o auditoría.

### Gitleaks oficial y excepciones acotadas

[Gitleaks release8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), ZIP Windows x64 contrastado con checksums.txt oficial: SHA256 **D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E**; binario version8.30.1 ejecutado. No paquete npm homónimo. Distribución/checksums/reportes guardados en TEMP/smartretail-task006a. Para reprovisionar descargar assets de esa release, comparar SHA256 y sólo entonces extraer/ejecutar.

Escaneo `dir` sobre raíz real, con archivos no seguidos/ignorados por Git incluidos según reglas del scanner; no copia limitada a git ls-files. Historial no aporta evidencia porque hay0commits. Primera ejecución default:6 detecciones de claves **reales generadas por Next** en4artefactos locales, no credenciales de servicios encontradas en fuentes. No se imprimieron valores. Son sensibles si se distribuyen artefactos internos; no se califican como falsos secretos.

Por ese resultado se creó .gitleaks.toml extendiendo defaults, con sólo dos allowlists específicas: generic-api-key AND rutas exactas AND nombre del campo en el match (no línea completa). Excepciones: `.next/cache/.rscinfo` y `.next/server/server-reference-manifest.json`, campos encryption.key/encryptionKey; `.next/cache/.previewinfo` y `.next/prerender-manifest.json`, campos previewModeSigningKey/previewModeEncryptionKey. No se excluye .next completo, .env, claves privadas, fuentes ni bundles. Defaults upstream contienen exclusiones de dependencias/lockfiles y ciertos binarios: el escaneo no es exhaustivo ni certifica seguridad. No se añadió .gitleaksignore ni baseline para suprimir hallazgos. --ignore-gitleaks-allow impide supresión mediante comentarios.

```powershell
$taskGitleaks = Join-Path $env:TEMP 'smartretail-task006a/gitleaks/gitleaks.exe'
& $taskGitleaks version
& $taskGitleaks dir . --config .gitleaks.toml --redact=100 --ignore-gitleaks-allow --no-banner
```

Auditoría de dependencias actual1MODERATE UUID conocido;0LOW/HIGH/CRITICAL. Audit bruto termina1; audit:deps umbralhigh termina0 mostrando MODERATE, sin hardcodear conteo ni ocultar fallo de servicio. Cadena y límites §11 siguen vigentes. No se autorizaron hooks de instalación (ignore-scripts). Estado completo de ejecución y pruebas negativas en PROJECT_STATE.

## 13. TASK-006A.1 — lint web soportado — 2026-09-23

Se reprodujo antes de editar el fallo web: ESLint9.39.5, exit2, error explícito del throw de eslint.config.mjs. No fue un warning observado del parser: la configuración anterior impedía cargarlo. La familia typescript-eslint/parser8.70.1 instalada para móvil y candidata para web declara TS>=4.8.4<6.1.0; TS7.0.2 queda fuera. Se volvieron a consultar [metadata del parser](https://registry.npmjs.org/@typescript-eslint/parser/8.70.1), [soporte oficial](https://typescript-eslint.io/users/dependency-versions/) y [configuración Next](https://nextjs.org/docs/app/api-reference/config/eslint).

Ensayo reversible con copias previas de manifiesto/config web, lock, workspace, manifiestos raíz/móvil y tsconfig en TEMP/smartretail-task006a1: TS6.0.3 exacto, eslint-config-next16.3.6 y eslint-config-prettier10.1.8. Los tres comandos web lint/typecheck/build terminaron0, sin advertencia de TS no soportado. Tras esa evidencia se adoptó el candidato. No se cambian Next16.3.6, React19.3.0, Node24.13.1, ESLint9.39.5 ni los controles TS estrictos. skipLibCheck continúa false. No se necesitó probar otras versiones TS: la condición de fallo del candidato TS6 no ocurrió. §9 conserva el antecedente TS5.9.3/URLPattern, pero no demuestra que TS7 fuera la única solución; TS6 ahora pasa con los mismos tipos Node/React.

Flat config web funcional: recommended core-web-vitals y typescript de Next, config-prettier al final y exclusiones sólo de artefactos/next-env generado. Parser efectivo para TS/TSX: @typescript-eslint/parser8.70.1, resolviendo TypeScript6.0.3. No se configura project/projectService ni se afirma lint tipado; typecheck estricto se ejecuta por separado. Sin supresión de versiones no soportadas, overrides, force, shims o reglas propias desactivadas. max-warnings0 sigue vigente. Prettier ejecutable sigue3.9.9, distinto de config-prettier10.1.8.

Lock generado exclusivamente con pnpm11.27.1, ignore-scripts y excepción CLI exacta de antigüedad prettier@3.9.9 ya documentada; sin cambios persistentes al workspace. Dos frozen0 y hash antes/después1/después2 idéntico2E5D7F235F4CCAE899331E7A02289C3A4C4069877208C0FBEAEF2E5F9C4C5C20. Peers0. Scripts de validación mantienen variables sólo de proceso pnpm_config_verify_deps_before_run=false tras instalación explícita y NEXT_TELEMETRY_DISABLED=1. No cambió ningún script raíz.

Regresiones ejecutadas: web lint/typecheck/build0, móvil lint/typecheck0 y check completo0 hasta audit:deps. Auditoría bruta1 por UUID1MODERATE conocido; info/low/high/critical0. Gitleaks oficial8.30.1 dir con redacción100 y .gitleaks.toml existente devuelve0, sin coincidencias adicionales; conserva límites y excepciones de claves internas Next de §12. No se interpreta como ausencia universal de secretos. Advertencias de instalación deprecadas ESLint9/UUID7 son conocidas, no se ocultaron ni se confunden con incompatibilidad TypeScript.

Negativa ESLint repetida sin tocar UI: const no utilizada añadida temporalmente al propio eslint.config.mjs. Regla @typescript-eslint/no-unused-vars emite warning; max-warnings0 provoca exit1. Restauración byte por byte en finally con SHA256 idéntico1390208D454193B3174DA9409F4F8E28A59568EBC92D6A53FF1A325825918D40 y lint posterior0. Las otras negativas de TASK-006A siguen vigentes porque scripts/formato/typecheck no cambiaron.

Runtime producción local sobre loopback: /200, /api/v1/health200 y ruta inexistente404. Servidor de regresión cerrado con Ctrl+C, puerto liberado comprobado. Después se arrancó una nueva sesión oculta de Next start en127.0.0.1:3000 para atender la petición expresa del usuario de dejar la web levantada. No despliegue ni exposición en interfaces externas. PID/logs en TEMP/smartretail-task006a1; no hay autenticación, cuentas ni credenciales: sólo página inicial y health. No se implementa login en esta tarea.

La primera carga de lint tardó más que las siguientes; no se demostró causa ni se alteraron controles para acelerarla. NativeCommandError en logs PowerShell provino de redirigir stderr del gestor (líneas de comandos); los códigos reales del proceso registrados en la sesión fueron0. Evidencias: candidate-lint/typecheck/build.log, negative-lint.json, audit.json, gitleaks.json, frozen-hashes.txt y salidas de herramientas. No se repiten exports nativos ni Doctor al permanecer móvil intacto. Revisiones y cierre en PROJECT_STATE.

Cierre 2026-09-24: QA y SECURITY independientes completados sin nuevos hallazgos; se adopta TS6.0.3 y configuración Next soportada. TASK-006A.1 y TASK-006A COMPLETADAS. Alcance de cada revisión y riesgo residual en PROJECT_STATE.

## 14. TASK-006B — Vitest y primera suite Node — 2026-09-24

Se comprobó la línea base antes de modificar el proyecto: Node 24.13.1, pnpm 11.27.1, TS web/móvil 6.0.3, main sin commits ni remotos, check completo 0. Auditoría inicial: LOW 0, MODERATE 1 (UUID conocido), HIGH 0, CRITICAL 0. Se conservaron los cambios e índice de tareas anteriores y el servidor local existente; esta suite no usa HTTP ni requiere ese servidor.

Se seleccionó **Vitest 5.0.1** tras enumerar versiones estables del registro oficial, sin instalar tags ni prereleases. [Metadata exacta](https://registry.npmjs.org/vitest/5.0.1): Node ^22.12.0 || ^24.0.0 || >=26.0.0; nuestra versión está incluida. Vitest no declara un peer TypeScript específico: la compatibilidad TS 6.0.3 se comprobó ejecutando el test y el typecheck web estricto que incluye route.test.ts. No se equipara transformación TypeScript con comprobación de tipos. [Guía oficial](https://vitest.dev/guide/) y [configuración](https://vitest.dev/config/).

Única dependencia directa nueva: vitest 5.0.1 en devDependencies raíz. Requiere peer Vite ^6.4.0 || ^7.0.0 || ^8.0.0; pnpm lo resolvió automáticamente a **8.3.0**, congelado en lock, sin añadir Vite directo. [Vite 8.3.0](https://registry.npmjs.org/vite/8.3.0) acepta Node ^20.19.0 || >=22.12.0. Peers check 0; @types/node resuelto 24.13.6. Instalación con ignore-scripts, sin force ni conflictos ignorados; en esta tarea no se necesitó excepción de antigüedad ni cambio del workspace. Advertencias conocidas de deprecación ESLint9/UUID7 se conservan.

Configuración raíz vitest.config.mts: extensión ESM explícita, defineConfig de vitest/config, entorno node y globals false. Incluye apps/**/*.{test,spec}.ts y packages/**/*.{test,spec}.ts (no crea packages). Hereda exclusiones de Vitest y excluye node_modules, .next, dist, .expo, build, out, coverage, .vitest y generated en cualquier nivel. Sin watch en test, cobertura, DOM simulado, E2E, snapshots ni configuración de UI nativa. No se instalaron frameworks de navegador/dispositivo ni proveedores de cobertura.

Test cercano al handler: apps/web/app/api/v1/health/route.test.ts, una suite/un caso. Importa GET de ./route y lo ejecuta sin mocks ni copia de implementación. Verifica Response.status 200, content-type application/json, parseo válido mediante response.json() y cuerpo unknown comparado con toStrictEqual({ status: 'ok' }). La igualdad estricta rechaza campos adicionales; un JSON inválido rechaza la promesa y falla el caso. No hay any ni supresiones TS. El typecheck web existente incluye el test sin cambios de tsconfig; configuración raíz cargada por Vitest, sin afirmar que pertenezca al programa TS web.

Scripts raíz: test = vitest run; check conserva formato → lint → typecheck, añade test y termina con audit:deps. format:check añade vitest.config.mts; test TS ya cae en su glob de apps. No se modifican configuraciones ESLint/Prettier, el handler, UI ni móvil. No se añade watch al no necesitarse para esta primera suite.

Aislamiento comprobado mediante vitest list: repositorio real, un archivo/un caso y ninguna suite inesperada. Además se construyó sólo en TEMP una raíz de descubrimiento con diez archivos *.test.ts: uno bajo apps/web/source y nueve bajo los directorios excluidos, incluido dist/android móvil. Usando el mismo config real con --root temporal, list --filesOnly devuelve sólo el archivo legítimo. Es una prueba de descubrimiento; los fixtures vacíos no se ejecutaron ni cuentan como pruebas del producto. No se alteraron artefactos de la aplicación.

Negativa controlada: expectativa status 200 → 503, test termina 1 mostrando recibido 200/esperado 503. Restauración de bytes en finally, hash antes/después idéntico **B4FB37B15AD8DF420FBFE2EEE5578EC9E527FD2867063B553514837F016A444A**, test posterior 0. No se cambió el handler ni quedó el test roto. Un intento auxiliar de exportar listado duplicó --json y falló por argumento CLI; se corrigió a una sola opción y se guardaron discovery.json/isolation.json, sin cambio de configuración.

Lock generado sólo por pnpm 11.27.1; hash tras instalación y tras cada una de dos instalaciones frozen idéntico **0541243B17DDAD26EE04E51BD71650B71737B4CB11E72D08B1D474F4ABBFF1A9**, ambas código 0. Auditoría posterior conserva LOW 0 / MODERATE 1 / HIGH 0 / CRITICAL 0. Gitleaks oficial 8.30.1 con config existente y redacción 100 termina 0; límites y excepciones documentados en §12 no cambian.

Reproducción desde raíz con pnpm 11.27.1 disponible: pnpm test; pnpm check; pnpm exec vitest list --json; pnpm audit; pnpm install --frozen-lockfile --ignore-scripts (dos veces). En este equipo sin gestor global se usó node $taskPnpm con ruta TEMP/smartretail-task006a/manager/package/bin/pnpm.mjs y variables sólo de proceso pnpm_config_verify_deps_before_run=false / NEXT_TELEMETRY_DISABLED=1, tras instalación explícita. Auditoría bruta termina 1 por MODERATE; audit:deps termina 0 por umbral HIGH. Scanner separado: gitleaks dir . --config .gitleaks.toml --redact=100 --ignore-gitleaks-allow --no-banner.

Alcance futuro de Vitest: lógica pura, contratos, casos de uso Node e integraciones controladas cuando existan. Esta prueba acredita el handler directo; no verifica enrutamiento HTTP de Next, middleware, navegador, UI nativa ni dispositivos. No hay lógica comercial, Auth, base de datos ni cobertura creada. Resultados y revisiones de esta tarea en PROJECT_STATE.

Cierre TASK-006B: COMPLETADA; QA y SECURITY independientes sin hallazgos pendientes. Se confirma Vitest5.0.1 raíz, test directo de health y test integrado al check. Reproducción, resultados y límites de revisores registrados en PROJECT_STATE.

## 15. TASK-007A — Money, contratos e identificadores — 2026-09-24

Línea base confirmada antes de editar: Node24.13.1, pnpm11.27.1, main sin commits/remotos, tres proyectos, check0 y audit1 por UUID1MODERATE (LOW/HIGH/CRITICAL0). packages/domain y packages/contracts no existían. Se guardaron hashes y manifiesto/lock previos en TEMP/smartretail-task007a; los cambios de tareas anteriores e índice Git se preservaron.

Se crean dos paquetes privados internos, con exports únicamente '.' → src/index.ts y types apuntando al mismo archivo. Se distribuyen fuentes TypeScript para herramientas del monorepo que las procesan; no se afirma soporte de carga directa por cualquier runtime ni se añade build. Domain tiene cero dependencias runtime; contracts sólo Zod. No se conectan aplicaciones, capas futuras ni base de datos a estas primitivas.

**Money:** tipo readonly { currency: 'MXN'; minorUnits: bigint }, construido mediante money(bigint) con validación runtime de typeof y Object.freeze. Sólo campos primitivos, por lo que el freeze evita cambiar todo el valor. 100n equivale a un peso; no hay number, floats ni conversión de strings en importes. Se admiten negativos para ajustes futuros, sin establecer política de precios. addMoney/subtractMoney validan operandos, operan exclusivamente con bigint y devuelven otro valor congelado; compareMoney devuelve -1/0/1 (indicadores, no importes); isZeroMoney compara con0n. Guardas runtime rechazan moneda distinta o minorUnits no bigint incluso desde JS. Sin clase, límites comerciales, redondeo, multiplicación, división ni serialización JSON. El helper de validación no se exporta. Las operaciones son puras y no hay estado compartido, persistencia ni reintentos que requieran pruebas transaccionales/concurrentes en esta tarea.

**Zod 4.6.5**: máximo parche estable4.6 encontrado al consultar metadata, fijado exactamente sólo en dependencies de contracts. [Registro exacto](https://registry.npmjs.org/zod/4.6.5) sin dependencias externas/peers; [documentación oficial](https://zod.dev/) indica TypeScript5.5 o posterior y strict requerido. TS6.0.3 verificado con typecheck real sin saltar declaraciones. [API oficial](https://zod.dev/api) respalda strictObject, uuid y refine con abort. Sin prereleases, tags, force ni overrides.

**Contrato Money:** MoneySchema = z.strictObject({currency:z.literal('MXN'),minorUnits:...}); MoneyDto se deriva con z.infer. String obligatorio, sin coerce/trim/transform ni BigInt conversion. Canonical: cero o entero ASCII con primer dígito1–9, signo '-' opcional sólo para no cero. Rechaza +1, -0, ceros iniciales, decimales, exponentes, whitespace y dígitos Unicode; la aserción de fin absoluto rechaza también saltos de línea finales que '$' de JavaScript podría permitir. Campos JSON extra rechazados, incluido __proto__ proveniente de JSON.parse. No se serializa Money de dominio ni se crea conversor entre paquetes.

Límite técnico de **128 caracteres incluyendo el signo**: hasta128dígitos positivos o127negativos, una representación muy superior a necesidades iniciales sin inventar máximo comercial. Una refine consulta string.length y aborta antes de regex si supera128; sólo strings cortos pasan a la validación canónica, y nunca se construye bigint aquí. Inputs válidos son ASCII; la medición UTF-16 coincide con su número de caracteres. Tests cubren bordes128/129 de ambos signos y un millón de dígitos/caracteres inválidos; el caso inválido largo produce únicamente el error de longitud, acreditando la interrupción. No se pretende evitar la memoria ya asignada al string ni sustituir futuros límites de tamaño HTTP/JSON. El dominio no adopta este límite de transporte.

**UUID:** UuidSchema = z.uuid(), validación nativa sin regex propia, sin coerción, normalización ni restricción de versión específica añadida. Pruebas v4/v7 y mayúsculas, variante inválida, truncado, vacío y tipos erróneos. No representa membresía, autorización ni pertenencia empresarial; no hay identificadores de entidades aún.

**TypeScript y lint:** ambos paquetes fijan TS6.0.3 en desarrollo, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes, skipLibCheck:false, noEmit, moduleResolution Bundler, types[]. Fuente domain sólo lib ES2022: no tipos Node/DOM. Declaraciones Vitest/Vite/tinybench fallaron inicialmente por EventTarget/AbortSignal/WebSocket/DOMHighResTimeStamp; se separó tsconfig.tests.json con DOM sólo para los tests de domain. Zod4.6.5, schemas.d.cts, también declara URL: contracts necesita lib ES2022+DOM para verificar esas declaraciones sin shims ni skipLibCheck. Es disponibilidad de tipos, no dependencia runtime del navegador. Cada typecheck comprueba fuentes y tests por separado. Se corrigieron tablas it.each heterogéneas usando entradas unknown envueltas en objetos: evita errores de overload y que [] se interprete como una fila sin argumentos en lugar del input real.

Se reutiliza el stack ESLint existente declarándolo compartido en devDependencies raíz: eslint9.39.5, @eslint/js9.39.5, typescript-eslint8.70.1 y eslint-config-prettier10.1.8, ya presentes en el grafo. No herramienta nueva sólo para fronteras. Cada paquete tiene flat config recomendada JS/TS más Prettier. En src, no-restricted-imports permite sólo './' internos sin segmentos '..' para domain; contracts añade únicamente 'zod'. También se rechazan import() y require directo. Probes vía stdin comprobaron rechazos reales (exit1) de imports cruzados, relativos fuera de src, Next/Expo/Node y Zod desde domain. Inspección de fuentes confirma el desacoplamiento actual. Son controles de arquitectura sobre código revisado, no un sandbox frente a JavaScript deliberadamente hostil.

Scripts reales por paquete: lint, typecheck y test (Vitest5.0.1 compartido, root ../.. y filtro de ruta del paquete). Raíz amplía lint/typecheck a ambos paquetes y format:check a packages/**/*.{ts,mts,mjs,json}; conserva apps y todos los gates. Vitest existente ya descubre packages, por lo que no se modificó su config ni duplicó runner. Tests a través de src/index; health continúa intacto. No se tocaron apps, configuraciones existentes ESLint/Prettier ni Gitleaks.

Pruebas finales iniciales: domain22, contratos Money49/UUID14, health1, total86 en4archivos; individuales, test raíz y check completo0. Negativa reversible adicional: una expectativa temporal incorrecta de que {currency:'MXN',minorUnits:100} sería aceptado falló con recibido false, exit1. Restauración exacta del test Money contratos, hash0038A45168C22D7B238D07BABE57ED8FEA9291EEFA067AF68A9B4E42FF28B7FF antes/después, contratos63/63 de nuevo0. Los casos permanentes esperan correctamente el rechazo. No se dejó probe ni supresión.

Auditoría después de instalar:827entradas frente826; LOW0/MODERATE1/HIGH0/CRITICAL0, sin nuevo advisory. El residual UUID y deprecación ESLint9 siguen documentados. Peers0. Dos frozen ignore-scripts con pnpm11.27.1:0, tres hashes232CA42D3588CD8F5112F560FEFDD6D3D9FDDE65C25E01A7826CC8DFB86BF135 idénticos. Gitleaks oficial8.30.1 dir/config existente/redact100:0, sin detecciones adicionales; no se alteraron excepciones. Gestor y variables de proceso de validación según §14; ninguna política global cambiada. No se editaron locks a mano ni ejecutaron hooks de instalación.

Alcance y límites: estas primitivas no implementan precios, Quantity, productos, movimientos, ventas, impuestos, descuentos, autenticación ni persistencia. Una capa superior futura hará la conversión DTO↔Money y validará reglas comerciales. Resultados independientes QA/SECURITY, posibles correcciones y estado final constan en PROJECT_STATE.

Límite observado por SECURITY: strictObject valida el contrato JSON; Zod puede aceptar propiedades heredadas e ignorar propiedades no enumerables de objetos JavaScript arbitrarios. Esas formas no las produce JSON.parse. No se presenta el schema como sanitizador de objetos hostiles con getters/proxies; futuras fronteras recibirán datos JSON y aplicarán límites de transporte antes del parsing.

Cierre TASK-007A: COMPLETADA. QA y SECURITY independientes concluyeron sin hallazgos pendientes; las validaciones finales y atribuciones de cada revisor constan en PROJECT_STATE. Quedan las limitaciones documentadas y el riesgo residual UUID, sin bloqueo nuevo.

## 16. TASK-007B: Quantity exacta y unidades

Quantity representa milésimas mediante bigint: 1000n equivale a una unidad y 1n a 0.001 de esa unidad. El objeto readonly se congela en runtime. UnitCode es una unión cerrada de piece, kg, g, l, ml, m y cm; el constructor también rechaza unidades inválidas y valores que no sean bigint en runtime. No se interpretan strings externos ni números. Se permiten negativos y fracciones de piece: las restricciones comerciales corresponden a entidades futuras.

API pública: quantity, addQuantity, subtractQuantity, compareQuantity (-1/0/1), isZeroQuantity, tipos Quantity/UnitCode e IncompatibleQuantityUnitError. Suma, resta y comparación exigen exactamente la misma unidad, incluso para ceros; arrojan el error explícito en caso contrario. No hay conversiones kg/g, redondeo, multiplicación ni división. Las operaciones conservan los operandos y la exactitud más allá del rango seguro de number. Domain mantiene cero dependencias runtime externas.

Contracts expone UnitCodeSchema/UnitCodeDto y QuantitySchema/QuantityDto, sin importar domain. Ejemplo serializable: {"unit":"kg","milliUnits":"1250"}. El schema estricto rechaza claves adicionales, unidades desconocidas y valores no string. Se extrajo únicamente la regla interna canonicalIntegerString utilizada por Money y Quantity; no se exporta por el índice público ni cambia la API o validación de Money. Las listas de unidades son independientes en ambos paquetes para preservar su desacoplamiento, verificadas por tests de los siete valores.

El límite técnico es 128 caracteres incluyendo signo. La comprobación de longitud aborta antes del regex; no se convierte a bigint en contracts. La representación canónica admite cero o enteros con signo negativo opcional, rechaza -0, ceros iniciales, signos positivos, espacios, decimales, exponentes y saltos de línea. El límite no es una regla comercial ni impide asignar previamente un string enorme: futuras fronteras HTTP necesitarán límites de transporte. Se conserva la limitación de objetos JavaScript arbitrarios descrita en §15; estos contratos validan datos JSON, no getters/proxies hostiles.

Sin nuevas dependencias, instalaciones, cambios de manifiestos/configuración ni lockfile. Se mantiene Zod4.6.5 y Vitest5.0.1 existentes. Sin productos, inventario, ventas, persistencia, autenticación, UI o conversiones DTO/dominio. Validaciones, revisión independiente y estado de cierre en PROJECT_STATE.

## 17. TASK-007C: Product core

Product es una entidad pura readonly congelada con id, name, sku, barcode opcional, unit, purchaseCost, salePrice y status. createProduct recibe CreateProductInput (la misma forma tipada), revalida las primitivas y crea copias congeladas de ambos Money: cambios posteriores en un input estructural mutable no alteran el producto. No reutiliza referencias a precios del llamador. No implementa edición, generación de UUID, timestamps, tenancy, cantidades, stock, categorías, imágenes, proveedores, impuestos, promociones, ventas, API o persistencia.

ProductId, ProductName, Sku y Barcode son strings nominales con marcas unique symbol privadas y factories explícitas. Las marcas se asignan únicamente tras validación runtime. Un único InvalidProductFieldError pequeño, derivado de TypeError, identifica el campo sin interpolar el valor rechazado; el guard existente de UnitCode conserva su TypeError. La creación revalida los campos incluso cuando un llamador JavaScript ignora los tipos.

ProductId: forma UUID de36caracteres, versiones1–8 con variante RFC, Nil y Max según el contrato UUID existente. Conserva el caso de UUID versionados; Max se acepta en minúsculas, igual que UuidSchema/Zod instalado. No normaliza, genera ni demuestra existencia del identificador. La regex del dominio usa segmentos de tamaño fijo; contracts reutiliza UuidSchema después de un guard exacto de longitud que también rechaza whitespace final. Referencias de formato: [RFC9562](https://www.rfc-editor.org/rfc/rfc9562.html) y [UUID de Zod](https://zod.dev/api#uuids). No se incorpora una dependencia UUID.

Nombre:1–120puntos de código Unicode, no grafemas ni unidades UTF-16. Se comprueba primero tamaño UTF-16≤240 para acotar trabajo y asignaciones al contar puntos. Se conservan acentos, ideogramas, emoji y marcas combinantes, sin trim de salida, cambio de caso, normalización NFC ni colapso de espacios internos. Se rechazan bordes whitespace, Cc (controles), Cs (surrogates aislados), separadores de línea/párrafo, y Cf excepto ZWNJ/ZWJ para escrituras y emoji compuestos. Se exige algún punto distinto de formato/marca/separador para evitar nombres enteramente invisibles; no es un detector de confusables ni un sanitizador HTML. El límite cuenta marcas combinantes y joiners por separado. Las mismas reglas explícitas existen en ambos paquetes, sin importarse mutuamente.

SKU:1–64ASCII, A–Z/0–9 y separadores ._- internos; primer y último carácter alfanumérico. Un solo carácter alfanumérico es válido; separadores internos repetidos son válidos. Barcode:1–128ASCII visible U+0021–U+007E, sin espacios/controles, genérico sin checksum ni inferencia GTIN. Los dígitos y ceros iniciales permanecen strings. Los valores literales constructor/__proto__ son barcode válido: no son claves ni acceso a objetos. El framing Enter/Tab se rechaza; corresponde al dispositivo retirarlo explícitamente en una tarea futura. No se convierte number a string ni se normalizan SKU/barcode.

Ausencia de barcode representa producto sin código. Si está presente, debe ser válido; null, undefined explícito, vacío y whitespace se rechazan. Contracts usa BarcodeSchema.exactOptional(), disponible en Zod4.6.5, con inferencia barcode?:string compatible con exactOptionalPropertyTypes; validado mediante tests runtime y de tipos. No se elimina ni transforma una propiedad inválida para aceptarla. [Documentación oficial Zod](https://zod.dev/api) y código/tests de la versión instalada consultados.

Status cerrado active/inactive; ambos válidos. purchaseCost y salePrice deben ser Money/MXN con bigint≥0; cero y venta inferior al costo permitidos. Money aislado conserva negativos. ProductSchema aplica la regla contextual sobre MoneySchema existente: el string canónico válido no puede comenzar con signo negativo. No convierte a bigint ni number. El límite técnico128 de Money sigue activo; no se inventa máximo comercial. ProductSchema es strict, también sus Money anidados; reutiliza UnitCodeSchema. ProductDto se deriva del schema. Helpers de precios y marcas no se exportan por los índices públicos.

Formato y precio contextual pertenecen a dominio/contratos; unicidad de SKU/barcode por empresa requiere application y restricciones reales de persistencia futuras. Crear dos productos con el mismo SKU es permitido aquí, sin registro global ficticio. Tampoco se verifica existencia de ProductId, membresía, permisos ni aislamiento: no hay servicio ni base de datos. Futuras fronteras deberán acotar payload antes de JSON.parse, autorizar y escapar salidas. Se mantienen límites sobre objetos JS arbitrarios/getters/proxies documentados en §15; los schemas no certifican objetos hostiles fuera del transporte JSON.

Sin dependencias nuevas, cambios de manifiestos, configuraciones o lockfile. Sólo dos archivos fuente nuevos por paquete agrupan campos y entidad, más sus tests e índices públicos. Apps y primitivas previas intactas. QA/SECURITY y evidencia de validación en PROJECT_STATE.
## 18. TASK-007D: edición pura de Product

Se agregan nueve funciones explícitas: renameProduct, changeProductSku, changeProductBarcode, removeProductBarcode, changeProductUnit, changePurchaseCost, changeSalePrice, activateProduct y deactivateProduct. No existe patch genérico ni comando que cambie ProductId. Contracts permanece intacto; ProductSchema ya describe el estado final, y no se crean schemas de comandos sin application/API.

Cada función valida primero el Product completo mediante createProduct y luego construye el resultado mediante esa misma factory. Así no se puede ocultar un campo original inválido sustituyéndolo por uno válido. Los nuevos strings reutilizan productName/sku/barcode; unidad, estado y precios reutilizan las invariantes de createProduct, incluido Money/MXN/bigint≥0. No se duplica ningún regex ni error. El valor de identidad y los campos ajenos al comando se conservan; los precios se preservan por valor, no por identidad referencial de los objetos Money.

Política uniforme elegida entre las alternativas permitidas: **siempre devolver un Product nuevo**, incluso si activate/deactivate repiten el estado o remove encuentra barcode ya ausente. Es idempotencia por valor, no por referencia. Se prioriza la garantía explícita de resultado nuevo/inmutable y el soporte seguro de inputs estructuralmente válidos pero mutables recibidos desde JavaScript. La preferencia de devolver la misma referencia no se adopta: podría devolver un input mutable ajeno a la factory. Las pruebas fijan esta decisión. La creación/congelación acotada de Product y sus dos Money conserva la estrategia existente; no hay deep-freeze recursivo, biblioteca adicional ni caché de objetos.

removeProductBarcode construye la forma sin propiedad barcode; no deja undefined ni null. Coste/precio cero y venta por debajo del coste siguen permitidos; cambiar uno no cambia el otro, calcula margen, descuentos o impuestos. changeProductUnit modifica sólo la configuración, sin convertir precios, Quantity ni históricos. Cuando exista inventario, cambiar unidad con movimientos previos requerirá reglas adicionales de application/persistencia. La unicidad por empresa de SKU/barcode continúa pendiente de esas capas, sin falso índice en memoria.

Protección runtime: rechaza null/undefined, tipos erróneos, Product incompleto, campos falsificados, precios negativos y unidades inválidas antes de aplicar la edición. Acepta objetos estructuralmente válidos y produce copias congeladas independientes, incluso en operaciones repetidas. No es una frontera contra getters/proxies con efectos laterales ni valida procedencia/autorización de un objeto; se conserva el límite de dominio documentado en §17. Extra keys ajenas al modelo no se trasladan al resultado porque la factory reconstruye su forma explícita. Ninguna función muta ni congela el objeto de entrada.

Sin eventos, historial, timestamps, inventario, tenancy, repositorios, persistencia, API, UI o dependencias nuevas. Evidencia, revisión independiente y estado en PROJECT_STATE.
## 19. TASK-008A: InventoryLocation y StockBalance estructurales

InventoryLocation es readonly/congelada con id, code, name y status active/inactive. No contiene sucursal, empresa, dirección, almacén padre, stock o timestamps. createInventoryLocation revalida cada campo y reconstruye la forma explícita sin mutar el input. No comprueba unicidad ni crea operaciones de edición de ubicaciones.

InventoryLocationId, Code y Name son strings nominales independientes. El ID reutiliza la validación UUID existente mediante productId, pero obtiene su propia marca; ProductId e InventoryLocationId no son intercambiables en TypeScript. Se preserva la política UUID actual:36caracteres, versiones1–8/variante RFC, Nil/Max, sin generación o normalización. Code admite1–32ASCII A–Z/0–9/-/_, extremos alfanuméricos; rechaza puntos, minúsculas, espacios, Unicode y controles. La unicidad del código corresponde a persistencia futura.

Name admite1–100puntos de código Unicode. Primero se acota tamaño UTF-16≤200, luego se cuenta el máximo100 y se reutiliza productName para visibilidad/controles/bordes whitespace sin duplicar su política Unicode. Se permiten acentos, emoji, marcas y joiners legítimos según §17; no se cambia case, normaliza NFC o colapsan espacios internos. Los errores de dominio de los campos de ubicación usan TypeError contextual sin incluir inputs. Las aserciones de marca sólo se realizan después de validación.

StockBalance es readonly/congelado con productId, locationId y quantity. La factory stockBalance revalida ambos IDs y construye una copia congelada mediante quantity(unit,milliUnits); reutiliza bigint, milésimas y UnitCode existentes, sin copiar regex ni convertir units/numbers/strings. Inputs Quantity estructurales mutables válidos se copian, nunca se congelan o modifican los objetos originales. El saldo sólo representa estado: no hay setStock/increaseStock/decreaseStock/adjustStock/replaceBalance ni otra API de mutación directa.

Cero es un saldo válido, no elimina el objeto ni significa ausencia de una futura fila. Se admiten negativos para representar datos inconsistentes/reconciliaciones sin ocultarlos. La política operativa inicial será impedir generar stock negativo mediante movimientos normales, pero queda expresamente pendiente de TASK-008B. No hay movimientos, reservas, entradas/salidas, transferencias, ajustes, ventas/compras, conteos, eventos o historial implementados aquí.

StockBalance aislado no conoce Product completo: no puede comprobar Product.unit frente a quantity.unit. Esa coherencia, existencia real de ambos IDs, pertenencia empresarial y autorizaciones serán responsabilidad de application/persistencia cuando dispongan de las entidades. No se inventan restricciones ni conversiones en esta factory.

Contracts expone InventoryLocationIdSchema/CodeSchema/NameSchema/StatusSchema/Schema y DTO derivado. ID reutiliza ProductIdSchema (sin marcas en transporte); Name compone el límite100 con ProductNameSchema; Code tiene su único patrón específico. StockBalanceSchema estricto reutiliza ProductIdSchema, InventoryLocationIdSchema y QuantitySchema; StockBalanceDto deriva del schema y transporta milliUnits string canónico. Todos los objetos JSON rechazan claves extra, incluida Quantity anidada, sin coerción. El límite técnico128 de milliUnits permanece heredado; no se convierte a bigint en contratos.

Guardas de longitud previas a conteos/regex limitan el procesamiento posterior del string, no el coste de recibir/asignar payloads gigantes. Getters/proxies y propiedades heredadas/no enumerables de objetos JS arbitrarios conservan el límite documentado en §15–17. La validación no prueba identidad/autorización ni certifica seguridad global. Sin paquetes nuevos, persistencia, API, tenancy o cambios de apps; evidencia y revisiones en PROJECT_STATE.
## 20. TASK-008B: movimientos y aplicación operativa

InventoryMovement es una unión discriminada exactamente por type:receipt/issue/adjustment. InventoryMovementId es UUID nominal distinto de ProductId/InventoryLocationId, validado con la estrategia existente sin generar IDs. Cada movimiento contiene id, productId, locationId y el payload de su variante. createInventoryReceipt/createInventoryIssue/createInventoryAdjustment reciben la forma tipada completa, incluido type, y revalidan tipos, IDs, discriminador y payload en runtime. Reconstruyen objetos congelados con copias Quantity independientes; no conservan referencias mutables del llamador.

Receipt exige Quantity>0 y suma; issue exige Quantity>0 y resta, nunca representa una salida con signo negativo. Adjustment exige delta firmado distinto de cero y reason nominal obligatorio de1–200puntos de código Unicode. Reason aplica la misma política visible de §17 con límite propio: guard UTF-16≤400 previo al conteo/regex, sin bordes whitespace/controles/formatos invisibles no permitidos, preservando Unicode y joiners legítimos. No interpreta texto ni normaliza. No hay enum de razones. Los errores de movimiento son deterministas y no interpolan inputs.

applyInventoryMovement reconstruye/valida StockBalance, rechaza saldo inicial negativo con InvalidOperationalStockBalanceError, revalida el movimiento por su factory y exige coincidencia exacta de productId/locationId (InventoryMovementTargetMismatchError). Usa addQuantity/subtractQuantity existentes para aritmética bigint y coincidencia exacta de UnitCode; IncompatibleQuantityUnitError rechaza kg/g, piece/kg, l/ml, m/cm y cualquier otra diferencia sin conversión. Un resultado negativo produce InsufficientStockError; cero es válido. Retorna nuevo StockBalance congelado y no modifica saldo ni movimiento originales.

Los saldos negativos siguen siendo representables estructuralmente por stockBalance; una operación normal no puede procesarlos, ni siquiera una entrada capaz de volverlos positivos. La reparación/reconciliación requerirá un flujo administrativo futuro explícito. Coherencia con Product.unit y existencia real/empresa/permiso de los IDs sigue siendo responsabilidad de application/persistencia, ausentes aquí.

**Límite de idempotencia:** InventoryMovementId permite identificar una solicitud, pero applyInventoryMovement no deduplica ni garantiza exactly-once. Aplicar el mismo receipt+1 dos veces sobre el resultado lleva10→11→12. No hay Set global, caché, memoria, historial ni IDs aplicados dentro de StockBalance. La garantía idempotente/exactly-once requerirá persistencia transaccional con unicidad de movementId y control de concurrencia. Esta tarea no implementa esa garantía, transacciones o un ledger persistente.

Contracts expone InventoryMovementIdSchema, InventoryAdjustmentReasonSchema, schemas strict de cada variante y InventoryMovementSchema mediante z.discriminatedUnion("type",...). Reutiliza ProductIdSchema/InventoryLocationIdSchema/QuantitySchema. Las condiciones contextuales de signo examinan únicamente el string canónico: positivo si no es0 ni empieza con signo negativo; delta si no es0. No se convierte a BigInt ni number. QuantitySchema global conserva cero/negativos y su límite técnico128 previo al regex. Se rechazan campos extra en raíz y Quantity, mezcla de payloads, tipos arbitrarios, controles/Unicode no válido en IDs/cantidades y strings enormes. DTOs derivan de los schemas; helpers no se exportan por los índices públicos.

applyInventoryMovement es la única operación nueva que aplica movimientos al saldo. La factory estructural stockBalance existente se conserva para representar/reconstituir datos; construir objetos JavaScript no es una autorización para escribir stock operativo. Futuras capas deben encapsular persistencia y exigir movimientos. No se crean setStock/increaseStock/decreaseStock/adjustStock/replaceBalance, transferencias o rutas alternativas operativas. No hay timestamps, actor, tenancy, referencias comerciales, eventos o historial. Los objetos JS hostiles con getters/proxies mantienen los límites anteriores; estos modelos no son un sandbox ni acreditan autorización o seguridad global.

Se actualiza únicamente la parte obsoleta de la prueba TASK-008A que exigía ausencia de applyInventoryMovement: ahora su existencia está autorizada y se prueba en esta suite. Se mantienen las prohibiciones de mutadores directos y edición de ubicaciones. Ningún test anterior se elimina; pasan1049casos previos más los nuevos. Sin cambios de apps, configuración, dependencias ni lockfile; resultados independientes y cierre en PROJECT_STATE.
## 21. TASK-008C: transferencias como coordinación pura

InventoryTransfer es una instrucción readonly/congelada con InventoryTransferId nominal, issueMovementId, receiptMovementId, productId, sourceLocationId, destinationLocationId y Quantity positiva. No tiene type/status, actor, timestamps, historial ni metadata de persistencia. Su ID reutiliza la estrategia UUID existente y no se genera internamente. Los IDs de movimiento deben diferir y las ubicaciones deben diferir: para estas dos desigualdades se compara el UUID sin distinción de caso, sin modificar la representación guardada. Así un mismo UUID escrito en mayúsculas/minúsculas no evade el rechazo. La correspondencia con balances conserva la comparación exacta ya existente.

createInventoryTransfer revalida todos los IDs y usa createInventoryIssue para validar/copiar Quantity>0 sin duplicar sus reglas. createInventoryTransferMovements revalida la instrucción y deriva un par congelado de issue en origen y receipt en destino, con los IDs proporcionados, mismo producto y misma cantidad exacta. Reutiliza ambas factories existentes; no añade "transfer" a InventoryMovementType ni modifica los tres tipos de movimiento del ledger futuro.

applyInventoryTransfer deriva ambos movimientos, reconstruye/valida ambos StockBalance y hace preflight de ambas relaciones de producto/ubicación/unidad antes de calcular efectos. El preflight existente de movimientos se extrajo como helper interno compartido, no exportado por src/index; usa compareQuantity para validar igualdad de unidades. Después aplica issue al origen y receipt al destino mediante applyInventoryMovement, que conserva validación de saldo operativo no negativo y stock suficiente. Devuelve un InventoryTransferResult congelado con ambos nuevos saldos. El orden de error es determinista: instrucción y sus relaciones internas, forma de saldos origen/destino, targets/unidades origen/destino y finalmente aplicación operacional origen/destino. No hay conversión, cálculo monetario o número flotante.

Cero inicial en destino y cero final en origen son válidos. Saldos iniciales negativos en cualquiera de los lados se rechazan, aunque el receipt pudiera corregir el destino. Stock insuficiente falla. Si destino falla después de calcular un objeto local para origen, ese objeto no escapa; no se modifican entradas y no se retorna resultado parcial.

**Atomicidad exclusivamente de función pura:** la función devuelve ambos resultados o lanza error. No garantiza transacción SQL, aislamiento, bloqueo, compare-and-swap, rollback durable, exactly-once ni consistencia entre procesos. Futuras application/database deberán aplicar ambos movimientos y saldos dentro de una transacción real. Las garantías actuales se refieren a datos inertes; no constituyen un sandbox para getters/proxies que ejecuten efectos arbitrarios.

**Sin deduplicación:** transferId y los dos movementIds sólo identifican la instrucción y sus movimientos. Aplicar dos veces la misma transferencia2 sobre origen10/destino0 produce8/2 y después6/4 mientras haya saldo. No hay Set/Map/caché global, historial o IDs en StockBalance. La unicidad/idempotencia real depende de persistencia transaccional futura.

InventoryTransferIdSchema reutiliza ProductIdSchema. InventoryTransferSchema es strict, reutiliza InventoryMovementIdSchema, ProductIdSchema, InventoryLocationIdSchema y QuantitySchema; aplica positividad contextual y las dos desigualdades de IDs. DTO derivado y milliUnits string canónico; no coerción ni conversión a BigInt. Quantity conserva su límite128 antes del regex; las comparaciones de signo no requieren parsear enteros. No cambia QuantitySchema global ni InventoryMovementSchema. Errores de relaciones apuntan a receiptMovementId/destinationLocationId.

El único test anterior modificado deja de prohibir createInventoryTransfer/applyInventoryTransfer ahora autorizados; conserva mutadores directos prohibidos. No se elimina ningún caso previo. Sin dependencias nuevas ni cambios de apps/configs/manifiestos/lockfile. No hay workflow persistido, repositorios, SQL, Auth, transfer statuses ni otra TASK. Resultados de revisión y validaciones en PROJECT_STATE.
## 22. TASK-010: PostgreSQL, roles y replay durable

Driver node-postgres pg8.23.0 exacto, comprobado contra metadata npm y documentación oficial compatible con Node24 (https://node-postgres.com/). Transacciones usan un único cliente del pool hasta COMMIT/ROLLBACK, como exige https://node-postgres.com/features/transactions. Sin ORM ni parsers globales: BIGINT viaja como string y se reconstruye bigint; el límite firmado64bits es técnico de almacenamiento, no máximo comercial.

Migración001 se aplica una vez por administrador en DB dedicada; crea owner NOLOGIN/NOBYPASSRLS y rol app NOLOGIN/NOBYPASSRLS para un login separado sin pertenencia al owner. RLS+FORCE cubre seis tablas (https://www.postgresql.org/docs/current/ddl-rowsecurity.html). Cada transacción valida rol seguro y usa set_config parametrizado/local para app.tenant_id; faltante no ve filas, inválido falla. TenantContext sólo admite contexto servidor ya autorizado: UUID válido/contexto configurable no equivalen a autorización y no son una frontera contra un cliente con credenciales SQL de backend.

Las FKs compuestas evitan referencias entre tenants. IDs de ledger/transferencia globalmente únicos; SKU/barcode únicos por tenant (NULL múltiple). App puede insertar ledger pero no actualizarlo/borrarlo ni modificar saldos directamente. Trigger SECURITY DEFINER con search_path fijo, owner sin BYPASSRLS y FORCE activo aplica delta/verifica resultado/no negativo. Función lock_balance limitada al contexto permite FOR UPDATE sin otorgar UPDATE a app. Constraint trigger diferido verifica children/target/unidad/cantidad/resultados de transferencia al commit.

Adapter usa una sola transacción con bloqueos de saldos ordenados por UUID normalizado y filas cero creadas bajo constraints. Application consulta replay antes de validar stock disponible actual; retorna snapshot original de resultado, no saldo actual. Misma identidad/payload normalizado por casing UUID no vuelve a escribir; payload distinto falla. Unicidad protege colisiones concurrentes; errores revierten ledger/metadata/saldos. No se reintenta automáticamente la callback. Capacidades replay opcionales preservan adapters anteriores que sólo rechazan duplicados. Transacción/idempotencia local DB, no exactly-once distribuido ni idempotencia de conteos sin movimiento.

Tests requieren SMARTRETAIL_PG_TEST_CONFIG apuntando a JSON temporal con host loopback/database smartretail_task010/user/password/appUser/appPassword; nunca usan DATABASE_URL de producción. Aplican migración si no existe y limpian fixtures sólo de esa DB desechable. Sin esa variable, suite DB se omite explícitamente; test/check sin DB no prueban SQL/RLS/concurrencia. Puesta en marcha temporal y resultados reales constan en PROJECT_STATE. No se agrega .env.example al no existir una convención requerida.

## 23. TASK-011: membresía y permisos autoritativos en PostgreSQL

AuthenticatedContext transporta userId/tenantId inmutables y UUID validados; no prueba autenticidad de token. UserId representa sub externo, sin email ni dependencia de auth.users. La futura integración autenticada deberá verificar identidad antes de construirlo; tenant solicitado sólo selecciona y no acredita membresía. No se agrega login/SDK/API.

La matriz fija vive en role_permissions global: owner/admin todos los10permisos iniciales, inventory_clerk products.read/locations.read/inventory.read/receive/issue/transfer. tenant_memberships liga user/tenant con rol/status; normal login sólo lee su membresía activa. Sin grants de escritura en membresías/matriz, ni siquiera por members.manage: ese permiso se modela para futuros casos, no habilita bootstrap directo. Fixtures usan administrador de DB.

UoW recibe Permission obligatorio en su contrato y lo verifica en la misma transacción antes del callback; DB establece user y tenant locales y reconsulta PostgreSQL. El método authorize es una consulta reusable puntual, no token/capacidad cacheable; los casos verifican de nuevo. RLS combina una política restrictiva tenant+active-member con políticas permisivas por acción. Helpers SECURITY INVOKER con search_path fijo consultan membresía propia bajo RLS/FORCE, evitando recursión y nuevos privilegios definer. Definers previos de ledger/locking también quedan sujetos a esas políticas. Una conexión backend comprometida que pueda establecer ambos GUC sigue fuera de la garantía criptográfica inexistente; no se afirma protección ante credenciales SQL robadas. La revocación se observa en consultas posteriores con snapshots PostgreSQL, sin prometer invalidación retroactiva de commits ya realizados.

## TASK-015 — Redondeo de ventas por línea

El precio unitario usa centavos MXN bigint y la cantidad milésimas bigint. Para precios no negativos y cantidades positivas, el total de cada línea aplica HALF-UP al centavo: `(precio * cantidad + 500n) / 1000n`. Se redondea cada línea antes de sumar sus totales exactos. Al reagregar el mismo producto se recalcula con la cantidad acumulada y el precio del snapshot original; completar el draft no implica cobro, persistencia ni descuento de stock.
## TASK-016 — Venta durable y recuperación del checkout

SaleId identifica el comando durable y los movimientos conservan UUID estables. Application reconstruye precios/snapshots con Product confiable y compara la cotización; PostgreSQL confirma en una sola transacción venta, líneas, pagos y ledger. Un advisory lock por SaleId serializa reintentos; balances y productos se bloquean en orden determinista. Replay idéntico devuelve snapshots históricos antes de consultar el stock/precio actual; contenido diferente produce conflicto. Constraints diferidos verifican cierre y vínculos, triggers impiden cambios históricos y agregar hijos a una venta ya comprometida. HALF-UP SQL usa div sobre numeric entero para evitar redondeos intermedios.

Sólo owner/admin reciben sales.read/create. Cash/card son registros del método declarado, sin gateway. Cada pago es positivo y su suma debe coincidir exactamente; una venta de total cero, permitida por Product existente, utiliza cero filas de pago. Límites BIGINT de almacenamiento se verifican sin conversión a number.

El POS guarda únicamente el comando pendiente en sessionStorage bajo el subject verificado, antes de enviarlo. Recargar conserva IDs, tenant y desglose de pago; un resultado incierto bloquea edición y se reintenta sin nuevo ID. Recuperación corrupta/no autorizada bloquea y conserva el registro para consultar su estado. Esta recuperación cubre recargas de la misma pestaña; cerrar la pestaña o borrar almacenamiento requiere consultar el recibo mediante SaleId, no constituye una cola durable ni garantía distribuida exactly-once.

## TASK-020 — compras y recepciones — 2026-10-03

Proveedores pertenecen al tenant; las órdenes conservan costos MXN y cantidades exactas por línea. Sólo draft admite reemplazar líneas; ordenar fija snapshots. Se permite cancelar una orden parcialmente recibida conservando todas sus recepciones y ledger. No hay cuentas por pagar ni actualización automática de Product.purchaseCost.
Límites técnicos:1–50 líneas por orden/comando, texto hasta2000 caracteres y payload HTTP16KiB; listados muestran las100 órdenes más recientes. No son máximos comerciales. Money/Quantity reutilizan contratos canónicos existentes sin coerción.
Una recepción combina orden, receipt durable, movimiento InventoryReceipt, saldo y auditoría en una transacción; constraints diferidos impiden commits incompletos. ID idéntico con payload canónico idéntico es replay; payload distinto produce409. El navegador conserva el comando en sessionStorage de la pestaña por usuario verificado antes del POST; fallos inciertos no generan otro ID.

## TASK-021 — cliente opcional de la venta — 2026-10-03

Customer conserva sólo nombre, teléfono/email/notas opcionales y estado; no se añaden identificaciones ni dirección. API de cliente usa schemas estrictos y límites técnicos200/50/254/2000 caracteres; búsquedas literales de hasta200, listado100 y detalle50 ventas recientes. Última compra se obtiene usando el índice tenant/customer/created_at; historial resume pagos y devoluciones sin recalcular la venta.
Sale.customerId es opcional en el draft transportado; ausencia mantiene el payload histórico. Su UUID canónico participa en idempotencia, sin objetos de cliente enviados por navegador. Validación/bloqueo del cliente activo sólo para venta nueva dentro de la transacción existente; replay resuelve antes incluso si después se desactiva.
La FK compuesta impide cross-tenant. sales.customer_name es snapshot mínimo generado por trigger, sin privilegio INSERT del runtime sobre ese campo; conserva el nombre de ticket tras edición/desactivación. Auditoría customer separada, con actor/tenant/acción/fecha/correlación y sin PII de contacto. No hay DELETE runtime.
POS vuelve a Público general al cambiar empresa o confirmar; suspender conserva el contrato anterior de líneas y avisa que al recuperar se debe seleccionar nuevamente el cliente. No se amplía el modelo de ventas suspendidas ni se crea CRM.


## TASK-022: operational reporting

Read-only reporting lives in database/reporting -> application/query -> authenticated API/dashboard; no domain analytics, new dependency or ledger writes. Migration014 adds reports.read for owner/admin only. Queries use restricted runtime, tenant RLS, REPEATABLE READ READ ONLY, parameterized references, and 5s per-statement timeout for aggregations.
Dates are inclusive Mexican calendar dates (America/Mexico_City), converted explicitly from date::timestamp to timestamptz; SQL uses [start,next-day midnight). Presets include today; custom ranges contain 1-366 days (2000-2099). Returns use their own recording date/location, independently of original sale date. Net sales = completed sales minus completed returns; net may be negative. Average ticket rounds gross/count half-up to one minor unit; empty average is zero. Money/quantities remain integer PostgreSQL numeric/bigint and strings, with bigint formatting; SVG ratios only derive integer coordinates.
Location scopes all applicable sections. Product/payment/customer filters select whole sales containing the product/method/customer (including all payments and their returns); product table restricts matching line items. Supplier/product scope whole purchase orders; supplier does not affect sales/cash/inventory, customer/method do not affect purchases/cash/inventory. No allocation of split payments or product margins. Top products are gross quantities/revenue, not return-adjusted.
Purchase orders are counted by creation date/current status; pending means ordered. Ordered/estimated value excludes cancelled orders, includes draft estimates, and uses rounded ordered quantities times saved unit cost. Received value uses receipt date and rounds each receipt line quantity times saved immutable ordered unit cost; reporting convention, not a new payment/payable ledger. Cash shifts use opening date/current state, live expected cash for open shifts and closed snapshots; cash in/out use movement date and include refund cash_out once.
Inventory is current, independent of historical date filters; active products aggregate balances for selected location or all locations, including inactive location balances. Missing balances mean zero. Default explicit low-stock threshold is1000 milli-units (1 product base unit), configurable per report from0 through18 canonical digits: low is0 < stock <= threshold, empty is stock=0. No hidden per-product minimum. Counts cover all matches, alerts100, top products20, selectors100, days366. CSV sales/products applies identical filters, minor/milli integer units and formula neutralization in quoted cells. No additional indexes without plan evidence.
