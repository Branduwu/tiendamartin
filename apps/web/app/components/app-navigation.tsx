"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
const pages = [
  ["/dashboard", "Dashboard"],
  ["/products", "Productos"],
  ["/inventory", "Inventario"],
  ["/pos", "Punto de venta"],
  ["/cash", "Caja"],
  ["/sales", "Ventas"],
  ["/suppliers", "Proveedores"],
  ["/purchases", "Compras"],
  ["/customers", "Clientes"],
  ["/settings/users", "Usuarios"],
  ["/promotions", "Promociones"],
  ["/settings/taxes", "Impuestos"],
] as const;
export default function AppNavigation({
  current,
  blocked = false,
  permissions,
}: {
  current: string;
  blocked?: boolean;
  permissions?: readonly string[];
}) {
  const [discovered, setDiscovered] = useState<readonly string[]>([]);
  useEffect(() => {
    if (permissions !== undefined) return;
    const controller = new AbortController();
    fetch("/api/v1/tenants", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data: { tenants: { permissions: string[] }[] } =
          await response.json();
        if (!controller.signal.aborted)
          setDiscovered(data.tenants[0]?.permissions ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [permissions]);
  const visiblePermissions = permissions ?? discovered;
  return (
    <nav className="app-nav" aria-label="Principal">
      {pages
        .filter(([href]) => {
          const required: Record<string, string> = {
            "/dashboard": "reports.read",
            "/products": "products.read",
            "/inventory": "inventory.read",
            "/pos": "sales.create",
            "/cash": "cash.read",
            "/sales": "sales.read",
            "/suppliers": "suppliers.read",
            "/purchases": "purchases.read",
            "/customers": "customers.read",
            "/settings/users": "members.manage",
            "/promotions": "promotions.read",
            "/settings/taxes": "taxes.manage",
          };
          return visiblePermissions.includes(required[href] ?? "");
        })
        .map(([href, label]) =>
          blocked &&
          [
            "/products",
            "/inventory",
            "/pos",
            "/suppliers",
            "/purchases",
            "/customers",
            "/dashboard",
          ].includes(href) ? (
            <span
              key={href}
              aria-disabled="true"
              aria-current={current === href ? "page" : undefined}
            >
              {label}
            </span>
          ) : (
            <Link
              key={href}
              href={href}
              aria-current={current === href ? "page" : undefined}
            >
              {label}
            </Link>
          ),
        )}
    </nav>
  );
}
export function companyLabel(id: string, index: number) {
  return `Empresa ${index + 1} (${id.slice(-6)})`;
}
