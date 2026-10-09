# SmartRetail · Dirección visual UX03B0

Checkpoint B0.1, 2026-10-09. Azul/neutro aprobado conceptualmente; refinamiento visual pendiente de aprobación. Sustituye la dirección verde de UX03A **sólo en Dashboard, Productos y POS**; el resto espera aprobación. Benchmark de páginas e imágenes oficiales; sin copiar assets.

| Referencia visual                                                                                                                      | Patrón útil                                                                                | Qué no copiar                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Shopify Admin / Polaris](https://shopify.dev/docs/apps/design/visual-design)                                                          | Tabla neutral, datos alineados, estados con texto; superficie y jerarquía antes que color. | Marca y catálogo completo de funciones.                              |
| [Stripe Dashboard](https://stripe.com/payments), [documentación](https://docs.stripe.com/dashboard/basics)                             | Pocas métricas destacadas, gráfica legible y controles secundarios discretos.              | Gradientes de marketing, púrpura de marca y decoración fintech.      |
| [Square Retail](https://squareup.com/us/en/point-of-sale/retail)                                                                       | Importe y siguiente acción inequívocos; interfaces operativas con poco ruido.              | Hardware, efectos del terminal o identidad de servicios de pago.     |
| [Linear, actualización marzo 2026](https://linear.app/now/behind-the-latest-design-refresh)                                            | Navegación neutral, menor énfasis en opciones inactivas, separación sutil y dark diseñado. | Texto demasiado tenue, densidad de herramienta técnica o negro puro. |
| [Lightspeed, Sell screen](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534062778651-Using-the-Retail-POS-Sell-screen) | Buscar/agregar a un lado; carrito, total y cobro al otro.                                  | Mosaico multicolor y duplicación de barras.                          |
| [Toast POS](https://pos.toasttab.com/products/point-of-sale)                                                                           | Objetivos táctiles y contraste para trabajo operativo; modos claro/oscuro.                 | Categorías de colores saturados y complejidad de restaurante.        |
| [Atlassian Color](https://atlassian.design/foundations/color/)                                                                         | Tokens por intención, neutrales específicos por tema, selección distinta de foco.          | Ecosistema de iconos, ilustraciones y abundancia de acentos.         |

Lightspeed/Toast bloquearon navegación automatizada: se revisaron sus imágenes oficiales enlazadas públicamente. Sin acceso a aplicaciones autenticadas.

**Dirección propia: espacio de trabajo comercial.** Tipografía Arial/Helvetica existente; títulos 26 px/600, secciones 18 px/600, cuerpo 14–16 px y metadata 13–14 px. Cifras tabulares, divisores y layout abierto. Radios 8 px controles / 10–12 px superficies; sombras mínimas. Sin gradients, glassmorphism ni dependencias nuevas.

| Token                           | Claro                       | Oscuro                      |
| ------------------------------- | --------------------------- | --------------------------- |
| Fondo / superficie / secundaria | #F8FAFC / #FFFFFF / #F1F5F9 | #0B0F17 / #111827 / #18212F |
| Borde / borde de control        | #E2E8F0 / #64748B           | #263244 / #64748B           |
| Texto / secundario              | #0F172A / #5B6B80           | #F8FAFC / #94A3B8           |
| Texto azul / hover / selección  | #2563EB / #1D4ED8 / #EFF6FF | #60A5FA / #93C5FD / #172C48 |
| Success texto / fondo           | #166534 / #F0FDF4           | #4ADE80 / #142C20           |
| Warning texto / fondo           | #92400E / #FFFBEB           | #FBBF24 / #302510           |
| Danger texto / fondo            | #B91C1C / #FEF2F2           | #F87171 / #321C24           |

CTA sólido cobalto #2563EB / hover #1D4ED8 y texto blanco en ambos temas; links/foco conservan azul claro en dark. Azul: CTA/selección/foco/gráfica; verde: Activo/éxito. Dark separa CTA sólido de links/foco. Ajustes WCAG: secundario claro #5B6B80 y hover dark #93C5FD. Sistema sigue como default.

**Tres composiciones:** Dashboard prioriza cuatro indicadores, tendencia y productos; desglose completo accesible bajo demanda. Productos usa nombre/precio como jerarquía, tabla desktop y filas/cards mobile, búsqueda/estado y un CTA. POS prioriza búsqueda/escaneo → catálogo → carrito/total → Cobrar, con acciones secundarias neutras y cliente opcional bajo demanda. Sidebar neutral compartida, destino activo azul sutil con indicador; cabecera ligera.

**Checkpoint B0.1:** [8 capturas](../output/playwright/ux03b01/index.html), cuenta compacta, filas móviles de productos y barra inferior POS que abre un único carrito modal con total/Cobrar fijos. Cuatro tamaños × ambos temas; datos ficticios locales, sin escrituras cloud. [B0 anterior](../output/playwright/ux03b0/index.html) conservado. Esperar aprobación antes de UX03B1; sin commit funcional/deploy.

**Rollout UX03B1 (2026-10-09):** aprobación explícita de B0.1 recibida en esta TASK; sistema visual compartido publicado y smoke representativo productivo PASS. Los checkpoints anteriores quedan como referencia histórica. Estándar final en [UX_GUIDELINES](UX_GUIDELINES.md#interaction-sizing).
