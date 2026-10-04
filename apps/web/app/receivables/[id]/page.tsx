import { redirect, notFound } from "next/navigation";
import { UuidSchema } from "@smartretail/contracts";
import { verifiedUserId } from "../../../lib/auth";
import ReceivablesPanel from "../receivables-panel";
export const dynamic = "force-dynamic";
export default async function ReceivablePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) notFound();
  const { tenantId } = await searchParams;
  return (
    <ReceivablesPanel
      id={id}
      userId={userId}
      {...(tenantId === undefined ? {} : { preferredTenant: tenantId })}
    />
  );
}
