# TASK-XXX — Título concreto

## Objetivo

Resultado único, pequeño y comprobable. Indicar estado inicial y problema que resuelve.

## Alcance

- Incluido: cambios estrictamente necesarios.
- Excluido: funcionalidades y operaciones que no se autorizan.
- Archivos permitidos: enumerar rutas concretas o directorios con límites claros.
- Dependencias: tareas previas, decisiones aprobadas y herramientas ya disponibles.
- Restricciones: instalaciones, red, datos, servicios y ambientes que pueden utilizarse; precisar autorización si corresponde. Producción requiere autorización explícita.

Si un cambio indispensable queda fuera del alcance, documentar el bloqueo o solicitar ampliación; no incorporarlo silenciosamente. Consultar [AGENTS.md](../AGENTS.md).

## Criterios de aceptación

1. Resultado observable y evidencia esperada.
2. Casos límite y denegaciones pertinentes.
3. Límite verificable de archivos y efectos externos.

## Plan y pruebas

- Pasos mínimos dentro de esta TASK, sin iniciar otra.
- Riesgos y controles aplicables de [SECURITY](SECURITY.md).
- Comandos/herramientas pertinentes ya disponibles y resultados esperados.
- Para cambios críticos: pruebas de permisos, aislamiento, transacciones, concurrencia y reintentos según corresponda.
- Registrar comandos ejecutados, resultados reales, limitaciones y pruebas omitidas con motivo. No instalar herramientas sin autorización de la tarea.

## Revisión

- DEVELOPER: cambios y evidencia.
- QA: criterios, casos límite y regresiones.
- SECURITY: identidad, permisos, empresas, secretos, validaciones, dependencias y vulnerabilidades.

Solicitar revisiones independientes según AGENTS.md. Para cada una registrar ejecución real, responsable, alcance, hallazgos con severidad/archivo/línea, corrección y verificación. Marcar expresamente lo no ejecutado o no aplicable; no inventar aprobaciones.

## Reporte final breve

1. Estado inicial.
2. Archivos creados o modificados.
3. Decisiones propuestas, confirmadas y pendientes.
4. Validaciones ejecutadas y resultados.
5. Hallazgos de QA y SECURITY; indicar si se ejecutaron realmente.
6. Riesgos o bloqueos.
7. Estado: COMPLETADA / PARCIAL / BLOQUEADA.

Actualizar PROJECT_STATE con hechos verificables y detenerse. No comenzar la siguiente TASK automáticamente.
