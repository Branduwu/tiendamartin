import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import SalesPanel from "./sales-panel";
export const dynamic = "force-dynamic";
export default async function SalesPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <SalesPanel />;
}
