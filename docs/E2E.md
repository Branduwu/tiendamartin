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
