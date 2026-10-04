"use client";
import PosCustomerSelector from "../components/pos-customer-selector";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createSaleDraft,
  assignSaleCustomer,
  addSaleProduct,
  changeSaleQuantity,
  removeSaleLine,
  quantity,
  type SaleDraft,
} from "@smartretail/domain";
import {
  SuspendSaleSchema,
  SaleDraftSchema,
  type SuspendSaleDto,
  type SuspendedSaleDto,
} from "@smartretail/contracts";
import { scanSaleProduct } from "@smartretail/application";
import type {
  SaleDraftDto,
  CashShiftDto,
  ProductDto,
  InventoryLocationDto,
  CheckoutDto,
  StoredSaleDto,
} from "@smartretail/contracts";
import { recoverPendingSale } from "../../lib/pos-pending";
import { checkoutInput } from "../../lib/sale-mapping";
import { productInput } from "../../lib/product-mapping";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
import {
  decimalToMilliUnits,
  milliUnitsToDecimal,
} from "../../lib/quantity-input";
type Stock = {
  productId: string;
  locationId: string;
  quantity: { unit: string; milliUnits: string };
};
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      body.error ?? "No se pudo completar la operación.",
      response.status,
    );
  return body as T;
}
const mxn = (minor: string) => `$${minorUnitsToDecimal(minor)} MXN`;
export default function PosPanel({ userId }: { userId: string }) {
  const pendingKey = `smartretail.pending-sale.${userId}`;
  const router = useRouter();
  const suspendKey = `smartretail.pending-suspension.${userId}`;
  const [pendingSuspend, setPendingSuspend] = useState<SuspendSaleDto | null>(
    null,
  );
  const [associated, setAssociated] = useState<string | null>(null);
  const [suspended, setSuspended] = useState<SuspendedSaleDto[]>([]);
  const [showSuspended, setShowSuspended] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [scanProduct, setScanProduct] = useState<ProductDto | null>(null);
  const [scanQuantity, setScanQuantity] = useState("");
  const [notice, setNotice] = useState("");
  const scannerRef = useRef<HTMLInputElement>(null);
  const scanQuantityRef = useRef<HTMLInputElement>(null);
  const [tenants, setTenants] = useState<
      { tenantId: string; permissions: string[]; displayName?: string }[]
    >([]),
    [tenant, setTenant] = useState("");
  const [products, setProducts] = useState<ProductDto[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]),
    [location, setLocation] = useState("");
  const [shift, setShift] = useState<CashShiftDto | null>(null);
  const [stock, setStock] = useState<Stock[]>([]),
    [search, setSearch] = useState("");
  const [draft, setDraft] = useState<SaleDraft | null>(null),
    [texts, setTexts] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<"cash" | "card" | "mixed">("cash"),
    [cash, setCash] = useState("0.00");
  const [pending, setPending] = useState<CheckoutDto | null>(null),
    [sending, setSending] = useState(false);
  const [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState<StoredSaleDto | null>(null),
    [loading, setLoading] = useState(true);
  const sendingRef = useRef(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const locked =
    sending || pending !== null || pendingSuspend !== null || recoveryBlocked;
  useEffect(() => {
    const controller = new AbortController();
    api<{
      tenants: {
        tenantId: string;
        permissions: string[];
        displayName?: string;
      }[];
    }>("/api/v1/tenants", {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        data.tenants = data.tenants.filter((t) =>
          t.permissions.includes("sales.create"),
        );
        setTenants(data.tenants);
        let selected = data.tenants[0]?.tenantId ?? "";
        try {
          const recovery = recoverPendingSale(
            sessionStorage.getItem(pendingKey),
            data.tenants.map((t) => t.tenantId),
          );
          if (recovery.kind === "blocked") {
            setRecoveryBlocked(true);
            setError(recovery.message);
          } else if (recovery.kind === "recover") {
            const restored = checkoutInput(recovery.command).draft;
            selected = recovery.tenantId;
            setPending(recovery.command);
            setAssociated(recovery.command.suspendedSaleId ?? null);
            setDraft(restored);
            setLocation(recovery.command.locationId);
            setMethod(recovery.method);
            setCash(recovery.cash);
            setTexts(
              Object.fromEntries(
                restored.lines.map((l) => [
                  l.productId,
                  milliUnitsToDecimal(l.quantity.milliUnits.toString()),
                ]),
              ),
            );
          }
          const raw = sessionStorage.getItem(suspendKey);
          if (raw !== null) {
            if (raw.length > 65536)
              throw new Error("Invalid suspension recovery");
            const saved = JSON.parse(raw) as {
              tenantId?: unknown;
              command?: unknown;
            };
            const parsed = SuspendSaleSchema.safeParse(saved.command);
            if (
              !parsed.success ||
              typeof saved.tenantId !== "string" ||
              !data.tenants.some((t) => t.tenantId === saved.tenantId) ||
              recovery.kind !== "none"
            ) {
              setRecoveryBlocked(true);
              setError(
                "Suspensi\u00f3n pendiente no recuperable. Consulta su estado antes de continuar.",
              );
            } else {
              selected = saved.tenantId;
              setLocation(parsed.data.locationId);
              setPendingSuspend(parsed.data);
              setNotice(
                "Conservamos la suspensi\u00f3n pendiente para reintentar con el mismo ID.",
              );
            }
          }
        } catch {
          setRecoveryBlocked(true);
          setError(
            "No pudimos recuperar la venta pendiente. Consulta su estado antes de comenzar otra venta.",
          );
        }
        setTenant(selected);
        if (!data.tenants.length) setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [pendingKey, suspendKey]);
  useEffect(() => {
    if (!tenant) return;
    const controller = new AbortController();
    const init = {
      headers: { "x-tenant-id": tenant },
      signal: controller.signal,
    };
    Promise.all([
      api<{ products: ProductDto[] }>("/api/v1/products", init),
      api<{ locations: InventoryLocationDto[] }>("/api/v1/locations", init),
    ])
      .then(([p, l]) => {
        if (controller.signal.aborted) return;
        setProducts(p.products);
        setLocations(l.locations.filter((v) => v.status === "active"));
        setLocation(
          (current) =>
            current || l.locations.find((v) => v.status === "active")?.id || "",
        );
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
          if (e.status === 401) router.replace("/login");
        }
      });
    return () => controller.abort();
  }, [tenant, router]);
  useEffect(() => {
    if (!tenant || !location) return;
    const controller = new AbortController();
    api<{ stock: Stock[] }>(`/api/v1/inventory?locationId=${location}`, {
      headers: { "x-tenant-id": tenant },
      signal: controller.signal,
    })
      .then((d) => {
        if (!controller.signal.aborted) setStock(d.stock);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [tenant, location]);
  useEffect(() => {
    if (!tenant || !location) return;
    const controller = new AbortController();
    api<{ shift: CashShiftDto | null }>(`/api/v1/cash?locationId=${location}`, {
      headers: { "x-tenant-id": tenant },
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setShift(data.shift);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [tenant, location]);
  function adjust(id: string, text: string) {
    if (!draft) return;
    try {
      const line = draft.lines.find((l) => l.productId === id);
      if (!line) return;
      setDraft(
        changeSaleQuantity(
          draft,
          id,
          quantity(line.unit, BigInt(decimalToMilliUnits(text))),
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cantidad inválida.");
    }
  }
  function add(product: ProductDto, amount = 1000n) {
    try {
      const next = addSaleProduct(
        draft ?? createSaleDraft(crypto.randomUUID()),
        productInput(product.id, product),
        quantity(product.unit, amount),
      );
      setDraft(next);
      setTexts(
        Object.fromEntries(
          next.lines.map((l) => [
            l.productId,
            milliUnitsToDecimal(l.quantity.milliUnits.toString()),
          ]),
        ),
      );
      setConfirmed(null);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo agregar el producto.",
      );
    }
  }

  function scanAdd(product: ProductDto, amount?: bigint) {
    try {
      const next = scanSaleProduct(
        draft ?? createSaleDraft(crypto.randomUUID()),
        productInput(product.id, product),
        amount === undefined ? undefined : quantity(product.unit, amount),
      );
      setDraft(next);
      setTexts(
        Object.fromEntries(
          next.lines.map((l) => [
            l.productId,
            milliUnitsToDecimal(l.quantity.milliUnits.toString()),
          ]),
        ),
      );
      setScanProduct(null);
      setScanQuantity("");
      setConfirmed(null);
      setNotice(`${product.name}: producto agregado.`);
      setError("");
      scannerRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cantidad inv\u00e1lida.");
    }
  }
  async function scan() {
    if (locked || sendingRef.current || !location) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    setNotice("");
    setScanProduct(null);
    let needsQuantity = false;
    try {
      const result = await api<{
        status: "active" | "inactive" | "not_found";
        product?: ProductDto;
      }>(`/api/v1/products/lookup?barcode=${encodeURIComponent(barcode)}`, {
        headers: { "x-tenant-id": tenant },
      });
      setBarcode("");
      if (result.status === "not_found")
        setError("C\u00f3digo de barras no encontrado.");
      else if (result.status === "inactive")
        setError("El producto est\u00e1 inactivo y no puede venderse.");
      else if (result.product) {
        if (result.product.unit === "piece") scanAdd(result.product);
        else {
          needsQuantity = true;
          setScanProduct(result.product);
          setScanQuantity("");
          setNotice("Indica la cantidad antes de agregar este producto.");
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Error de red. Vuelve a escanear.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
      requestAnimationFrame(() =>
        (needsQuantity ? scanQuantityRef : scannerRef).current?.focus(),
      );
    }
  }
  async function listSuspended() {
    const data = await api<{ suspended: SuspendedSaleDto[] }>(
      "/api/v1/suspended-sales",
      { headers: { "x-tenant-id": tenant } },
    );
    setSuspended(data.suspended);
    setShowSuspended(true);
  }
  async function suspendCart() {
    if (sendingRef.current || recoveryBlocked || pending || associated) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      let command = pendingSuspend;
      if (!command) {
        if (!draft?.lines.length || !location)
          throw new Error("Agrega productos y selecciona una ubicaci\u00f3n.");
        command = SuspendSaleSchema.parse({
          id: crypto.randomUUID(),
          locationId: location,
          lines: draft.lines.map((l) => ({
            productId: l.productId,
            quantity: {
              unit: l.unit,
              milliUnits: decimalToMilliUnits(
                texts[l.productId] ??
                  milliUnitsToDecimal(l.quantity.milliUnits.toString()),
              ),
            },
          })),
        });
        if (
          new TextEncoder().encode(JSON.stringify(command)).byteLength > 16384
        )
          throw new Error(
            "El carrito supera el l\u00edmite t\u00e9cnico de transporte. Suspende menos l\u00edneas.",
          );
        sessionStorage.setItem(
          suspendKey,
          JSON.stringify({ tenantId: tenant, command }),
        );
        setPendingSuspend(command);
      }
      await api("/api/v1/suspended-sales", {
        method: "POST",
        headers: { "x-tenant-id": tenant, "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      sessionStorage.removeItem(suspendKey);
      setPendingSuspend(null);
      setDraft(null);
      setTexts({});
      setScanProduct(null);
      setCash("0.00");
      setNotice(
        "Venta suspendida. No se reserv\u00f3 ni descont\u00f3 inventario. Al recuperar, vuelve a seleccionar el cliente.",
      );
      await listSuspended();
    } catch (e) {
      if (e instanceof ApiError && [400, 404, 409].includes(e.status)) {
        sessionStorage.removeItem(suspendKey);
        setPendingSuspend(null);
      }
      if (e instanceof ApiError && e.status === 401) router.replace("/login");
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo confirmar. Reintenta la misma suspensi\u00f3n.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  async function suspendedAction(
    record: SuspendedSaleDto,
    action: "recover" | "cancel",
  ) {
    if (locked || sendingRef.current || draft?.lines.length) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const data = await api<{
        record: SuspendedSaleDto;
        draft?: SaleDraftDto;
      }>(`/api/v1/suspended-sales/${record.id}/${action}`, {
        method: "POST",
        headers: { "x-tenant-id": tenant, "content-type": "application/json" },
        body: JSON.stringify(
          action === "recover" ? { saleId: crypto.randomUUID() } : {},
        ),
      });
      if (action === "recover") {
        const parsed = SaleDraftSchema.parse(data.draft);
        const restored = checkoutInput({
          draft: parsed,
          locationId: data.record.locationId,
          payments: [],
          movements: [],
        }).draft;
        setDraft(restored);
        setAssociated(record.id);
        setLocation(data.record.locationId);
        setShift(null);
        setConfirmed(null);
        setScanProduct(null);
        setTexts(
          Object.fromEntries(
            restored.lines.map((l) => [
              l.productId,
              milliUnitsToDecimal(l.quantity.milliUnits.toString()),
            ]),
          ),
        );
        // A same-location recovery also refreshes the current shift explicitly.
        const current = await api<{ shift: CashShiftDto | null }>(
          `/api/v1/cash?locationId=${data.record.locationId}`,
          { headers: { "x-tenant-id": tenant } },
        );
        setShift(current.shift);
        setNotice(
          "Carrito recuperado con precios actuales. Sigue guardado y no reserva stock.",
        );
      } else {
        setNotice("Venta suspendida cancelada; inventario intacto.");
        await listSuspended();
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo completar la operaci\u00f3n.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const total = draft?.total.minorUnits ?? 0n;
  let cardAmount = "—";
  try {
    const remainder = total - BigInt(decimalToMinorUnits(cash));
    if (remainder >= 0n) cardAmount = mxn(remainder.toString());
  } catch {
    /* Input remains editable until valid. */
  }
  async function checkout() {
    if (sendingRef.current || recoveryBlocked || pendingSuspend !== null)
      return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      let command = pending;
      if (!command) {
        if (!shift || shift.status !== "open")
          throw new Error(
            "Abre la caja de esta ubicaci\u00f3n antes de vender.",
          );
        if (!draft || !location)
          throw new Error("Agrega productos y selecciona una ubicación.");
        let edited = draft;
        for (const line of draft.lines)
          edited = changeSaleQuantity(
            edited,
            line.productId,
            quantity(
              line.unit,
              BigInt(
                decimalToMilliUnits(
                  texts[line.productId] ??
                    milliUnitsToDecimal(line.quantity.milliUnits.toString()),
                ),
              ),
            ),
          );
        const amount = edited.total.minorUnits;
        const payment = (method: "cash" | "card", value: bigint) => ({
          method,
          amount: { currency: "MXN" as const, minorUnits: value.toString() },
        });
        let payments: CheckoutDto["payments"] = [];
        if (amount > 0n) {
          if (method === "mixed") {
            const cashAmount = BigInt(decimalToMinorUnits(cash));
            if (cashAmount <= 0n || cashAmount >= amount)
              throw new Error(
                "En pago mixto, efectivo y tarjeta deben ser mayores que cero y sumar el total.",
              );
            payments = [
              payment("cash", cashAmount),
              payment("card", amount - cashAmount),
            ];
          } else payments = [payment(method, amount)];
        }
        command = {
          ...(associated ? { suspendedSaleId: associated } : {}),
          shiftId: shift.id,
          draft: {
            ...edited,
            total: { currency: "MXN", minorUnits: amount.toString() },
            lines: edited.lines.map((l) => ({
              ...l,
              quantity: {
                unit: l.unit,
                milliUnits: l.quantity.milliUnits.toString(),
              },
              unitPrice: {
                currency: "MXN",
                minorUnits: l.unitPrice.minorUnits.toString(),
              },
              lineTotal: {
                currency: "MXN",
                minorUnits: l.lineTotal.minorUnits.toString(),
              },
            })),
          },
          locationId: location,
          payments,
          movements: edited.lines.map((l) => ({
            productId: l.productId,
            movementId: crypto.randomUUID(),
          })),
        };
        // Save only the sale command, never Auth credentials. Recovery is scoped
        // to the server-verified subject and retains the original tenant/IDs.
        sessionStorage.setItem(
          pendingKey,
          JSON.stringify({ tenantId: tenant, command }),
        );
        setPending(command);
        setDraft(edited);
      }
      const result = await api<{ recorded: StoredSaleDto; replayed: boolean }>(
        "/api/v1/sales",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": tenant,
          },
          body: JSON.stringify(command),
        },
      );
      setConfirmed(result.recorded);
      setSuspended((current) =>
        current.filter((record) => record.id !== command.suspendedSaleId),
      );
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        /* A stale receipt can only replay the same SaleId. */
      }
      setPending(null);
      setAssociated(null);
      setDraft(null);
      setTexts({});
      setCash("0.00");
      try {
        const current = await api<{ stock: Stock[] }>(
          `/api/v1/inventory?locationId=${location}`,
          { headers: { "x-tenant-id": tenant } },
        );
        setStock(current.stock);
      } catch {
        setError(
          "Venta confirmada. Consulta Inventario para actualizar las existencias.",
        );
      }
    } catch (e) {
      if (e instanceof ApiError && [400, 404, 409].includes(e.status)) {
        setPending(null);
        sessionStorage.removeItem(pendingKey);
      }
      if (e instanceof ApiError && e.status === 401) router.replace("/login");
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos confirmar la venta. Reintenta la misma venta.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/products">
          SmartRetail
        </Link>
        <AppNavigation
          current="/pos"
          permissions={
            tenants.find((t) => t.tenantId === tenant)?.permissions ?? []
          }
        />
      </header>
      <main className="workspace">
        <div className="heading">
          <div>
            <h1>Punto de venta</h1>
            <p className="company-context">
              Cajero actual:{" "}
              {tenants.find((t) => t.tenantId === tenant)?.displayName ??
                "Cajero registrado"}
            </p>
            <p className="muted">
              Selecciona productos, revisa el pago y confirma la venta.
            </p>
          </div>
        </div>
        {notice ? (
          <p role="status" className="notice">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        {confirmed ? (
          <section className="pos-confirmation" role="status">
            <h2>Venta confirmada</h2>
            <p>{mxn(confirmed.sale.total.minorUnits)}</p>
            <p>Cliente: {confirmed.customerName ?? "Público general"}</p>
            <p>
              ID de venta:{" "}
              <strong className="sale-id">{confirmed.sale.id}</strong>
            </p>
            <Link href={`/sales/${confirmed.sale.id}?tenantId=${tenant}`}>
              Ver ticket
            </Link>
            <p>El servidor guardó la venta y descontó las existencias.</p>
          </section>
        ) : null}
        {!pending && shift?.status !== "open" && (
          <p role="status" className="notice">
            No hay un turno abierto. <Link href="/cash">Abre caja</Link> antes
            de completar la venta.
          </p>
        )}
        {shift?.status === "open" && (
          <p className="company-context">
            Caja abierta en la ubicación seleccionada.
          </p>
        )}
        {loading ? (
          <p role="status" className="notice">
            Cargando punto de venta…
          </p>
        ) : !tenants.length ? (
          <p>No tienes una empresa activa.</p>
        ) : (
          <>
            <PosCustomerSelector
              key={tenant}
              tenantId={tenant}
              value={draft?.customerId}
              locked={locked}
              canRead={
                tenants
                  .find((t) => t.tenantId === tenant)
                  ?.permissions.includes("customers.read") ?? false
              }
              canWrite={
                tenants
                  .find((t) => t.tenantId === tenant)
                  ?.permissions.includes("customers.write") ?? false
              }
              onSelect={(id) => {
                setDraft((current) =>
                  assignSaleCustomer(
                    current ?? createSaleDraft(crypto.randomUUID()),
                    id,
                  ),
                );
                setConfirmed(null);
              }}
            />
            <a className="mobile-cart-jump" href="#cart-title">
              Ver venta actual <strong>{mxn(total.toString())}</strong>
            </a>
            <div className="pos-selectors">
              <label>
                Empresa
                <select
                  value={tenant}
                  disabled={locked || !!draft?.lines.length}
                  onChange={(e) => {
                    if (e.target.value === tenant) return;
                    setDraft(null);
                    setTenant(e.target.value);
                    setLocation("");
                    setShift(null);
                    setProducts([]);
                    setStock([]);
                    setConfirmed(null);
                    setShowSuspended(false);
                    setSuspended([]);
                    setScanProduct(null);
                  }}
                >
                  {tenants.map((t, index) => (
                    <option key={t.tenantId} value={t.tenantId}>
                      {companyLabel(t.tenantId, index)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ubicación
                <select
                  value={location}
                  disabled={locked || associated !== null}
                  onChange={(e) => {
                    if (e.target.value === location) return;
                    setLocation(e.target.value);
                    setShift(null);
                    setStock([]);
                  }}
                >
                  <option value="">Selecciona una ubicación</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section
              className="pos-cart scan-panel"
              aria-labelledby="scan-title"
            >
              <h2 id="scan-title">Escanear producto</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void scan();
                }}
              >
                <label>
                  Código de barras
                  <input
                    ref={scannerRef}
                    aria-label="Código de barras"
                    autoComplete="off"
                    value={barcode}
                    maxLength={128}
                    disabled={locked || !location}
                    onChange={(e) => setBarcode(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={locked || !location || !barcode}
                >
                  Buscar código
                </button>
              </form>
              {scanProduct && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!locked) {
                      try {
                        scanAdd(
                          scanProduct,
                          BigInt(decimalToMilliUnits(scanQuantity)),
                        );
                      } catch {
                        setError("Revisa la cantidad.");
                      }
                    }
                  }}
                >
                  <p>
                    {scanProduct.name} · {mxn(scanProduct.salePrice.minorUnits)}{" "}
                    / {scanProduct.unit}
                  </p>
                  <label>
                    Cantidad a agregar ({scanProduct.unit})
                    <input
                      ref={scanQuantityRef}
                      inputMode="decimal"
                      value={scanQuantity}
                      onChange={(e) => setScanQuantity(e.target.value)}
                      disabled={locked}
                    />
                  </label>
                  <button disabled={locked || !scanQuantity}>
                    Agregar cantidad
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={locked}
                    onClick={() => setScanProduct(null)}
                  >
                    Descartar lectura
                  </button>
                </form>
              )}
            </section>
            <section className="stack suspended-panel">
              <div className="actions">
                <button
                  type="button"
                  disabled={
                    sending ||
                    recoveryBlocked ||
                    !!pending ||
                    !!associated ||
                    (!pendingSuspend && !draft?.lines.length)
                  }
                  onClick={() => void suspendCart()}
                >
                  {pendingSuspend
                    ? "Reintentar la misma suspensi\u00f3n"
                    : "Suspender venta"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={locked}
                  onClick={() => {
                    void listSuspended().catch((e) => setError(e.message));
                  }}
                >
                  Ventas suspendidas
                </button>
                {associated && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={locked}
                    onClick={() => {
                      setDraft(null);
                      setTexts({});
                      setAssociated(null);
                      setNotice(
                        "El carrito original sigue suspendido. Los cambios sin guardar se descartaron.",
                      );
                    }}
                  >
                    Dejar original en espera
                  </button>
                )}
              </div>
              {associated && (
                <p>
                  Recuperada: {associated.slice(0, 8)}. Precio actual; el
                  checkout vuelve a validar stock y precio.
                </p>
              )}
              {showSuspended && (
                <div aria-label="Ventas suspendidas">
                  <h2>Ventas suspendidas</h2>
                  <p className="muted">
                    Hasta 50 pendientes recientes. Para recuperar o cancelar,
                    termina o suspende primero el carrito actual.
                  </p>
                  {!suspended.length && <p>No hay ventas suspendidas.</p>}
                  {suspended.map((record) => (
                    <article className="pos-product" key={record.id}>
                      <div>
                        <strong>{record.id.slice(0, 8)}</strong>
                        <small>
                          {new Date(record.createdAt).toLocaleString()} ?{" "}
                          {locations.find((l) => l.id === record.locationId)
                            ?.name ?? record.locationId}
                        </small>
                        <small>{record.lines.length} líneas</small>
                      </div>
                      <div className="actions">
                        <button
                          type="button"
                          disabled={locked || !!draft?.lines.length}
                          onClick={() =>
                            void suspendedAction(record, "recover")
                          }
                        >
                          Recuperar
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={locked || !!draft?.lines.length}
                          onClick={() => void suspendedAction(record, "cancel")}
                        >
                          Cancelar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <div className="pos-layout">
              <section aria-labelledby="catalog-title">
                <h2 id="catalog-title">Productos</h2>
                <label>
                  Buscar por nombre o SKU
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Busca un producto"
                  />
                </label>
                <div className="pos-catalog">
                  {!products.some(
                    (p) =>
                      p.status === "active" &&
                      `${p.name} ${p.sku}`
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()),
                  ) && (
                    <p className="muted" role="status">
                      No hay coincidencias. Cambia la búsqueda o revisa el{" "}
                      <Link href="/products">catálogo de productos</Link>.
                    </p>
                  )}

                  {products
                    .filter(
                      (p) =>
                        p.status === "active" &&
                        `${p.name} ${p.sku}`
                          .toLocaleLowerCase()
                          .includes(search.toLocaleLowerCase()),
                    )
                    .map((p) => {
                      const current = stock.find((s) => s.productId === p.id);
                      return (
                        <article key={p.id} className="pos-product">
                          <div>
                            <strong>{p.name}</strong>
                            <small>
                              {p.sku} · {p.unit}
                            </small>
                            <small>
                              Disponible:{" "}
                              {current
                                ? milliUnitsToDecimal(
                                    current.quantity.milliUnits,
                                  )
                                : "—"}
                            </small>
                          </div>
                          <div>
                            <strong>{mxn(p.salePrice.minorUnits)}</strong>
                            <button
                              type="button"
                              disabled={locked || !location}
                              onClick={() => add(p)}
                              aria-label={`Agregar ${p.name}`}
                            >
                              Agregar
                            </button>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </section>
              <section className="pos-cart" aria-labelledby="cart-title">
                <h2 id="cart-title" tabIndex={-1}>
                  Venta actual
                </h2>
                {!draft?.lines.length ? (
                  <p className="muted">Agrega un producto para comenzar.</p>
                ) : (
                  draft.lines.map((l) => (
                    <article className="pos-line" key={l.productId}>
                      <div>
                        <strong>{l.name}</strong>
                        <small>
                          {l.sku} · {mxn(l.unitPrice.minorUnits.toString())} /{" "}
                          {l.unit}
                        </small>
                      </div>
                      <label>
                        Cantidad ({l.unit})
                        <input
                          inputMode="decimal"
                          value={
                            texts[l.productId] ??
                            milliUnitsToDecimal(
                              l.quantity.milliUnits.toString(),
                            )
                          }
                          disabled={locked}
                          onChange={(e) =>
                            setTexts({
                              ...texts,
                              [l.productId]: e.target.value,
                            })
                          }
                          onBlur={(e) => adjust(l.productId, e.target.value)}
                        />
                      </label>
                      <div className="actions">
                        <strong>
                          {mxn(l.lineTotal.minorUnits.toString())}
                        </strong>
                        <button
                          className="secondary"
                          type="button"
                          disabled={locked}
                          onClick={() => {
                            setDraft(removeSaleLine(draft, l.productId));
                            setError("");
                          }}
                          aria-label={`Eliminar ${l.name}`}
                        >
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))
                )}
                <dl className="pos-totals">
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{mxn(total.toString())}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{mxn(total.toString())}</dd>
                  </div>
                </dl>
                <label>
                  Método de pago
                  <select
                    value={method}
                    disabled={locked}
                    onChange={(e) =>
                      setMethod(e.target.value as "cash" | "card" | "mixed")
                    }
                  >
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                    <option value="mixed">Mixto</option>
                  </select>
                </label>
                {method === "mixed" ? (
                  <div className="stack">
                    <label>
                      Efectivo (MXN)
                      <input
                        inputMode="decimal"
                        value={cash}
                        disabled={locked}
                        onChange={(e) => setCash(e.target.value)}
                      />
                    </label>
                    <p>
                      Tarjeta: <strong>{cardAmount}</strong>
                    </p>
                  </div>
                ) : (
                  <p>
                    Pago {method === "cash" ? "en efectivo" : "con tarjeta"}:{" "}
                    <strong>{mxn(total.toString())}</strong>
                  </p>
                )}
                <button
                  className="pos-checkout"
                  type="button"
                  disabled={
                    sending ||
                    recoveryBlocked ||
                    pendingSuspend !== null ||
                    !draft?.lines.length ||
                    !location ||
                    (!pending && shift?.status !== "open")
                  }
                  onClick={checkout}
                >
                  {sending
                    ? "Confirmando venta…"
                    : pending
                      ? "Reintentar la misma venta"
                      : "Completar venta"}
                </button>
                {pending ? (
                  <p role="status" className="notice">
                    Conservamos esta venta para reintentar sin duplicarla. No
                    cierres esta página hasta confirmar el resultado.
                  </p>
                ) : null}
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
