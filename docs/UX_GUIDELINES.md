# UX de SmartRetail

## Auditoría UX03A

Revisión de las vistas principales en 1440×900, 1280×800, 390×844 y 360×800; capturas privadas en TEMP/smartretail-ux03a/before. La primera captura prematura mostraba cargas: se repitió esperando contenido estable. La navegación plana presenta 16 destinos y ocupa aproximadamente 390 px en móvil. Acciones y módulos compiten por atención; el contexto empresarial y cerrar sesión varían según pantalla. Alertas y etiquetas no aparecen en el menú compartido. Las tablas ya tienen un patrón de filas/cards móvil que se conserva como base.

## Dirección visual

Mantener la identidad verde, sin añadir fuentes remotas ni librerías. Fondo claro #f3f6f5, superficie #fbfcfb, texto #18352e, primario #126449; oscuro con fondo #172322, superficie #21312b y texto #e5eee9. Tipografía del sistema, cuerpo 16 px, títulos compactos y cifras tabulares. Espaciado de 4/8 px, radios moderados, sombras sólo para elevación. La búsqueda de referencias locales no produjo una estructura pertinente de dashboard; las decisiones siguen el brief y la identidad existente.

Desktop: rail izquierdo con grupos por actividad y sólo el grupo actual abierto; contexto y cuenta en la cabecera, contenido alineado a la izquierda. Mobile: cabecera corta y botón Menú abre un diálogo modal táctil con esos grupos, cierre explícito, Escape y foco restaurado. No se ofrece una segunda lista permanente de enlaces.

## Reglas reutilizables

- Navegación basada en permisos de la empresa de la pantalla; sin unir empresas ni inferir permisos por rol. Cajero prioriza Vender y Clientes; Inventario prioriza Existencias y Comprar. Administración de SmartRetail tiene shell independiente.
- La empresa elegida por cada módulo sigue su comportamiento actual; no se promete persistencia entre módulos. La cabecera siempre identifica el contexto realmente cargado. Persistencia empresarial global queda pendiente de una tarea específica.
- Inicio: owner/admin con reports.read; POS: cajero con sales.create; inventario: clerk con inventory.read. Invitación y comandos pendientes conservan prioridad. La interfaz nunca sustituye autorización backend.
- Tema Claro/Oscuro/Sistema, por defecto Sistema. Sólo esa preferencia se guarda en localStorage; valores inválidos o almacenamiento bloqueado tienen fallback seguro. Sin datos personales ni DB.
- Botón primario para confirmar/crear; secondary o ghost para consultar/navegar; danger separado para acciones destructivas. Controles de al menos 44 px, foco visible, labels y estado de carga explícito.
- PageHeader, Card, FormField, Input, Select, Badge/Status, EmptyState y Notice comparten tokens y clases; drawer usa el patrón Dialog nativo. EmptyState orienta con una acción sólo cuando existe permiso.
- Tabla desktop y filas/cards etiquetadas mobile mediante data-table/data-label. No trasladar ocho columnas a 360 px. Texto y estado siempre acompañan al color. Impresión conserva papel blanco y oculta shell/tema.
- No animaciones continuas; respetar reduced-motion. Evitar prefetch masivo de todos los módulos. No ocultar errores operativos ni convertir estados desconocidos en éxito.

## Pendiente de UX03B

Aplicación exhaustiva de jerarquía, lenguaje, tablas y estados vacíos módulo por módulo. Esta tarea establece shell, navegación y tema; no cambia cálculos, ledger, permisos, tenancy ni solicitudes comerciales.
