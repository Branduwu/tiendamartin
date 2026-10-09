"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  saveInvitationToken,
  readInvitationToken,
  clearInvitationToken,
} from "../../lib/invitation-handoff";
class InvitationResponseError extends Error {}
export default function InviteForm({
  authenticated,
}: {
  authenticated: boolean;
}) {
  const router = useRouter(),
    sending = useRef(false);
  const [token, setToken] = useState(""),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const params = new URLSearchParams(window.location.hash.slice(1)),
          fromLink = params.get("token");
        window.history.replaceState(null, "", "/invite");
        if (fromLink && /^[a-f0-9]{64}$/.test(fromLink)) {
          saveInvitationToken(fromLink);
          setToken(fromLink);
        } else if (fromLink) {
          clearInvitationToken();
          setError("El enlace no es válido. Solicita una nueva invitación.");
        } else {
          const saved = readInvitationToken();
          if (saved && /^[a-f0-9]{64}$/.test(saved)) setToken(saved);
        }
        setReady(true);
      } catch {
        setError(
          "No pudimos recuperar el enlace. Ábrelo de nuevo en este navegador.",
        );
        setReady(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  async function accept() {
    if (sending.current || !token) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        if ([404, 409].includes(response.status)) {
          clearInvitationToken();
          setToken("");
        }
        throw new InvitationResponseError(
          result !== null &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "No pudimos confirmar la invitación.",
        );
      }
      clearInvitationToken();
      // Membership changed: discard prefetched redirects from before acceptance.
      window.location.assign(new URL("/products", window.location.origin).href);
    } catch (e) {
      setError(
        e instanceof InvitationResponseError
          ? e.message
          : "No pudimos conectar o confirmar la invitación. Reintenta en unos momentos.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (!ready) return <p role="status">Comprobando enlace…</p>;
  return (
    <div className="stack">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {token ? (
        authenticated ? (
          <>
            <p>
              Al aceptar, se añadirá esta empresa a tu cuenta. Tus otras
              empresas conservarán sus datos separados.
            </p>
            <button disabled={busy} onClick={() => void accept()}>
              {busy ? "Confirmando…" : "Aceptar invitación"}
            </button>
            <Link href="/products">Comprobar mis empresas</Link>
          </>
        ) : (
          <>
            <p>
              Primero inicia sesión o crea una cuenta con el correo invitado y
              verifícalo. Después podrás aceptar aquí.
            </p>
            <Link href="/login?next=invite">Iniciar sesión</Link>
            <Link href="/register">Crear cuenta</Link>
          </>
        )
      ) : (
        <p>
          Abre el enlace completo que te compartió el administrador. Si venció o
          ya fue usado, solicita uno nuevo.
        </p>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          clearInvitationToken();
          setToken("");
          router.replace("/onboarding");
        }}
      >
        Descartar invitación y volver a mi cuenta
      </button>
    </div>
  );
}
