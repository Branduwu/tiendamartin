import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import DashboardPanel from "./dashboard-panel";
import { tenantsForUser } from "../../lib/database";
import { roleLanding, canOpenDashboard } from "../../lib/navigation";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const actor = await verifiedUserId();
  if (!actor) redirect("/login");
  const tenants = await tenantsForUser(actor);
  const member =
    tenants.find((t) => t.tenantStatus !== "suspended") ?? tenants[0];
  const landing = roleLanding(member);
  if (
    !canOpenDashboard(tenants) &&
    landing !== "/dashboard" &&
    landing !== "/onboarding"
  )
    redirect(landing);
  return <DashboardPanel />;
}
