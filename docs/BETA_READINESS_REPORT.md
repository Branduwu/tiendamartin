# SmartRetail — auditoría de preparación para beta

Fecha: 2026-10-10

Base auditada: `11ebf2f`
Alcance: auditoría documental y de código focal. No se modificaron lógica, migraciones, infraestructura ni producción; tampoco se ejecutaron suites completas ni E2E masivo.

## Dictamen

**NO-GO para una beta con negocios reales.**

El núcleo comercial tiene evidencia histórica de implementación y pruebas, pero tres controles previos a custodiar datos reales siguen sin evidencia suficiente o sin implementación: recuperación demostrable, MFA obligatoria para cuentas privilegiadas y límites de frecuencia para captura documental/OCR. Un piloto interno sin datos reales no cambia este dictamen. Una vez resueltos los bloqueantes, el siguiente dictamen esperado es **CONDITIONAL GO** para 3–5 negocios, con alcance y operaciones expresamente limitados.

| Área | Semáforo | Fundamentación |
| --- | --- | --- |
| Núcleo comercial e integridad | LISTO | Dinero, inventario, ventas, caja, crédito, CxP y auditoría tienen contratos, transacciones, RLS y evidencia focal histórica. |
| Identidad, tenant y permisos | CONDICIONAL | RLS/FORCE RLS, roles y aislamiento tienen evidencia focal; MFA obligatoria para privilegiados no está acreditada. |
| Archivos y OCR | BLOQUEADO | Validación y Storage privado existen, pero no hay límite de frecuencia para documento/OCR. |
| Recuperación de datos | BLOQUEADO | BETA02 acreditó sólo un transporte/restauración externo sintético con B2 y Restic; Supabase Free sigue sin PITR y no existe restauración aislada de Database/Auth/Storage reales. |
| Observabilidad y soporte operativo | CONDICIONAL | Auditoría durable y soporte existen; faltan alertas, monitorización, guardia y runbook de incidentes. |
| Experiencia y campo | CONDICIONAL | Web responsive, scanner y OCR tienen smoke focal; faltan jornadas reales, impresora y lector físico. |
| Legal, privacidad y ciclo de vida | BLOQUEADO | No hay evidencia de términos, aviso de privacidad, retención, baja o portabilidad completa. |
| Dependencias | CONDICIONAL | 1 MODERATE y 2 HIGH aceptados siguen presentes; sus excepciones vencen el 2026-11-02. |

## Reconciliación de requerimientos

La matriz contiene **119** filas, aunque el encargo indica que se originó con 115. Se conservaron sus IDs y estados para evitar inventar equivalencias. Resultado de la reconciliación documental: **78 DONE, 25 PARTIAL, 3 MISSING y 13 DEFERRED**. `DONE` significa evidencia acotada de código/pruebas históricas, no certificación operativa actual.

| Grupo | DONE | PARTIAL | MISSING | DEFERRED | Evidencia y siguiente paso |
| --- | ---: | ---: | ---: | ---: | --- |
| C01–C29 núcleo comercial | 28 | 0 | 0 | 1 | Matriz C01–C29, migraciones y pruebas focales; C28 logo/foto comercial queda posterior. |
| S01–S15 SaaS/admin | 12 | 2 | 0 | 1 | Matriz S01–S15 y smokes Auth; S12 entrega SMTP y S15 multiempresa requieren operación/política. S14 soporte con acceso temporal queda posterior. |
| U01–U18 UX/ayuda | 12 | 6 | 0 | 0 | UX focal y ayuda integrada; responsive, lenguaje, formularios, estados, tablas y POS móvil necesitan jornadas reales. |
| A01–A12 Auth | 8 | 4 | 0 | 0 | AUTH-SEC01 acredita recovery/cambio; MFA, password managers, abuso y revocación completa quedan parciales. |
| I01–I11 seguridad de entradas | 9 | 2 | 0 | 0 | Consultas parametrizadas, escaping y CSRF están cubiertos focalmente; Unicode transversal y enumeration integral no. |
| X01–X02 CSV | 1 | 1 | 0 | 0 | Neutralización de fórmulas comprobada; compatibilidad real con hojas de cálculo no. |
| K01–K11 captura/hardware | 6 | 3 | 0 | 2 | Scanner/QR y validación física focal DONE; lector físico, foto producto y OCR siguen acotados. K07/K08 ya reflejan el smoke físico de UX03D2; K08 confirma revisión humana antes de cualquier recepción. |
| M01–M08 móvil/hardware | 2 | 2 | 1 | 3 | Navegador y print DOM existen; faltan hardware certificado, cajón e historia offline. |
| F01–F13 posterior/operación | 0 | 5 | 2 | 6 | Importación, backup/restore, observabilidad y portabilidad requieren trabajo previo a beta; CFDI, gateway y PWA pueden seguir diferidos si se declaran fuera del piloto. |

