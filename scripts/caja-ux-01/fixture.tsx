import React from "react";
import { createRoot } from "react-dom/client";
import CashPanel from "../../apps/web/app/cash/cash-panel";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const testWindow = window as typeof window & {
  React: typeof React;
  cashMock: (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string | undefined;
    },
  ) => Promise<{ status: number; body: unknown }>;
};
testWindow.React = React;
window.fetch = (async (input, init) => {
  const result = await testWindow.cashMock(String(input), {
    method: init?.method ?? "GET",
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(result.body), { status: result.status });
}) as typeof fetch;
createRoot(document.getElementById("root")!).render(
  <CashPanel userId="550e8400-e29b-41d4-a716-446655440020" />,
);
