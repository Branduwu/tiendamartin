import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import PromotionsPanel from "./promotions-panel";
export const dynamic = "force-dynamic";
export default async function PromotionsPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <PromotionsPanel />;
}