Los requisitos no DONE y su prioridad se mantienen en [PRODUCT_REQUIREMENTS_MATRIX.md](PRODUCT_REQUIREMENTS_MATRIX.md). Para esta beta, la evidencia de cada fila se interpreta como `verificada en fuentes`, `histórica` o `NO VERIFICADO`; ninguna fila se eleva a PASS por este informe.

## Flujos completos

| Flujo | Estado | Evidencia revisada | Riesgo o restricción beta |
| --- | --- | --- | --- |
| Registro → correo → onboarding | CONDICIONAL | Matriz S04–S06 y AUTH-SEC01 registran email/password, confirmación y onboarding. | Sin CAPTCHA probado ni garantía de entregabilidad/alertas actuales. |
| Login → recuperación/cambio | CONDICIONAL | AUTH-SEC01 documenta PKCE, recuperación, cambio y logout global. | MFA no obligatoria; JWT emitido conserva ventana; no hay prueba actual de abuso. |
| Empresa → sucursal → usuarios/permisos | LISTO | C01/C02/C25/C26 y S01–S10, con RLS y pruebas negativas históricas. | Debe verificarse con usuarios reales y MFA antes de operar. |
| Producto → inventario inicial | LISTO | C03–C06 y pruebas de inventario/ledger. | Importación masiva no existe; alta inicial será asistida/manual. |
| Compra → recepción → existencias | LISTO | C08–C10 y OCR como borrador revisable. | OCR no recibe automáticamente; tasa de captura debe limitarse. |
| POS → caja → venta → ticket → devolución | CONDICIONAL | C11–C16, transacciones e idempotencia documentadas. | Ticket es browser print, no CFDI; impresora y conciliación física no acreditadas. |
| Clientes → crédito → pagos | LISTO | C17/C20 y evidencia de snapshots/abonos. | Requiere entrenamiento y política comercial del negocio. |
| Gastos / CxP | LISTO | C21/C22, rutas y auditoría documentadas. | No es contabilidad formal. |
| Reportes | CONDICIONAL | C23 y CSV neutralizado. | Sin exportación completa, importación ni validación real en Excel/Sheets. |
| Ayuda / soporte | CONDICIONAL | U12–U18 y soporte auditado. | Falta procedimiento de incidentes y escalamiento. |
| Escaneo móvil / QR | CONDICIONAL | K01/K03/K04/K10/K11; smoke físico reportado. | Lector USB/Bluetooth y variedad de dispositivos no comprobados. |
| OCR → revisión → borrador → recepción | CONDICIONAL | TASK-UX03D2: foto/PDF, revisión humana, borrador y smoke físico PASS. | HEIC/RAW no admitidos; no rate limiting; recepción sigue separada y manual. |

## Bloqueantes y brechas principales

| Prioridad | Brecha verificada | Impacto | Próxima TASK propuesta |
| --- | --- | --- | --- |
| P0 | Restauración de PostgreSQL y Storage no demostrada; sin RPO/RTO, retención ni responsable acreditados. | Pérdida de datos sin recuperación operativa demostrada. | Beta hardening: backup, restore aislado y runbook. |
| P0 | MFA no obligatoria ni probada para owner/admin/platform admin. | Compromiso de cuenta privilegiada. | MFA privilegiada y recuperación. |
| P0 | Captura documental/OCR no tiene límite de frecuencia específico. | Consumo abusivo de CPU, Storage y cuotas. | Cuotas/rate limiting de documentos. |
| P1 | Sin alertas, monitorización, guardia ni runbook de incidente. | Detección y respuesta tardías a caída de DB/Auth/correo. | Observabilidad y operaciones beta. |
| P1 | CSP global ausente; sesión SSR accesible a JavaScript por la arquitectura del SDK. | Mayor impacto de una futura regresión XSS. | Diseño y despliegue CSP compatible. |
| P1 | HIBP deshabilitado; CAPTCHA y protección antiabuso no acreditados. | Abuso de registro/recovery y contraseñas débiles conocidas. | Hardening Auth/registro. |
| P1 | 2 HIGH y 1 MODERATE con excepción temporal. | Riesgo de cadena de suministro vigente. | Revisión/remediación antes del 2026-11-02. |
| P1 | Términos, privacidad, retención, baja y portabilidad incompletos. | Riesgo contractual y de datos con negocios reales. | Legal/data lifecycle para beta. |
| P1 | Hardware real e impresión térmica no acreditados. | Operación de caja puede fallar en campo. | Piloto de hardware por perfil de negocio. |
| P1 | Importación de catálogo y exportación completa ausentes. | Onboarding lento y baja sin portabilidad completa. | Import/export asistido. |
| P1 | SMTP/entregabilidad y cuotas externas no revalidadas. | Registro/recovery pueden fallar sin detección. | Prueba operativa y alertas de correo. |
| P2 | CFDI, cobro bancario, PWA/offline, cajón e app nativa. | Expectativas de producto. | Declarar fuera de alcance del piloto. |

