"use client";
import { useEffect, useState } from "react";
import type { BusinessProfileDto } from "@smartretail/contracts";
import { purchasingApi } from "./purchasing-client";
export default function BusinessContext({
  tenantId,
  locationId,
  userName,
}: {
  tenantId: string;
  locationId?: string;
  userName?: string;
}) {
  const [loaded, setLoaded] = useState<{
    tenant: string;
    profile: BusinessProfileDto;
    branches: { id: string; name: string; displayName: string | null }[];
  }>();
  useEffect(() => {
    if (!tenantId) return;
    const c = new AbortController();
    purchasingApi<{
      profile: BusinessProfileDto;
      branches: { id: string; name: string; displayName: string | null }[];
    }>("/api/v1/business", tenantId, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setLoaded({ tenant: tenantId, ...d });
      })
      .catch(() => undefined);
    return () => c.abort();
  }, [tenantId]);
  const value = loaded?.tenant === tenantId ? loaded : undefined,
    branch = value?.branches.find((b) => b.id === locationId);
  return (
    <p className="company-context">
      {value
        ? (value.profile.tradeName ?? value.profile.businessName)
        : "Negocio"}
      {branch ? " · " + (branch.displayName ?? branch.name) : ""}
      {userName ? " · Cajero: " + userName : ""}
    </p>
  );
}
