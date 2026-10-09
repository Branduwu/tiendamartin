"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { InitialSetup } from "@smartretail/application";
import {
  usePurchasingCompany,
  purchasingApi,
} from "../components/purchasing-client";
export const setupSteps = [
  ["company", "Empresa creada", "business"],
  ["branch", "Primera sucursal", "branches"],
  ["product", "Agrega tu primer producto", "products"],
  ["inventory", "Registra inventario", "inventory"],
  ["team", "Invita a tu equipo (opcional)", "users"],
  ["taxes", "Configura impuestos si los necesitas (opcional)", "taxes"],
  ["cash", "Abre una caja", "cash"],
  ["sale", "Realiza tu primera venta", "pos"],
] as const;
export function setupProgress(value: InitialSetup) {
  return [
    value.company,
    value.branch,
    value.product,
    value.inventory,
    value.cash,
    value.sale,
  ].filter(Boolean).length;
}
export default function InitialSetupPanel({
  compact = false,
  preferred,
}: {
  compact?: boolean;
  preferred?: string;
}) {
  const { tenants, tenantId, setTenantId, loading, error } =
    usePurchasingCompany("settings.manage", preferred);
  const [result, setResult] = useState<{
      tenantId: string;
      value: InitialSetup;
    } | null>(null),
    [failure, setFailure] = useState("");
  useEffect(() => {
    if (!tenantId) return;
    const c = new AbortController();
    purchasingApi<InitialSetup>("/api/v1/help/setup", tenantId, {
      signal: c.signal,
    })
      .then((value) => {
        if (!c.signal.aborted) {
          setResult({ tenantId, value });
          setFailure("");
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setFailure(
            "No pudimos consultar el progreso. Recarga para reintentar.",
          );
      });
    return () => c.abort();
  }, [tenantId]);
  const value = result?.tenantId === tenantId ? result.value : null;
  if (compact && (loading || !tenantId || !value || setupProgress(value) === 6))
    return null;
  if (!compact && loading)
    return <p role="status">Consultando configuración…</p>;
  if (!compact && !tenantId)
    return (
      <p>
        {error ||
          "La configuración inicial es para Propietario y Administrador. Consulta las guías que correspondan a tu rol."}
      </p>
    );
  const body = (
    <>
      {!compact && tenants.length > 1 && (
        <label className="field">
          Empresa
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.tenantName || "Tu empresa"}
              </option>
            ))}
          </select>
        </label>
      )}
      {failure && <p role="alert">{failure}</p>}
      {!value && !failure && <p role="status">Consultando progreso…</p>}
      {value && (
        <ul className="setup-checklist">
          {setupSteps.map(([key, label, slug]) => (
            <li key={key}>
              <span aria-label={value[key] ? "Completado" : "Pendiente"}>
                {value[key] ? "✓" : "○"}
              </span>
              <Link href={`/help/${slug}`}>{label}</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return compact ? (
    <details
      className="panel setup-compact"
      open={value ? setupProgress(value) < 4 : false}
    >
      <summary>
        Primeros pasos · {value ? setupProgress(value) : 0} de 6 esenciales
      </summary>
      {body}
      <Link href="/help/first-steps">Ver configuración inicial</Link>
    </details>
  ) : (
    <section
      className="panel stack"
      aria-label="Progreso de configuración inicial"
    >
      {body}
    </section>
  );
}
