import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import SuppliersPanel from "./suppliers-panel";
export const dynamic = "force-dynamic";
export default async function Page() {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  return <SuppliersPanel />;
}
