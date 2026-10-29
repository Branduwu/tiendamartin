"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import PasswordField from "./password-field";
import { Button } from "./ui";
import { browserAuth } from "../../lib/supabase/client";
import CredentialForm from "./credential-form";

export default function PasswordForm({ mode }: { mode: "reset" | "change" }) {
  const [confirmationError, setConfirmationError] = useState(false),
    [savedWithoutLogout, setSavedWithoutLogout] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const sending = useRef(false),
    code = useRef(""),
    flowId = useRef<string | undefined>(undefined);
  const captured = useRef(false);
  const [ready, setReady] = useState(mode === "change"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [reauth, setReauth] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (mode !== "reset" || captured.current) return;
    captured.current = true;
    const url = new URL(window.location.href);
    code.current = url.searchParams.get("code") ?? "";
    flowId.current = url.searchParams.get("sb_flow_id") ?? undefined;
    const valid =
      !!code.current &&
      code.current.length <= 4096 &&
      !url.searchParams.has("error");
    // Keep an unused code across a reload; clear it before any exchange.
    if (!valid) window.history.replaceState(null, "", "/reset-password");
    setReady(valid);
    if (!valid) setError("Este enlace ya no es válido. Solicita uno nuevo.");
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !ready) return;
    const form = event.currentTarget,
      data = new FormData(form),
      password = String(data.get("password")),
      confirmation = String(data.get("confirmation"));
    setConfirmationError(false);
    if (password !== confirmation) {
      setError("");
      setConfirmationError(true);
      form
        .querySelector<HTMLInputElement>('input[name="confirmation"]')
        ?.focus();
      return;
    }
    sending.current = true;
    if (mode === "reset")
      window.history.replaceState(null, "", "/reset-password");
    setBusy(true);
    setError("");
    try {
      const credentials =
        mode === "reset"
          ? {
              code: code.current,
              ...(flowId.current ? { flowId: flowId.current } : {}),
            }
          : {
              currentPassword: String(data.get("currentPassword")),
              ...(data.get("nonce")
                ? { nonce: String(data.get("nonce")) }
                : {}),
            };
      const response = await fetch(
        `/api/auth/${mode === "reset" ? "reset" : "change"}-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirmation, ...credentials }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "password_update_unconfirmed") {
          form.reset();
          code.current = "";
          flowId.current = undefined;
          setReady(false);
          setUncertain(true);
          return;
        }
        if (result.code === "password_saved_logout_failed") {
          form.reset();
          code.current = "";
          setSavedWithoutLogout(true);
          return;
        }
        // Only expose our own bounded messages, never a provider body or a proxy error.
        setError(
          response.status === 409
            ? "Solicita un código de confirmación para continuar."
            : response.status === 401 && mode === "reset"
              ? "Este enlace ya no es válido. Solicita uno nuevo."
              : response.status === 400
                ? result.code === "current_password_invalid"
                  ? "Revisa la contraseña actual."
                  : "No pudimos guardar la contraseña. Revisa los datos y usa una nueva diferente."
                : "No pudimos completar el cambio. Solicita un nuevo enlace o inténtalo más tarde.",
        );
        if (result.code === "reauthentication_required") setReauth(true);
        if (mode === "reset") setReady(false);
      } else {
        form.reset();
        code.current = "";
        setDone(true);
      }
    } catch {
      // A lost response is not evidence that the provider rejected the update.
      form.reset();
      code.current = "";
      flowId.current = undefined;
      setReady(false);
      setUncertain(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function logoutForLogin() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await browserAuth().auth.signOut({ scope: "local" });
      if (result.error) {
        setError(
          "No pudimos cerrar esta sesión. Inténtalo de nuevo; el resultado del cambio sigue sin confirmar.",
        );
        return;
      }
      window.location.assign(new URL("/login", window.location.origin).href);
    } catch {
      setError(
        "No pudimos cerrar esta sesión. Inténtalo de nuevo; el resultado del cambio sigue sin confirmar.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (uncertain)
    return (
      <div className="stack">
        <p role="status">
          No pudimos confirmar si se guardó la contraseña. No repitas el cambio
          automáticamente. Comprueba el acceso con la nueva contraseña; si no
          funciona, solicita un nuevo enlace.
        </p>
        <p className="muted">
          Para comprobar la nueva contraseña, primero cierra esta sesión e
          inicia sesión de nuevo.
        </p>
        <Button busy={busy} onClick={logoutForLogin}>
          Cerrar sesión y comprobar acceso
        </Button>
        {error && <p role="alert">{error}</p>}
        <Link href="/forgot-password">Solicitar un nuevo enlace</Link>
      </div>
    );
  if (savedWithoutLogout)
    return (
      <div className="stack">
        <p role="status">
          Contraseña actualizada; no pudimos cerrar las sesiones. Cierra esta
          sesión antes de continuar.
        </p>
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await browserAuth().auth.signOut({
                scope: "local",
              });
              if (!result.error)
                window.location.assign(
                  new URL("/login", window.location.origin).href,
                );
              else setError("No pudimos cerrar sesión. Inténtalo de nuevo.");
            } catch {
              setError("No pudimos cerrar sesión. Inténtalo de nuevo.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Cerrar sesión
        </Button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  async function sendCode() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/auth/reauthenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setNotice(
        r.ok
          ? "Revisa el correo de tu cuenta para confirmar el cambio."
          : "Espera unos minutos antes de volver a solicitar el código.",
      );
    } catch {
      setNotice("No pudimos conectar. Inténtalo de nuevo.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="stack">
        <p role="status">
          Contraseña actualizada. Inicia sesión con tu nueva contraseña.
        </p>
        <a href="/login">Iniciar sesión</a>
      </div>
    );
  return (
    <div className="stack">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {ready && (
        <CredentialForm
          action={mode === "reset" ? "/reset-password" : "/settings/account"}
          onSubmit={submit}
          busy={busy}
        >
          <fieldset disabled={busy} className="stack">
            {mode === "change" && (
              <PasswordField
                name="currentPassword"
                label="Contraseña actual"
                current
              />
            )}
            <PasswordField name="password" label="Nueva contraseña" />
            <PasswordField
              name="confirmation"
              label="Confirmar contraseña"
              invalid={confirmationError}
            />
            {confirmationError && (
              <p id="confirmation-error" role="alert" className="error">
                Las contraseñas no coinciden.
              </p>
            )}
            <p id="password-requirements" className="muted">
              De 8 a 128 caracteres. Se permiten espacios, acentos y símbolos.
              Usa una contraseña diferente y evita reutilizarla.
            </p>
            {reauth && (
              <>
                <label>
                  Código de confirmación
                  <input
                    name="nonce"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    minLength={6}
                    maxLength={10}
                    required
                  />
                </label>
                <button className="secondary" type="button" onClick={sendCode}>
                  Enviar código de confirmación
                </button>
              </>
            )}
          </fieldset>
          {notice && <p role="status">{notice}</p>}
          <Button type="submit" busy={busy} busyLabel="Guardando…">
            Guardar contraseña
          </Button>
        </CredentialForm>
      )}
      <Link href="/forgot-password">Solicitar un nuevo enlace</Link>
    </div>
  );
}
