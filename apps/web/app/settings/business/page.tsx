import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import BusinessPanel from "./business-panel";
export const dynamic = "force-dynamic";
export default async function BusinessPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <BusinessPanel />;
}
