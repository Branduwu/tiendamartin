"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SUSPENDED_COMPANY_MESSAGE } from "@smartretail/application";
export default function PlatformContext() {
  const [platform, setPlatform] = useState(false),
    [suspended, setSuspended] = useState<string[]>([]);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/platform", { signal: c.signal, cache: "no-store" })
      .then((r) => {
        if (!c.signal.aborted) setPlatform(r.ok);
      })
      .catch(() => {});
    fetch("/api/v1/tenants", { signal: c.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const d: { tenants: { tenantName: string; tenantStatus: string }[] } =
          await r.json();
        if (!c.signal.aborted)
          setSuspended(
            d.tenants
              .filter((t) => t.tenantStatus === "suspended")
              .map((t) => t.tenantName),
          );
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  return (
    <>
      {platform && <Link href="/platform">Administración de plataforma</Link>}
      {!!suspended.length && (
        <p role="alert">
          {suspended.join(", ")}: {SUSPENDED_COMPANY_MESSAGE}
        </p>
      )}
    </>
  );
}
