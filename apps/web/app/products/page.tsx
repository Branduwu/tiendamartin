import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import ProductsPanel from "./products-panel";
export const dynamic = "force-dynamic";
export default async function ProductsPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <ProductsPanel />;
}
