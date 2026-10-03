import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import InventoryAlertsPanel from "../../components/inventory-alerts-panel";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await verifiedUserId())) redirect("/login");
  const query = await searchParams;
  // Repeated selectors are forwarded as invalid text, never silently accepted.
  const selector = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value.join(",") : value;
  return (
    <InventoryAlertsPanel
      initialTenantId={selector(query.tenantId)}
      initialLocationId={selector(query.locationId)}
    />
  );
}
