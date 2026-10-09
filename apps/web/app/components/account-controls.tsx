"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserAuth } from "../../lib/supabase/client";
import ThemeToggle from "./theme-toggle";
export default function AccountControls({
  blocked = false,
}: {
  blocked?: boolean;
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
  return (
    <div className="shell-account">
      <ThemeToggle />
      <button
        type="button"
        className="ghost"
        disabled={blocked || busy}
        onClick={logout}
      >
        {busy ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
