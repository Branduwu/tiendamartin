# Protocolo de desarrollo de SmartRetail

## Alcance y evidencia

- Trabajar en una sola TASK por ejecución. Los revisores de esa TASK no abren otra tarea. No comenzar la siguiente automáticamente.
- Leer la tarea, este archivo y las instrucciones aplicables antes de editar. Implementar exclusivamente el alcance solicitado y respetar los archivos permitidos.
- No implementar funcionalidades adicionales, instalar herramientas, cambiar configuraciones ni efectuar operaciones externas fuera de la autorización de la tarea.
- Distinguir requisitos confirmados, propuestas y comportamiento comprobado. No afirmar que algo funciona sin evidencia reproducible; declarar validaciones omitidas y sus motivos.
- No desplegar ni modificar producción sin autorización explícita. No hacer commits ni push salvo solicitud expresa.

## Controles obligatorios

- Validar entradas, sesión, permisos y pertenencia a la empresa del lado servidor en cada operación. La interfaz y los tipos TypeScript no son controles de seguridad.
- Aplicar denegación por defecto y mínimo privilegio. El identificador de empresa recibido del cliente no prueba autorización. Verificar también la empresa de cada recurso relacionado.
- No exponer secretos ni datos sensibles en código, clientes, logs, respuestas, documentación o herramientas. Al inspeccionar variables de entorno, mostrar únicamente nombres; no volcar archivos con sus valores.
- Ejecutar los cambios financieros y de inventario relacionados dentro de una transacción de base de datos, con control de concurrencia e idempotencia cuando haya reintentos. Varias peticiones independientes no constituyen una transacción.
- No modificar directamente saldos históricos ni borrar movimientos contabilizados. Corregir mediante movimientos compensatorios autorizados y trazables; cualquier saldo derivado se actualiza atómicamente con su movimiento.
- Exigir pruebas para cambios críticos: autenticación, autorización, aislamiento empresarial, dinero, existencias, migraciones y secretos. Incluir casos negativos, concurrencia y reintentos donde corresponda. Si faltan medios para probar, reportar el bloqueo y no declarar el cambio validado.
- Mantener auditoría con actor, empresa, operación, fecha e identificador de correlación, sin credenciales ni datos de pago sensibles. Consultar [SECURITY](docs/SECURITY.md) para el modelo inicial.

## Responsabilidades y ciclo por tarea

1. DEVELOPER: inspecciona el estado, implementa únicamente la tarea asignada y aporta evidencia de sus validaciones.
2. QA: contrasta criterios de aceptación, alcance, casos límite, pruebas y regresiones. Distingue revisión documental de ejecución funcional.
3. SECURITY: revisa autenticación, autorización, aislamiento entre empresas, secretos, validaciones, dependencias y vulnerabilidades; declara qué no es verificable.

Usar revisiones separadas con subagentes cuando estén disponibles y sean pertinentes. Cada revisor recibe la misma TASK, archivos finales y criterios, trabaja en modo lectura y devuelve severidad, evidencia con archivo y línea, impacto y corrección sugerida. No atribuir revisiones que no se ejecutaron. Si no hay subagentes, ejecutar QA y SECURITY en sesiones independientes con ese mismo material y registrar responsable, alcance y resultado; una autorrevisión debe identificarse como tal.

Resolver hallazgos dentro del alcance y solicitar nueva revisión de los cambios pertinentes. No confundir ausencia de hallazgos documentales con certificación del sistema. Registrar brevemente resultados reales en [PROJECT_STATE](docs/PROJECT_STATE.md).

El reporte final debe indicar: estado inicial; archivos creados/modificados; decisiones propuestas y pendientes; validaciones y resultados; hallazgos reales de QA y SECURITY; riesgos/bloqueos; estado COMPLETADA, PARCIAL o BLOQUEADA. Usar [TASK_TEMPLATE](docs/TASK_TEMPLATE.md) para futuras tareas pequeñas.
