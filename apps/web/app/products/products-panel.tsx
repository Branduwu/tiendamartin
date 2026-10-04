"use client";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ProductDto,
  CreateProductDto,
  UpdateProductDto,
} from "@smartretail/contracts";
import { browserAuth } from "../../lib/supabase/client";
import { minorUnitsToDecimal } from "../../lib/money-input";
import ProductForm from "./product-form";
type Tenant = { tenantId: string; canWriteProducts: boolean };
async function api<T>(
  router: ReturnType<typeof useRouter>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  if (response.status === 401) {
    router.replace("/login");
    router.refresh();
    throw new Error("La sesión terminó.");
  }
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "No se pudo completar la operación.",
    );
  return body as T;
}
export default function ProductsPanel() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<ProductDto | null | undefined>(
    undefined,
  );
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ tenants: Tenant[] }>(router, "/api/v1/tenants", {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTenants(data.tenants);
        setTenantId(data.tenants[0]?.tenantId ?? "");
        if (!data.tenants.length) setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "No pudimos cargar tus empresas. Recarga la página para reintentar.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [router]);
  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    api<{ products: ProductDto[] }>(router, "/api/v1/products", {
      headers: { "x-tenant-id": tenantId },
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setProducts(data.products);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "No pudimos cargar los productos. Revisa tu acceso e inténtalo de nuevo.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [tenantId, reload, router]);
  const canWrite =
    tenants.find((tenant) => tenant.tenantId === tenantId)?.canWriteProducts ===
    true;
  async function save(value: CreateProductDto | UpdateProductDto) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ product: ProductDto }>(
        router,
        `/api/v1/products${editor ? `/${editor.id}` : ""}`,
        {
          method: editor ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-tenant-id": tenantId,
          },
          body: JSON.stringify(value),
        },
      );
      setProducts((previous) =>
        [
          ...previous.filter((item) => item.id !== result.product.id),
          result.product,
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditor(undefined);
      setNotice("Producto guardado.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No pudimos guardar el producto.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      const { error } = await browserAuth().auth.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
    } catch {
      setError("No pudimos cerrar sesión. Inténtalo de nuevo.");
      setLoggingOut(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/products">
          SmartRetail
        </a>
        <AppNavigation current="/products" />
        <button
          className="secondary"
          disabled={saving || loggingOut}
          onClick={logout}
        >
          {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </header>
      <main className="workspace">
        <div className="heading">
          <div>
            <p className="eyebrow">Catálogo</p>
            <h1>Productos</h1>
            <p className="muted">
              Administra los datos y precios de tus productos.
            </p>
          </div>
          {canWrite && (
            <button
              disabled={loading || saving || editor !== undefined}
              onClick={() => {
                setEditor(null);
                setError("");
                setNotice("");
              }}
            >
              Nuevo producto
            </button>
          )}
        </div>
        {tenants.length > 1 && (
          <label className="tenant-selector">
            Empresa
            <select
              value={tenantId}
              disabled={saving || editor !== undefined}
              onChange={(event) => {
                setTenantId(event.target.value);
                setProducts([]);
                setLoading(true);
                setError("");
                setNotice("");
                setEditor(undefined);
              }}
            >
              {tenants.map((tenant, index) => (
                <option key={tenant.tenantId} value={tenant.tenantId}>
                  {companyLabel(tenant.tenantId, index)}
                </option>
              ))}
            </select>
          </label>
        )}
        {tenants.length === 1 && (
          <p className="company-context">Empresa activa</p>
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
        {editor !== undefined && (
          <ProductForm
            key={editor?.id ?? "new"}
            product={editor}
            busy={saving}
            onSave={save}
            onCancel={() => setEditor(undefined)}
          />
        )}
        {loading ? (
          <p role="status" className="card">
            Cargando productos…
          </p>
        ) : !tenants.length ? (
          <p className="card">
            No tienes empresas activas asignadas. Contacta al administrador.
          </p>
        ) : (
          <section className="card" aria-label="Lista de productos">
            <div className="list-heading">
              <h2>Catálogo de la empresa</h2>
              <button
                className="secondary"
                disabled={saving || editor !== undefined}
                onClick={() => {
                  setLoading(true);
                  setError("");
                  setReload((value) => value + 1);
                }}
              >
                Actualizar
              </button>
            </div>
            {!products.length ? (
              <p className="muted">
                No hay productos para mostrar.
                {canWrite ? " Crea el primero para comenzar." : ""}
              </p>
            ) : (
              <div
                className="table-scroll responsive-table"
                tabIndex={0}
                role="region"
                aria-label="Productos"
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      {[
                        "Nombre",
                        "SKU",
                        "Código de barras",
                        "Unidad",
                        "Costo MXN",
                        "Precio MXN",
                        "Estado",
                        "Acciones",
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id}>
                        <th scope="row">{product.name}</th>
                        <td data-label="SKU">{product.sku}</td>
                        <td data-label="Código de barras">
                          {product.barcode ?? "—"}
                        </td>
                        <td data-label="Unidad">{product.unit}</td>
                        <td className="amount" data-label="Costo MXN">
                          $
                          {minorUnitsToDecimal(product.purchaseCost.minorUnits)}
                        </td>
                        <td className="amount price" data-label="Precio MXN">
                          ${minorUnitsToDecimal(product.salePrice.minorUnits)}
                        </td>
                        <td data-label="Estado">
                          <span className={`badge ${product.status}`}>
                            {product.status === "active"
                              ? "Activo"
                              : "Inactivo"}
                          </span>
                        </td>
                        <td data-label="Acciones" className="row-actions">
                          {saving || editor !== undefined ? (
                            <span aria-disabled="true">Imprimir etiqueta</span>
                          ) : (
                            <Link
                              href={`/labels?${new URLSearchParams({ tenantId, productId: product.id })}`}
                              aria-label={`Imprimir etiqueta de ${product.name}`}
                            >
                              Imprimir etiqueta
                            </Link>
                          )}
                          {canWrite ? (
                            <button
                              className="secondary"
                              disabled={saving || editor !== undefined}
                              aria-label={`Editar ${product.name}`}
                              onClick={() => {
                                setEditor(product);
                                setError("");
                                setNotice("");
                              }}
                            >
                              Editar
                            </button>
                          ) : (
                            "Solo lectura"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
