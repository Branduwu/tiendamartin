"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  StoredSaleDto,
  InventoryLocationDto,
} from "@smartretail/contracts";
import { minorUnitsToDecimal } from "../../lib/money-input";
export default function SalesPanel() {
  const [tenants, setTenants] = useState<string[]>([]),
    [tenant, setTenant] = useState(""),
    [sales, setSales] = useState<StoredSaleDto[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [returnedIds, setReturnedIds] = useState<string[]>([]);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/tenants", { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (c.signal.aborted) return;
        const allowed = b.tenants
          .filter((t: { permissions: string[] }) =>
            t.permissions.includes("sales.read"),
          )
          .map((t: { tenantId: string }) => t.tenantId);
        setTenants(allowed);
        setTenant(allowed[0] ?? "");
        if (!allowed.length) setLoading(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!tenant) return;
    const c = new AbortController();
    const init = {
      headers: { "x-tenant-id": tenant },
      cache: "no-store" as const,
      signal: c.signal,
    };
    Promise.all([
      fetch("/api/v1/sales", init),
      fetch("/api/v1/locations", init),
    ])
      .then(async (responses) => {
        const [s, l] = await Promise.all(responses.map((r) => r.json()));
        if (responses.some((r) => !r.ok)) throw new Error(s.error ?? l.error);
        if (c.signal.aborted) return;
        setSales(s.sales);
        setReturnedIds(s.returnedSaleIds ?? []);
        setLocations(l.locations);
        setLoading(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [tenant]);
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <nav className="actions">
          <Link href="/pos">Punto de venta</Link>
          <Link href="/cash">Caja</Link>
          <Link href="/sales">Ventas</Link>
        </nav>
      </header>
      <main className="workspace">
        <h1>Historial de ventas</h1>
        <p>
          Últimas 50 ventas. Los importes y productos corresponden al momento de
          la venta.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <label>
          Empresa
          <select
            aria-label="Empresa"
            value={tenant}
            onChange={(e) => {
              setTenant(e.target.value);
              setSales([]);
              setLocations([]);
              setLoading(true);
            }}
          >
            {tenants.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {loading ? (
          <p>Cargando ventas…</p>
        ) : !tenants.length ? (
          <p>No tienes permiso para consultar ventas.</p>
        ) : !sales.length ? (
          <p>No hay ventas registradas.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Venta</th>
                  <th>Ubicación</th>
                  <th>Total MXN</th>
                  <th>Pago</th>
                  <th>Usuario</th>
                  <th>Turno</th>
                  <th>Devoluciones</th>
                  <th>Ticket</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.sale.id}>
                    <td>
                      <time dateTime={s.createdAt}>{s.createdAt}</time>
                    </td>
                    <td className="sale-id">{s.sale.id}</td>
                    <td>
                      {locations.find((l) => l.id === s.locationId)?.name ??
                        s.locationId}
                    </td>
                    <td>${minorUnitsToDecimal(s.sale.total.minorUnits)}</td>
                    <td>
                      {s.payments
                        .map((p) =>
                          p.method === "cash" ? "Efectivo" : "Tarjeta",
                        )
                        .join(" + ") || "Sin pago (total cero)"}
                    </td>
                    <td className="sale-id">{s.createdBy}</td>
                    <td className="sale-id">
                      {s.shiftId ?? "Anterior a caja"}
                    </td>
                    <td>
                      {returnedIds.includes(s.sale.id)
                        ? "Con devoluciones"
                        : "Sin devoluciones"}
                    </td>
                    <td>
                      <Link href={`/sales/${s.sale.id}?tenantId=${tenant}`}>
                        Ver ticket
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
