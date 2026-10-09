# Autenticación y entradas — AUTH-SEC01

## Recuperación y cambio personal

Supabase Auth oficial, PKCE y correo SMTP existente. `/forgot-password` da la misma respuesta para éxito, cuenta inexistente, rechazo o límite del proveedor. El enlace debe abrirse en el navegador que lo solicitó; redirect permitido exacto: `https://app.smartretailapp.live/reset-password`. No se añaden tokens propios, contraseñas en PostgreSQL ni claves administrativas al cliente.

`/reset-password` retira el código de la barra de dirección y lo envía únicamente al confirmar contraseñas. El servidor limita el cuerpo a 16 KiB, valida el contrato, intercambia el código en un cliente aislado y verifica firma, identidad, sesión y AMR `recovery`. Nunca emite cookies con sus access/refresh tokens. Los propósitos login OTP/magiclink/signup no autorizan reset. El callback normal verifica en aislamiento y sólo adopta una sesión de confirmación/login; rechaza recovery.

`/settings/account` usa la identidad Auth comprobada, sin destinatario arbitrario y sin exigir membresía comercial activa. Supabase exige contraseña actual; la reautenticación oficial envía un código cuando corresponde. Tras guardar se solicita logout global. Si falla, se informa que la contraseña sí se guardó; para recovery se intenta revocación local del JWT recién intercambiado, retenido sólo en RAM, incluso si el SDK ya vació su almacenamiento. Los fallos de cleanup registran únicamente un evento seguro. No se promete revocación cuando el proveedor falla.

## Política cloud comprobada

Mínimo de Supabase actualizado de 6 a 8 para coincidir con registro existente y la [recomendación oficial](https://supabase.com/docs/guides/auth/password-security). Formularios/contratos nuevos: 8–128, sin trim ni normalización de contraseña, sin composición obligatoria; aceptan acentos, espacios y símbolos/emoji. Se rechazan NUL y Unicode mal formado. Confirmación de email habilitada; expiración OTP y JWT: 3600 segundos. Contraseña actual y reautenticación obligatorias habilitadas. SMTP/DNS conservados.

Límites consultados: correo 30/h por proyecto, envío Auth y verificación 30/5 min por IP, token 150/5 min por IP, con buckets del proveedor; cooldown recovery según Supabase. No se ejecuta abuso masivo para agotarlos. [Semántica oficial](https://supabase.com/docs/guides/auth/rate-limits). No existe limitador casero nuevo.

HIBP deshabilitado: requiere plan compatible; no se contrata. TOTP habilitado por proveedor, sin UI ni obligatoriedad nueva. Pendientes: evaluar protección contra passwords filtrados, MFA operativo y CAPTCHA según riesgo beta.

## Entradas: servidor frente a interfaz

Los campos HTML y mensajes ayudan al usuario; la autoridad sigue siendo los contratos strict, límites de cuerpo/query, sesión derivada, permisos y pertenencia empresarial en handlers/repositorios/RLS. Muestra revisada: login/register, onboarding, empresa/sucursales, productos/SKU/barcode, proveedores/clientes, notas, gastos, promociones/impuestos, usuarios/invitaciones y búsqueda/filtros. No hay una certificación de todas las combinaciones.

Consultas comerciales parametrizadas; identificadores SQL dinámicos revisados provienen de código/listas controladas. Strings legítimos como `O'Connor`, comillas, acentos y emoji no se bloquean por parecer SQL. JSX escapa textos; no se añade HTML crudo. Se homogeneiza rechazo de NUL/surrogates inválidos en búsqueda/contactos/notas representativos, manteniendo longitudes existentes y Unicode legítimo. Los dos exportadores CSV actuales pasan por el mismo helper: neutraliza `= + - @` tras whitespace/control inicial y escapa comillas; pruebas de ambos reportes y celdas contextuales. Compatibilidad en aplicación real Excel/Sheets no ejecutada.

## Navegador, sesiones y límites de aseguramiento

Headers: nosniff, DENY y no-referrer; HSTS corresponde al hosting. Sin CSP nueva: requiere diseño/pruebas específicas para Next/Supabase. Cookies Auth SSR compartidas con navegador: Secure en HTTPS, SameSite Lax, path `/`, sin Domain padre; no HttpOnly por arquitectura del SDK de cliente. Esto exige prevención XSS; no implica cookies inaccesibles a JavaScript.

Logout invalida refresh sessions; JWT ya emitido puede seguir válido hasta su expiración porque APIs existentes usan verificación de claims. No se promete revocación instantánea de todo JWT. Mensajes UI neutros no certifican equivalencia temporal de todos los endpoints del proveedor. Password-manager autocomplete/pegado revisados; extensión real no probada. Expiración/replay manejados por Auth, con negativas focales; no se reduce la expiración cloud para probar.

## Evidencia de cierre (2026-10-09)

50 tests unitarios nuevos útiles; 2506 tests/80 archivos PASS por pnpm check, con integración PostgreSQL existente. Build exit 0; Gitleaks exit 0; 16 E2E nuevos locales y 28 Auth/login remotos PASS. Ocho PNG y UI desktop/mobile 360 revisados por QA; axe/overflow focal cero. SECURITY independiente cerró propósito recovery, callback alternativo, revocación explícita y mensaje del código real del proveedor. Revisores hicieron lectura/visual; ejecuciones y cloud corresponden a DEVELOPER.

Producción: correo recovery entregado, PKCE reset 200 sin cookies token, replay/inválido 401, login/password + tenant/productos, cambio con contraseña actual 200 y wrong password 400, refresh anterior rechazado y headers/cookies efectivos. Signup PKCE real conserva onboarding aislado; magiclink/signup presentados como reset se rechazaron contra cloud. Proveedor agrupa enlace usado/expirado en otp_expired: probado ese error real, sin esperar una hora para envejecer recovery. Email inexistente devuelve el mismo mensaje UI. Membresía SMOKE restaurada inactive, sesiones controladas revocadas y dos usuarios Auth de prueba sin membresía eliminados. Sin cambio de propietario permanente ni ledger.

Secretos: archivos .env/.env.local ignorados por Git; 43 archivos del bundle cliente local inspeccionados contra la conexión/password DB de runtime, 0 coincidencias. Ninguna credencial SMTP se guarda en el repositorio ni en NEXT_PUBLIC_*.
