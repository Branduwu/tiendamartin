import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import AppNavigation from "../components/app-navigation";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await verifiedUserId())) redirect("/login");
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/help">
          SmartRetail
        </Link>
        <AppNavigation compact current="/help" />
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className="workspace stack help-layout"
      >
        {children}
      </main>
    </>
  );
}
