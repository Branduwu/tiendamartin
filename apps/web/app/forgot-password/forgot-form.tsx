"use client";
import { useRef, useState, type FormEvent } from "react";
import { browserAuth } from "../../lib/supabase/client";
import { Button } from "../components/ui";
export const RECOVERY_MESSAGE =
  "Si existe una cuenta con ese correo, recibirás instrucciones para restablecer tu contraseña.";
export default function ForgotForm({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  const sending = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !configured) return;
    sending.current = true;
    setBusy(true);
    const form = event.currentTarget;
    try {
      await browserAuth().auth.resetPasswordForEmail(
        String(new FormData(form).get("email")).trim(),
        { redirectTo: window.location.origin + "/reset-password" },
      );
    } catch {
      /* Identical account-independent response, including network/provider limits. */
    } finally {
      form.reset();
      setSent(true);
      setBusy(false);
      sending.current = false;
    }
  }
  return sent ? (
    <div role="status" className="stack">
      <p>{RECOVERY_MESSAGE}</p>
      <p className="muted">
        Revisa también spam. Si no llega, espera unos minutos antes de volver a
        intentarlo. Abre el enlace en este mismo navegador.
      </p>
      <button
        className="secondary"
        type="button"
        onClick={() => setSent(false)}
      >
        Intentar con otro correo
      </button>
    </div>
  ) : (
    <form className="stack" onSubmit={submit}>
      {!configured && (
        <p role="status">
          La recuperación aún no está disponible. Contacta al administrador.
        </p>
      )}
      <label>
        Correo electrónico
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
      </label>
      <Button
        busy={busy}
        busyLabel="Enviando…"
        disabled={!configured}
        type="submit"
      >
        Enviar enlace
      </Button>
    </form>
  );
}
