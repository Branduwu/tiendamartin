# UX de SmartRetail

## Auditoría UX03A

Revisión de las vistas principales en 1440×900, 1280×800, 390×844 y 360×800; capturas privadas en TEMP/smartretail-ux03a/before. La primera captura prematura mostraba cargas: se repitió esperando contenido estable. La navegación plana presenta 16 destinos y ocupa aproximadamente 390 px en móvil. Acciones y módulos compiten por atención; el contexto empresarial y cerrar sesión varían según pantalla. Alertas y etiquetas no aparecen en el menú compartido. Las tablas ya tienen un patrón de filas/cards móvil que se conserva como base.

## Dirección visual

UX03B0.1 aprobada: azul/cobalto primario y superficies neutrales. Claro: fondo #F8FAFC, superficie #FFFFFF, texto #0F172A; oscuro: fondo #0B0F17, superficie #111827, texto #F8FAFC. CTA sólido #2563EB con texto blanco en ambos temas; links/foco claros en oscuro. Verde únicamente para éxito/activo. Tipografía del sistema y cifras tabulares; sin fuentes remotas ni dependencias nuevas. Referencias y checkpoints en [UX_VISUAL_DIRECTION](UX_VISUAL_DIRECTION.md).

Desktop: rail izquierdo con grupos por actividad y sólo el grupo actual abierto; contexto y cuenta en la cabecera, contenido alineado a la izquierda. Mobile: cabecera corta y botón Menú abre un diálogo modal táctil con esos grupos, cierre explícito, Escape y foco restaurado. No se ofrece una segunda lista permanente de enlaces.

## Reglas reutilizables

- Navegación basada en permisos de la empresa de la pantalla; sin unir empresas ni inferir permisos por rol. Cajero prioriza Vender y Clientes; Inventario prioriza Existencias y Comprar. Administración de SmartRetail tiene shell independiente.
- Selector global sólo con varias empresas activas autorizadas. La selección viaja en tenantId y se recuerda en sessionStorage como preferencia, nunca como autorización. Cada módulo vuelve a contrastarla con sus memberships/permisos; un enlace explícito inválido no abre otra empresa. Cambiar abre la landing del nuevo rol mediante navegación completa, desmontando formularios/IDs anteriores. Carrito y operaciones pendientes bloquean el cambio en POS/Caja; los comandos de resultado incierto se conservan para recuperación.
- Inicio: owner/admin con reports.read; POS: cajero con sales.create; inventario: clerk con inventory.read. Invitación y comandos pendientes conservan prioridad. La interfaz nunca sustituye autorización backend.
- Tema Claro/Oscuro/Sistema, por defecto Sistema. Sólo esa preferencia se guarda en localStorage; valores inválidos o almacenamiento bloqueado tienen fallback seguro. Sin datos personales ni DB.
- Botón primario para confirmar/crear; secondary o ghost para consultar/navegar; danger separado para acciones destructivas. Controles de al menos 44 px, foco visible, labels y estado de carga explícito.
- PageHeader, Card, FormField, Input, Select, Badge/Status, EmptyState y Notice comparten tokens y clases; drawer usa el patrón Dialog nativo. EmptyState orienta con una acción sólo cuando existe permiso.
- Tabla desktop y filas/cards etiquetadas mobile mediante data-table/data-label. No trasladar ocho columnas a 360 px. Texto y estado siempre acompañan al color. Impresión conserva papel blanco y oculta shell/tema.
- No animaciones continuas; respetar reduced-motion. Evitar prefetch masivo de todos los módulos. No ocultar errores operativos ni convertir estados desconocidos en éxito.

## Interaction sizing

- Buttons: compact 36 px sólo para acciones terciarias densas desktop; standard 40 px; touch/mobile mínimo 44 px; Cobrar 52 px. Primary cobalto para una acción dominante por contexto; secondary para acciones normales, ghost para actualizar/exportar, danger para riesgo/desactivación. Botones desktop de ancho natural; full width móvil sólo en confirmación/guardado o CTA dominante.
- Icon buttons y summaries de acciones: 40×40 px desktop, 44×44 px móvil; nombre accesible, foco visible y Escape. ActionMenu usa details nativo con enlaces/botones normales, sin inventar un rol ARIA menu.
- Inputs/selects: 44 px desktop y 48 px móvil; labels visibles, helper/error relacionado. Field enlaza label/id/aria-describedby y aria-invalid. Textarea inicial 96 px, resize vertical.
- Spacing: 4/8/12/16/24/32/48 px; contenido 28/32 px desktop y 16 px móvil; fieldsets con gap 16 px, form-grid alineado al inicio. Formularios simples máximo 800 px; tablas/dashboard/POS pueden ser más anchos.
- Títulos 26–28 px desktop, 25–26 móvil; secciones 18–20; cuerpo 14–16, labels 14, metadata 12–14. LoadingLabel superpone ambos textos en una celda para reservar ancho; disabled conserva explicación y feedback importante.
- Contratos públicos en components/ui.tsx: Button, IconButton, Input, Select, Textarea, Field, Card/Section, Badge, Table/List, ActionMenu, EmptyState, Dialog, Toast y PageHeader. Los controles nativos existentes reutilizan la misma escala CSS; no hay estilos de formulario por módulo. ContextHelp permite teclado/Enter/Escape y click/tap; sólo se usa para diferencia de caja.
- Listas mobile priorizan datos comerciales; referencias quedan secundarias. Inventario agrupa operaciones en ⋯, Ventas oculta referencias de venta/turno y pago secundario en móvil (ticket conserva detalle). Negocio despliega preferencias/ticket bajo demanda. Etiquetas muestra tamaño/impresión después de seleccionar productos. Impresión conserva papel blanco y oculta shell.

