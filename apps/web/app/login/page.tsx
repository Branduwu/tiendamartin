import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { authConfiguration } from "../../lib/supabase/config";
import LoginForm from "./login-form";
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
    </main>
  );
}
