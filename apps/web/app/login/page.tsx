import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { authConfiguration } from "../../lib/supabase/config";
import LoginForm from "./login-form";
import ForgotForm from "../forgot-password/forgot-form";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmation?: string }>;
}) {
  const params = await searchParams;
  const destination = params.next === "invite" ? "/invite" : "/onboarding";
  if (await verifiedUserId()) redirect(destination);
  return (
    <main className="login">
      <p className="brand">SmartRetail</p>
      <h1>Bienvenido de nuevo</h1>
      <p className="muted">Accede a tu tienda.</p>
      {params.confirmation === "retry" && (
        <p role="status">
          El enlace ya se verificó o venció. Intenta iniciar sesión; si hace
          falta, solicita un nuevo enlace de verificación.
        </p>
      )}
      <LoginForm
        configured={authConfiguration() !== null}
        destination={destination}
      />
      <details className="stack">
        <summary>Verificar mi correo</summary>
        <p className="muted">
          Si tu cuenta sigue pendiente o el enlace venció, solicita otra
          verificación. Abre el nuevo enlace en este mismo navegador. Verificar
          el correo no otorga acceso a ninguna empresa.
        </p>
        <ForgotForm
          configured={authConfiguration() !== null}
          mode="confirmation"
        />
      </details>
    </main>
  );
}
