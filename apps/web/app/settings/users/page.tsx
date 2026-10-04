import { redirect } from "next/navigation";
import { verifiedUserId } from "../../../lib/auth";
import UsersPanel from "./users-panel";
export const dynamic = "force-dynamic";
export default async function UsersPage() {
  if (!(await verifiedUserId())) redirect("/login");
  return <UsersPanel />;
}
