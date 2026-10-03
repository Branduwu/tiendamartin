import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import CustomersPanel from "./customers-panel";
export const dynamic = "force-dynamic";
export default async function CustomersPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <CustomersPanel />;
}
