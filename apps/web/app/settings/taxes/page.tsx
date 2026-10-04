import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import TaxesPanel from "./taxes-panel";
export const dynamic = "force-dynamic";
export default async function TaxesPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <TaxesPanel />;
}
