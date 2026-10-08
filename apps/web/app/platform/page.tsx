import Link from "next/link";
import { verifiedUserId } from "../../lib/auth";
import { platformForUser } from "../../lib/database";
export default async function PlatformPage() {
  const actor = await verifiedUserId();
  if (!actor || !(await platformForUser(actor).access())) return null;
  const { summary } = await platformForUser(actor).list();
  return (
    <>
      <h1>Plataforma</h1>
      <p>
        Administración de empresas. Este portal no concede acceso a sus
        operaciones comerciales.
      </p>
      <section className="panel stack">
        <h2>Empresas registradas</h2>
        <p>Total: {summary.total}</p>
        <p>Activas: {summary.active}</p>
        <p>Suspendidas: {summary.suspended}</p>
        <Link href="/platform/companies">Administrar empresas</Link>
      </section>
    </>
  );
}
