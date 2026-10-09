import Link from "next/link";
import { authConfiguration } from "../../lib/supabase/config";
import ForgotForm from "./forgot-form";
export const dynamic = "force-dynamic";
export default function ForgotPasswordPage() {
  return (
    <main className="login">
      <p className="brand">SmartRetail</p>
      <h1>Recupera tu cuenta</h1>
      <p className="muted">
        Te enviaremos instrucciones para crear una nueva contraseña.
      </p>
      <ForgotForm configured={authConfiguration() !== null} />
      <Link href="/login">Volver a iniciar sesión</Link>
    </main>
  );
}
