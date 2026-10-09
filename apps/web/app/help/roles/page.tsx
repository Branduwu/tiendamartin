import Link from "next/link";
import { roleGuides } from "../../../lib/help-content";
import { verifiedUserId } from "../../../lib/auth";
import { platformForUser } from "../../../lib/database";
export default async function RolesPage() {
  const actor = await verifiedUserId();
  const platform = actor && (await platformForUser(actor).access());
  return (
    <article className="help-article">
      <Link href="/help">← Ayuda</Link>
      <h1>¿Qué puedo hacer según mi rol?</h1>
      <p>
        El rol aplica dentro de una empresa. Cambiar la empresa o la sucursal no
        concede permisos adicionales.
      </p>
      {Object.entries(roleGuides).map(([key, r]) => (
        <section id={key} key={key}>
          <h2>{r.title}</h2>
          <p>{r.summary}</p>
        </section>
      ))}
      {platform && (
        <section id="platform_admin">
          <h2>Administrador de SmartRetail</h2>
          <p>
            Administra empresas, suspensión y solicitudes de soporte. Es una
            autorización independiente de Propietario o Administrador de una
            empresa. No concede acceso automático a ventas o inventario
            empresarial.
          </p>
          <Link href="/platform/support">Bandeja de soporte</Link>
        </section>
      )}
    </article>
  );
}
