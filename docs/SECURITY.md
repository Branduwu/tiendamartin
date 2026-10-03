# Modelo inicial de seguridad

Estado: requisitos y controles para futuras implementaciones; no hay controles técnicos implementados ni sistema ejecutable auditado. Consultar los límites en [ARCHITECTURE](ARCHITECTURE.md). [TECH_DECISIONS](TECH_DECISIONS.md) es la fuente principal de la estrategia SQL/RLS (§3), herramientas/gates (§4) y aislamiento de ambientes (§5), propuestas en TASK-002.

## Activos y fronteras de confianza

Proteger identidades, membresías, productos, movimientos, ventas, cobros, cajas, archivos, trazas y secretos. Considerar clientes web/móvil manipulables, usuarios autenticados de otra empresa, empleados con permisos insuficientes y atacantes sin sesión. Fronteras: cliente/API, API/Auth, API/PostgreSQL, Storage y futuros proveedores de pago; también CI y servicios de despliegue.

| Amenaza | Control obligatorio al implementar | Evidencia requerida |
| --- | --- | --- |
| Acceso a otra empresa (IDOR) | Comprobar membresía y permiso en servidor, filtrar recursos por empresa, proteger relaciones y aplicar RLS con mínimo privilegio. | Pruebas cruzadas de lectura/escritura y referencias usando al menos dos empresas. |
| Suplantación o elevación de rol | Verificar token, emisor, audiencia y expiración mediante mecanismo soportado; no usar metadatos editables como autoridad; denegar por defecto. | Tokens inválidos/expirados, membresía revocada y permisos insuficientes rechazados. |
| Doble venta/cobro o carrera de stock | Transacciones, restricciones, control de concurrencia e idempotencia vinculada a empresa/operación, con comparación del contenido repetido. | Reintentos, carrera por última unidad y fallo intermedio sin cambios parciales. |
| Alteración del historial | Movimientos compensatorios y trazas protegidas; impedir edición/borrado de movimientos contabilizados con roles ordinarios. | Pruebas de permisos y reconciliación de saldos derivados. |
| Inyección, XSS y CSRF | Validar esquema, límites y tipos en servidor; consultas parametrizadas, salida segura y defensa CSRF para autenticación por cookies. | Entradas maliciosas y solicitudes de origen no autorizado rechazadas donde aplique. |
| Filtración de secretos/datos | Secretos solo en servidor, redacción de logs y errores; acceso mínimo por ambiente. | Revisión de bundles, logs y configuración sin imprimir valores secretos. |
| Archivos ajenos o maliciosos | Buckets privados por defecto, políticas por empresa, tamaño/tipo y nombres validados, enlaces temporales autorizados. | Accesos cruzados y archivos inválidos rechazados; verificar también borrado/listado. |
| Abuso y cadena de suministro | Límites de solicitudes y payload, dependencias mínimas fijadas con lockfile, revisión de vulnerabilidades y permisos CI. | Pruebas de límites y evaluación de dependencias reales una vez existentes. |
| Webhooks falsos o repetidos | Verificar firma según proveedor, impedir repetición, reconciliar estados e idempotencia. | Firma inválida, evento duplicado/fuera de orden y fallo del proveedor. |
| Pérdida o exposición operativa | Ambientes separados, respaldo, restauración probada, acceso administrativo restringido y trazabilidad. | Ensayo de recuperación y revisión de accesos antes de producción. |

## Base de datos y privilegios

El `tenant_id` o identificador de empresa enviado por un cliente es un selector, nunca una prueba de acceso. El servidor debe comprobar membresía vigente y pertenencia de los objetos, incluidos los relacionados. Diseñar claves/restricciones que impidan referencias entre empresas. RLS debe cubrir tablas expuestas y operaciones permitidas; revisar funciones, vistas y Storage por separado.

Las claves de servicio/secretas pueden eludir RLS; no deben ser el camino habitual de peticiones de usuarios ni llegar al frontend. Esta propiedad está documentada en [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Cualquier tarea administrativa privilegiada necesita autorización, alcance y auditoría explícitos. Una conexión SQL directa no hereda automáticamente la identidad Auth: definir propagación segura, rol efectivo y limpieza del contexto al usar pooling. Revisar `SECURITY DEFINER`, permisos de ejecución y `search_path` si se autorizan funciones de este tipo.

TASK-002 selecciona como propuesta un rol `smartretail_api` no propietario ni BYPASSRLS, RLS con comprobación de membresía/permiso y contexto SQL local a cada transacción. El esquema comercial no se expone a clientes Data API. Se prohíben credenciales de migración en runtime, cambios de rol privilegiados y contexto persistente de sesión. Auth verifica identidad antes de establecer el contexto; membresías no son editables por el rol ordinario. La API debe usar la misma conexión hasta commit/rollback y descartar conexiones de estado incierto.

Los parámetros SQL de contexto no son identidad firmada: un servidor comprometido o su credencial robada puede falsificarlos. RLS es defensa frente a errores de filtrado y ataques desde clientes, no una garantía frente al control total del servidor. El contrato completo y la prueba negativa con dos empresas, commit/rollback y reutilización de pool se definen en TECH_DECISIONS §3; esas pruebas aún no se ejecutaron.

## Pipeline y ambientes

No entregar secretos a código de PR no confiable; separar CI, migración y despliegue. Exigir lockfile congelado, revisión de scripts/dependencias, acciones fijadas y permisos mínimos. Tipos/lint/formato, pruebas críticas, auditoría de dependencias y escaneo de secretos aplicables bloquean integración si fallan o quedan incompletos, según TECH_DECISIONS §4.

Producción mantiene proyectos/credenciales separados de previews. Preview sin backend aislado queda sin persistencia, nunca conecta por fallback a producción. Validar coherencia de hosts/proyecto Auth/buckets por ambiente, además de impedir que código no confiable reciba secretos productivos. Migraciones y despliegues productivos requieren autorización explícita y controles de recuperación; no están habilitados en esta tarea.

## Sesiones, secretos y datos

Definir duración, renovación, cierre/revocación de sesiones y protección del almacenamiento móvil antes de implementar Auth. Usar TLS en ambientes remotos y cookies con atributos adecuados a la estrategia web. CORS no sustituye autorización ni defensa CSRF.

No incluir secretos en variables públicas ni en bundles; Expo documenta que `EXPO_PUBLIC_*` se incorpora al código del cliente en su [guía de variables](https://docs.expo.dev/guides/environment-variables/). Lo público solo puede contener configuración no confidencial. No hay nombres de variables de proyecto existentes en esta auditoría; no se enumeraron valores del entorno del proceso.

No almacenar credenciales de tarjetas ni datos de autenticación del pago. Si se integra un proveedor, definir tokenización, estados y reconciliación; alcance de cumplimiento pendiente. Minimizar datos personales en trazas y definir acceso, retención y eliminación sin destruir historial comercial obligatorio, según requisitos que se determinen.

## Aspectos por verificar

No se puede comprobar aún Auth, RLS, sesiones, vulnerabilidades de dependencias, restauración ni aislamiento en ejecución: no existen código, paquetes o servicios configurados en la carpeta. La ausencia de secretos en los documentos no acredita la seguridad de futuras aplicaciones. Antes de habilitar operaciones comerciales, resolver los controles aplicables y ejecutar pruebas negativas y transaccionales. Las revisiones de esta TASK y sus límites se registran en [PROJECT_STATE](PROJECT_STATE.md).
