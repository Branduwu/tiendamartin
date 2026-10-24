import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import InventoryPanel from "./inventory-panel";
export const dynamic = "force-dynamic";
export default async function InventoryPage() {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  return <InventoryPanel key={userId} userId={userId} />;
}
