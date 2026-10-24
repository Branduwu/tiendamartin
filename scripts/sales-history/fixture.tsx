import React from "react";
import { createRoot } from "react-dom/client";
import SalesPanel from "../../apps/web/app/sales/sales-panel";
import "../../apps/web/app/globals.css";
const testWindow = window as typeof window & {
  React: typeof React;
  salesMock: (
    url: string,
    headers: Record<string, string>,
  ) => Promise<{ status: number; body: unknown }>;
};
testWindow.React = React;
window.fetch = (async (input, init) => {
  const result = await testWindow.salesMock(
    String(input),
    Object.fromEntries(new Headers(init?.headers).entries()),
  );
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(result.body), { status: result.status });
}) as typeof fetch;
createRoot(document.getElementById("root")!).render(
  <SalesPanel userId="550e8400-e29b-41d4-a716-446655440020" />,
);
