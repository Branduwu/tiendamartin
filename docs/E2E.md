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
