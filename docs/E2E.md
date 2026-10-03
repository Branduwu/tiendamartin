# E2E y QA visual

La suite usa Playwright con Chromium y cuatro viewports: 1440x900, 1280x800, 390x844 y 360x800. Las pruebas no crean `storageState` ni guardan cookies.

## Comandos

```powershell
corepack pnpm e2e
corepack pnpm e2e:ui
corepack pnpm e2e:visual
corepack pnpm e2e:update-snapshots
```

Por defecto se inicia la web local en `http://127.0.0.1:3000`. Para producción usa sólo pruebas read-only:

```powershell
$env:E2E_BASE_URL = "https://smartretail-sepia.vercel.app"
corepack pnpm e2e login.spec.ts --project desktop --project mobile-small --grep "labelled form"
```

Los flujos autenticados requieren variables locales `E2E_EMAIL` y `E2E_PASSWORD`. Nunca las guardes en Git ni las imprimas. Los tests no mutan datos de producción; los snapshots no contienen credenciales ni `storageState`.

Los snapshots de referencia se actualizan sólo con `e2e:update-snapshots` tras revisar visualmente el diff. Las pruebas funcionales comprueban navegación y controles; las visuales comprueban layout, overflow, nombres accesibles y regresiones de pantalla.

El smoke anterior es público; `e2e:visual` requiere credenciales y puede omitir todas sus pruebas sin ellas. Traces y vídeo desactivados para evitar conservar credenciales o sesiones; no publicar screenshots autenticados sin revisarlos.

## TASK-UX02 — baselines y evidencia

Login usa `login.png` sin Auth configurado y `login-configured.png` con Auth disponible, en los cuatro viewports. La captura excluye únicamente `nextjs-portal`, UI externa del servidor de desarrollo, mediante `stylePath` y `e2e/screenshot.css`; axe analiza la página sin exclusiones nuevas. `caret: initial` evita que el screenshot altere inputs antes de hidratación. Las actualizaciones de los ocho PNG se revisaron como cambios intencionales de diseño.

Suite final configurada: 12 PASS y 24 SKIP explícitos sin credenciales email/password; el modo sin Auth se valida aparte con los 12 tests de login. Smoke privado independiente y read-only con OTP real autorizado: 28 pantallas finales y 32 checks de estados, cero POST comerciales, axe sin violaciones. Error de login probado con respuesta ficticia interceptada; no es evidencia de password login real. Las sesiones se revocan y las capturas privadas no se versionan.

Producción UX02: smoke remoto read-only de 28 vistas más ocho focales POS/login tras terminar consultas, todos PASS; cero errores de render/hidratación y cero violaciones axe. Deployment `dpl_2sTLw8cQ4thhGkTGBLf5wBAUtjSf` READY. Ejecuciones operacionales realizadas por DEVELOPER; QA revisó visualmente las capturas y baselines locales, sin atribuirle ejecución cloud.

## TASK-020 — smoke focal de compras

e2e/purchasing.spec.ts revisa suppliers list, purchases list, detalle y formulario de recepción en desktop/mobile-small, sin escrituras. Requiere E2E_EMAIL/E2E_PASSWORD y, para detalle/formulario, E2E_PURCHASE_ID/E2E_TENANT_ID de una orden ordered/partially_received; omite explícitamente sin esas variables. Traces/vídeo permanecen desactivados.
La ejecución privada autorizada usa OTP real sin contraseña, no persiste sesiones y comprueba ocho vistas con axe, creación UI y recepción parcial/total, respuesta perdida/recarga/replay y controles negativos. Evidencia fuera de Git; no equivale a probar password login.

Cierre TASK-020: browser OTP real8 vistas locales +8 productivas PASS, axe0/overflow0/render0; cuatro PNG locales revisadas por QA Nash. Script password focal8SKIP explícitos. Smoke productivo creó fixtures SMOKE y dos recepciones, conservados con ledger; replay tras respuesta perdida validado contra servidor. Deployment dpl_HMLQsoZEveK1Sc7AYAa9U7wiD7NP READY; ejecuciones cloud realizadas por DEVELOPER.

## TASK-021 — clientes

e2e/customers.spec.ts añade tres checks read-only (directorio, historial, cliente opcional POS) en desktop/mobile-small. Email/password ausentes:6SKIP explícitos; detalle necesita E2E_CUSTOMER_ID/E2E_TENANT_ID. No se persisten credenciales, traces ni vídeo.
Smoke privado autorizado OTP real local:8 vistas clientes/POS/historial/ticket, axe0/overflow0/render0; venta asociada con respuesta perdida/reload/replay, cliente inactivo e historial intacto, Público general. Quick-create y cambio de empresa360px adicionales PASS; QA revisó cuatro PNG locales. Ejecuciones realizadas por DEVELOPER; no equivalen a password login.

Cierre TASK-021: smoke OTP productivo8 vistas PASS con axe0/overflow0/render0; venta asociada/replay tras respuesta perdida, snapshot ticket/historial preservado al desactivar, nueva inactive409 y Público general201. Adapter confirma una venta asociada, otra general y stock8000; fixtures y ledger preservados. Deployment dpl_AGDV1w6sC9WdgkQ9iN3QqYnNJvfo READY. Ejecución cloud DEVELOPER; password6SKIP sigue explícito.

## TASK-022 — dashboard y reportes

Dos checks read-only en e2e/reporting.spec.ts: dashboard/cambio de periodo y rango histórico vacío. Desktop/mobile-small: cuatro SKIP explícitos por ausencia de email/password. El smoke privado DEVELOPER con Supabase OTP/getClaims y cookies sólo en memoria ejecutó seis vistas locales (dashboard, siete días, vacío; 1440/360px): axe0, overflow0, render0. CSV filtrado, retry con idénticos filtros y error independiente de selectores/reintento PASS. Comparaciones SQL controladas del adapter runtime PASS; cinco EXPLAIN ANALYZE con rango366 días, máximo6.736ms sobre fixtures locales, sin afirmar escalabilidad universal. Intentos iniciales del harness ajustaron selectores de combobox y espera de estado React; no cambiaron datos históricos ni lógica funcional. Smoke remoto y revisión visual independiente pendientes.

Cierre remoto TASK-022: DEVELOPER ejecutó seis vistas productivas con Auth OTP real, desktop1440/mobile360, axe0/overflow0/render0. Dashboard/periodo7d/CSV/rango2000 vacío/tenant403/foreign-reference403/anónimo falsificado401 PASS. Adapter/SQL controlados coinciden con API; huellas17 tablas comerciales intactas, cero fixtures nuevos productivos. Deployment dpl_7BpreTyeVrbAvB8b7rLhUy7HEF9e READY. QA Arendt y SECURITY Hegel independientes postsmoke favorables por revisión de código/artefactos; QA inspeccionó ocho PNG locales/remotos. No ejecutaron browser/cloud ni suites; esas ejecuciones fueron DEVELOPER. Cuatro checks password SKIP siguen explícitos.
