import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import PasswordForm from "../../components/password-form";
import Link from "next/link";
import ProfilePanel from "./profile-panel";
import AppNavigation from "../../components/app-navigation";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation current="/settings/account" />
      </header>
      <main className="workspace" id="workspace-content" tabIndex={-1}>
        <div className="stack" style={{ maxWidth: "60rem" }}>
          <p className="brand">SmartRetail · Tu cuenta</p>
          <h1>Mi perfil</h1>
          <ProfilePanel />
          <section className="panel stack">
            <h2>Cambiar contraseña</h2>
            <p className="muted">
              Este cambio sólo afecta a tu cuenta. Al guardar cerrarás las
              sesiones abiertas.
            </p>
            <PasswordForm mode="change" />
          </section>
          <Link href="/onboarding">Volver a mis empresas</Link>
        </div>
      </main>
    </>
  );
}
