"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InventoryLocationDto } from "@smartretail/contracts";
import AppNavigation, { companyLabel } from "./app-navigation";
import InventoryStateBadge from "./inventory-state-badge";
import {
  purchasingApi,
  PurchasingApiError,
  type PurchasingTenant,
} from "./purchasing-client";
import { milliUnitsToDecimal } from "../../lib/quantity-input";

type Alerts = {
  low: string;
  empty: string;
  alerts: {
    id: string;
    name: string;
    sku: string;
    locationId: string;
    locationName: string;
    unit: string;
    stock: string;
    minimum: string | null;
    suggested: string;
    state: "low" | "out";
  }[];
};
export default function InventoryAlertsPanel({
  initialTenantId,
  initialLocationId,
}: {
  initialTenantId?: string | undefined;
  initialLocationId?: string | undefined;
}) {
  const router = useRouter();
  const [tenants, setTenants] = useState<PurchasingTenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [locationId, setLocationId] = useState(initialLocationId ?? "");
  const [locations, setLocations] = useState<InventoryLocationDto[]>([]);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; data: Alerts }>();
  const [reload, setReload] = useState(0);
  const [accessReload, setAccessReload] = useState(0);
  const key = `${tenantId}:${locationId}:${reload}`;
  const alerts = loaded?.key === key ? loaded.data : undefined;
  const canPurchase =
    tenants
      .find((t) => t.tenantId === tenantId)
      ?.permissions.includes("purchases.write") ?? false;
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<{ tenants: PurchasingTenant[] }>(
      "/api/v1/tenants",
      undefined,
      { signal: c.signal },
    )
      .then((data) => {
        if (c.signal.aborted) return;
        const allowed = data.tenants.filter((t) =>
          t.permissions.includes("inventory.read"),
        );
        setTenants(allowed);
        // A supplied company is never silently replaced for a deep link.
        setTenantId(initialTenantId ?? allowed[0]?.tenantId ?? "");
        setAccessLoading(false);
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        setAccessLoading(false);
        setAccessError("No pudimos cargar tus empresas.");
        if (e instanceof PurchasingApiError && e.status === 401)
          router.replace("/login");
      });
    return () => c.abort();
  }, [initialTenantId, accessReload, router]);
  useEffect(() => {
    if (!tenantId) return;
    const c = new AbortController();
    const query = new URLSearchParams(locationId ? { locationId } : {});
    Promise.all([
      purchasingApi<Alerts>(`/api/v1/inventory/alerts?${query}`, tenantId, {
        signal: c.signal,
      }),
      purchasingApi<{ locations: InventoryLocationDto[] }>(
        "/api/v1/locations",
        tenantId,
        { signal: c.signal },
      ),
    ])
      .then(([data, places]) => {
        if (c.signal.aborted) return;
        setLoaded({ key, data });
        setLocations(places.locations);
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        setError(
          e instanceof Error ? e.message : "No pudimos cargar las alertas.",
        );
        setLocations([]);
        if (e instanceof PurchasingApiError && e.status === 401)
          router.replace("/login");
      });
    return () => c.abort();
  }, [tenantId, locationId, key, router]);
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/inventory">
          SmartRetail
        </Link>
        <AppNavigation current="/inventory" />
      </header>
      <main className="workspace stack">
        <div className="heading">
          <div>
            <p className="eyebrow">Operaciones</p>
            <h1>Alertas de inventario</h1>
            <p className="muted">
              Revisa mínimos por ubicación y prepara el reabastecimiento.
            </p>
          </div>
          <Link href="/inventory">Volver a inventario</Link>
        </div>
        {!!tenants.length && (
          <div className="form-grid">
            <label>
              Empresa
              <select
                value={tenantId}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setLocationId("");
                  setLocations([]);
                  setError("");
                }}
              >
                {!tenants.some((t) => t.tenantId === tenantId) && (
                  <option value={tenantId}>Empresa solicitada</option>
                )}
                {tenants.map((t, i) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {companyLabel(t.tenantId, i)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ubicación
              <select
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setError("");
                }}
              >
                <option value="">Todas las ubicaciones</option>
                {!!locationId &&
                  !locations.some((l) => l.id === locationId) && (
                    <option value={locationId}>Ubicación solicitada</option>
                  )}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {(error || accessError) && (
          <p className="error" role="alert">
            {error || accessError}
          </p>
        )}
        <div className="actions">
          <button
            className="secondary"
            disabled={accessLoading || (!tenantId && !accessError)}
            onClick={() => {
              if (accessError) {
                setAccessError("");
                setAccessLoading(true);
                setAccessReload((n) => n + 1);
              } else {
                setError("");
                setReload((n) => n + 1);
              }
            }}
          >
            Actualizar alertas
          </button>
        </div>
        {accessLoading || (tenantId && !alerts && !error) ? (
          <p className="card" role="status">
            Cargando alertas…
          </p>
        ) : !tenantId && !accessError ? (
          <p className="card">
            No tienes acceso al inventario. Consulta al administrador.
          </p>
        ) : null}
        {alerts && (
          <>
            <dl className="report-kpis">
              <div>
                <dt>Stock bajo</dt>
                <dd>{alerts.low}</dd>
              </div>
              <div>
                <dt>Agotados</dt>
                <dd>{alerts.empty}</dd>
              </div>
            </dl>
            <section className="card" aria-label="Productos con alerta">
              <p className="muted">
                Sin mínimo configurado no se generan alertas automáticas. Se
                muestran las primeras 100 alertas del filtro seleccionado; los
                contadores incluyen todos los productos distintos en cada
                estado. La sugerencia se consulta de nuevo al abrir compras.
              </p>
              {!alerts.alerts.length ? (
                <p role="status">No hay alertas para esta ubicación.</p>
              ) : (
                <div
                  className="table-scroll responsive-table"
                  role="region"
                  aria-label="Alertas por ubicación"
                  tabIndex={0}
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        {[
                          "Producto",
                          "Stock actual",
                          "Estado",
                          "Mínimo",
                          "Faltante sugerido",
                          "Acciones",
                        ].map((x) => (
                          <th key={x} scope="col">
                            {x}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.alerts.map((a) => (
                        <tr key={`${a.id}/${a.locationId}`}>
                          <th scope="row">
                            {a.name}
                            <small className="row-location">
                              SKU: {a.sku} · {a.locationName}
                            </small>
                          </th>
                          <td data-label="Stock actual">
                            {milliUnitsToDecimal(a.stock)} {a.unit}
                          </td>
                          <td data-label="Estado">
                            <InventoryStateBadge state={a.state} />
                          </td>
                          <td data-label="Mínimo">
                            {a.minimum === null
                              ? "Sin mínimo"
                              : `${milliUnitsToDecimal(a.minimum)} ${a.unit}`}
                          </td>
                          <td data-label="Faltante sugerido">
                            {milliUnitsToDecimal(a.suggested)} {a.unit}
                          </td>
                          <td data-label="Acciones" className="row-actions">
                            {canPurchase && BigInt(a.suggested) > 0n ? (
                              <Link
                                className="button-link"
                                aria-label={`Crear orden de compra de ${a.name} en ${a.locationName}`}
                                href={`/purchases?${new URLSearchParams({ tenantId, replenishProductId: a.id, replenishLocationId: a.locationId })}`}
                              >
                                Crear orden de compra
                              </Link>
                            ) : (
                              <>
                                <button disabled>Crear orden de compra</button>
                                <small className="row-location">
                                  {BigInt(a.suggested) <= 0n
                                    ? "Sin faltante sugerido"
                                    : "Requiere permiso de compras"}
                                </small>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
