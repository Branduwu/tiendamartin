import React from "react";
import { createRoot } from "react-dom/client";
import UsersPanel from "../../apps/web/app/settings/users/users-panel";
import BusinessPanel from "../../apps/web/app/settings/business/business-panel";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const host = window as typeof window & {
  React: typeof React;
  settingsMock: (
    url: string,
    init: {
      method: string;
      body: string | undefined;
      headers: Record<string, string>;
    },
  ) => Promise<{ status: number; body: unknown }>;
};
host.React = React;
window.fetch = (async (input, init) => {
  const result = await host.settingsMock(String(input), {
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : undefined,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(result.body), { status: result.status });
}) as typeof fetch;
createRoot(document.getElementById("root")!).render(
  location.pathname.endsWith("/users") ? <UsersPanel /> : <BusinessPanel />,
);
