"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserAuth } from "../../lib/supabase/client";
import Link from "next/link";
import { readInvitationToken } from "../../lib/invitation-handoff";
import { AUTH_MESSAGES } from "../../lib/supabase/resilience";
import { loginAttempt } from "../../lib/supabase/login-attempt";
export default function LoginForm({
  configured,
  destination = "/onboarding",
}: {
  configured: boolean;
  destination?: "/onboarding" | "/invite";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settling, setSettling] = useState(false);
  const [ready, setReady] = useState(false);
  const [continuePath, setContinuePath] = useState("/onboarding");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const attempt = useRef<ReturnType<typeof loginAttempt> | null>(null);
  function getAttempt() {
    if (attempt.current === null)
      attempt.current = loginAttempt(
        (credentials) => browserAuth().auth.signInWithPassword(credentials),
        (result) => {
          if (!mounted.current) return;
          setSettling(false);
          if (result.kind === "success") {
            setContinuePath(nextPath());
            setReady(true);
            setError("");
          } else if (result.kind === "error")
            setError(AUTH_MESSAGES[result.failure]);
        },
      );
    return attempt.current;
  }
  const nextPath = () => {
    let next = destination;
    try {
      if (readInvitationToken()) next = "/invite";
    } catch {
      /* Unavailable storage cannot block a successful login. */
    }
    return next;
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    const flow = getAttempt();
    if (flow.pending || flow.authenticated) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await flow.run({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      if (!mounted.current) return;
      setSettling(flow.pending);
      if (result.kind === "error") {
        setError(AUTH_MESSAGES[result.failure]);
        return;
      }
      if (result.kind === "success") {
        const path = nextPath();
        setContinuePath(path);
        setReady(true);
        router.replace(path);
      }
    } catch {
      if (mounted.current) setError(AUTH_MESSAGES.unknown);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="stack"
      aria-busy={busy}
      aria-describedby={error ? "login-error" : undefined}
    >
      {!configured && (
        <p role="status" className="warning">
          El inicio de sesión aún no está disponible. Contacta al administrador.
        </p>
      )}
      <label>
        Correo electrónico
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label>
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
        />
      </label>
      {error && (
        <p id="login-error" role="alert" className="error">
          {error}
        </p>
      )}
      {settling && (
        <p role="status">
          La solicitud anterior sigue terminando. No envíes otro intento; si no
          finaliza, recarga esta página.
        </p>
      )}
      {ready && (
        <p role="status">
          Sesión iniciada.{" "}
          <Link href={continuePath} prefetch={false}>
            Continuar
          </Link>
        </p>
      )}
      <button disabled={busy || settling || ready || !configured} type="submit">
        {busy
          ? "Iniciando sesión…"
          : ready
            ? "Sesión iniciada"
            : settling
              ? "Solicitud pendiente"
              : "Iniciar sesión"}
      </button>
      <Link href="/register">Crear una cuenta</Link>
      <Link href="/forgot-password">¿Olvidaste tu contraseña?</Link>
    </form>
  );
}
