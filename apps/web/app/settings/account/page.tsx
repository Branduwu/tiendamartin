import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import AccountSecurity from "./account-security";
import Link from "next/link";
import ProfilePanel from "./profile-panel";
import AppNavigation from "../../components/app-navigation";
import styles from "./profile-panel.module.css";
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
        <div className={styles.account}>
          <div className={styles.pageHeading}>
            <h1>Mi cuenta</h1>
            <p className="muted">Tu perfil y la seguridad de tu acceso.</p>
          </div>
          <nav className={styles.sections} aria-label="Secciones de mi cuenta">
            <a href="#account-profile">Perfil</a>
            <a href="#account-security">Seguridad</a>
          </nav>
          <ProfilePanel />
          <AccountSecurity />
          <Link href="/onboarding">Volver a mis empresas</Link>
        </div>
      </main>
    </>
  );
}
