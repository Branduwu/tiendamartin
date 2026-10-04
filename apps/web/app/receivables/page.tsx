import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import ReceivablesPanel from "./receivables-panel";
export const dynamic = "force-dynamic";
export default async function ReceivablesPage() {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  return <ReceivablesPanel userId={userId} />;
}
