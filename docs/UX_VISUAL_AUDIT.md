# Auditoría visual UX

## TASK-UX02 — 2026-10-02

Partida: TASK-019 completada, HEAD `a5c8847`, working tree limpio. Se conservaron identidad verde, tipografía local y arquitectura; sin dependencias nuevas ni cambios comerciales, API, Auth, permisos, RLS o migraciones.

## Corregidos

- **UX-P2 / Inventario móvil:** retirado `min-width: 950px`. Tabla desktop y filas tipo tarjeta en mobile conservan producto, ubicación, cantidad y acciones. La cabecera sigue disponible para tecnologías de asistencia.
- **UX-P2 / POS móvil:** acceso visible y fijo a la venta actual con total y enlace al carrito; controles amplios, escáner destacado y checkout agrupado. Desktop conserva dos columnas.
- **UX-P3 / Navegación:** cinco destinos compartidos, estado activo y distribución adaptable. Se conservan los bloqueos anteriores durante operaciones pendientes.
- **UX-P3 / Empresa:** una sola empresa muestra «Empresa activa»; varios tenants usan etiquetas numeradas con sufijo identificable. El UUID completo se conserva como valor técnico, no como título operativo.
- **UX-P3 / Login:** copy breve, jerarquía y espacios revisados a 360px, disabled gris distinguible, advertencia y error accesible asociado al formulario.
- **UX-P3 / Ventas y ticket:** fechas uniformes `es-MX` / `America/Mexico_City`, totales destacados y referencias técnicas secundarias desplegables. Venta original y devoluciones tienen grupos visuales distintos; referencias completas se mantienen al imprimir.
- **UX-P3 / Estados y formularios:** loading visible, búsqueda POS vacía anunciada, feedback coherente, error boundary humano sin stack y foco visible. Caja identifica faltante/sobrante con texto además de color.
- **UX-P3 / Baseline:** login tiene capturas diferenciadas según configuración Auth. Sólo se excluye el portal de herramientas Next dev de la captura, no de axe ni de la aplicación. `caret: initial` evita la mutación de atributos del input por Playwright durante hidratación.

## Evidencia y revisión independiente

Chromium existente: 1440x900, 1280x800, 390x844 y 360x800. Se compararon 28 capturas antes y 28 finales de login, productos, inventario, POS, caja, ventas y ticket. Resultado final: cero violaciones axe; vistas privadas sin overflow horizontal ni controles sin nombre. Ocho snapshots de login representan Auth configurado/no configurado.

Smoke de estados: 32 comprobaciones PASS, formularios abrir/cancelar, carrito local, pagos visibles, búsqueda vacía, foco, error ficticio interceptado y print CSS; cero POST comerciales. Auth real del owner mediante OTP administrativo autorizado y `getClaims`, sesión revocada al terminar; no password ni sesión persistida en Git. Las capturas autenticadas y resultados permanecen privados fuera del repositorio.

QA Sagan revisó imágenes y código en lectura; cuatro hallazgos intermedios de carrito, fechas, nombre de región y estado vacío corregidos. SECURITY Archimedes comparó lógica y expresiones `disabled` contra HEAD: sin cambios en handlers comerciales ni capas de servidor. Las ejecuciones de navegador corresponden a DEVELOPER; los revisores no certifican seguridad general.

## Pendientes

- **UX-P3:** el contrato actual sólo aporta identificadores de tenant/usuario; nombres comerciales y nombres del cajero requieren una futura tarea de datos, sin inventarlos aquí. Las referencias siguen consultables.
- La suite privada por email/password conserva SKIP explícito sin `E2E_EMAIL` / `E2E_PASSWORD`; el smoke OTP no demuestra ese flujo de contraseña. Impresión CSS comprobada, impresión física no ejecutada.
- No hay UX-P1/P2 abiertos en pantallas y estados revisados. No se realizaron fuzzing masivo ni mutaciones financieras para esta tarea visual.
