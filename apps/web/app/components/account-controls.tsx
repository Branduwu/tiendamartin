"use client";
import { LoadingLabel } from "./ui";
import { useEffect, useState } from "react";
import { roleLabel } from "../../lib/navigation";
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
  const [profileName, setProfileName] = useState("");
  const [photoEnabled, setPhotoEnabled] = useState(false),
    [photoFailed, setPhotoFailed] = useState(false),
    [photoVersion, setPhotoVersion] = useState(0);
  useEffect(() => {
    let controller: AbortController;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      fetch("/api/v1/profile?summary=1", { cache: "no-store", signal })
        .then(async (r) => {
          if (!r.ok) return;
          const data = await r.json();
          if (!signal.aborted) {
            setProfileName(
              typeof data.displayName === "string" ? data.displayName : "",
            );
            setPhotoEnabled(data.photoEnabled === true);
            setPhotoFailed(false);
            setPhotoVersion((v) => v + 1);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("smartretail:profile-updated", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("smartretail:profile-updated", refresh);
    };
  }, []);
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
      {photoEnabled && !photoFailed && (
        // Private cookie-authenticated image; do not use the public image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/profile/photo?v=${photoVersion}`}
          width={40}
          height={40}
          style={{ borderRadius: "50%", objectFit: "cover" }}
          alt="Tu fotografía"
          onError={() => setPhotoFailed(true)}
        />
      )}
      {compact && (
        <p className="account-identity">
          {profileName
            ? [profileName, role ? roleLabel(role) : ""]
                .filter(Boolean)
                .join(" · ")
            : (identity ?? "Tu cuenta")}
        </p>
      )}
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
          Mi perfil y contraseña
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
