import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { tenantsForUser } from "../../lib/database";
import Link from "next/link";
import PosPanel from "./pos-panel";
export const dynamic = "force-dynamic";
export default async function PosPage() {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  const memberships = await tenantsForUser(userId);
  if (!memberships.some((m) => m.permissions.includes("sales.create")))
    return (
      <main className="workspace">
        <h1>Sin acceso a ventas</h1>
        <p>No tienes permiso para crear ventas en tus empresas.</p>
        <Link href="/inventory">Volver a inventario</Link>
      </main>
    );
  return <PosPanel userId={userId} />;
}
