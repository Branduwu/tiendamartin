import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import DocumentCapturePanel from "./document-capture-panel";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await verifiedUserId())) redirect("/login");
  const query = await searchParams;
  return (
    <DocumentCapturePanel
      initialTenantId={
        typeof query.tenantId === "string" ? query.tenantId : undefined
      }
    />
  );
}
