"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreatePurchaseOrderSchema,
  ReceivePurchaseOrderSchema,
  UuidSchema,
  type PurchaseOrderDto,
  type SupplierDto,
  type ProductDto,
  type InventoryLocationDto,
} from "@smartretail/contracts";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { formatDateTime } from "../components/presentation";
import {
  replenishmentPath,
  trustedPurchasePrefill,
  type PurchasePrefill,
  type ReplenishmentRequest,
} from "../components/purchase-prefill";
import {
  purchasingApi,
  PurchasingApiError,
  usePurchasingCompany,
} from "../components/purchasing-client";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
import {
  decimalToMilliUnits,
  milliUnitsToDecimal,
} from "../../lib/quantity-input";

type Receipt = ReturnType<typeof ReceivePurchaseOrderSchema.parse>;
type Pending = { tenantId: string; purchaseId: string; input: Receipt };
const statusText = {
  draft: "Borrador",
  ordered: "Ordenada",
  partially_received: "Recibida parcialmente",
  received: "Recibida",
  cancelled: "Cancelada",
};
const remaining = (l: PurchaseOrderDto["lines"][number]) =>
  (
    BigInt(l.quantityOrdered.milliUnits) - BigInt(l.quantityReceived.milliUnits)
  ).toString();
export default function PurchasesPanel({
  userId,
  initialPurchaseId,
  initialTenantId,
  replenishment,
}: {
  userId: string;
  initialPurchaseId?: string;
  initialTenantId?: string | undefined;
  replenishment?: ReplenishmentRequest | undefined;
}) {
  const router = useRouter(),
    company = usePurchasingCompany("purchases.read", initialTenantId);
  const pendingKey = `smartretail.pending-purchase-receipt.${userId}`;
  const [orders, setOrders] = useState<PurchaseOrderDto[]>([]),
    [suppliers, setSuppliers] = useState<SupplierDto[]>([]),
    [products, setProducts] = useState<ProductDto[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]),
    [detail, setDetail] = useState<PurchaseOrderDto | null>(null),
    [loadedKey, setLoadedKey] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0),
    [editor, setEditor] = useState<PurchaseOrderDto | null | undefined>(
      undefined,
    ),
    [pending, setPending] = useState<Pending | null>(null),
    [storageBlocked, setStorageBlocked] = useState(false),
    [rejected, setRejected] = useState(false),
    [quantities, setQuantities] = useState<Record<string, string>>({});
  const sending = useRef(false);
  const consumedPrefill = useRef("");
  const [prefill, setPrefill] = useState<PurchasePrefill>();
  const [prefillError, setPrefillError] = useState("");
  const canWrite = company.permissions.includes("purchases.write"),
    canReceive = company.permissions.includes("purchases.receive");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(pendingKey);
        if (!raw) return;
        const value: unknown = JSON.parse(raw);
        if (
          !value ||
          typeof value !== "object" ||
          !("tenantId" in value) ||
          !("purchaseId" in value) ||
          !("input" in value)
        )
          throw new Error();
        const tenant = UuidSchema.safeParse(value.tenantId),
          id = UuidSchema.safeParse(value.purchaseId),
          input = ReceivePurchaseOrderSchema.safeParse(value.input);
        if (!tenant.success || !id.success || !input.success) throw new Error();
        setPending({
          tenantId: tenant.data,
          purchaseId: id.data,
          input: input.data,
        });
      } catch {
        setStorageBlocked(true);
        setError(
          "No pudimos recuperar el intento guardado. Conserva la pestaña y consulta al administrador antes de recibir de nuevo.",
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingKey]);
  const targetId =
    initialPurchaseId ??
    (pending?.tenantId === company.tenantId ? pending.purchaseId : undefined);
  const requestedPrefillKey = replenishment
    ? `${replenishment.tenantId}:${replenishment.productId}:${replenishment.locationId}`
    : "";
  const loadKey = `${company.tenantId}:${targetId ?? ""}:${reload}:${requestedPrefillKey}`;
  const loading = !!company.tenantId && loadedKey !== loadKey;
  useEffect(() => {
    if (!company.tenantId) return;
    const c = new AbortController();
    const requestPrefill =
      !!replenishment && consumedPrefill.current !== requestedPrefillKey;
    Promise.all([
      purchasingApi<{ purchases: PurchaseOrderDto[] }>(
        "/api/v1/purchases",
        company.tenantId,
        { signal: c.signal },
      ),
      purchasingApi<{ suppliers: SupplierDto[] }>(
        "/api/v1/suppliers",
        company.tenantId,
        { signal: c.signal },
      ),
      purchasingApi<{ products: ProductDto[] }>(
        "/api/v1/products",
        company.tenantId,
        { signal: c.signal },
      ),
      purchasingApi<{ locations: InventoryLocationDto[] }>(
        "/api/v1/locations",
        company.tenantId,
        { signal: c.signal },
      ),
      targetId
        ? purchasingApi<{ purchase: PurchaseOrderDto }>(
            `/api/v1/purchases/${targetId}`,
            company.tenantId,
            { signal: c.signal },
          )
        : Promise.resolve(null),
      requestPrefill && replenishment
        ? purchasingApi<unknown>(
            replenishmentPath(replenishment),
            replenishment.tenantId,
            { signal: c.signal },
          )
            .then((value) => ({ value, error: "" }))
            .catch((e) => {
              if (
                !c.signal.aborted &&
                e instanceof PurchasingApiError &&
                e.status === 401
              )
                router.replace("/login");
              return {
                value: undefined,
                error:
                  e instanceof Error
                    ? e.message
                    : "No pudimos consultar la sugerencia.",
              };
            })
        : Promise.resolve(null),
    ])
      .then(([p, s, pr, l, d, suggestion]) => {
        if (c.signal.aborted) return;
        setOrders(p.purchases);
        setSuppliers(s.suppliers);
        setProducts(pr.products);
        setLocations(l.locations);
        setDetail(d?.purchase ?? null);
        setLoadedKey(loadKey);
        setEditor(undefined);
        setPrefill(undefined);
        if (suggestion && replenishment) {
          consumedPrefill.current = requestedPrefillKey;
          try {
            if (suggestion.error) throw new Error(suggestion.error);
            if (company.tenantId !== replenishment.tenantId || !canWrite)
              throw new Error(
                "No tienes permiso para preparar esta compra en la empresa solicitada.",
              );
            const value = trustedPurchasePrefill(
              suggestion.value,
              replenishment,
              pr.products,
              l.locations,
            );
            if (sessionStorage.getItem(pendingKey))
              throw new Error(
                "Confirma primero la recepción pendiente antes de preparar el reabastecimiento.",
              );
            setPrefill(value);
            setPrefillError("");
            setEditor(null);
          } catch (e) {
            setPrefillError(
              e instanceof Error ? e.message : "Sugerencia de compra inválida.",
            );
          }
        }
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        setError(e instanceof Error ? e.message : "No pudimos cargar compras.");
        setLoadedKey(loadKey);
        setEditor(undefined);
        setDetail(null);
        setOrders([]);
        setSuppliers([]);
        setProducts([]);
        setLocations([]);
        if (e instanceof PurchasingApiError && e.status === 401)
          router.replace("/login");
      });
    return () => c.abort();
  }, [
    company.tenantId,
    targetId,
    reload,
    router,
    loadKey,
    replenishment,
    requestedPrefillKey,
    canWrite,
    pendingKey,
  ]);
  function fail(e: unknown) {
    setError(
      e instanceof Error && e.name === "ZodError"
        ? "Revisa las cantidades y unidades."
        : e instanceof Error
          ? e.message
          : "No pudimos completar la operación.",
    );
    if (e instanceof PurchasingApiError && e.status === 401)
      router.replace("/login");
  }
  async function save(
    input: ReturnType<typeof CreatePurchaseOrderSchema.parse>,
  ) {
    if (sending.current) return;
    sending.current = true;
    setSaving(true);
    setError("");
    try {
      const { id, ...fields } = input;
      const result = await purchasingApi<{ purchase: PurchaseOrderDto }>(
        editor ? `/api/v1/purchases/${id}` : "/api/v1/purchases",
        company.tenantId,
        {
          method: editor ? "PATCH" : "POST",
          body: JSON.stringify(editor ? fields : input),
        },
      );
      setEditor(undefined);
      setDetail(result.purchase);
      setNotice("Borrador guardado.");
      router.push(
        `/purchases/${result.purchase.id}?tenantId=${company.tenantId}`,
      );
      setReload((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  async function action(which: "order" | "cancel") {
    if (!detail || sending.current || pending) return;
    sending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await purchasingApi<{ purchase: PurchaseOrderDto }>(
        `/api/v1/purchases/${detail.id}/${which}`,
        company.tenantId,
        { method: "POST", body: "{}" },
      );
      setDetail(result.purchase);
      setNotice(
        which === "order"
          ? "Orden confirmada. Ya puedes recibir mercancía."
          : "Orden cancelada. Las recepciones anteriores se conservan.",
      );
      setReload((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  function amountError(l: PurchaseOrderDto["lines"][number], value: string) {
    if (!value) return "";
    try {
      const amount = BigInt(decimalToMilliUnits(value));
      if (l.quantityOrdered.unit === "piece" && amount % 1000n !== 0n)
        return "Usa piezas enteras.";
      if (amount > BigInt(remaining(l)))
        return "La cantidad excede lo pendiente.";
      return "";
    } catch {
      return "Cantidad inválida; máximo 3 decimales.";
    }
  }
  async function receive(event: FormEvent) {
    event.preventDefault();
    if (!detail || sending.current || storageBlocked) return;
    sending.current = true;
    setSaving(true);
    setError("");
    setRejected(false);
    try {
      let command = pending;
      if (!command) {
        if (sessionStorage.getItem(pendingKey))
          throw new Error(
            "Espera a recuperar el intento pendiente antes de recibir.",
          );
        const input = ReceivePurchaseOrderSchema.parse({
          id: crypto.randomUUID(),
          lines: detail.lines.flatMap((l) => {
            const value = quantities[l.productId] ?? "";
            if (!value) return [];
            if (amountError(l, value))
              throw new Error("Revisa las cantidades pendientes.");
            const milliUnits = decimalToMilliUnits(value);
            return milliUnits === "0"
              ? []
              : [
                  {
                    productId: l.productId,
                    quantity: { unit: l.quantityOrdered.unit, milliUnits },
                  },
                ];
          }),
        });
        command = { tenantId: company.tenantId, purchaseId: detail.id, input };
        sessionStorage.setItem(pendingKey, JSON.stringify(command));
        setPending(command);
      }
      if (
        command.tenantId !== company.tenantId ||
        command.purchaseId !== detail.id
      )
        throw new Error("Reintenta desde la orden del intento pendiente.");
      const result = await purchasingApi<{
        purchase: PurchaseOrderDto;
        replayed: boolean;
      }>(`/api/v1/purchases/${command.purchaseId}/receive`, command.tenantId, {
        method: "POST",
        body: JSON.stringify(command.input),
      });
      setDetail(result.purchase);
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      setQuantities({});
      setNotice(
        result.replayed
          ? "Recepción ya registrada; no se duplicaron existencias."
          : "Recepción registrada y existencias actualizadas.",
      );
      setReload((n) => n + 1);
    } catch (e) {
      if (
        e instanceof PurchasingApiError &&
        [400, 404, 409].includes(e.status)
      ) {
        setRejected(true);
        setReload((n) => n + 1);
      }
      fail(e);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  function discardRejected() {
    if (!rejected || saving) return;
    try {
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      setRejected(false);
      setReload((n) => n + 1);
      setQuantities({});
      setNotice(
        "Intento rechazado descartado. Revisa las cantidades antes de crear otra recepción.",
      );
    } catch {
      setError("No pudimos actualizar el intento guardado.");
    }
  }
  const invalidQuantity =
    detail?.lines.some(
      (l) => !!amountError(l, quantities[l.productId] ?? ""),
    ) ?? false;
  const hasQuantity =
    detail?.lines.some((l) => {
      try {
        return BigInt(decimalToMilliUnits(quantities[l.productId] ?? "0")) > 0n;
      } catch {
        return false;
      }
    }) ?? false;
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation current="/purchases" blocked={saving || !!pending} />
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Abastecimiento</p>
            <h1>{initialPurchaseId ? "Orden de compra" : "Compras"}</h1>
            <p className="muted">
              Prepara pedidos y recibe mercancía en inventario.
            </p>
          </div>
          <div className="actions">
            <Link href="/suppliers">Ver proveedores</Link>
            {!initialPurchaseId && (
              <button
                disabled={!canWrite || saving || loading || !!pending}
                onClick={() => {
                  setPrefill(undefined);
                  setEditor(null);
                  setError("");
                }}
              >
                Nueva orden
              </button>
            )}
          </div>
        </div>
        {company.tenants.length > 1 ? (
          <label>
            Empresa
            <select
              value={company.tenantId}
              disabled={saving || !!pending}
              onChange={(e) => {
                company.setTenantId(e.target.value);
                setEditor(undefined);
                setPrefill(undefined);
                setPrefillError("");
                setQuantities({});
                setDetail(null);
              }}
            >
              {company.tenants.map((t, i) => (
                <option value={t.tenantId} key={t.tenantId}>
                  {companyLabel(t.tenantId, i)}
                </option>
              ))}
            </select>
          </label>
        ) : company.tenantId ? (
          <p className="muted">Empresa activa</p>
        ) : null}
        {(error || company.error) && (
          <p role="alert" className="error">
            {error || company.error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {prefillError && (
          <div>
            <p role="alert" className="error">
              {prefillError}
            </p>
            <button
              className="secondary"
              disabled={saving || loading || !!pending}
              onClick={() => {
                consumedPrefill.current = "";
                setPrefillError("");
                setReload((n) => n + 1);
              }}
            >
              Reintentar sugerencia
            </button>
          </div>
        )}
        {pending && (
          <section className="warning" role="status">
            <p>
              Hay una recepción pendiente de confirmar. Conservamos su ID y
              cantidades para reintentar sin duplicar.
            </p>
            <Link
              href={`/purchases/${pending.purchaseId}?tenantId=${pending.tenantId}`}
            >
              Abrir la orden del intento pendiente
            </Link>
            {rejected && (
              <button
                className="secondary"
                disabled={saving}
                onClick={discardRejected}
              >
                Descartar intento rechazado
              </button>
            )}
          </section>
        )}
        {(company.loading || loading) && (
          <p role="status" className="card">
            Cargando compras…
          </p>
        )}
        {!company.loading && !company.tenantId && (
          <p className="card">
            No tienes acceso a compras. Consulta al administrador.
          </p>
        )}
        {editor !== undefined && !loading && (
          <section className="card">
            <h2>{editor ? "Editar borrador" : "Nueva orden"}</h2>
            {prefill && (
              <p className="notice">
                Cantidad sugerida consultada en inventario. Selecciona un
                proveedor y revisa el borrador antes de guardarlo.
              </p>
            )}
            <DraftForm
              key={editor?.id ?? `new:${requestedPrefillKey}`}
              current={editor}
              prefill={prefill}
              suppliers={suppliers}
              locations={locations}
              products={products}
              saving={saving}
              onSave={save}
              onCancel={() => setEditor(undefined)}
            />
          </section>
        )}
        {!loading && detail && (
          <>
            <section className="card">
              <div className="section-heading">
                <h2>
                  {suppliers.find((s) => s.id === detail.supplierId)?.name ??
                    "Proveedor de la orden"}
                </h2>
                <span className="badge">{statusText[detail.status]}</span>
              </div>
              <p>
                Ubicación:{" "}
                {locations.find((l) => l.id === detail.locationId)?.name ??
                  "Ubicación de la orden"}
              </p>
              <p className="muted">
                Creada: {formatDateTime(detail.createdAt)}
                {detail.orderedAt
                  ? ` · Ordenada: ${formatDateTime(detail.orderedAt)}`
                  : ""}
              </p>
              {detail.notes && <p>{detail.notes}</p>}
              <details className="secondary-reference">
                <summary>Referencia de la orden</summary>
                <p className="sale-id">{detail.id}</p>
              </details>
              <div className="actions">
                {detail.status === "draft" && canWrite && (
                  <>
                    <button
                      className="secondary"
                      disabled={saving || !!pending}
                      onClick={() => setEditor(detail)}
                    >
                      Editar borrador
                    </button>
                    <button
                      disabled={saving || !!pending}
                      onClick={() => action("order")}
                    >
                      Ordenar compra
                    </button>
                  </>
                )}
                {!["received", "cancelled"].includes(detail.status) &&
                  canWrite && (
                    <button
                      className="danger"
                      disabled={saving || !!pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "¿Cancelar el pendiente de esta orden? Las recepciones registradas se conservan.",
                          )
                        )
                          void action("cancel");
                      }}
                    >
                      Cancelar orden
                    </button>
                  )}
                <Link href="/purchases">Volver a compras</Link>
              </div>
            </section>
            <section className="card">
              <h2>Líneas de la orden</h2>
              <div className="responsive-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Pedido</th>
                      <th>Recibido</th>
                      <th>Pendiente</th>
                      <th>Costo unitario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.productId}>
                        <th scope="row">
                          {products.find((p) => p.id === l.productId)?.name ??
                            "Producto"}
                          <small>{l.quantityOrdered.unit}</small>
                        </th>
                        <td data-label="Pedido">
                          {milliUnitsToDecimal(l.quantityOrdered.milliUnits)}
                        </td>
                        <td data-label="Recibido">
                          {milliUnitsToDecimal(l.quantityReceived.milliUnits)}
                        </td>
                        <td data-label="Pendiente">
                          <strong>{milliUnitsToDecimal(remaining(l))}</strong>
                        </td>
                        <td data-label="Costo unitario">
                          ${minorUnitsToDecimal(l.unitCost.minorUnits)} MXN
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {["ordered", "partially_received"].includes(detail.status) &&
              canReceive && (
                <section className="card">
                  <h2>Recibir mercancía</h2>
                  <p className="muted">
                    Indica sólo lo recibido ahora. No se modifica el costo de
                    compra del producto.
                  </p>
                  <form className="stack" onSubmit={receive}>
                    {detail.lines
                      .filter((l) => BigInt(remaining(l)) > 0n)
                      .map((l) => {
                        const value = quantities[l.productId] ?? "";
                        const problem = amountError(l, value);
                        const fixed = pending?.input.lines.find(
                          (r) => r.productId === l.productId,
                        )?.quantity.milliUnits;
                        return (
                          <label key={l.productId}>
                            {products.find((p) => p.id === l.productId)?.name ??
                              "Producto"}{" "}
                            — recibir ahora ({l.quantityOrdered.unit})
                            <span className="muted">
                              Pedido{" "}
                              {milliUnitsToDecimal(
                                l.quantityOrdered.milliUnits,
                              )}{" "}
                              · recibido{" "}
                              {milliUnitsToDecimal(
                                l.quantityReceived.milliUnits,
                              )}{" "}
                              · pendiente {milliUnitsToDecimal(remaining(l))}
                            </span>
                            <input
                              inputMode="decimal"
                              maxLength={128}
                              value={
                                pending
                                  ? fixed
                                    ? milliUnitsToDecimal(fixed)
                                    : ""
                                  : value
                              }
                              disabled={saving || !!pending || storageBlocked}
                              aria-invalid={!!problem}
                              aria-describedby={
                                problem
                                  ? `receive-error-${l.productId}`
                                  : undefined
                              }
                              onChange={(e) =>
                                setQuantities({
                                  ...quantities,
                                  [l.productId]: e.target.value,
                                })
                              }
                            />
                            {problem && (
                              <span
                                id={`receive-error-${l.productId}`}
                                className="error"
                              >
                                {problem}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    <button
                      disabled={
                        saving ||
                        storageBlocked ||
                        (!pending && (!hasQuantity || invalidQuantity)) ||
                        (!!pending &&
                          (pending.purchaseId !== detail.id ||
                            pending.tenantId !== company.tenantId))
                      }
                    >
                      {saving
                        ? "Confirmando recepción…"
                        : pending
                          ? "Reintentar misma recepción"
                          : "Confirmar recepción"}
                    </button>
                  </form>
                </section>
              )}
            {pending &&
              pending.purchaseId === detail.id &&
              ["received", "cancelled"].includes(detail.status) && (
                <form className="card" onSubmit={receive}>
                  <p>
                    Confirma el resultado del comando anterior con el mismo ID.
                  </p>
                  <button disabled={saving || !canReceive}>
                    Reintentar misma recepción
                  </button>
                </form>
              )}
          </>
        )}
        {!initialPurchaseId && !loading && company.tenantId && (
          <section className="card">
            <h2>Órdenes de compra</h2>
            <p className="muted">Hasta 100 órdenes recientes.</p>
            {orders.length === 0 ? (
              <p>
                Aún no hay órdenes.{" "}
                {canWrite
                  ? "Crea una con un proveedor activo y una ubicación."
                  : "Solicita a un administrador que prepare una orden."}
              </p>
            ) : (
              <div className="responsive-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>Ubicación</th>
                      <th>Estado</th>
                      <th>Cantidades</th>
                      <th>Fecha</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <th scope="row">
                          {suppliers.find((s) => s.id === o.supplierId)?.name ??
                            "Proveedor"}
                        </th>
                        <td data-label="Ubicación">
                          {locations.find((l) => l.id === o.locationId)?.name ??
                            "Ubicación"}
                        </td>
                        <td data-label="Estado">{statusText[o.status]}</td>
                        <td data-label="Cantidades">
                          {o.lines.map((l) => (
                            <p key={l.productId}>
                              {milliUnitsToDecimal(
                                l.quantityReceived.milliUnits,
                              )}{" "}
                              /{" "}
                              {milliUnitsToDecimal(
                                l.quantityOrdered.milliUnits,
                              )}{" "}
                              {l.quantityOrdered.unit}
                            </p>
                          ))}
                        </td>
                        <td data-label="Fecha">
                          {formatDateTime(o.createdAt)}
                        </td>
                        <td data-label="Acciones" className="row-actions">
                          <Link
                            className="button-link"
                            href={`/purchases/${o.id}?tenantId=${company.tenantId}`}
                          >
                            Ver orden
                          </Link>
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
type DraftLine = {
  key: string;
  productId: string;
  amount: string;
  cost: string;
};
function DraftForm({
  current,
  prefill,
  suppliers,
  locations,
  products,
  saving,
  onSave,
  onCancel,
}: {
  current: PurchaseOrderDto | null;
  prefill?: PurchasePrefill | undefined;
  suppliers: SupplierDto[];
  locations: InventoryLocationDto[];
  products: ProductDto[];
  saving: boolean;
  onSave: (
    input: ReturnType<typeof CreatePurchaseOrderSchema.parse>,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const activeProducts = products.filter((p) => p.status === "active");
  const [id] = useState(() => current?.id ?? crypto.randomUUID()),
    [supplierId, setSupplierId] = useState(
      current?.supplierId ??
        (prefill
          ? ""
          : (suppliers.find((s) => s.status === "active")?.id ?? "")),
    ),
    [locationId, setLocationId] = useState(
      current?.locationId ??
        prefill?.locationId ??
        locations.find((l) => l.status === "active")?.id ??
        "",
    ),
    [notes, setNotes] = useState(current?.notes ?? ""),
    [error, setError] = useState("");
  const fresh = (): DraftLine => ({
    key: crypto.randomUUID(),
    productId: activeProducts[0]?.id ?? "",
    amount: "1",
    cost: activeProducts[0]
      ? minorUnitsToDecimal(activeProducts[0].purchaseCost.minorUnits)
      : "0.00",
  });
  const [lines, setLines] = useState<DraftLine[]>(() =>
    current
      ? current.lines.map((l) => ({
          key: crypto.randomUUID(),
          productId: l.productId,
          amount: milliUnitsToDecimal(l.quantityOrdered.milliUnits),
          cost: minorUnitsToDecimal(l.unitCost.minorUnits),
        }))
      : prefill
        ? [
            {
              key: crypto.randomUUID(),
              productId: prefill.productId,
              amount: prefill.amount,
              cost: minorUnitsToDecimal(
                products.find((p) => p.id === prefill.productId)!.purchaseCost
                  .minorUnits,
              ),
            },
          ]
        : [fresh()],
  );
  function change(key: string, fields: Partial<DraftLine>) {
    setLines((old) =>
      old.map((l) => (l.key === key ? { ...l, ...fields } : l)),
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (new Set(lines.map((l) => l.productId)).size !== lines.length)
        throw new Error("Usa una sola línea por producto.");
      const value = CreatePurchaseOrderSchema.parse({
        id,
        supplierId,
        locationId,
        ...(notes ? { notes } : {}),
        lines: lines.map((l) => {
          const p = products.find((p) => p.id === l.productId);
          if (!p) throw new Error("Selecciona un producto.");
          return {
            productId: l.productId,
            quantityOrdered: {
              unit: p.unit,
              milliUnits: decimalToMilliUnits(l.amount),
            },
            unitCost: {
              currency: "MXN",
              minorUnits: decimalToMinorUnits(l.cost),
            },
          };
        }),
      });
      await onSave(value);
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "Revisa productos, cantidades, costos y referencias activas.",
      );
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Proveedor
          <select
            required
            value={supplierId}
            disabled={saving}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Selecciona un proveedor</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id} disabled={s.status !== "active"}>
                {s.name}
                {s.status !== "active" ? " (inactivo)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ubicación
          <select
            required
            value={locationId}
            disabled={saving}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Selecciona una ubicación</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id} disabled={l.status !== "active"}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {lines.map((l, i) => (
        <fieldset className="purchase-draft-line" key={l.key} disabled={saving}>
          <legend>Línea {i + 1}</legend>
          <div className="form-grid">
            <label>
              Producto
              <select
                required
                value={l.productId}
                onChange={(e) => {
                  const p = products.find((p) => p.id === e.target.value);
                  change(l.key, {
                    productId: e.target.value,
                    cost: p
                      ? minorUnitsToDecimal(p.purchaseCost.minorUnits)
                      : "0.00",
                  });
                }}
              >
                <option value="">Selecciona un producto</option>
                {products.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={p.status !== "active"}
                  >
                    {p.name} · {p.unit}
                    {p.status !== "active" ? " (inactivo)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad pedida
              <input
                required
                inputMode="decimal"
                maxLength={128}
                value={l.amount}
                onChange={(e) => change(l.key, { amount: e.target.value })}
              />
            </label>
            <label>
              Costo unitario MXN
              <input
                required
                inputMode="decimal"
                maxLength={128}
                value={l.cost}
                onChange={(e) => change(l.key, { cost: e.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={saving || lines.length === 1}
            onClick={() =>
              setLines((old) => old.filter((x) => x.key !== l.key))
            }
          >
            Quitar línea {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={saving || lines.length >= 50 || !activeProducts.length}
        onClick={() => setLines((old) => [...old, fresh()])}
      >
        Agregar línea
      </button>
      <label>
        Notas
        <textarea
          maxLength={2000}
          value={notes}
          disabled={saving}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          disabled={
            saving || !supplierId || !locationId || !activeProducts.length
          }
        >
          {saving ? "Guardando…" : "Guardar borrador"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancelar edición
        </button>
      </div>
    </form>
  );
}
