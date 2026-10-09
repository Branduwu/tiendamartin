"use client";
import { selectCompany } from "../../lib/company-selection";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  InventoryLocationDto,
  InventoryStockDto,
} from "@smartretail/contracts";
import { browserAuth } from "../../lib/supabase/client";
import { milliUnitsToDecimal } from "../../lib/quantity-input";
import InventoryForm, { type Command, type Action } from "./inventory-form";
import InventoryMinimumForm from "../components/inventory-minimum-form";
import InventoryStateBadge from "../components/inventory-state-badge";
import { ActionMenu, ContextHelp } from "../components/ui";

type Tenant = { tenantId: string; tenantName?: string; permissions: string[] };
class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export default function InventoryPanel() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [locations, setLocations] = useState<InventoryLocationDto[]>([]);
  const [stock, setStock] = useState<InventoryStockDto[]>([]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{
    action: Action;
    row?: InventoryStockDto;
  }>();
  const [pending, setPending] = useState<Command>();
  const [minimumEditor, setMinimumEditor] = useState<InventoryStockDto>();
  const [reload, setReload] = useState(0);
  const [accessReload, setAccessReload] = useState(0);
  const [loadFailed, setLoadFailed] = useState<"access" | "stock">();
  const permissions =
    tenants.find((tenant) => tenant.tenantId === tenantId)?.permissions ?? [];
  const blocked =
    loading ||
    saving ||
    editor !== undefined ||
    minimumEditor !== undefined ||
    loadFailed !== undefined;
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, cache: "no-store" });
    if (response.status === 401) {
      router.replace("/login");
      router.refresh();
    }
    const body = await response.json();
    if (!response.ok)
      throw new ApiFailure(
        typeof body.error === "string"
          ? body.error
          : "No se pudo completar la operación.",
        response.status,
      );
    return body as T;
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/tenants", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          router.refresh();
        }
        if (!response.ok) throw new Error();
        return (await response.json()) as { tenants: Tenant[] };
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTenants(data.tenants);
        setLoadFailed(undefined);
        const selected = selectCompany(data.tenants);
        setTenantId(selected);
        if (!selected) setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed("access");
          setError("No pudimos cargar tus empresas. Recarga para reintentar.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [router, accessReload]);
  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    // Publish both locations and stock together, including both transfer sides.
    const load = async (path: string) => {
      const response = await fetch(path, {
        headers: { "x-tenant-id": tenantId },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        router.replace("/login");
        router.refresh();
      }
      if (!response.ok) throw new Error();
      return response.json();
    };
    Promise.all([load("/api/v1/locations"), load("/api/v1/inventory")])
      .then(
        ([places, balances]: [
          { locations: InventoryLocationDto[] },
          { stock: InventoryStockDto[] },
        ]) => {
          if (controller.signal.aborted) return;
          setLocations(places.locations);
          setLoadFailed(undefined);
          setStock(balances.stock);
          setLocationId((current) =>
            places.locations.some((place) => place.id === current)
              ? current
              : (places.locations[0]?.id ?? ""),
          );
          setLoading(false);
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed("stock");
          setStock([]);
          setError(
            "No pudimos confirmar las existencias. Actualiza para reintentar.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [tenantId, reload, router]);

  async function save(command: Command) {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    setPending(command);
    try {
      const result = await api<{ status?: string }>(command.path, {
        method: "POST",
        headers: {
          "x-tenant-id": tenantId,
          "content-type": "application/json",
        },
        body: JSON.stringify(command.body),
      });
      setPending(undefined);
      setEditor(undefined);
      setNotice(
        result.status === "no-change"
          ? "Sin cambios: el conteo coincide con el saldo."
          : "Operación confirmada.",
      );
      setStock([]);
      setLoading(true);
      setReload((value) => value + 1);
    } catch (failure) {
      const definite = failure instanceof ApiFailure && failure.status < 500;
      if (definite) setPending(undefined);
      setError(
        definite
          ? failure.message
          : "No pudimos confirmar el resultado. Reintenta el mismo comando; su ID se conserva.",
      );
    } finally {
      setSaving(false);
    }
  }
  const open = (action: Action, row?: InventoryStockDto) => {
    setEditor(row ? { action, row } : { action });
    setError("");
    setNotice("");
  };
  async function saveMinimum(
    minimumStock: InventoryStockDto["minimumStock"] | null,
  ) {
    if (
      !minimumEditor ||
      saving ||
      !permissions.includes("inventory.minimum.write")
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api("/api/v1/inventory/minimums", {
        method: "PATCH",
        headers: {
          "x-tenant-id": tenantId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          productId: minimumEditor.productId,
          locationId: minimumEditor.locationId,
          minimumStock,
        }),
      });
      setMinimumEditor(undefined);
      setNotice(minimumStock ? "Mínimo guardado." : "Mínimo eliminado.");
      setStock([]);
      setLoading(true);
      setReload((value) => value + 1);
    } catch (failure) {
      setError(
        failure instanceof ApiFailure
          ? failure.message
          : "No pudimos confirmar el mínimo. Reintenta guardar la misma configuración.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <header className="topbar">
        {saving || pending ? (
          <span className="brand">SmartRetail</span>
        ) : (
          <Link className="brand" href="/products">
            SmartRetail
          </Link>
        )}
        <AppNavigation
          tenantId={tenantId}
          branchName={locations.find((l) => l.id === locationId)?.name}
          current="/inventory"
          blocked={!!(saving || pending)}
          permissions={permissions}
        />
        <button
          className="secondary"
          disabled={saving || pending !== undefined}
          onClick={async () => {
            setSaving(true);
            try {
              const result = await browserAuth().auth.signOut();
              if (result.error) throw result.error;
              router.replace("/login");
              router.refresh();
            } catch {
              setError("No pudimos cerrar la sesión.");
              setSaving(false);
            }
          }}
        >
          Cerrar sesión
        </button>
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <div className="heading">
          <div>
            <p className="eyebrow">Operaciones</p>
            <h1>Inventario</h1>
            <ContextHelp
              label="Stock mínimo"
              href="/help/minimum-stock"
              keepPage={blocked}
            >
              Cuando la existencia llegue a esta cantidad o menos, SmartRetail
              mostrará una alerta de reabastecimiento.
            </ContextHelp>
            <p className="muted">
              Consulta existencias y registra movimientos por ubicación.
            </p>
          </div>
          {permissions.includes("locations.write") && (
            <button disabled={blocked} onClick={() => open("location")}>
              Nueva ubicación
            </button>
          )}
        </div>
        {tenants.length > 1 ? (
          <label hidden className="tenant-selector">
            Empresa
            <select
              value={tenantId}
              disabled={blocked}
              onChange={(event) => {
                setTenantId(event.target.value);
                setLocations([]);
                setStock([]);
                setLocationId("");
                setLoading(true);
                setError("");
                setNotice("");
              }}
            >
              {tenants.map((tenant, index) => (
                <option key={tenant.tenantId} value={tenant.tenantId}>
                  {companyLabel(tenant.tenantId, index, tenant.tenantName)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          tenants.length === 1 && (
            <p className="company-context">Empresa activa</p>
          )
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {editor && (
          <InventoryForm
            key={`${editor.action}/${editor.row?.productId ?? "new"}`}
            action={editor.action}
            row={editor.row}
            locations={locations}
            busy={saving}
            pending={pending}
            onSave={save}
            onCancel={() => setEditor(undefined)}
          />
        )}
        {minimumEditor && (
          <InventoryMinimumForm
            key={`${minimumEditor.productId}/${minimumEditor.locationId}`}
            row={minimumEditor}
            busy={saving}
            onSave={saveMinimum}
            onCancel={() => setMinimumEditor(undefined)}
          />
        )}
        {loading ? (
          <p role="status" className="card">
            Cargando inventario…
          </p>
        ) : loadFailed ? (
          <section className="card" aria-label="Carga fallida">
            <h2>Datos no disponibles</h2>
            <button
              className="secondary"
              onClick={() => {
                setError("");
                setLoading(true);
                if (loadFailed === "access")
                  setAccessReload((value) => value + 1);
                else setReload((value) => value + 1);
              }}
            >
              Reintentar carga
            </button>
          </section>
        ) : !tenants.length ? (
          <p className="card">
            No tienes empresas activas asignadas. Contacta al administrador.
          </p>
        ) : (
          <section className="card" aria-label="Existencias">
            <div className="list-heading">
              <h2>Existencias por ubicación</h2>
              {!blocked && (
                <Link
                  href={`/inventory/alerts?${new URLSearchParams({ tenantId, ...(locationId ? { locationId } : {}) })}`}
                >
                  Ver alertas
                </Link>
              )}
              <button
                className="secondary"
                disabled={blocked}
                onClick={() => {
                  setError("");
                  setStock([]);
                  setLoading(true);
                  setReload((value) => value + 1);
                }}
              >
                Actualizar
              </button>
            </div>
            {!locations.length ? (
              <p className="muted">
                No hay ubicaciones para mostrar. Crea la primera para comenzar.{" "}
                <Link href="/help/branches">Cómo configurar sucursales</Link>
              </p>
            ) : (
              <>
                <label className="tenant-selector">
                  Ubicación
                  <select
                    value={locationId}
                    disabled={blocked}
                    onChange={(event) => setLocationId(event.target.value)}
                  >
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name} · {location.code}
                        {location.status === "inactive" ? " (Inactiva)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!stock.some((row) => row.locationId === locationId) ? (
                  <p className="muted">
                    No hay productos para mostrar. Crea productos en el
                    catálogo.{" "}
                    <Link href="/help/inventory">
                      Cómo registrar inventario inicial
                    </Link>
                  </p>
                ) : (
                  <div
                    className="table-scroll responsive-table"
                    tabIndex={0}
                    role="region"
                    aria-label="Existencias por ubicación"
                  >
                    <table className="data-table inventory-table">
                      <thead>
                        <tr>
                          {[
                            "Producto",
                            "Cantidad",
                            "Mínimo / estado",
                            "Acciones",
                          ].map((label) => (
                            <th scope="col" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stock
                          .filter((row) => row.locationId === locationId)
                          .map((row) => (
                            <tr key={row.productId}>
                              <th scope="row">
                                {row.productName}
                                <small className="row-location">
                                  SKU: {row.sku} ·{" "}
                                  {
                                    locations.find(
                                      (l) => l.id === row.locationId,
                                    )?.name
                                  }
                                </small>
                              </th>
                              <td
                                className="amount stock-quantity"
                                data-label="Cantidad"
                              >
                                {milliUnitsToDecimal(
                                  row.quantity.milliUnits,
                                ).replace(/\.?0+$/, "")}{" "}
                                {row.quantity.unit === "piece"
                                  ? "pza"
                                  : row.quantity.unit}
                              </td>
                              <td data-label="Mínimo / estado">
                                <InventoryStateBadge
                                  state={row.inventoryState}
                                />
                                <small className="row-location">
                                  {row.minimumStock
                                    ? `Mínimo: ${milliUnitsToDecimal(row.minimumStock.milliUnits).replace(/\.?0+$/, "")} ${row.minimumStock.unit === "piece" ? "pza" : row.minimumStock.unit}`
                                    : "Sin mínimo configurado"}
                                </small>
                              </td>
                              <td data-label="Acciones" className="row-actions">
                                <ActionMenu
                                  label={`Acciones de ${row.productName}`}
                                >
                                  {permissions.includes(
                                    "inventory.minimum.write",
                                  ) && (
                                    <button
                                      className="secondary"
                                      disabled={blocked}
                                      aria-label={`Configurar mínimo de ${row.productName}`}
                                      onClick={() => {
                                        setMinimumEditor(row);
                                        setError("");
                                        setNotice("");
                                      }}
                                    >
                                      Configurar mínimo
                                    </button>
                                  )}
                                  {(
                                    [
                                      [
                                        "receive",
                                        "Recibir",
                                        "inventory.receive",
                                      ],
                                      ["issue", "Retirar", "inventory.issue"],
                                      [
                                        "adjustment",
                                        "Ajustar",
                                        "inventory.adjust",
                                      ],
                                      ["count", "Contar", "inventory.adjust"],
                                      [
                                        "transfer",
                                        "Transferir",
                                        "inventory.transfer",
                                      ],
                                    ] as const
                                  )
                                    .filter(([, , permission]) =>
                                      permissions.includes(permission),
                                    )
                                    .map(([action, label]) => (
                                      <button
                                        className="secondary"
                                        key={action}
                                        aria-label={`${label} ${row.productName}`}
                                        disabled={
                                          blocked ||
                                          (action === "transfer" &&
                                            locations.length < 2)
                                        }
                                        onClick={() => open(action, row)}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                </ActionMenu>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}
