import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import PasswordForm from "../../components/password-form";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return (
    <main className="login">
      <p className="brand">SmartRetail · Tu cuenta</p>
      <h1>Cambiar contraseña</h1>
      <p className="muted">
        Este cambio sólo afecta a tu cuenta. Al guardar cerrarás las sesiones
        abiertas.
      </p>
      <PasswordForm mode="change" />
      <Link href="/onboarding">Volver a mis empresas</Link>
    </main>
  );
}
