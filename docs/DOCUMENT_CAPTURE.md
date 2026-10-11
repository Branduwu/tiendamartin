# Captura asistida de compras — UX03D2

## Spike y decisión

Metadata npm y fuentes oficiales consultadas el 2026-10-10: PDF.js `6.4.299` (Apache-2.0, Node >=22.13/24) y Tesseract.js `7.0.0` (Apache-2.0, worker, español) permiten extracción local sin coste variable. PDF.js tiene ~35 MB desempaquetados, incluidos assets opcionales; sólo se carga el display/worker necesario. Tesseract.js ocupa ~1.4 MB más core/modelo; el modelo español `@tesseract.js-data/spa@1.0.0` (MIT) es un asset pesado y se descarga sólo al necesitar OCR. Se medirá transferencia y tiempo en fixtures, sin equiparar viewport emulado con hardware real.

Alternativas: Scribe.js `0.16.1` integra PDF/OCR pero su licencia AGPL-3.0 y superficie mayor no encajan con esta integración mínima. OCR nativo no ofrece un contrato browser portátil. Servicios cloud introducen envío de información empresarial y coste variable; no se incorporan sin benchmark que justifique esa necesidad.

Decisión: PDF con texto se lee directamente con PDF.js; sólo páginas sin texto suficiente se rasterizan y pasan al worker OCR español. Imágenes usan ese mismo worker. Modelos y scripts desde el origen de SmartRetail; sin CDN ni API generativa. Preview pasivo en canvas/imagen, sin viewer PDF, anotaciones, JavaScript, acciones ni enlaces ejecutables. Un worker de sesión posee el worker OCR y permite terminar también su inicialización. Procesamiento cancelable y recursos liberados.

