"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductDto } from "@smartretail/contracts";
import { labelItems, labelQuantity } from "../../lib/product-labels";
import AppNavigation from "../components/app-navigation";
import ProductLabel from "../components/product-label";
import {
  purchasingApi,
  PurchasingApiError,
  type PurchasingTenant,
} from "../components/purchasing-client";

type Selection = { productId: string; quantity: string };

export default function LabelsPanel({
  tenantId: preferredTenant,
  productId,
  error: queryError,
}: {
  tenantId?: string;
  productId?: string;
  error?: string;
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState<PurchasingTenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [prefillEnabled, setPrefillEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(queryError ?? "");
  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ tenants: PurchasingTenant[] }>(
      "/api/v1/tenants",
      undefined,
      { signal: controller.signal },
    )
      .then(({ tenants }) => {
        if (controller.signal.aborted) return;
        const allowed = tenants.filter((t) =>
          t.permissions.includes("products.read"),
        );
        setCompanies(allowed);
        // A supplied selector never falls back to a different company.
        if (!queryError && preferredTenant) {
          const preferred = allowed.find(
            (t) => t.tenantId.toLowerCase() === preferredTenant.toLowerCase(),
          );
          if (preferred) {
            setTenantId(preferred.tenantId);
          } else {
            setError(
              "No tienes acceso a la empresa de la etiqueta solicitada.",
            );
          }
        } else if (!queryError) {
          setTenantId(allowed[0]?.tenantId ?? "");
        }
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof PurchasingApiError && cause.status === 401)
          router.replace("/login");
        setError("No pudimos cargar tus empresas. Recarga para reintentar.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [preferredTenant, queryError, router]);

  return (
    <div className="labels-page">
      <header className="topbar">
        <Link className="brand" href="/products">
          SmartRetail
        </Link>
        <AppNavigation
          current="/labels"
          permissions={
            companies.find((c) => c.tenantId === tenantId)?.permissions ?? []
          }
        />
      </header>
      <main className="workspace">
        <div className="heading labels-controls">
          <div>
            <p className="eyebrow">Catálogo</p>
            <h1>Etiquetas de productos</h1>
            <p className="muted">
              Selecciona productos y revisa sus etiquetas antes de imprimir.
            </p>
          </div>
          <Link href="/products">Volver a productos</Link>
        </div>
        <div className="labels-controls">
          <label className="tenant-selector">
            Empresa
            <select
              value={tenantId}
              disabled={loading || !companies.length}
              onChange={(event) => {
                setTenantId(event.target.value);
                setPrefillEnabled(false);
                setError("");
              }}
            >
              <option value="">Selecciona una empresa</option>
              {companies.map((company, index) => (
                <option key={company.tenantId} value={company.tenantId}>
                  Empresa {index + 1}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {loading && <p role="status">Cargando empresas…</p>}
          {!loading && !companies.length && !error && (
            <p className="card">
              No tienes empresas con permiso para consultar productos.
            </p>
          )}
        </div>
        {tenantId && !loading && !error && (
          <CompanyLabels
            key={tenantId}
            tenantId={tenantId}
            productId={
              prefillEnabled &&
              tenantId.toLowerCase() === preferredTenant?.toLowerCase()
                ? productId
                : undefined
            }
          />
        )}
      </main>
    </div>
  );
}

function CompanyLabels({
  tenantId,
  productId,
}: {
  tenantId: string;
  productId?: string | undefined;
}) {
  const router = useRouter();
  const [reload, setReload] = useState(0);
  const loadKey = `${tenantId}:${reload}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    products: ProductDto[];
    error: string;
  }>({ key: "", products: [], error: "" });
  const [selections, setSelections] = useState<Selection[]>([]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [size, setSize] = useState<"small" | "standard">("standard");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ products: ProductDto[] }>("/api/v1/products", tenantId, {
      signal: controller.signal,
    })
      .then(({ products }) => {
        if (controller.signal.aborted) return;
        const prefill =
          productId && reload === 0
            ? products.find(
                (p) => p.id.toLowerCase() === productId.toLowerCase(),
              )
            : undefined;
        setLoaded({
          key: loadKey,
          products,
          error:
            productId && reload === 0 && !prefill
              ? "El producto solicitado no está disponible en esta empresa. Selecciona otro producto."
              : "",
        });
        if (prefill) setSelections([{ productId: prefill.id, quantity: "1" }]);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof PurchasingApiError && cause.status === 401)
          router.replace("/login");
        setLoaded({
          key: loadKey,
          products: [],
          error:
            "No pudimos cargar los productos. Revisa tu acceso y reintenta.",
        });
      });
    return () => controller.abort();
  }, [tenantId, productId, reload, loadKey, router]);

  const loading = loaded.key !== loadKey;
  const products = loading ? [] : loaded.products;
  const term = search.trim().toLocaleLowerCase("es-MX");
  const filtered = products.filter((p) =>
    [p.name, p.sku, p.barcode ?? ""].some((text) =>
      text.toLocaleLowerCase("es-MX").includes(term),
    ),
  );
  let items: ReturnType<typeof labelItems> = [];
  let selectionError = "";
  if (!loading && selections.length) {
    try {
      items = labelItems(
        products,
        selections.map((s) => ({
          productId: s.productId,
          quantity: labelQuantity(s.quantity),
        })),
      );
    } catch {
      selectionError =
        "Usa cantidades enteras de 1 a 100 y un máximo total de 200 etiquetas por impresión.";
    }
  }
  const error = loading ? "" : loaded.error || formError || selectionError;
  const printable = !loading && !error && items.length > 0;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const amount = labelQuantity(quantity);
      if (!products.some((p) => p.id === selectedProduct))
        throw new Error("Selecciona un producto de esta empresa.");
      const previous = selections.find((s) => s.productId === selectedProduct);
      const next = [
        ...selections.filter((s) => s.productId !== selectedProduct),
        {
          productId: selectedProduct,
          quantity: String(
            amount + (previous ? labelQuantity(previous.quantity) : 0),
          ),
        },
      ];
      labelItems(
        products,
        next.map((s) => ({
          productId: s.productId,
          quantity: labelQuantity(s.quantity),
        })),
      );
      setSelections(next);
      setFormError("");
      setLoaded((value) => ({ ...value, error: "" }));
    } catch {
      setFormError(
        "Selecciona un producto y usa cantidades enteras de 1 a 100, sin superar 200 etiquetas en total.",
      );
    }
  }

  return (
    <>
      <section className="card labels-controls" aria-label="Preparar etiquetas">
        <div className="list-heading">
          <h2>Preparar etiquetas</h2>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => {
              setSelections([]);
              setSelectedProduct("");
              setFormError("");
              setReload((value) => value + 1);
            }}
          >
            Actualizar productos
          </button>
        </div>
        {loading && <p role="status">Cargando productos…</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <form className="stack" onSubmit={add}>
          <label>
            Buscar por nombre, SKU o código de barras
            <input
              type="search"
              value={search}
              maxLength={200}
              disabled={loading}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedProduct("");
              }}
            />
          </label>
          <div className="form-grid">
            <label>
              Producto
              <select
                value={selectedProduct}
                required
                disabled={loading || !products.length}
                onChange={(event) => setSelectedProduct(event.target.value)}
              >
                <option value="">Selecciona un producto</option>
                {filtered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad de etiquetas
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                required
                value={quantity}
                disabled={loading}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
          </div>
          <button type="submit" disabled={loading || !selectedProduct}>
            Agregar etiquetas
          </button>
        </form>
        {!loading && !filtered.length && (
          <p className="muted">
            No hay productos que coincidan con la búsqueda.
          </p>
        )}
        <p className="muted">
          De 1 a 100 copias por producto; máximo técnico de 200 etiquetas por
          impresión.
        </p>
        {selections.length > 0 && (
          <ul className="label-selection-list">
            {selections.map((selection) => {
              const product = products.find(
                (p) => p.id === selection.productId,
              );
              return product ? (
                <li key={product.id}>
                  <span>
                    {product.name} · {product.sku}
                  </span>
                  <label>
                    Copias de {product.name}
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={selection.quantity}
                      onChange={(event) => {
                        setSelections((previous) =>
                          previous.map((s) =>
                            s.productId === product.id
                              ? { ...s, quantity: event.target.value }
                              : s,
                          ),
                        );
                        setFormError("");
                      }}
                    />
                  </label>
                  <button
                    className="secondary"
                    aria-label={`Quitar ${product.name}`}
                    onClick={() => {
                      setSelections((previous) =>
                        previous.filter((s) => s.productId !== product.id),
                      );
                      setFormError("");
                    }}
                  >
                    Quitar
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        )}
        <div className="labels-print-actions">
          <label>
            Tamaño de etiqueta
            <select
              value={size}
              onChange={(event) =>
                setSize(event.target.value === "small" ? "small" : "standard")
              }
            >
              <option value="small">Pequeña · 50 × 30 mm</option>
              <option value="standard">Estándar · 70 × 40 mm</option>
            </select>
          </label>
          <button
            disabled={!printable}
            onClick={() => {
              if (printable) window.print();
            }}
          >
            Imprimir etiquetas
          </button>
        </div>
        <p className="muted">
          Imprime en A4 a escala 100 %, con margen de 10 mm y sin encabezados ni
          pies del navegador. Prueba la lectura con tu escáner antes de usar las
          etiquetas.
        </p>
      </section>
      <section
        className="labels-preview"
        aria-label="Vista previa de etiquetas"
      >
        <h2 className="labels-controls">
          Vista previa · {printable ? items.length : 0} etiquetas
        </h2>
        {!printable && (
          <p className="card labels-controls">
            Agrega productos con cantidades válidas para ver las etiquetas.
          </p>
        )}
        <div className="label-sheet" data-size={size}>
          {printable &&
            items.map(({ product, copy }) => (
              <ProductLabel
                key={`${product.id}:${copy}`}
                product={product}
                size={size}
              />
            ))}
        </div>
      </section>
    </>
  );
}
