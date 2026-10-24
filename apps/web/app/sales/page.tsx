import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import SalesPanel from "./sales-panel";
export const dynamic = "force-dynamic";
export default async function SalesPage() {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  return <SalesPanel key={userId} userId={userId} />;
}
