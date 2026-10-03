import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import InventoryPanel from "./inventory-panel";
export const dynamic = "force-dynamic";
export default async function InventoryPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <InventoryPanel />;
}