## Seguridad y dependencias

Controles con evidencia focal: RLS/FORCE RLS y políticas por tenant en migraciones, permisos de servidor, queries parametrizadas, escaping JSX, defensa CSRF, sanitización CSV, bucket privado y validaciones MIME/tamaño para archivos. Esto no certifica todas las tablas, buckets ni configuración cloud actual.

No verificado o incompleto: MFA obligatoria, rate limit para documentos/OCR, CSP, HIBP/CAPTCHA, logs y headers efectivos de producción, configuración actual de Supabase/Vercel/Resend, pruebas de aislamiento cloud y acceso de soporte de plataforma.

La revisión de SECURITY ejecutó `pnpm audit --json`: **0 LOW, 1 MODERATE, 2 HIGH y 0 CRITICAL**. Los riesgos HIGH exactos son `GHSA-86w9-cpqp-85rv` en `node-forge@1.4.0` y `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687` en `braces@3.0.3`; la aceptación configurada vence el **2026-11-02** y falla cerrada ante cambio de árbol/ruta/versión o expiración. El MODERATE conocido es `uuid@7.0.3`. No se extiende ninguna aceptación por este reporte.

## Backup, recuperación y operaciones

**PARCIALMENTE VERIFICADO:** un artefacto Restic cifrado de cuatro archivos ficticios se recuperó desde bytes descargados de B2, con Object Lock Compliance sintético y hashes coincidentes. **NO VERIFICADO:** frecuencia, retención operativa, responsable, cobertura de Supabase Database/Auth/Storage, restauración no destructiva de datos reales, RPO/RTO, recuperación de borrados accidentales y rollback de migraciones con datos reales. Tener un backup del proveedor no demuestra que la restauración real funcione.

Antes de beta se necesita una restauración aislada y no destructiva: restaurar una copia de Database en un proyecto de prueba, comprobar esquema, RLS, una muestra de ledger y lectura autorizada de objetos privados; registrar duración, datos restaurados, responsable y resultado. Propuesta inicial a validar con negocio: RPO máximo 24 h y RTO máximo 8 h. Son objetivos propuestos, no capacidades demostradas.

Implementado: auditoría de dominio y soporte con contexto mínimo. Recomendado antes de beta: alertas de disponibilidad/5xx/cuotas, registro seguro de incidente, contacto de escalamiento para Vercel/Supabase/Resend, revisión semanal de cuotas y runbook de correo/Auth/DB/Storage.

## Entrada a beta y UX de campo

Checklist mínimo de entrada:

- [ ] Restauración aislada de Database y Storage registrada, con RPO/RTO y responsable.
- [ ] MFA obligatoria y recuperación comprobada para todas las cuentas privilegiadas.
- [ ] Rate limit/cuotas para documentos/OCR y política ante abuso.
- [ ] Alertas mínimas, runbook de incidentes y contactos de escalamiento.
- [ ] Revisión de advisories antes del 2026-11-02, sin renovar excepciones automáticamente.
- [ ] Términos, aviso de privacidad, retención y procedimiento de baja/portabilidad aprobados.
- [ ] Smoke de cada negocio: primer login, producto, inventario inicial, compra/recepción, POS, cierre, devolución, soporte y recuperación.
- [ ] Una impresora térmica y un lector real verificados si el negocio dependerá de ellos.
- [ ] Alcance comunicado: sin CFDI, gateway bancario, offline/PWA ni app nativa publicada.

Métricas de campo propuestas: tiempo hasta primer producto y primera venta, tasa de error/corrección de barcode y OCR, duración de apertura/cierre de caja, operaciones que requieren soporte, fallos de correo/Auth y tickets/errores por negocio. Observar una primera jornada completa por negocio sin alterar sus datos de forma automática.

## Revisión independiente y límites

QA/operaciones independiente revisó flujos, operación, hardware y backup en solo lectura. SECURITY independiente revisó controles de tenant, Auth, archivos, dependencias y superficie de abuso en solo lectura. Ambos coinciden en recuperación no demostrada y MFA; SECURITY añade como bloqueo el rate limit de documentos/OCR. Ninguno ejecutó producción, RLS cloud, restore, hardware, logs externos ni suites completas.

Estado de TASK-BETA01: **COMPLETADA como auditoría documental.** No se hizo commit, push, despliegue ni se inició otra TASK.
