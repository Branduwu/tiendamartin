# Arquitectura propuesta

Estado: propuesta para aprobación actualizada en TASK-002; no hay aplicaciones ni infraestructura implementadas. [TECH_DECISIONS](TECH_DECISIONS.md) es la fuente principal de versiones, decisiones técnicas, comparación PostgreSQL/RLS, calidad, ambientes y pendientes. El inventario real está en [PROJECT_STATE](PROJECT_STATE.md).

## Evaluación y límites

El monorepositorio TypeScript con Next.js, Expo/React Native y PostgreSQL en Supabase es una base razonable para compartir contratos y mantener integridad transaccional. Se propone una API HTTP versionada alojada inicialmente en Next.js sobre Vercel, compartida por web y móvil. Evita operar un servicio adicional al inicio, pero acopla despliegues de web/API; trabajos prolongados o integraciones asíncronas podrían exigir un proceso separado. Validar límites, conexiones, regiones y costos antes de elegir planes. Expo EAS se propone para compilar y distribuir móvil.

Compartir contratos y lógica pura, no asumir que la interfaz DOM de Next.js será reutilizable en React Native. Se propone pnpm workspaces sin Turborepo ni microservicios iniciales. La API usa runtime Node y SQL parametrizado mediante node-postgres, sin ORM inicialmente. Versiones documentadas y verificaciones pendientes se registran únicamente en TECH_DECISIONS.

```text
apps/
  web/                 # Administración Next.js y adaptadores HTTP /api/v1
  mobile/              # Expo / React Native para iOS y Android
packages/
  contracts/           # Esquemas de entrada/salida y errores, aptos para clientes
  domain/              # Reglas puras, sin framework, red o credenciales
  application/         # Casos de uso y puertos; uso exclusivo del servidor
  database/            # Adaptadores PostgreSQL y unidad transaccional; servidor
  api-client/          # Cliente HTTP tipado compartido, sin secretos
  config/              # Configuración compartida de TypeScript/lint, sin secretos
supabase/
  migrations/          # DDL, restricciones, funciones y políticas versionadas
  tests/               # Pruebas de base de datos y aislamiento
tests/
  e2e/                 # Flujos integrados web/móvil según herramienta elegida
docs/                  # Arquitectura, seguridad, decisiones, estado y plantilla
```

Esta estructura es ilustrativa: TASK-001 y TASK-002 solo producen documentación. No crear paquetes ni carpetas adicionales todavía.

## Flujo y responsabilidades

Web/móvil → API → casos de uso → adaptadores PostgreSQL. Los contratos describen entradas; el servidor vuelve a validarlas. `application` depende de `domain` y define puertos que implementa `database`; la composición ocurre en el servidor de `apps/web`. Los clientes solo importan contratos y cliente HTTP; no importan paquetes de servidor ni acceden directamente a tablas comerciales.

La API autentica, autoriza, resuelve empresa y recursos y coordina cada operación. PostgreSQL aplica restricciones y transacciones; Supabase Auth gestiona identidad y Storage archivos bajo políticas propias. Los adaptadores HTTP deben permanecer pequeños para permitir extraer una API independiente después. Los Server Actions, si se usan, pasan por los mismos casos de uso y controles.

## Identidad, empresas e integridad

Proponer Supabase Auth con verificación de tokens en servidor y comprobación de membresía y permisos vigentes; no confiar en roles editables por el usuario. Cookies web seguras y estrategia CSRF cuando aplique; almacenamiento seguro de sesión móvil, renovación y revocación por definir. Cada endpoint es una frontera de autorización, como indica la [guía oficial de Next.js](https://nextjs.org/docs/app/guides/authentication).

Diseñar para empresa explícita y aislamiento verificable, aunque se propone una empresa operativa en el MVP. La estrategia seleccionada para propuesta es un login SQL dedicado sin privilegios de propietario/bypass, RLS y contexto de actor/empresa limitado a la transacción. Auth verifica identidad en la API; la conexión SQL no la hereda. Esquema comercial privado sin grants a clientes de Data API. TECH_DECISIONS §3 define establecimiento/limpieza del contexto, autorización, pooling y pruebas negativas obligatorias antes de persistencia; [SECURITY](SECURITY.md) delimita amenazas y controles.

Ventas, movimientos, cobros registrados y caja requieren atomicidad local, restricciones e idempotencia. Usar importes exactos (unidades mínimas o decimal según moneda), política explícita de redondeo y movimientos compensatorios. Bloqueos o control optimista deben impedir ventas concurrentes inconsistentes. No mantener transacciones abiertas durante llamadas a proveedores de pago: proponer estados, outbox y reconciliación para efectos externos; una transacción SQL no revierte un cobro externo.

## Pruebas propuestas

- Unitarias: reglas puras, importes, redondeos y transiciones válidas/inválidas.
- Integración con PostgreSQL de pruebas: rollback, restricciones, RLS por rol, referencias entre empresas, carreras por últimas unidades e idempotencia.
- API: contratos, sesión inválida/expirada, permisos insuficientes, recursos de otra empresa, reintentos y errores sin datos sensibles.
- E2E: flujos críticos web/móvil, incluidas denegaciones. Ejecutar con datos sintéticos y servicios de pago de prueba.
- CI futura: tipos estrictos, ESLint, Prettier, Vitest, integración PostgreSQL, Playwright, auditoría de dependencias y Gitleaks según gates de TECH_DECISIONS §4. Hoy no hay pipeline ni suite.

## Ambientes propuestos

| Ambiente | Uso y aislamiento |
| --- | --- |
| Local | Base y Auth/Storage locales o de desarrollo exclusivos, datos sintéticos, sin credenciales de producción. |
| Preview | Backend aislado por cambio; si no existe, preview sin operaciones persistentes. Sin credenciales productivas ni acceso a staging por defecto. |
| Staging | Entorno estable separado, proveedores en modo prueba, ensayo de migraciones y restauración. |
| Producción | Recursos, credenciales y accesos separados; autorización explícita para cambios, respaldo y recuperación verificados. |

Separar también buckets, URLs de retorno de Auth, perfiles de compilación y canales de actualización móvil. No compartir silenciosamente datos entre previews. Publicación móvil y compatibilidad de API requieren una ventana de versiones soportadas.

## Decisiones pendientes y riesgos

Valores iniciales propuestos: MXN, una empresa/sucursal/ubicación, operación conectada y stock negativo deshabilitado. No son aprobación de negocio. TECH_DECISIONS §6 concentra redondeo y confirmaciones necesarias, incluidos roles, devoluciones, pagos, impuestos y dispositivos.

Resolver pins y compatibilidad ejecutada de herramientas, gestión de sesiones, región, presupuesto, retención, recuperación (RPO/RTO) y observabilidad. El acceso SQL/RLS ya tiene una propuesta concreta, no una alternativa indefinida; falta aprobación y prueba real. Riesgos principales: fuga entre empresas, doble cobro/venta, abuso de privilegios, despliegues incompatibles con móviles existentes y límites operativos del alojamiento. Nada de ello queda validado en ejecución por estas tareas documentales.
