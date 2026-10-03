# Auditoría visual UX

## Alcance

Se preparó una base Playwright para Chromium en 1440x900, 1280x800, 390x844 y 360x800. Incluye login, navegación autenticada read-only, snapshots, overflow, controles fuera de viewport, nombres accesibles, axe-core y teclado.

## Hallazgos preliminares

### [UX-P2] La tabla de inventario conserva una anchura mínima grande en móvil
**Página:** Inventario  
**Viewport:** 390x844 y 360x800  
**Evidencia:** `.inventory-table` fija `min-width: 950px` y se presenta dentro de scroll horizontal.  
**Problema:** La información completa requiere desplazamiento horizontal y puede dificultar la comparación de filas en pantallas pequeñas.  
**Impacto usuario:** La operación móvil de inventario es funcional, pero las columnas y acciones no son cómodas de escanear.  
**Recomendación:** Evaluar cards o columnas prioritarias ocultables en TASK-UX02; esta tarea no cambia el diseño.

### [UX-P3] La selección de empresa muestra el UUID al usuario
**Página:** Productos e Inventario  
**Viewport:** Todos  
**Evidencia:** Los componentes renderizan `tenantId` como texto cuando existe una sola empresa y como opción del selector cuando hay varias.  
**Problema:** El identificador técnico no es una etiqueta comprensible para una persona operativa.  
**Impacto usuario:** Reduce la claridad de contexto y hace más difícil confirmar la empresa activa.  
**Recomendación:** Mostrar un nombre operativo cuando el modelo lo soporte; no publicar ni inventar nombres en esta tarea.

### [UX-P3] El botón deshabilitado de login conserva apariencia primaria
**Página:** Login  
**Viewport:** 1440x900, 1280x800, 390x844 y 360x800  
**Evidencia:** Con Auth local no configurado, el mensaje informa que el inicio no está disponible y el botón aparece deshabilitado con una atenuación leve.  
**Problema:** La jerarquía visual entre acción disponible y acción bloqueada depende sobre todo del mensaje superior.  
**Impacto usuario:** Puede parecer que el formulario está listo para enviar aunque el botón no tenga efecto.  
**Recomendación:** Revisar un tratamiento disabled más explícito en TASK-UX02; no cambiarlo en esta tarea.

### [UX-P3] El texto introductorio se parte en dos líneas en móvil pequeño
**Página:** Login  
**Viewport:** 360x800  
**Evidencia:** “Inicia sesión para administrar tus productos.” se divide después de “tus”.  
**Problema:** La descripción pierde continuidad visual respecto a los viewports mayores.  
**Impacto usuario:** Bajo; el contenido sigue siendo legible y no desplaza controles fuera de pantalla.  
**Recomendación:** Revisar ancho y ritmo tipográfico en una tarea visual posterior.

## Pendiente de ejecución autenticada

La ejecución contra páginas privadas depende de `E2E_EMAIL` y `E2E_PASSWORD` locales. Sin esas variables no se deben inventar sesiones, credenciales ni resultados visuales autenticados. TASK-019 y sus devoluciones quedan fuera de los criterios estables de esta auditoría.
