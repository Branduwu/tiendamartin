"use client";
import { selectCompany } from "../../lib/company-selection";
import SaleDiscountSummary from "../components/sale-discount-summary";
import { formatDateTime } from "../components/presentation";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { SalesHistoryQuerySchema } from "@smartretail/contracts";
import type {
  StoredSaleDto,
  InventoryLocationDto,
} from "@smartretail/contracts";
import { minorUnitsToDecimal } from "../../lib/money-input";

const emptyFilters = { q: "", from: "", to: "", locationId: "", payment: "" };
const date = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeZone: "America/Mexico_City",
});
const time = new Intl.DateTimeFormat("es-MX", {
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});
export default function SalesPanel({ userId }: { userId: string }) {
  const [memberships, setMemberships] = useState<
    {
      tenantId: string;
      tenantName?: string;
      permissions: string[];
      displayName?: string;
    }[]
  >([]);
  const [tenants, setTenants] = useState<string[]>([]),
    [tenant, setTenant] = useState("");
  const [sales, setSales] = useState<StoredSaleDto[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [returnedIds, setReturnedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState(emptyFilters),
    [filters, setFilters] = useState(emptyFilters);
  const [cursors, setCursors] = useState<string[]>([""]),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const cursor = cursors[cursors.length - 1]!;
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/tenants", { signal: c.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (c.signal.aborted) return;
        const allowed = body.tenants.filter((t: { permissions: string[] }) =>
          t.permissions.includes("sales.read"),
        );
        setMemberships(body.tenants);
        setTenants(allowed.map((t: { tenantId: string }) => t.tenantId));
        const selected = selectCompany(allowed);
        // Only query context, never sale data or credentials. Storage is untrusted.
        try {
          const raw = sessionStorage.getItem(
            `smartretail.sales-history.${userId}.${selected}`,
          );
          if (raw && raw.length <= 131072) {
            const saved: unknown = JSON.parse(raw);
            if (
              saved &&
              typeof saved === "object" &&
              "filters" in saved &&
              "cursors" in saved
            ) {
              const values = SalesHistoryQuerySchema.safeParse(saved.filters);
              const pages = saved.cursors;
              if (
                values.success &&
                !values.data.cursor &&
                Array.isArray(pages) &&
                pages.length > 0 &&
                pages.length <= 1000 &&
                pages[0] === "" &&
                pages
                  .slice(1)
                  .every(
                    (cursor: unknown) =>
                      SalesHistoryQuerySchema.safeParse({ cursor }).success,
                  )
              ) {
                const recovered = { ...emptyFilters, ...values.data };
                setDraft(recovered);
                setFilters(recovered);
                setCursors(pages);
              }
            }
          }
        } catch {
          /* Unavailable/corrupt query context falls back to the first page. */
        }
        setTenant(selected);
        if (!selected) setLoading(false);
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setError(
            "No pudimos consultar tus empresas. Recarga la página para volver a intentarlo.",
          );
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [userId]);
  useEffect(() => {
    if (!tenant) return;
    try {
      const query = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== ""),
      );
      sessionStorage.setItem(
        `smartretail.sales-history.${userId}.${tenant}`,
        JSON.stringify({ filters: query, cursors }),
      );
    } catch {
      /* History remains usable when tab storage is unavailable. */
    }
  }, [userId, tenant, filters, cursors]);
  useEffect(() => {
    if (!tenant) return;
    const c = new AbortController();
    fetch("/api/v1/locations", {
      headers: { "x-tenant-id": tenant },
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) return;
        if (!c.signal.aborted) setLocations(body.locations);
      })
      .catch(() => {
        /* History still works; saved location names remain visible. */
      });
    return () => c.abort();
  }, [tenant]);
  useEffect(() => {
    if (!tenant) return;
    const c = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    if (cursor) params.set("cursor", cursor);
    fetch(`/api/v1/sales${params.size ? `?${params}` : ""}`, {
      headers: { "x-tenant-id": tenant },
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "No pudimos cargar las ventas.");
        if (c.signal.aborted) return;
        setSales(body.sales);
        setReturnedIds(body.returnedSaleIds ?? []);
        setNextCursor(body.nextCursor ?? null);
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No pudimos cargar las ventas.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [tenant, filters, cursor, reload]);
  function startQuery() {
    setLoading(true);
    setError("");
    setSales([]);
    setReturnedIds([]);
    setNextCursor(null);
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError("La fecha Desde no puede ser posterior a Hasta.");
      return;
    }
    startQuery();
    setFilters({ ...draft, q: draft.q.trim() });
    setCursors([""]);
  }
  const filtered = Object.values(filters).some(Boolean);
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          tenantId={tenant}
          current="/sales"
          permissions={
            memberships.find((t) => t.tenantId === tenant)?.permissions ?? []
          }
        />
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className="workspace sales-workspace"
      >
        <h1>Historial de ventas</h1>
        <p className="muted">
          Consulta ventas anteriores en páginas de hasta 50. Los importes se
          conservan como se registraron.
        </p>
        <label hidden>
          Empresa
          <select
            aria-label="Empresa"
            value={tenant}
            onChange={(e) => {
              startQuery();
              setTenant(e.target.value);
              setSales([]);
              setLocations([]);
              setLoading(true);
              setDraft(emptyFilters);
              setFilters(emptyFilters);
              setCursors([""]);
            }}
          >
            {tenants.map((t, i) => (
              <option key={t} value={t}>
                {companyLabel(
                  t,
                  i,
                  memberships.find((m) => m.tenantId === t)?.tenantName,
                )}
              </option>
            ))}
          </select>
        </label>
        {!!tenants.length && (
          <form
            className="card sales-filters"
            onSubmit={apply}
            aria-label="Filtros de ventas"
          >
            <label className="sales-search">
              Buscar ventas
              <input
                type="search"
                maxLength={80}
                placeholder="Referencia, cliente, producto o SKU"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </label>
            <label>
              Desde
              <input
                type="date"
                min="1900-01-01"
                max={draft.to || "9998-12-31"}
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                min={draft.from || "1900-01-01"}
                max="9998-12-31"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <label>
              Ubicación
              <select
                aria-label="Ubicación"
                value={draft.locationId}
                onChange={(e) =>
                  setDraft({ ...draft, locationId: e.target.value })
                }
              >
                <option value="">Todas las ubicaciones</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Forma de pago
              <select
                aria-label="Forma de pago"
                value={draft.payment}
                onChange={(e) =>
                  setDraft({ ...draft, payment: e.target.value })
                }
              >
                <option value="">Todos los pagos</option>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="credit">Crédito</option>
              </select>
            </label>
            <div className="sales-filter-actions">
              <button type="submit" disabled={loading}>
                Buscar
              </button>
              <button
                className="secondary"
                type="button"
                disabled={loading}
                onClick={() => {
                  startQuery();
                  setDraft(emptyFilters);
                  setFilters(emptyFilters);
                  setCursors([""]);
                }}
              >
                Limpiar filtros
              </button>
            </div>
            <small className="sales-filter-note">
              Fechas en hora de Ciudad de México. Los pagos combinados aparecen
              en cada forma de pago utilizada.
            </small>
          </form>
        )}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {tenant && (
              <button
                type="button"
                className="secondary"
                disabled={loading}
                onClick={() => {
                  startQuery();
                  setReload((v) => v + 1);
                }}
              >
                Reintentar consulta
              </button>
            )}
          </div>
        )}
        <section aria-label="Resultados de ventas" aria-busy={loading}>
          {loading ? (
            <p className="card" role="status">
              Cargando ventas…
            </p>
          ) : !tenant ? (
            <p className="card">
              {error
                ? "No se pudieron cargar las empresas."
                : "No tienes permiso para consultar ventas."}
            </p>
          ) : error ? null : !sales.length ? (
            <p className="card muted">
              {filtered
                ? "No hay ventas que coincidan con estos filtros."
                : cursors.length > 1
                  ? "No hay más ventas en esta página."
                  : "No hay ventas registradas. Completa una venta desde Punto de venta para consultar su ticket aquí."}
            </p>
          ) : (
            <div className="table-scroll responsive-table sales-results">
              <table className="data-table sales-table">
                <caption>Ventas de la página {cursors.length}</caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Venta y cliente</th>
                    <th scope="col">Ubicación</th>
                    <th scope="col">Total MXN</th>
                    <th scope="col">Pago</th>
                    <th scope="col">Devoluciones</th>
                    <th scope="col">Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.sale.id}>
                      <td data-label="Fecha">
                        <time
                          dateTime={s.createdAt}
                          title={formatDateTime(s.createdAt)}
                        >
                          <span>{date.format(new Date(s.createdAt))}</span>
                          <small>{time.format(new Date(s.createdAt))}</small>
                        </time>
                      </td>
                      <td data-label="Venta y cliente">
                        <strong>{s.customerName ?? "Público general"}</strong>
                        <details className="reference">
                          <summary>Venta {s.sale.id.slice(0, 8)}</summary>
                          <span className="sale-id">{s.sale.id}</span>
                          <p>
                            Cajero: {s.createdByName ?? "Cajero registrado"}
                          </p>
                          <span className="sale-id">{s.createdBy}</span>
                          <p>
                            Turno:{" "}
                            <span className="sale-id">
                              {s.shiftId ?? "Anterior a caja"}
                            </span>
                          </p>
                        </details>
                      </td>
                      <td data-label="Ubicación">
                        {s.locationName ??
                          locations.find((l) => l.id === s.locationId)?.name ??
                          "Ubicación registrada"}
                      </td>
                      <td className="amount price" data-label="Total MXN">
                        <span className="sales-amount">
                          ${minorUnitsToDecimal(s.sale.total.minorUnits)}
                        </span>
                        {s.details && (
                          <details>
                            <summary>Ver descuentos</summary>
                            <SaleDiscountSummary recorded={s} />
                          </details>
                        )}
                      </td>
                      <td data-label="Pago">
                        {s.payments
                          .map((p) =>
                            p.method === "cash"
                              ? "Efectivo"
                              : p.method === "credit"
                                ? "Crédito pendiente"
                                : "Tarjeta",
                          )
                          .join(" + ") || "Sin pago (total cero)"}
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
        </section>
        {!!tenant && (
          <nav className="sales-pagination" aria-label="Paginación de ventas">
            <button
              type="button"
              className="secondary"
              disabled={loading || cursors.length === 1}
              onClick={() => {
                startQuery();
                setCursors((v) => v.slice(0, -1));
              }}
            >
              Anterior
            </button>
            <p role="status">
              Página {cursors.length}
              {!loading && !error
                ? ` · ${sales.length} ${sales.length === 1 ? "venta" : "ventas"}`
                : ""}
            </p>
            <button
              type="button"
              className="secondary"
              disabled={loading || !nextCursor || !!error}
              onClick={() => {
                if (nextCursor) {
                  startQuery();
                  setCursors((v) =>
                    v[v.length - 1] === nextCursor ? v : [...v, nextCursor],
                  );
                }
              }}
            >
              Siguiente
            </button>
          </nav>
        )}
      </main>
    </>
  );
}
