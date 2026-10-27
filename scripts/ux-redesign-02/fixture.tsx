import React from "react";
import { createRoot } from "react-dom/client";
import AccountPage from "../../apps/web/app/settings/account/page";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const host = window as typeof window & {
  React: typeof React;
  accountMock: (
    url: string,
    init: { method: string; body: string | undefined },
  ) => Promise<{ status: number; body: unknown }>;
};
host.React = React;
const nativeFetch = window.fetch.bind(window);
window.fetch = (async (input, init) => {
  if (
    String(input).startsWith("/api/v1/profile/photo") &&
    (!init?.method || init.method === "GET")
  )
    return nativeFetch(input, init);
  const result = await host.accountMock(String(input), {
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(result.body), { status: result.status });
}) as typeof fetch;
Promise.resolve(AccountPage()).then((view) =>
  createRoot(document.getElementById("root")!).render(view),
);
