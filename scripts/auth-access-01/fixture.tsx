import React from "react";
import { createRoot } from "react-dom/client";
import LoginForm from "../../apps/web/app/login/login-form";
import ForgotForm from "../../apps/web/app/forgot-password/forgot-form";
import RegisterForm from "../../apps/web/app/register/register-form";
import PasswordForm from "../../apps/web/app/components/password-form";
import InviteForm from "../../apps/web/app/invite/invite-form";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";
const testWindow = window as typeof window & {
  React: typeof React;
  fetchMock: (
    url: string,
    body: string | undefined,
  ) => Promise<{ status: number; body: unknown }>;
};
testWindow.React = React;
window.fetch = (async (input, init) => {
  const r = await testWindow.fetchMock(
    String(input),
    typeof init?.body === "string" ? init.body : undefined,
  );
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as typeof fetch;
const url = new URL(window.location.href),
  configured = url.searchParams.get("configured") !== "no";
const view =
  url.pathname === "/forgot-password" ? (
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
  <main className="login">
    <h1>Acceso de prueba</h1>
    {view}
  </main>,
);
