import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import PurchasesPanel from "../purchases-panel";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const { tenantId } = await searchParams;
  return (
    <PurchasesPanel
      userId={userId}
      initialPurchaseId={id}
      {...(tenantId ? { initialTenantId: tenantId } : {})}
    />
  );
}
