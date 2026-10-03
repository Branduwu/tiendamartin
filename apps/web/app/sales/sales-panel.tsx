"use client";
import { formatDateTime } from "../components/presentation";
import AppNavigation, { companyLabel } from "../components/app-navigation";
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
        <AppNavigation current="/sales" />
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
            {tenants.map((t, index) => (
              <option key={t} value={t}>
                {companyLabel(t, index)}
              </option>
            ))}
          </select>
        </label>
        {loading ? (
          <p className="card" role="status">
            Cargando ventas…
          </p>
        ) : !tenants.length ? (
          <p className="card">No tienes permiso para consultar ventas.</p>
        ) : !sales.length ? (
          <p className="card muted">
            No hay ventas registradas. Completa una venta desde Punto de venta
            para consultar su ticket aquí.
          </p>
        ) : (
          <div className="table-scroll responsive-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Venta</th>
                  <th scope="col">Ubicación</th>
                  <th scope="col">Total MXN</th>
                  <th scope="col">Pago</th>
                  <th scope="col">Usuario</th>
                  <th scope="col">Turno</th>
                  <th scope="col">Devoluciones</th>
                  <th scope="col">Ticket</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.sale.id}>
                    <td data-label="Fecha">
                      <time dateTime={s.createdAt}>
                        {formatDateTime(s.createdAt)}
                      </time>
                    </td>
                    <td data-label="Venta">
                      <details className="reference">
                        <summary>{s.sale.id.slice(0, 8)}</summary>
                        <span className="sale-id">{s.sale.id}</span>
                      </details>
                    </td>
                    <td data-label="Ubicación">
                      {locations.find((l) => l.id === s.locationId)?.name ??
                        s.locationId}
                    </td>
                    <td className="amount price" data-label="Total MXN">
                      ${minorUnitsToDecimal(s.sale.total.minorUnits)}
                    </td>
                    <td data-label="Pago">
                      {s.payments
                        .map((p) =>
                          p.method === "cash" ? "Efectivo" : "Tarjeta",
                        )
                        .join(" + ") || "Sin pago (total cero)"}
                    </td>
                    <td data-label="Usuario">
                      <details className="reference">
                        <summary>Ref. {s.createdBy.slice(0, 8)}</summary>
                        <span className="sale-id">{s.createdBy}</span>
                      </details>
                    </td>
                    <td data-label="Turno">
                      <details className="reference">
                        <summary>
                          {s.shiftId ? "Ver referencia" : "Anterior a caja"}
                        </summary>
                        <span className="sale-id">
                          {s.shiftId ?? "Anterior a caja"}
                        </span>
                      </details>
                    </td>
                    <td data-label="Devoluciones">
                      {returnedIds.includes(s.sale.id)
                        ? "Con devoluciones"
                        : "Sin devoluciones"}
                    </td>
                    <td data-label="Ticket" className="row-actions">
                      <Link
                        className="button-link secondary"
                        href={`/sales/${s.sale.id}?tenantId=${tenant}`}
                      >
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
