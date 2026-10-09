"use client";
import { LoadingLabel } from "./ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserAuth } from "../../lib/supabase/client";
import ThemeToggle from "./theme-toggle";
import Link from "next/link";
export default function AccountControls({
  blocked = false,
  compact = false,
  identity,
  role,
}: {
  blocked?: boolean;
  compact?: boolean;
  identity?: string | undefined;
  role?: string | undefined;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  async function logout() {
    if (blocked || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await browserAuth().auth.signOut();
      if (result.error) throw result.error;
      router.replace("/login");
      router.refresh();
    } catch {
      setError("No pudimos cerrar sesión. Inténtalo de nuevo.");
      setBusy(false);
    }
  }
  const controls = (
    <div className="shell-account">
      {compact && <p className="account-identity">{identity ?? "Tu cuenta"}</p>}
      <ThemeToggle />
      {!blocked && (
        <>
          <Link href="/help/support" prefetch={false}>
            Ayuda y soporte
          </Link>
          <Link href={`/help/roles${role ? `#${role}` : ""}`} prefetch={false}>
            Ver qué puedo hacer
          </Link>
        </>
      )}
      {!blocked && (
        <Link href="/settings/account" prefetch={false}>
          Cambiar contraseña
        </Link>
      )}
      <button
        type="button"
        className="ghost"
        disabled={blocked || busy}
        onClick={logout}
      >
        <LoadingLabel busy={busy} label="Cerrando sesión…">
          Cerrar sesión
        </LoadingLabel>
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
  return compact ? (
    <details
      className="pilot-account-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="Menú de usuario">
        Cuenta <span aria-hidden="true">⌄</span>
      </summary>
      {controls}
    </details>
  ) : (
    controls
  );
}
