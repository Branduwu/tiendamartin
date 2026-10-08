import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { platformForUser } from "../../lib/database";
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
  return (
    <>
      <header className="topbar">
        <strong>Administración de SmartRetail</strong>
        <nav className="app-nav" aria-label="Plataforma">
          <Link href="/platform">Resumen</Link>
          <Link href="/platform/companies">Empresas</Link>
          <Link href="/products">Ir a mi empresa</Link>
        </nav>
      </header>
      <main className="workspace stack" style={{ overflowWrap: "anywhere" }}>
        {children}
      </main>
    </>
  );
}
