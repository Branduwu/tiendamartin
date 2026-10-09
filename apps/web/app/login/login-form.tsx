"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserAuth } from "../../lib/supabase/client";
import Link from "next/link";
import { readInvitationToken } from "../../lib/invitation-handoff";
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { error } = await browserAuth().auth.signInWithPassword({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      if (error) {
        setError("No pudimos iniciar sesión. Revisa tu correo y contraseña.");
        setBusy(false);
        return;
      }
      router.replace(readInvitationToken() ? "/invite" : destination);
      router.refresh();
    } catch {
      setError("No pudimos conectar. Inténtalo de nuevo.");
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="stack"
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
      <button disabled={busy || !configured} type="submit">
        {busy ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
      <Link href="/register">Crear una cuenta</Link>
    </form>
  );
}
