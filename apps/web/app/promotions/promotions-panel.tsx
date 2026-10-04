"use client";
import { useEffect, useState } from "react";
import type {
  CouponDto,
  PromotionDto,
  ProductDto,
} from "@smartretail/contracts";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import {
  purchasingApi,
  usePurchasingCompany,
} from "../components/purchasing-client";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
type Item = CouponDto | PromotionDto;
const dateInput = (v: string | undefined) =>
  v
    ? new Date(Date.parse(v) - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export default function PromotionsPanel() {
  const company = usePurchasingCompany("promotions.read"),
    [kind, setKind] = useState<"promotions" | "coupons">("promotions"),
    [promotions, setPromotions] = useState<PromotionDto[]>([]),
    [coupons, setCoupons] = useState<CouponDto[]>([]),
    [products, setProducts] = useState<ProductDto[]>([]),
    [loadedTenant, setLoadedTenant] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null),
    [showForm, setShowForm] = useState(false),
    [name, setName] = useState(""),
    [productId, setProductId] = useState(""),
    [type, setType] = useState<"amount" | "percentage">("percentage"),
    [value, setValue] = useState(""),
    [active, setActive] = useState(true),
    [starts, setStarts] = useState(""),
    [ends, setEnds] = useState(""),
    [limit, setLimit] = useState("");
  const canWrite = company.permissions.includes("promotions.write");
  useEffect(() => {
    if (!company.tenantId) return;
    const c = new AbortController();
    Promise.resolve().then(() => {
      if (!c.signal.aborted) {
        setLoadedTenant("");
        setPromotions([]);
        setCoupons([]);
        setProducts([]);
        setLoading(true);
        setError("");
      }
    });
    Promise.all([
      purchasingApi<{ promotions: PromotionDto[] }>(
        "/api/v1/promotions",
        company.tenantId,
        { signal: c.signal },
      ),
      purchasingApi<{ coupons: CouponDto[] }>(
        "/api/v1/coupons",
        company.tenantId,
        { signal: c.signal },
      ),
      purchasingApi<{ products: ProductDto[] }>(
        "/api/v1/products",
        company.tenantId,
        { signal: c.signal },
      ),
    ])
      .then(([p, cou, pd]) => {
        if (!c.signal.aborted) {
          setLoadedTenant(company.tenantId);
          setPromotions(p.promotions);
          setCoupons(cou.coupons);
          setProducts(pd.products);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No pudimos cargar promociones.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [company.tenantId, refresh]);
  function edit(item: Item | null) {
    setEditing(item);
    setName(item ? ("code" in item ? item.code : item.name) : "");
    setProductId(
      item && "productId" in item
        ? item.productId
        : (products.find((p) => p.status === "active")?.id ?? ""),
    );
    setType(item?.discount.type ?? "percentage");
    setValue(item ? minorUnitsToDecimal(item.discount.value) : "");
    setActive(item?.active ?? true);
    setStarts(dateInput(item?.startsAt));
    setEnds(dateInput(item?.endsAt));
    setLimit(item && "usageLimit" in item ? (item.usageLimit ?? "") : "");
    setShowForm(true);
    setError("");
    setNotice("");
  }
  const ready = loadedTenant === company.tenantId && !loading;
  const items: Item[] = !ready ? [] : kind === "coupons" ? coupons : promotions;
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          current="/promotions"
          permissions={company.permissions}
          blocked={busy}
        />
      </header>
      <main className="workspace stack">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Precios</p>
            <h1>Promociones y cupones</h1>
            <p className="muted">
              Configura descuentos simples para tus ventas.
            </p>
          </div>
          {canWrite && !showForm && (
            <button disabled={!ready || busy} onClick={() => edit(null)}>
              Crear {kind === "coupons" ? "cupón" : "promoción"}
            </button>
          )}
        </div>
        {company.error && (
          <p className="error" role="alert">
            {company.error}
          </p>
        )}
        {error && (
          <p id="promotion-error" className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {company.tenants.length > 0 && (
          <label>
            Empresa
            <select
              aria-label="Empresa"
              disabled={busy || showForm}
              value={company.tenantId}
              onChange={(e) => {
                company.setTenantId(e.target.value);
                setShowForm(false);
                setEditing(null);
                setNotice("");
              }}
            >
              {company.tenants.map((t, i) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {companyLabel(t.tenantId, i)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row-actions">
          <button
            className="secondary"
            aria-pressed={kind === "promotions"}
            disabled={busy || showForm}
            onClick={() => setKind("promotions")}
          >
            Promociones
          </button>
          <button
            className="secondary"
            aria-pressed={kind === "coupons"}
            disabled={busy || showForm}
            onClick={() => setKind("coupons")}
          >
            Cupones
          </button>
        </div>
        {showForm && (
          <form
            className="card stack"
            aria-describedby={error ? "promotion-error" : undefined}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const common = {
                  discount: { type, value: decimalToMinorUnits(value) },
                  active,
                  ...(starts
                    ? { startsAt: new Date(starts).toISOString() }
                    : {}),
                  ...(ends ? { endsAt: new Date(ends).toISOString() } : {}),
                };
                const body =
                  kind === "coupons"
                    ? {
                        ...common,
                        code: name.trim().toUpperCase(),
                        ...(limit ? { usageLimit: limit } : {}),
                      }
                    : { ...common, name: name.trim(), productId };
                await purchasingApi(
                  `/api/v1/${kind}${editing ? "/" + editing.id : ""}`,
                  company.tenantId,
                  {
                    method: editing ? "PATCH" : "POST",
                    body: JSON.stringify(
                      editing ? body : { ...body, id: crypto.randomUUID() },
                    ),
                  },
                );
                setShowForm(false);
                setEditing(null);
                setNotice("Configuración guardada.");
                setRefresh((n) => n + 1);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "No pudimos guardar.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>
              {editing ? "Editar" : "Crear"}{" "}
              {kind === "coupons" ? "cupón" : "promoción"}
            </h2>
            <fieldset disabled={busy} style={{ minWidth: 0 }}>
              <legend>Descuento y vigencia</legend>
              <div className="form-grid">
                <label>
                  {kind === "coupons"
                    ? "Código del cupón"
                    : "Nombre de promoción"}
                  <input
                    aria-describedby={error ? "promotion-error" : undefined}
                    required
                    maxLength={kind === "coupons" ? 32 : 120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {kind === "promotions" && (
                  <label>
                    Producto
                    <select
                      required
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                    >
                      <option value="">Selecciona un producto</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.sku}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Tipo de descuento
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as typeof type)}
                  >
                    <option value="percentage">Porcentaje</option>
                    <option value="amount">Importe fijo</option>
                  </select>
                </label>
                <label>
                  {type === "percentage"
                    ? "Porcentaje (%)"
                    : kind === "promotions"
                      ? "Descuento por unidad (MXN)"
                      : "Descuento (MXN)"}
                  <input
                    aria-describedby={error ? "promotion-error" : undefined}
                    required
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
                <label>
                  Inicio (opcional)
                  <input
                    aria-describedby={error ? "promotion-error" : undefined}
                    type="datetime-local"
                    value={starts}
                    onChange={(e) => setStarts(e.target.value)}
                  />
                </label>
                <label>
                  Fin (opcional)
                  <input
                    aria-describedby={error ? "promotion-error" : undefined}
                    type="datetime-local"
                    value={ends}
                    onChange={(e) => setEnds(e.target.value)}
                  />
                </label>
                {kind === "coupons" && (
                  <label>
                    Límite de usos (opcional)
                    <input
                      aria-describedby={error ? "promotion-error" : undefined}
                      inputMode="numeric"
                      pattern="[1-9][0-9]*"
                      maxLength={19}
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                    />
                  </label>
                )}
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".75rem",
                  }}
                >
                  <input
                    aria-describedby={error ? "promotion-error" : undefined}
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  Activo
                </label>
              </div>
              <p className="muted">
                Las promociones no se acumulan entre sí. El cupón se aplica
                después de los descuentos de línea y venta.
              </p>
              <div className="row-actions">
                <button>{busy ? "Guardando…" : "Guardar"}</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setShowForm(false);
                    setEditing(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {company.loading || loading ? (
          <p role="status">Cargando configuración…</p>
        ) : !company.tenants.length ? (
          <p>No tienes permiso para administrar promociones.</p>
        ) : !items.length ? (
          <p className="card">
            No hay {kind === "coupons" ? "cupones" : "promociones"} registrados.
          </p>
        ) : (
          <div className="table-scroll responsive-table">
            <table className="data-table">
              <thead>
                <tr>
                  {[
                    "Nombre / código",
                    "Descuento",
                    "Vigencia",
                    "Estado",
                    "Acciones",
                  ].map((t) => (
                    <th key={t} scope="col">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Nombre / código">
                      {"code" in item ? item.code : item.name}
                      {"productId" in item && (
                        <small>
                          {products.find((p) => p.id === item.productId)
                            ?.name ?? "Producto registrado"}
                        </small>
                      )}
                    </td>
                    <td data-label="Descuento">
                      {item.discount.type === "percentage"
                        ? minorUnitsToDecimal(item.discount.value) + "%"
                        : "$" +
                          minorUnitsToDecimal(item.discount.value) +
                          " MXN"}
                      {"uses" in item && (
                        <small>
                          Usos: {item.uses}
                          {item.usageLimit ? " / " + item.usageLimit : ""}
                        </small>
                      )}
                    </td>
                    <td data-label="Vigencia">
                      {item.startsAt
                        ? new Date(item.startsAt).toLocaleString("es-MX")
                        : "Desde ahora"}{" "}
                      —{" "}
                      {item.endsAt
                        ? new Date(item.endsAt).toLocaleString("es-MX")
                        : "Sin fecha de fin"}
                    </td>
                    <td data-label="Estado">
                      {item.active ? "Activo" : "Inactivo"}
                    </td>
                    <td data-label="Acciones">
                      {canWrite && (
                        <button
                          className="secondary"
                          disabled={busy || showForm}
                          onClick={() => edit(item)}
                          aria-label={`Editar ${"code" in item ? item.code : item.name}`}
                        >
                          Editar
                        </button>
                      )}
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
