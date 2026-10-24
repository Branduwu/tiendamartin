import React from "react";
import { createRoot } from "react-dom/client";
import InitialSetupPanel from "../../apps/web/app/help/initial-setup";
import OnboardingForm from "../../apps/web/app/onboarding/onboarding-form";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const fixture = window as typeof window & {
  React: typeof React;
  fetchMock: (
    url: string,
    headers: Record<string, string>,
    body?: string,
  ) => Promise<{ status: number; body: unknown }>;
};
fixture.React = React;
window.fetch = (async (input, init) => {
  const r = await fixture.fetchMock(
    String(input),
    Object.fromEntries(new Headers(init?.headers)),
    typeof init?.body === "string" ? init.body : undefined,
  );
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as typeof fetch;
const url = new URL(location.href);
createRoot(document.getElementById("root")!).render(
  <main className="workspace" style={{ maxWidth: 1000, margin: "auto" }}>
    <h1>Configuración inicial</h1>
    {url.pathname === "/start" ? (
      <OnboardingForm actor="synthetic-user" />
    ) : (
      <InitialSetupPanel compact={url.searchParams.get("compact") === "yes"} />
    )}
  </main>,
);
