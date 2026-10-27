import React from "react";
import { createRoot } from "react-dom/client";
import DashboardPanel from "../../apps/web/app/dashboard/dashboard-panel";
import InventoryAlertsPanel from "../../apps/web/app/components/inventory-alerts-panel";
import HelpHome from "../../apps/web/app/help/help-home";
import AppNavigation from "../../apps/web/app/components/app-navigation";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const host = window as typeof window & {
  React: typeof React;
  uxMock: (
    url: string,
    init: { method: string; headers: Record<string, string> },
  ) => Promise<{ status: number; body: unknown }>;
};
host.React = React;
window.fetch = (async (url, init) => {
  const result = await host.uxMock(String(url), {
    method: init?.method ?? "GET",
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(result.body), { status: result.status });
}) as typeof fetch;
const view = location.pathname;
createRoot(document.getElementById("root")!).render(
  view === "/dashboard" ? (
    <DashboardPanel />
  ) : view === "/inventory/alerts" ? (
    <InventoryAlertsPanel />
  ) : (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          compact
          current="/help"
          blocked={new URLSearchParams(location.search).has("locked")}
        />
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className="workspace stack help-layout"
      >
        <HelpHome />
      </main>
    </>
  ),
);
