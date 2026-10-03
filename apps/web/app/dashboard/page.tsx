import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import DashboardPanel from "./dashboard-panel";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <DashboardPanel />;
}
