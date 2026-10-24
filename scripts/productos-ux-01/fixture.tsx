import React from "react";
import { createRoot } from "react-dom/client";
import ProductsPanel from "../../apps/web/app/products/products-panel";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const testWindow = window as typeof window & {
  React: typeof React;
  productMock: (
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
  const r = await testWindow.productMock(String(input), {
    method: init?.method ?? "GET",
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as typeof fetch;
createRoot(document.getElementById("root")!).render(<ProductsPanel />);
