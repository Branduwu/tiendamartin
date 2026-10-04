"use client";
import { useEffect, useState } from "react";
export class PurchasingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function purchasingApi<T>(
  path: string,
  tenantId?: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (tenantId) headers.set("x-tenant-id", tenantId);
  if (init?.body) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers,
    });
  } catch {
    throw new PurchasingApiError(
      "No pudimos confirmar la respuesta. Reintenta cuando tengas conexión.",
      0,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PurchasingApiError(
      "No pudimos confirmar la respuesta del servidor.",
      0,
    );
  }
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "No pudimos completar la operación.";
    throw new PurchasingApiError(message, response.status);
  }
  return body as T;
}
export type PurchasingTenant = {
  tenantId: string;
  permissions: readonly string[];
};
export function usePurchasingCompany(
  permission:
    | "suppliers.read"
    | "purchases.read"
    | "customers.read"
    | "reports.read"
    | "promotions.read"
    | "taxes.manage",
  preferred?: string,
) {
  const [tenants, setTenants] = useState<PurchasingTenant[]>([]),
    [tenantId, setTenantId] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ tenants: PurchasingTenant[] }>(
      "/api/v1/tenants",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        const allowed = data.tenants.filter((t) =>
          t.permissions.includes(permission),
        );
        setTenants(allowed);
        setTenantId(
          allowed.some((t) => t.tenantId === preferred)
            ? (preferred ?? "")
            : (allowed[0]?.tenantId ?? ""),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("No pudimos cargar tus empresas. Recarga para reintentar.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [permission, preferred]);
  return {
    tenants,
    tenantId,
    setTenantId,
    loading,
    error,
    permissions:
      tenants.find((t) => t.tenantId === tenantId)?.permissions ?? [],
  };
}
