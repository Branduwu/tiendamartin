import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { authConfiguration } from "../../lib/supabase/config";
import LoginForm from "./login-form";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await verifiedUserId()) redirect("/products");
  return (
    <main className="login">
      <p className="brand">SmartRetail</p>
      <h1>Bienvenido de nuevo</h1>
      <p className="muted">Accede a tu tienda.</p>
      <LoginForm configured={authConfiguration() !== null} />
    </main>
  );
}
