"use client";
import { ScanFeedback, useScanFeedback } from "../components/scan-feedback";
import { LoadingLabel } from "../components/ui";
import { selectCompany } from "../../lib/company-selection";
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
import { Button, EmptyState, PageHeader } from "../components/ui";
import dynamic from "next/dynamic";
import { scanCode } from "../../lib/scanner";
import type { PhotoChange } from "../components/product-photo-input";
import {
  useProductPhotos,
  ProductThumbnail,
} from "../components/product-thumbnails";
const SmartScanner = dynamic(() => import("../components/smart-scanner"), {
  ssr: false,
});
type Tenant = {
  tenantId: string;
  tenantName?: string;
  canWriteProducts: boolean;
  permissions: string[];
};
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
  const feedback = useScanFeedback();
  const [unknownScan, setUnknownScan] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<ProductDto | null | undefined>(
    undefined,
  );
  const [reload, setReload] = useState(0);
  const photos = useProductPhotos(tenantId, reload);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scanner, setScanner] = useState(false),
    [initialBarcode, setInitialBarcode] = useState("");
  const visibleProducts = products.filter(
    (product) =>
      (statusFilter === "all" || product.status === statusFilter) &&
      `${product.name} ${product.sku} ${product.barcode ?? ""}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    const controller = new AbortController();
    api<{ tenants: Tenant[] }>(router, "/api/v1/tenants", {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTenants(data.tenants);
        const selected = selectCompany(data.tenants);
        setTenantId(selected);
        const code = scanCode(
          new URL(window.location.href).searchParams.get("barcode") ?? "",
        );
        if (
          code &&
          data.tenants.find((t) => t.tenantId === selected)?.canWriteProducts
        ) {
          setInitialBarcode(code);
          setEditor(null);
        }
        if (!selected) setLoading(false);
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
  async function save(
    value: CreateProductDto | UpdateProductDto,
    photo?: PhotoChange,
  ) {
    let persisted = false;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result =
        editor && !Object.keys(value).length
          ? { product: editor }
          : await api<{ product: ProductDto }>(
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
      persisted = true;
      if (photo) {
        // Product creation and optional photo are separate, explicit operations.
        // If upload fails, keep the persisted product in edit mode so retry never creates another product.
        setEditor(result.product);
        await api(router, `/api/v1/products/${result.product.id}/image`, {
          method: photo.blob ? "PUT" : "DELETE",
          headers: {
            "x-tenant-id": tenantId,
            "x-product-image-version": photo.expected ?? "none",
            ...(photo.blob ? { "Content-Type": "image/jpeg" } : {}),
          },
          ...(photo.blob ? { body: photo.blob } : {}),
        });
      }
      setEditor(undefined);
      setInitialBarcode("");
      setNotice("Producto guardado.");
      setReload((value) => value + 1);
    } catch (error) {
      setError(
        (photo && persisted
          ? "Producto guardado; la foto no se pudo aplicar. Reintenta con la vista previa. "
          : "") +
          (error instanceof Error
            ? error.message
            : "No pudimos guardar el producto."),
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
    <div className="visual-pilot pilot-products">
      <header className="topbar">
        <a className="brand" href="/products">
          SmartRetail
        </a>
        <AppNavigation
          compact
          tenantId={tenantId}
          blocked={saving || loggingOut}
          current="/products"
          permissions={
            tenants.find((t) => t.tenantId === tenantId)?.permissions ?? []
          }
        />
        <button
          className="secondary"
          disabled={saving || loggingOut}
          onClick={logout}
        >
          <LoadingLabel busy={loggingOut} label="Cerrando sesión…">
            Cerrar sesión
          </LoadingLabel>
        </button>
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <PageHeader>
          <div>
            <h1>Productos</h1>
            <button
              type="button"
              className="secondary"
              disabled={loading || saving || editor !== undefined}
              onClick={() => setScanner(true)}
            >
              Escanear para buscar
            </button>
            <p className="muted">
              Administra los datos y precios de tus productos.
            </p>
          </div>
          {canWrite && (
            <button
              disabled={loading || saving || editor !== undefined}
              onClick={() => {
                setEditor(null);
                setInitialBarcode("");
                setError("");
                setNotice("");
              }}
            >
              Nuevo producto
            </button>
          )}
        </PageHeader>
        {tenants.length > 1 && (
          <label hidden className="tenant-selector">
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
                  {companyLabel(tenant.tenantId, index, tenant.tenantName)}
                </option>
              ))}
            </select>
          </label>
        )}
        {tenants.length === 1 && (
          <p className="company-context">Empresa activa</p>
        )}
        <ScanFeedback message={feedback.message} />
        {unknownScan && (
          <section className="notice">
            <p>Código escaneado. No encontramos un producto con este código.</p>
            <div className="actions">
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setInitialBarcode(unknownScan);
                    setEditor(null);
                    setUnknownScan("");
                  }}
                >
                  Crear producto
                </button>
              )}
              <button type="button" onClick={() => setScanner(true)}>
                Escanear otro
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSearch("");
                  setUnknownScan("");
                  document.getElementById("product-search")?.focus();
                }}
              >
                Buscar manualmente
              </button>
            </div>
          </section>
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
            onCodeCaptured={() =>
              feedback.announce(
                "✓ Código capturado. Revisa el producto antes de guardar.",
              )
            }
            initialBarcode={initialBarcode}
            product={editor}
            tenantId={tenantId}
            busy={saving}
            onSave={save}
            onCancel={() => {
              setEditor(undefined);
              setInitialBarcode("");
            }}
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
          <section className="product-register" aria-label="Lista de productos">
            <div className="list-heading">
              <h2>
                Catálogo <span className="result-count">{products.length}</span>
              </h2>
              <button
                className="ghost"
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
            {!!products.length && (
              <div className="catalog-toolbar">
                <label>
                  Buscar productos
                  <input
                    id="product-search"
                    type="search"
                    placeholder="Nombre, SKU o código de barras"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  Estado
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="active">Activos</option>
                    <option value="inactive">Inactivos</option>
                  </select>
                </label>
                <p role="status">
                  {visibleProducts.length} de {products.length} productos
                </p>
              </div>
            )}
            {!products.length ? (
              <EmptyState
                title="Aún no tienes productos"
                helpHref="/help/products"
                keepPage={saving || editor !== undefined}
                action={
                  canWrite ? (
                    <Button
                      variant="secondary"
                      disabled={saving || editor !== undefined}
                      onClick={() => {
                        setEditor(null);
                        setError("");
                        setNotice("");
                      }}
                    >
                      Agregar producto
                    </Button>
                  ) : undefined
                }
              >
                {canWrite
                  ? "Agrega tu primer producto para comenzar a vender y controlar inventario."
                  : "Cuando tu equipo agregue productos, aparecerán aquí."}
              </EmptyState>
            ) : !visibleProducts.length ? (
              <EmptyState
                title="No encontramos productos"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                    }}
                  >
                    Limpiar búsqueda
                  </Button>
                }
              >
                Prueba otro nombre, SKU o código de barras, o cambia el estado.
              </EmptyState>
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
                        "Producto",
                        "Código de barras",
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
                    {visibleProducts.map((product) => (
                      <tr key={product.id}>
                        <th scope="row">
                          {photos[product.id] && (
                            <ProductThumbnail
                              key={photos[product.id]}
                              tenantId={tenantId}
                              productId={product.id}
                            />
                          )}
                          <strong>{product.name}</strong>
                          <span className="product-meta">
                            {product.sku} ·{" "}
                            {product.unit === "piece" ? "pza" : product.unit}
                          </span>
                        </th>
                        <td data-label="Código de barras">
                          {product.barcode ?? "—"}
                        </td>
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
                          <div className="desktop-product-edit">
                            {" "}
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
                          </div>
                          <details className="product-more">
                            <summary
                              aria-label={`Más opciones de ${product.name}`}
                            >
                              ⋯
                            </summary>
                            <div className="product-more-content">
                              <p className="mobile-product-detail">
                                Código: {product.barcode ?? "Sin código"}
                                <br />
                                Costo: $
                                {minorUnitsToDecimal(
                                  product.purchaseCost.minorUnits,
                                )}
                              </p>{" "}
                              {saving || editor !== undefined ? (
                                <span aria-disabled="true">
                                  Imprimir etiqueta
                                </span>
                              ) : (
                                <Link
                                  href={`/labels?${new URLSearchParams({ tenantId, productId: product.id })}`}
                                  aria-label={`Imprimir etiqueta de ${product.name}`}
                                >
                                  Imprimir etiqueta
                                </Link>
                              )}
                              <div className="mobile-product-edit">
                                {" "}
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
                              </div>
                            </div>
                          </details>
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
      {scanner && (
        <SmartScanner
          onClose={() => setScanner(false)}
          onCode={(code) => {
            setSearch(code);
            const found = products.find((p) => p.barcode === code);
            setUnknownScan(found ? "" : code);
            feedback.announce(
              found
                ? `✓ Código escaneado. Producto encontrado: ${found.name}`
                : "Código escaneado. No encontramos un producto con este código.",
            );
            setScanner(false);
          }}
        />
      )}
    </div>
  );
}
