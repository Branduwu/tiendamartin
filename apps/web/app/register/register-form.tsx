"use client";
import Link from "next/link";
import { useState, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserAuth } from "../../lib/supabase/client";
export default function RegisterForm({ configured }: { configured: boolean }) {
  const router = useRouter(),
    sending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const form = e.currentTarget,
      data = new FormData(form);
    try {
      const { data: result, error: failure } = await browserAuth().auth.signUp({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
        options: { emailRedirectTo: window.location.origin + "/auth/callback" },
      });
      form.reset();
      if (failure) {
        setError(
          "No pudimos crear la cuenta. Revisa los datos o intenta iniciar sesión. Si el servicio de correo está ocupado, inténtalo más tarde.",
        );
        return;
      }
      if (result.session) {
        router.replace("/onboarding");
        router.refresh();
      } else setSent(true);
    } catch {
      setError("No pudimos conectar. Inténtalo de nuevo.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {!configured && <p role="status">El registro aún no está disponible.</p>}
      {sent ? (
        <p role="status">
          Si el correo puede registrarse, recibirás un enlace para verificarlo.
          Revisa tu bandeja y después inicia sesión. Si ya tienes cuenta, puedes
          entrar directamente.
        </p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>
            Correo electrónico
            <input
              name="email"
              aria-label="Correo electrónico"
              aria-describedby="register-email-help"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
            <small id="register-email-help">
              Usaremos este correo para verificar tu identidad.
            </small>
          </label>
          <label>
            Contraseña
            <input
              name="password"
              aria-label="Contraseña"
              aria-describedby="register-password-help"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
            />
            <small id="register-password-help">
              Usa al menos 8 caracteres. Nunca compartas tu contraseña.
            </small>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy || !configured}>
            {busy ? "Creando cuenta…" : "Crear cuenta"}
          </button>
        </form>
      )}
      <Link href="/login">Ya tengo cuenta · Iniciar sesión</Link>
    </div>
  );
}