## Siguientes tareas

AUTH-SEC01 → UX03C → UX03D: recuperación/cambio de contraseña, guía/ayuda/onboarding y captura cámara/QR/foto/OCR respectivamente. No implementadas por UX03B1. La validación visual es una muestra de módulos/roles/estados, no una certificación WCAG general ni de todos los dispositivos.

## Ayuda integrada y soporte — UX03C

- Tres niveles: helper de instrucción, ContextHelp para conceptos y guía `/help` por tareas. Tips con título, 1–3 frases y enlace directo; no `?` por campo ni manual permanente en POS.
- ContextHelp conserva foco al abrir por hover; botón con nombre accesible y estado expandido, cierre con Escape y retorno de foco. Desktop usa diálogo no modal; activación móvil usa diálogo modal. Las guías abren otra pestaña, con aviso y `noopener`, cuando salir descartaría una edición o una operación pendiente.
- Guía estática en español, búsqueda de título/palabras/resumen y categorías. Lectura de ancho limitado; tarjetas en desktop, lista en móvil. Artículos de administración pueden explicar conceptos a otros roles, pero sus CTA se filtran por permisos del miembro actual. El servidor sigue siendo la autoridad.
- Cuenta muestra el rol humano y «Ver qué puedo hacer». Propietario y Administrador son roles empresariales; la explicación de Administrador de SmartRetail aparece sólo con autorización de plataforma. Cajero no devuelve ni administra catálogo; Almacén recibe compras, pero no crea órdenes, configura mínimos ni hace conteos de ajuste.
- Checklist de Propietario/Administrador derivado del servidor: seis pasos esenciales y equipo/impuestos opcionales. Equipo se reconoce con otro miembro activo; movimientos, turnos y ventas por historial. Dashboard lo colapsa desde cuatro esenciales y lo retira al completar seis; `/help/first-steps` conserva acceso. No hay progreso comercial en localStorage.
- Soporte muestra contexto antes de enviar: empresa, actor/rol derivados, pantalla de una lista segura y fecha del servidor. Sin adjuntos, chat, logs, cookies, tokens, formularios ajenos ni correo entrante. Advertir que el usuario no escriba secretos; no afirmar que texto libre puede detectar todos los secretos voluntarios.
- Cada usuario consulta sus solicitudes; plataforma puede cambiar estado sin impersonación ni acceso automático a operaciones comerciales. Folio corto secundario, texto escapado, cuerpo limitado y 20 solicitudes/hora por actor/empresa. Reintentos conservan intención e ID; sessionStorage guarda únicamente empresa/ID para reconciliar respuestas inciertas, nunca descripción ni credenciales. El formulario espera a terminar esa reconciliación.

La evidencia focal de ejecución se registra en PROJECT_STATE. UX03D no forma parte de esta entrega.

## Captura móvil — UX03D1

- Scanner reutiliza Dialog: cámara sólo por acción, manual siempre visible, resultado explícito antes de lookup, cierre con Escape/foco restaurado y apagado de tracks. Permiso denegado o navegador sin cámara mantienen foto/manual, sin excepciones técnicas.
- Viewfinder acotado 4:3 con guía simple; texto QR seguro con wrap, sin enlaces automáticos. No cargar decoder fallback hasta usar cámara/foto.
- POS conserva entrada por teclado/Enter y búsqueda como acciones principales; crear código desconocido sólo con products.write y en otra pestaña para preservar carrito. Una lectura no agrega repetidamente.
- Foto opcional: preview antes de guardar, botones de tomar/seleccionar/reemplazar/eliminar y procesamiento que bloquea guardado. Miniaturas de 36 px sólo cuando existe referencia; sin catálogo tipo ecommerce. Ayuda contextual enlaza la guía breve, sin tutorial permanente.
- Viewports y axe no certifican hardware: registrar por separado dispositivo físico, navegador, permiso/trasera/barcode/QR/apagado. Límites y controles en CAPTURE; evidencia en PROJECT_STATE.