Fuentes: [PDF.js](https://mozilla.github.io/pdf.js/getting_started/), [Tesseract.js](https://github.com/naptha/tesseract.js), [core oficial](https://github.com/naptha/tesseract.js-core/blob/master/package.json), [assets locales](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [Scribe.js](https://github.com/scribeocr/scribe.js).

## Arquitectura y regla de inventario

Ingestión → extracción de texto → propuesta estructurada → matching sugerido → revisión/corrección explícita → API normal de borrador de compra. Money/Quantity se parsean como strings exactos y bigint; valores ausentes o ambiguos no se inventan. La comparación de totales orienta al usuario, nunca ajusta importes silenciosamente. Impuestos detectados son datos del documento, no validación SAT ni un nuevo cálculo de recepción.

OCR nunca modifica inventario sin revisión y recepción posterior. La recepción conserva su aplicación/transacción/ledger existente; el documento y su texto son datos, nunca instrucciones.

## Privacidad y límites

La entrada local de cámara admite JPEG/PNG/WebP hasta 12 MiB, 50 MP y lado de 12000 px, comprobados antes de decodificar. Si supera 4 MiB/12 MP, se prepara una copia JPEG con orientación y proporción conservadas, hasta 2400 px por lado, y se revalida contra los límites server. No se amplían esos límites. Preview/OCR/envío/adjunto/retry usan exactamente esa copia; la UI avisa «copia optimizada» y la foto original permanece en el dispositivo. Archivos ya acotados y PDF conservan sus bytes. Preparación nativa serializada, cancelación de UI inmediata y descarte/cleanup de resultados tardíos; el decoder nativo puede terminar después de cancelar. Hasta 50 MP pueden requerir ~200 MB RGBA más temporales: resize y límites no garantizan el pico total de RAM ni compatibilidad de todo teléfono. Formatos HEIC/RAW no se añaden. Referencia de orientación y resize: [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap).

Validación client/server de JPEG/PNG/WebP/PDF; 4 MiB por archivo, 5 páginas PDF y 12 MP por imagen/página renderizada. Dimensiones de imagen comprobadas antes de crear bitmap. El perfil PDF inicial admite tablas xref tradicionales, sin cifrado ni actualizaciones incrementales: ObjStm/XRef comprimidos y nombres escapados se rechazan antes del parser para impedir expansión estructural; el mensaje propone Imprimir a PDF simple o foto. Validación del servidor en worker de hasta 10 s, heap V8 128 MiB y máximo dos trabajos simultáneos por proceso; el heap no es una garantía sobre toda la RAM. No compatibilidad PDF universal.

OCR/preview viven en memoria, sin persistencia en localStorage. Original privado opcional, inmutable, asociado sólo a una compra existente y autorizada por empresa, permiso y sucursal. Bucket purchase-documents sin lectura/escritura directa de JWTs de browser; API autenticada entrega attachment sin URL pública. Retry de original compara hash/tipo; no reemplaza otro documento. Cancelar antes de confirmar no sube documentos; originales de compras canceladas conservan su asociación histórica, sin limpieza que rompa integridad. No documentos personales reales en fixtures ni texto OCR en logs. XML fiscal se rechaza en esta fase.

Spike inicial en Windows/Node: PDF ficticio, nueve líneas 9/9 y sin OCR, ~55 ms; imagen clara ~700 ms OCR, confianza de motor 94, modelo español comprimido 2.1 MB. No es un benchmark móvil ni certificación de exactitud. Layouts desconocidos requieren completar líneas manualmente. Impuestos del documento se guardan como referencia revisada; no cambian el modelo contable de compras. Duplicado potencial: comparación contra las últimas 100 compras disponibles; no garantía de unicidad comercial histórica.

## Evidencia y comparación acotada

Fixtures ficticios: imagen clara/ticket/inclinada, PDF textual, escaneado, dos páginas, seis páginas rechazadas, malformado y contenido hostil como texto. El flujo requiere confirmar productos, unidades, cantidades/costos y revisión final; no se atribuye exactitud universal al OCR. El filtro PDF examina todos los bytes, incluidos objetos fuera del índice que PDF.js podría recuperar. Por prudencia rechaza `/ObjStm`, cualquier nombre con prefijo `/XRef`, `/Prev` y `/Encrypt` también cuando son texto literal/comentarios; cubre nombres escapados y la firma más amplia de recuperación de PDF.js. Es una restricción conocida, no prueba de que ese archivo sea malicioso: el aviso la explica y permite continuar mediante foto/compra manual. No se introduce un segundo parser permisivo para eliminar ese falso positivo.

QA estimó para el fixture de dos líneas 10–11 acciones y 30–53 s manuales frente a 11 acciones y 35–57 s asistidas con una corrección. Son supuestos ilustrativos de 2–3 s por acción y 10–20 s de lectura, no una medición humana: el ahorro no está demostrado para documentos cortos. Los tiempos automáticos del spike no incluyen revisión humana. No se añaden servicios externos para mejorar artificialmente esta comparación.

Medición del motor en Node/Windows con los fixtures del repositorio: inicialización 149 ms; imagen clara 352 ms/confianza 94, ticket 214 ms/95 e inclinada 251 ms/86. Las dos primeras conservaron ambas líneas; en la inclinada se perdió una separación de columnas de la segunda línea y requiere corrección/manual. No son tiempos de teléfono ni del flujo humano completo.

Build: assets del motor trazados explícitamente (~48.7 MiB, seis variantes WASM para capability detection), validación PDF ~17 MiB por función; ninguna `.env` incluida. Core `7.0.0` declarado directamente para que su resolución sea reproducible en Vercel: misma versión antes transitiva, no segundo motor. Browser carga sólo la variante elegida y el modelo español de 2 100 190 bytes cuando necesita OCR, no el conjunto del servidor. No warning de trazado del proyecto completo.

Las descargas y asociaciones del original registran actor, empresa, compra, fecha y correlación; nunca contenido del documento. La evidencia funcional y el estado de producción/smoke físico se registran en PROJECT_STATE.

Producción: diez recorridos focales PASS en desktop y viewport 360×800, con PDF textual sin OCR y OCR real de imagen/PDF escaneado. El caso de imagen tardó 7.5 s/5.9 s respectivamente; incluye acciones automatizadas, no mide el teléfono ni ahorro humano. PDF worker comprimido ~387 kB frente a 1.26 MB decodificado; preview y extracción reutilizan la caché del navegador. El smoke físico de foto/PDF y revisión final permanece pendiente; no se declara soporte universal.
