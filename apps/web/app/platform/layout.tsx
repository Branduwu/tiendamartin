import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { platformForUser, tenantsForUser } from "../../lib/database";
import { roleLanding } from "../../lib/navigation";
import AccountControls from "../components/account-controls";
export const dynamic = "force-dynamic";
export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await verifiedUserId();
  if (!user) redirect("/login");
  if (!(await platformForUser(user).access()))
    return (
      <main className="workspace stack">
        <h1>Acceso restringido</h1>
        <p>Esta área está reservada a la administración de plataforma.</p>
        <Link href="/products">Volver a mi empresa</Link>
      </main>
    );
  const members = await tenantsForUser(user);
  const company = members.find((m) => m.tenantStatus !== "suspended");
  return (
    <>
      <header className="topbar platform-header">
        <strong>Administración de SmartRetail</strong>
        <nav className="app-nav" aria-label="Plataforma">
          <Link href="/platform" prefetch={false}>
            Resumen
          </Link>
          <Link href="/platform/companies" prefetch={false}>
            Empresas
          </Link>
          {company && (
            <Link href={roleLanding(company)} prefetch={false}>
              Mi empresa
            </Link>
          )}
        </nav>
        <AccountControls />
      </header>
      <main className="workspace stack" style={{ overflowWrap: "anywhere" }}>
        {children}
      </main>
    </>
  );
}
