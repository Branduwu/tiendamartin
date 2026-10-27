import Link from "next/link";
import { companyHref } from "../../lib/company-selection";

/** Explains coverage without inferring configuration from a zero alert count. */
export default function InventoryAlertScope({
  tenantId,
  permissions,
  locationId,
}: {
  tenantId: string;
  permissions: readonly string[];
  locationId?: string | undefined;
}) {
  const inventory =
    companyHref("/inventory", tenantId) +
    (locationId ? `&locationId=${encodeURIComponent(locationId)}` : "");
  return (
    <div className="alert-scope">
      <p>
        <span aria-hidden="true">ⓘ </span>
        <strong>Solo productos con mínimo configurado</strong>
      </p>
      <p>
        Sin mínimo no hay alerta automática. Puede haber productos agotados que
        no aparecen aquí.
      </p>
      <div className="actions">
        {permissions.includes("inventory.read") && (
          <Link href={inventory}>Revisar existencias</Link>
        )}
        {permissions.includes("inventory.read") &&
          permissions.includes("inventory.minimum.write") && (
            <Link href={inventory}>Configurar mínimos</Link>
          )}
      </div>
    </div>
  );
}
