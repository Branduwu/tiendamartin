import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import PurchasesPanel from "./purchases-panel";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  const query = await searchParams;
  const selector = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value.join(",") : value;
  const replenishment =
    query.replenishProductId !== undefined ||
    query.replenishLocationId !== undefined
      ? {
          tenantId: selector(query.tenantId) ?? "",
          productId: selector(query.replenishProductId) ?? "",
          locationId: selector(query.replenishLocationId) ?? "",
        }
      : undefined;
  return (
    <PurchasesPanel
      userId={userId}
      initialTenantId={selector(query.tenantId)}
      replenishment={replenishment}
    />
  );
}
