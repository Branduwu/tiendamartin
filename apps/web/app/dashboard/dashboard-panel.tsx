"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  OperationalReport,
  ReportOptions,
} from "@smartretail/application";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import {
  purchasingApi,
  usePurchasingCompany,
} from "../components/purchasing-client";
import { minorUnitsToDecimal } from "../../lib/money-input";
const mxn = (value: string) => "$" + minorUnitsToDecimal(value) + " MXN";
function units(value: string): string {
  const n = BigInt(value),
    remainder = (n % 1000n)
      .toString()
      .padStart(3, "0")
      .replace(/0+$/, " ")
      .trim();
  return (n / 1000n).toString() + (remainder ? "." + remainder : "");
}
function Trend({ days }: { days: OperationalReport["days"] }) {
  const max = days.reduce(
    (n, d) => (BigInt(d.gross) > n ? BigInt(d.gross) : n),
    1n,
  );
  // Money stays bigint. Only integer SVG coordinates are derived from ratios.
  const points = days
    .map(
      (d, i) =>
        `${days.length === 1 ? 360 : Math.round((i * 700) / (days.length - 1)) + 10},${145n - (BigInt(d.gross) * 130n) / max}`,
    )
    .join(" ");
  return (
    <figure className="report-trend">
      <figcaption>Ventas completadas por día · MXN</figcaption>
      <svg
        role="img"
        aria-label="Tendencia de ventas; cifras exactas en el reporte diario"
        viewBox="0 0 720 160"
      >
        <line x1="10" x2="710" y1="145" y2="145" className="trend-baseline" />
        <polyline points={points} fill="none" className="trend-line" />
        {days.length === 1 && (
          <circle
            cx="360"
            cy={String(145n - (BigInt(days[0]?.gross ?? "0") * 130n) / max)}
            r="4"
            className="trend-dot"
          />
        )}
      </svg>
      <div className="actions muted">
        <span>{days[0]?.date}</span>
        <span>{days.at(-1)?.date}</span>
      </div>
    </figure>
  );
}
export default function DashboardPanel() {
  const company = usePurchasingCompany("reports.read");
  const [query, setQuery] = useState("period=today"),
    [loaded, setLoaded] = useState<{ key: string; value: OperationalReport }>(),
    [options, setOptions] = useState<{
      tenant: string;
      value: ReportOptions;
    }>(),
    [error, setError] = useState(""),
    [optionsError, setOptionsError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [exporting, setExporting] = useState(false);
  const key = company.tenantId + "?" + query;
  useEffect(() => {
    if (!company.tenantId) return;
    const controller = new AbortController();
    purchasingApi<ReportOptions>("/api/v1/reports/options", company.tenantId, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setOptions({ tenant: company.tenantId, value });
          setOptionsError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setOptionsError(
            "No pudimos cargar los filtros. Aplica los filtros para reintentar.",
          );
      });
    return () => controller.abort();
  }, [company.tenantId, refresh]);
  useEffect(() => {
    if (!company.tenantId) return;
    const controller = new AbortController();
    purchasingApi<OperationalReport>(
      "/api/v1/reports?" + query,
      company.tenantId,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoaded({ key, value });
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLoaded(undefined);
          setError(
            e instanceof Error ? e.message : "No pudimos consultar el reporte.",
          );
        }
      });
    return () => controller.abort();
  }, [company.tenantId, key, query, refresh]);
  const report = loaded?.key === key ? loaded.value : undefined;
  const choices =
    options?.tenant === company.tenantId ? options.value : undefined;
  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      params = new URLSearchParams();
    for (const [name, value] of form) {
      if (
        typeof value === "string" &&
        value &&
        (!(name === "from" || name === "to") || form.get("period") === "custom")
      )
        params.set(name, value);
    }
    setError("");
    setQuery(params.toString());
    setRefresh((r) => r + 1);
  }
  async function download(kind: "sales" | "products") {
    setExporting(true);
    try {
      const r = await fetch(`/api/v1/reports/${kind}.csv?${query}`, {
        cache: "no-store",
        headers: { "x-tenant-id": company.tenantId },
      });
      if (!r.ok) throw new Error("No pudimos exportar el reporte.");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-${report?.filters.from}-${report?.filters.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos exportar el reporte.",
      );
    } finally {
      setExporting(false);
    }
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: report?.timezone ?? "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const metrics: [string, string][] = report
    ? [
        ["Ventas de hoy", mxn(report.todaySales.gross)],
        ["Ventas del periodo", mxn(report.sales.gross)],
        ["Número de ventas", report.sales.count],
        ["Ticket promedio", mxn(report.sales.average)],
        ["Efectivo", mxn(report.sales.cash)],
        ["Tarjeta", mxn(report.sales.card)],
        ["Devoluciones", mxn(report.sales.refunds)],
        ["Ventas netas (con impuestos)", mxn(report.sales.net)],
        ["Venta bruta antes de descuentos", mxn(report.sales.baseGross)],
        ["Descuentos", mxn(report.sales.discounts)],
        ["Impuestos de las ventas", mxn(report.sales.taxCollected)],
        ...(report.credit
          ? ([
              [
                "Saldo pendiente de crédito (actual)",
                mxn(report.credit.outstanding),
              ],
              ["Crédito generado (período)", mxn(report.credit.generated)],
              ["Abonos cobrados (período)", mxn(report.credit.collected)],
              ["Cuentas pendientes (actual)", report.credit.openAccounts],
            ] as [string, string][])
          : []),
        ...(report.financial
          ? ([
              ["Cuentas por pagar (actual)", mxn(report.financial.outstanding)],
              ["Gastos registrados (per?odo)", mxn(report.financial.expenses)],
              [
                "Pagos a proveedores (per?odo)",
                mxn(report.financial.supplierPayments),
              ],
              ["Efectivo por gastos", mxn(report.financial.expenseCashOut)],
              [
                "Efectivo por proveedores",
                mxn(report.financial.supplierCashOut),
              ],
            ] as [string, string][])
          : []),
        ["Impuestos devueltos", mxn(report.sales.taxRefunded)],
        [
          "Venta comercial neta (sin impuestos)",
          mxn(report.sales.netCommercial),
        ],
        ["Compras recibidas", mxn(report.purchases.receivedAmount)],
        ["Stock bajo", report.inventory.low],
        ["Agotados", report.inventory.empty],
      ]
    : [];
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/dashboard">
          SmartRetail
        </Link>
        <AppNavigation
          tenantId={company.tenantId}
          current="/dashboard"
          permissions={company.permissions}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace stack">
        <div className="heading">
          <div>
            <h1>Inicio</h1>
            {report?.context && (
              <p className="company-context">
                {report.context.businessName} · {report.context.branchName}
              </p>
            )}
            <p className="muted">
              Ventas y operación de tu empresa, en un solo lugar.
            </p>
          </div>
        </div>
        {!!company.tenants.length && (
          <label>
            Empresa
            <select
              value={company.tenantId}
              disabled={exporting}
              onChange={(e) => {
                company.setTenantId(e.target.value);
                setQuery("period=today");
                setError("");
              }}
            >
              {company.tenants.map((t, i) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {companyLabel(t.tenantId, i, t.tenantName)}
                </option>
              ))}
            </select>
          </label>
        )}
        {(error || company.error || optionsError) && (
          <p role="alert" className="error">
            {error || company.error || optionsError}
          </p>
        )}
        {company.loading ? (
          <p role="status">Cargando empresas…</p>
        ) : !company.tenantId ? (
          <p>No tienes permiso para consultar reportes.</p>
        ) : (
          <>
            <section className="card" aria-labelledby="filters-title">
              <h2 id="filters-title">Periodo y filtros</h2>
              <form className="stack" key={company.tenantId} onSubmit={apply}>
                <div className="form-grid">
                  <label>
                    Periodo
                    <select name="period" defaultValue="today">
                      <option value="today">Hoy</option>
                      <option value="7d">7 días</option>
                      <option value="30d">30 días</option>
                      <option value="custom">Rango personalizado</option>
                    </select>
                  </label>
                  <label>
                    Desde
                    <input
                      name="from"
                      type="date"
                      min="2000-01-01"
                      max="2099-12-31"
                      defaultValue={today}
                    />
                  </label>
                  <label>
                    Hasta
                    <input
                      name="to"
                      type="date"
                      min="2000-01-01"
                      max="2099-12-31"
                      defaultValue={today}
                    />
                  </label>
                </div>
                <details>
                  <summary>Filtros operativos</summary>
                  <div className="form-grid">
                    {(
                      [
                        ["locationId", "Ubicación", "locations"],
                        ["productId", "Producto", "products"],
                        ["supplierId", "Proveedor (compras)", "suppliers"],
                        ["customerId", "Cliente (ventas)", "customers"],
                      ] as const
                    ).map(([name, label, list]) => (
                      <label key={name}>
                        {label}
                        <select name={name}>
                          <option value="">Todos</option>
                          {choices?.[list].map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <label>
                      Método de pago (ventas)
                      <select name="paymentMethod">
                        <option value="">Todos</option>
                        <option value="cash">Efectivo</option>
                        <option value="card">Tarjeta</option>
                      </select>
                    </label>
                  </div>
                  <p className="muted">
                    Mínimos configurados por producto y ubicación. Sin mínimo no
                    se genera alerta automática. Selectores: primeras 100
                    referencias.
                  </p>
                </details>
                <div className="actions">
                  <button disabled={exporting}>Aplicar filtros</button>
                  <span className="muted">
                    Fechas de la zona configurada · máximo 366 días
                  </span>
                </div>
              </form>
            </section>
            {!report && !error ? (
              <p role="status">Consultando reportes…</p>
            ) : (
              report && (
                <>
                  <p role="status" className="muted">
                    Periodo aplicado: {report.filters.from} al{" "}
                    {report.filters.to} · {report.timezone}
                  </p>
                  <dl className="report-kpis">
                    {metrics.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {report.credit && (
                    <p className="muted">
                      Las ventas incluyen crédito pendiente. Los abonos son
                      cobros del período y no se suman de nuevo a las ventas;
                      los abonos en efectivo entran al ledger de caja.
                    </p>
                  )}
                  {report.sales.count === "0" &&
                    report.sales.refunds === "0" && (
                      <p className="notice">
                        Sin ventas ni devoluciones en este periodo.
                      </p>
                    )}
                  <section className="card" aria-labelledby="sales-title">
                    <div className="heading">
                      <h2 id="sales-title">Reporte de ventas</h2>
                      <button
                        className="secondary"
                        disabled={exporting}
                        onClick={() => void download("sales")}
                      >
                        Exportar ventas CSV
                      </button>
                    </div>
                    <p className="muted">
                      Ventas netas = ventas completadas − devoluciones
                      completadas, incluidos impuestos. Venta comercial neta
                      excluye impuestos de ventas y devueltos. Las devoluciones
                      se cuentan en su fecha; puede resultar negativa. por fecha
                      de registro. Ticket promedio redondeado al centavo más
                      cercano. Producto y método seleccionan ventas completas
                      que los contienen; no prorratean pagos.
                    </p>
                    <Trend days={report.days} />
                    <div
                      className="report-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Resumen diario desplazable"
                    >
                      <table className="data-table">
                        <caption>Resumen diario local</caption>
                        <thead>
                          <tr>
                            {[
                              "Fecha",
                              "Ventas",
                              "Cantidad",
                              "Promedio",
                              "Cash",
                              "Card",
                              "Devoluciones",
                              "Neta",
                            ].map((x) => (
                              <th key={x} scope="col">
                                {x}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.days.map((d) => (
                            <tr key={d.date}>
                              <th scope="row">{d.date}</th>
                              {[
                                ["Ventas", mxn(d.gross)],
                                ["Cantidad", d.count],
                                ["Promedio", mxn(d.average)],
                                ["Cash", mxn(d.cash)],
                                ["Card", mxn(d.card)],
                                ["Devoluciones", mxn(d.refunds)],
                                ["Neta", mxn(d.net)],
                              ].map(([label, value]) => (
                                <td key={label} data-label={label}>
                                  {value}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="card" aria-labelledby="products-title">
                    <div className="heading">
                      <h2 id="products-title">Productos más vendidos</h2>
                      <button
                        className="secondary"
                        disabled={exporting}
                        onClick={() => void download("products")}
                      >
                        Exportar productos CSV
                      </button>
                    </div>
                    <p className="muted">
                      Top 20 por ingresos brutos del periodo; cantidades por
                      unidad. Stock actual en la ubicación elegida o sumado en
                      todas.
                    </p>
                    {!report.products.length ? (
                      <p>Sin productos vendidos en este periodo.</p>
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            {[
                              "Producto",
                              "Unidades vendidas",
                              "Ingresos",
                              "Stock actual",
                            ].map((x) => (
                              <th scope="col" key={x}>
                                {x}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.products.map((p) => (
                            <tr key={p.id}>
                              <th scope="row">{p.name}</th>
                              <td data-label="Unidades vendidas">
                                {units(p.quantity)} {p.unit}
                              </td>
                              <td data-label="Ingresos">{mxn(p.revenue)}</td>
                              <td data-label="Stock actual">
                                {units(p.stock)} {p.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                  <section className="card" aria-labelledby="stock-title">
                    <h2 id="stock-title">Alertas de inventario actual</h2>
                    <p className="muted">
                      Productos y ubicaciones activos con mínimo configurado.
                      Primeras 100 alertas por ubicación; los contadores
                      incluyen productos distintos en cada estado. No dependen
                      del periodo de ventas.
                    </p>
                    <Link
                      href={`/inventory/alerts?tenantId=${company.tenantId}`}
                      className="button secondary"
                    >
                      Ver alertas y reabastecimiento
                    </Link>
                    {!report.inventory.alerts.length ? (
                      <p>No hay productos agotados ni con stock bajo.</p>
                    ) : (
                      <ul className="report-alerts">
                        {report.inventory.alerts.map((p) => (
                          <li key={p.id + p.locationId}>
                            <strong>{p.name}</strong>
                            <span>
                              {p.state === "out" ? "Agotado" : "Stock bajo"} ·{" "}
                              {units(p.stock)} {p.unit} · {p.locationName} ·
                              Mínimo {units(p.minimum)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <div className="report-sections">
                    <section className="card">
                      <h2>Compras</h2>
                      <p className="muted">
                        Órdenes por fecha de creación y estado actual. Recibido
                        por fecha de recepción, con costo guardado; no es venta.
                      </p>
                      <dl className="cash-summary">
                        {[
                          ["Órdenes creadas", report.purchases.created],
                          ["Pendientes (ordered)", report.purchases.pending],
                          ["Parcialmente recibidas", report.purchases.partial],
                          ["Recibidas", report.purchases.received],
                          [
                            "Importe ordenado/estimado",
                            mxn(report.purchases.orderedAmount),
                          ],
                          [
                            "Importe recibido",
                            mxn(report.purchases.receivedAmount),
                          ],
                        ].map(([l, v]) => (
                          <div key={l}>
                            <dt>{l}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                    <section className="card">
                      <h2>Caja</h2>
                      <p className="muted">
                        Turnos por fecha de apertura; esperado actual para
                        abiertos, snapshot para cerrados. Entradas/salidas por
                        fecha de movimiento, incluye reembolsos. Sólo fecha y
                        ubicación.
                      </p>
                      <dl className="cash-summary">
                        {[
                          ["Turnos abiertos", report.cash.open],
                          ["Turnos cerrados", report.cash.closed],
                          ["Efectivo esperado", mxn(report.cash.expected)],
                          ["Faltantes", mxn(report.cash.shortage)],
                          ["Sobrantes", mxn(report.cash.surplus)],
                          ["Cash in", mxn(report.cash.cashIn)],
                          ["Cash out", mxn(report.cash.cashOut)],
                        ].map(([l, v]) => (
                          <div key={l}>
                            <dt>{l}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  </div>
                  <section className="card">
                    <h2>Clientes</h2>
                    <dl className="cash-summary">
                      <div>
                        <dt>Clientes con compras</dt>
                        <dd>{report.sales.customers}</dd>
                      </div>
                      <div>
                        <dt>Ventas asociadas a cliente</dt>
                        <dd>{report.sales.associated}</dd>
                      </div>
                      <div>
                        <dt>Ventas Público general</dt>
                        <dd>{report.sales.general}</dd>
                      </div>
                    </dl>
                  </section>
                </>
              )
            )}
          </>
        )}
      </main>
    </>
  );
}
