import "../../apps/web/instrumentation-client";
import React from "react";
import { createRoot } from "react-dom/client";
import LoginForm from "../../apps/web/app/login/login-form";
import ForgotForm from "../../apps/web/app/forgot-password/forgot-form";
import RegisterForm from "../../apps/web/app/register/register-form";
import PasswordForm from "../../apps/web/app/components/password-form";
import InviteForm from "../../apps/web/app/invite/invite-form";
import InvitationsPanel from "../../apps/web/app/settings/users/invitations-panel";
import ProfilePanel from "../../apps/web/app/settings/account/profile-panel";
import AppNavigation from "../../apps/web/app/components/app-navigation";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const testWindow = window as typeof window & {
  React: typeof React;
  fetchMock: (
    url: string,
    body: string | undefined,
    init: {
      method: string;
      headers: Record<string, string>;
      bodySize?: number;
    },
  ) => Promise<{ status: number; body: unknown }>;
};
testWindow.React = React;
const nativeFetch = window.fetch.bind(window);
window.fetch = (async (input, init) => {
  if (
    String(input).startsWith("/api/v1/profile/photo") &&
    (!init?.method || init.method === "GET")
  )
    return nativeFetch(input, init);
  const r = await testWindow.fetchMock(
    String(input),
    typeof init?.body === "string" ? init.body : undefined,
    {
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body instanceof Blob ? { bodySize: init.body.size } : {}),
    },
  );
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as typeof fetch;
const url = new URL(window.location.href),
  configured = url.searchParams.get("configured") !== "no";
const view =
  url.pathname === "/settings/account" ? (
    <>
      <h2>Mi perfil</h2>
      <ProfilePanel />
      <section className="panel stack">
        <h2>Cambiar contraseña</h2>
        <PasswordForm mode="change" />
      </section>
    </>
  ) : url.pathname === "/settings/users" ? (
    <InvitationsPanel
      tenantId="550e8400-e29b-41d4-a716-446655440001"
      onBusy={() => {}}
    />
  ) : url.pathname === "/forgot-password" ? (
    <ForgotForm configured={configured} />
  ) : url.pathname === "/register" ? (
    <RegisterForm configured={configured} />
  ) : url.pathname === "/reset-password" ? (
    <PasswordForm mode="reset" />
  ) : url.pathname === "/change" ? (
    <PasswordForm mode="change" />
  ) : url.pathname === "/invite" ? (
    <InviteForm
      authenticated={url.searchParams.get("authenticated") !== "no"}
    />
  ) : (
    <>
      <LoginForm configured={configured} />
      <details>
        <summary>Verificar mi correo</summary>
        <ForgotForm configured={configured} mode="confirmation" />
      </details>
    </>
  );
createRoot(document.getElementById("root")!).render(
  <>
    {url.pathname === "/settings/account" && (
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation current="/settings/account" />
      </header>
    )}
    <main
      className={url.pathname === "/settings/account" ? "workspace" : "login"}
      id="workspace-content"
      tabIndex={-1}
    >
      <div
        className="stack"
        style={
          url.pathname === "/settings/account" ? { maxWidth: "60rem" } : {}
        }
      >
        <h1>Acceso de prueba</h1>
        {view}
      </div>
    </main>
  </>,
);
