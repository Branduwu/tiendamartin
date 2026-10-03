import { redirect, notFound } from "next/navigation";
import { UuidSchema } from "@smartretail/contracts";
import { verifiedUserId } from "../../../lib/auth";
import CustomersPanel from "../customers-panel";
export const dynamic = "force-dynamic";
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  if (!(await verifiedUserId())) redirect("/login");
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) notFound();
  const { tenantId } = await searchParams;
  return (
    <CustomersPanel
      id={id}
      {...(tenantId === undefined ? {} : { preferredTenant: tenantId })}
    />
  );
}
