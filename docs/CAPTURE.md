# Captura móvil — UX03D1

## Motor y compatibilidad

La detección usa `BarcodeDetector` sólo si declara los siete formatos prioritarios. Si falta alguno, carga dinámicamente `zxing-wasm/reader` 3.1.5, publicado el 2026-10-06. [Fuente oficial y API](https://github.com/Sec-ant/zxing-wasm): wrapper MIT, motor ZXing-C++ Apache-2.0. El WASM reader pesa 966895 bytes (418474 gzip); se sirve desde el mismo origen y no se solicita hasta iniciar cámara o leer una imagen. No se incluye writer en la aplicación. `sharp` 0.35.5 ya estaba en el árbol de Next; ahora es dependencia explícita del servidor para sanear imágenes.

EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39 y QR tienen fixtures PNG sintéticas en `e2e/fixtures/capture`. Se generaron con writer del mismo paquete, escala 3, rasterizado PNG con sharp. Los valores están declarados en `e2e/capture.spec.ts`. UPC-A y EAN-13 con cero inicial son físicamente equivalentes: se conserva el resultado del decoder y se ofrece explícitamente el equivalente UPC-A, sin convertir silenciosamente. UPC-E usa el valor original de ocho dígitos expuesto por el decoder.

[BarcodeDetector no es universal](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector). El fallback usa WASM, canvas y getUserMedia bajo HTTPS; esto no acredita Safari/iOS ni Android reales. La evidencia de navegadores y dispositivos efectivamente probados se registra en PROJECT_STATE. La emulación de viewport no es una prueba de teléfono físico.

## Cámara y datos

Permiso sólo al iniciar, cámara trasera preferida, una lectura seguida de confirmación explícita. Cerrar, desmontar, ocultar página o completar lectura detiene los tracks. Manual siempre disponible. Frames y fotos del scanner se procesan localmente, sin upload, grabación ni logs del contenido. QR es texto no confiable: no navegación, HTML ni deep links automáticos. El código para lookup conserva su valor exacto, hasta 128 caracteres ASCII imprimibles, sin HTML ni esquemas URI.

Las fotos del scanner aceptan JPEG/PNG/WebP hasta 8 MiB y 24 megapíxeles; el bitmap se cierra al terminar y la lectura reduce a 1920 px. El límite de píxeles del navegador se comprueba después de decodificar; no promete evitar toda presión de memoria previa en dispositivos con pocos recursos.

## Foto principal y autorización

Una foto opcional por producto; preview y guardado explícito, con reemplazo/eliminación. Cliente: hasta 8 MiB, 24 MP, orientación de decoder, JPEG 1600 px/calidad 82. Servidor: cuerpo acotado a 3 MiB, firma/MIME reales, sharp 24 MP, sin animación, orientación EXIF, recodificación JPEG y eliminación de metadata. Storage acepta sólo JPEG hasta 1.5 MiB. SVG/HTML/ejecutables y MIME falsificado se rechazan. Archivos inválidos reciben errores sanitizados.

Bucket `product-images` privado. [Política Storage](https://supabase.com/docs/guides/storage/security/access-control) restrictiva niega acceso directo a anon/authenticated, incluso ante otra política permisiva. La API verifica claims, membresía activa, empresa del producto y products.read/write mediante runtime DB restringido y FORCE RLS en metadata/auditoría. Paths UUID derivados exclusivamente por servidor; no signed URLs ni paths libres. `SUPABASE_STORAGE_SECRET_KEY` existe exclusivamente como secreto server-side: concede capacidad administrativa de Storage y debe permanecer fuera del cliente/Git/logs. No se usa como rol DB runtime.

Auditoría durable con actor/empresa/producto/operación/correlación/fecha, sin archivo ni contenido. Cuota 60 intentos de cambio por hora por actor/empresa, serializada por advisory lock. Upload inmutable fuera de la transacción; referencia CAS bajo lock y revalidación. Storage tiene timeout de 10 s por petición. Un conflicto o resultado COMMIT incierto puede dejar un objeto privado huérfano: no se elimina a ciegas para no romper una referencia confirmada. Su limpieza futura deberá comprobar ausencia de referencias; no hay job de limpieza en esta TASK. El objeto anterior se elimina sólo tras commit confirmado; fallo de limpieza también puede dejar huérfano inaccesible por API.

No cambios de permisos comerciales, stock, ventas, impuestos, ledger ni cálculo. Reconocimiento visual por IA es experimental/futuro. UX03D2 — factura/nota/PDF/OCR y revisión humana — pendiente, no iniciada.

La versión esperada se transporta en `x-product-image-version` (`none` o UUID validado); no se utiliza `If-Match`, porque Vercel aplicó precondiciones HTTP a la respuesta DELETE incluso después del commit. La comparación de referencia sigue bajo lock en DB. Reemplazo y eliminación requieren el estado actual; cambios concurrentes devuelven conflicto sanitizado.

## Confirmación de lectura

El resultado aparece arriba del scanner con “Código detectado” o “QR leído” en una región aria-live; se oculta el viewfinder apagado. La confirmación sigue siendo explícita. Al volver a Productos o POS, un único aviso accesible permanece tres segundos: código capturado sin guardar automáticamente, producto encontrado o agregado. Las capturas consecutivas con el mismo texto renuevan el anuncio. Un código desconocido conserva acciones de crear según permiso, escanear otro y buscar manualmente. Los QR con enlace se identifican y muestran como texto, sin navegación ni ejecución automática. No se usan sonidos ni vibración.

La cámara procesa exclusivamente el recuadro central (80% del ancho y 50% del alto visibles, compensando object-fit cover), no todo el entorno. Confirma tras tres detecciones consecutivas idénticas; el intervalo de 250 ms supone al menos ~500 ms de estabilidad. Una lectura vacía, distinta, ambigua o sin imagen disponible reinicia la racha. Se exigen simbología soportada, cadenas acotadas, longitud EAN/UPC y check digit EAN/UPC-A; UPC-E se valida por el motor. No hay OCR de números impresos. Un resultado numérico sigue siendo válido si está codificado en barras. Fotos sin una lectura única válida piden aislar un código; entrada manual explícita preservada.
