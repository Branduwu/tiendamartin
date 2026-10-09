import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { authConfiguration } from "../../lib/supabase/config";
import RegisterForm from "./register-form";
export const dynamic = "force-dynamic";
export default async function RegisterPage() {
  if (await verifiedUserId()) redirect("/onboarding");
  return (
    <main className="login">
      <p className="brand">SmartRetail</p>
      <h1>Crea tu cuenta</h1>
      <p className="muted">
        Empieza con tu correo. Configurarás tu empresa después de verificarlo.
      </p>
      <RegisterForm configured={authConfiguration() !== null} />
    </main>
  );
}
