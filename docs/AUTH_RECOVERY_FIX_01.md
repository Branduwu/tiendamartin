# AUTH-RECOVERY-FIX-01

Base: e565f03c61b26d7b9e01323bae24642e2bd1ec64.
Rama aislada: fix/auth-recovery-close. Candidato aprobado y main sin cambios.

Dos defectos locales reproducidos antes de corregir:

- El montaje retiraba el código PKCE de la URL antes de usarlo. Una recarga
  perdía un código sin consumir. Ahora se conserva hasta el primer envío
  deliberado, incluso tras validación local fallida, y se retira antes del POST.
- La redirección canónica trasladaba reset-password desde el dominio legado
  al nuevo origen sin la cookie verifier original. Ahora preserva ese origen.

Reset responde no-referrer junto con private, no-store. El código permanece
temporalmente en barra/historial hasta guardar: riesgo residual conocido.
No hay almacenamiento adicional, autointercambio ni reintentos automáticos.
API, callback, propósito AMR recovery, firma, identidad, aislamiento de sesión
y revocación permanecen intactos.

La entrega real anterior está acreditada. El primer GET de verificación con
evento login y el segundo enlace inválido no identifican al consumidor.
Ninguno de estos dos defectos demuestra la causa del incidente real.
La plantilla actual no pudo consultarse mediante las herramientas autorizadas.
El correo aportado apuntaba al proveedor con tipo recovery y destino reset;
no se copian tokens ni enlaces de un solo uso.

Validación: 51 pruebas focales API/callback/origen/proxy y 11 comprobaciones
React/Chromium PASS, incluidos StrictMode sin autointercambio, recarga,
validación, doble submit, enlace inválido/usado/caducado y respuesta perdida.
HTTP interceptado, cero peticiones externas, sin proveedor real.
Typegen, TypeScript, lint focal, build Next.js y diff check PASS.
QA Harvey y SECURITY Linnaeus: revisiones separadas de lectura, sin bloqueos
en el diff; no ejecutaron pruebas reales del proveedor.

Única validación pendiente: prueba real autorizada del candidato con la cuenta
ficticia existente, un correo nuevo y enlace original abierto una sola vez en
el navegador que inició PKCE, hasta completar el cambio privado. No se envían
correos ni se publica o incorpora el parche al candidato en esta tarea.

Documentación oficial contrastada:
https://supabase.com/docs/guides/auth/server-side/advanced-guide
https://supabase.com/docs/guides/auth/auth-email-templates

Supabase contempla consumo anticipado por escáneres de correo. Una pantalla
intermedia con confirmación explícita es una mitigación posible si se acredita
ese consumo externo; no se atribuye aquí ni se modifica la plantilla productiva.
El índice changelog.md no pudo leerse con web por su tipo MIME; se consultaron
la documentación oficial y el SDK instalado, sin actualizar dependencias.

Estado: corrección local PASS; recuperación real de extremo a extremo pendiente.
