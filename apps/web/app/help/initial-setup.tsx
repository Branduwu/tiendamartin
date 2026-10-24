"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { InitialSetup } from "@smartretail/application";
import { companyHref } from "../../lib/company-selection";
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
/** Guidance only: every destination still authorizes its own operations. */
export function nextSetupStep(value: InitialSetup) {
  if (!value.company)
    return {
      title: "Revisa los datos de tu negocio",
      detail: "Confirma el nombre y los datos que aparecerán en tus tickets.",
      href: "/settings/business",
      permissions: ["settings.manage", "locations.read"],
    };
  if (!value.branch)
    return {
      title: "Prepara tu primera sucursal",
      detail:
        "En Existencias, crea una ubicación activa. Después podrás completar sus datos en Negocio y sucursales.",
      href: "/inventory",
      permissions: ["inventory.read", "locations.write"],
    };
  if (!value.product)
    return {
      title: "Agrega tu primer producto",
      detail:
        "En Productos, registra el nombre, precio, unidad y código que utilizarás para vender.",
      href: "/products",
      permissions: ["products.read", "products.write"],
    };
  if (!value.inventory)
    return {
      title: "Registra las existencias iniciales",
      detail:
        "En Existencias, selecciona la sucursal y utiliza Recibir para registrar las unidades que ya tengas. Comprueba primero las cantidades actuales: no repitas entradas ya registradas.",
      href: "/inventory",
      permissions: ["inventory.read", "inventory.receive"],
    };
  if (!value.cash)
    return {
      title: "Abre tu primer turno de caja",
      detail:
        "En Caja, elige la sucursal y registra el efectivo inicial antes de cobrar.",
      href: "/cash",
      permissions: ["cash.read", "cash.open"],
    };
  return {
    title: "Continúa en Punto de venta",
    detail:
      "El progreso refleja el historial del negocio, no la disponibilidad actual. Antes de cobrar, comprueba la sucursal, las existencias de los productos y tu turno de caja abierto.",
    href: "/pos",
    permissions: ["sales.create"],
  };
}
export default function InitialSetupPanel({
  compact = false,
  preferred,
}: {
  compact?: boolean;
  preferred?: string;
}) {
  const { tenants, tenantId, setTenantId, loading, error, permissions } =
    usePurchasingCompany("settings.manage", preferred);
  const [result, setResult] = useState<{
      tenantId: string;
      value: InitialSetup;
    } | null>(null),
    [failure, setFailure] = useState<{
      tenantId: string;
      attempt: number;
    } | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!tenantId) return;
    const c = new AbortController();
    purchasingApi<InitialSetup>("/api/v1/help/setup", tenantId, {
      signal: c.signal,
    })
      .then((value) => {
        if (!c.signal.aborted) {
          setResult({ tenantId, value });
          setFailure(null);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setFailure({ tenantId, attempt });
      });
    return () => c.abort();
  }, [tenantId, attempt]);
  const value = result?.tenantId === tenantId ? result.value : null;
  const failed = failure?.tenantId === tenantId && failure.attempt === attempt;
  const next = value ? nextSetupStep(value) : null;
  if (
    compact &&
    (loading || !tenantId || (value && setupProgress(value) === 6))
  )
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
      <p>
        Negocio:{" "}
        <strong>
          {tenants.find((t) => t.tenantId === tenantId)?.tenantName ||
            "Tu empresa"}
        </strong>
      </p>
      {permissions.includes("locations.read") && (
        <Link href={companyHref("/settings/business", tenantId)}>
          Revisar negocio y sucursales
        </Link>
      )}
      {failed && (
        <div className="stack">
          <p role="alert">
            No pudimos consultar el progreso. No se ha cambiado la
            configuración.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Reintentar consulta
          </button>
        </div>
      )}
      {!value && !failed && <p role="status">Consultando progreso…</p>}
      {next && (
        <div className="stack setup-next">
          <h2>{next.title}</h2>
          <p>{next.detail}</p>
          {next.permissions.every((p) => permissions.includes(p)) ? (
            <Link
              className="button-link"
              href={companyHref(next.href, tenantId)}
            >
              {next.title}
            </Link>
          ) : (
            <p>
              Solicita este paso a una persona autorizada de tu negocio. Tus
              permisos actuales no permiten realizarlo.
            </p>
          )}
        </div>
      )}
      {value && (
        <ul className="setup-checklist">
          {setupSteps.map(([key, label, slug]) => (
            <li key={key}>
              <span aria-label={value[key] ? "Completado" : "Pendiente"}>
                {value[key] ? "✓" : "○"}
              </span>
              <Link href={companyHref(`/help/${slug}`, tenantId)}>{label}</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return compact ? (
    <details
      className="panel setup-compact"
      open={!value || setupProgress(value) < 6}
    >
      <summary>
        Primeros pasos{" "}
        {value ? `· ${setupProgress(value)} de 6 esenciales` : "· Consultando"}
      </summary>
      {body}
      <Link href={companyHref("/help/first-steps", tenantId)}>
        Ver configuración inicial
      </Link>
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
