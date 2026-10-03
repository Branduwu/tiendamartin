import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import CashPanel from "./cash-panel";
export const dynamic = "force-dynamic";
export default async function CashPage() {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  return <CashPanel userId={userId} />;
}
