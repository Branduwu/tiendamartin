"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ExpenseSchema,
  SupplierPaymentSchema,
  type ExpenseInputDto,
  type SupplierPaymentDto,
} from "@smartretail/contracts";
import AppNavigation from "./app-navigation";
import {
  purchasingApi,
  PurchasingApiError,
  usePurchasingCompany,
} from "./purchasing-client";
import { formatDateTime } from "./presentation";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
type Amount = { currency: "MXN"; minorUnits: string };
type Account = {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  locationId: string;
  originalAmount: Amount;
  paidAmount: Amount;
  outstandingAmount: Amount;
  status: string;
  createdAt: string;
};
type Payment = {
  id: string;
  method: string;
  amount: Amount;
  createdAt: string;
};
type Expense = Payment & {
  category: string;
  description: string;
  locationId: string | null;
};
const mxn = (v: string) => "$" + minorUnitsToDecimal(v) + " MXN";
const methodName = (v: string) =>
  v === "cash" ? "Efectivo" : v === "card" ? "Tarjeta" : "Banco (registro)";
const stateName = (v: string) =>
  v === "paid"
    ? "Liquidada"
    : v === "partially_paid"
      ? "Parcialmente pagada"
      : "Pendiente";
export function PurchasePayable({
  tenant,
  id,
}: {
  tenant: string;
  id: string;
}) {
  const [value, setValue] = useState<Account | null>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<{ payable: Account }>("/api/v1/payables/" + id, tenant, {
      signal: c.signal,
    })
      .then((d) => {
        if (!c.signal.aborted) setValue(d.payable);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setValue(null);
          setError(
            e instanceof PurchasingApiError && e.status === 404
              ? "Compra histórica sin cuenta registrada."
              : "No pudimos consultar su cuenta.",
          );
        }
      });
    return () => c.abort();
  }, [tenant, id]);
  return (
    <section className="panel stack">
      <h2>Pago de compra</h2>
      {error ? (
        <p role="status">{error}</p>
      ) : value ? (
        <>
          <p>
            Total {mxn(value.originalAmount.minorUnits)} · Pagado{" "}
            {mxn(value.paidAmount.minorUnits)} · Pendiente{" "}
            {mxn(value.outstandingAmount.minorUnits)}
          </p>
          <Link href={"/payables/" + id + "?tenantId=" + tenant}>
            Ver cuenta y pagos
          </Link>
        </>
      ) : (
        <p>Cargando cuenta…</p>
      )}
    </section>
  );
}
export default function FinancialPanel({
  userId,
  mode,
  accountId,
  supplierId,
  preferred,
}: {
  userId: string;
  mode: "payables" | "expenses";
  accountId?: string;
  supplierId?: string;
  preferred?: string;
}) {
  const company = usePurchasingCompany(
    mode === "expenses" ? "expenses.read" : "payables.read",
    preferred,
  );
  const [rows, setRows] = useState<Account[]>([]),
    [expenses, setExpenses] = useState<Expense[]>([]),
    [detail, setDetail] = useState<{
      payable: Account;
      payments: Payment[];
    } | null>(null),
    [before, setBefore] = useState<string | undefined>(),
    [reload, setReload] = useState(0),
    [loaded, setLoaded] = useState(""),
    [error, setError] = useState("");
  const [supplier, setSupplier] = useState<{
    name: string;
    status: string;
  } | null>(null);
  const [purchasesBefore, setPurchasesBefore] = useState<string | undefined>();
  const [summaryBefore, setSummaryBefore] = useState<string | undefined>();
  const [summaryLoaded, setSummaryLoaded] = useState(""),
    [supplierLoaded, setSupplierLoaded] = useState("");
  const supplierKey = company.tenantId + ":" + supplierId;
  const summaryKey =
    supplierKey + ":" + summaryBefore + ":" + purchasesBefore + ":" + reload;
  const [summaryStored, setSummaryStored] = useState<{
      outstanding: string;
      openAccounts: string;
      payments: (Payment & { payableId: string })[];
      purchases: { id: string; status: string; createdAt: string }[];
    } | null>(null),
    [globalNotice, setGlobalNotice] = useState("");
  useEffect(() => {
    if (!supplierId || !company.tenantId) return;
    const c = new AbortController();
    purchasingApi<{
      outstanding: string;
      openAccounts: string;
      payments: (Payment & { payableId: string })[];
      purchases: { id: string; status: string; createdAt: string }[];
    }>(
      "/api/v1/suppliers/" +
        supplierId +
        "/financial" +
        (summaryBefore || purchasesBefore
          ? "?" +
            new URLSearchParams({
              ...(summaryBefore ? { before: summaryBefore } : {}),
              ...(purchasesBefore ? { purchasesBefore } : {}),
            })
          : ""),
      company.tenantId,
      {
        signal: c.signal,
      },
    )
      .then((d) => {
        if (!c.signal.aborted) {
          setSummaryStored(d);
          setSummaryLoaded(summaryKey);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setSummaryStored(null);
          setSummaryLoaded(summaryKey);
        }
      });
    return () => c.abort();
  }, [
    supplierId,
    company.tenantId,
    reload,
    summaryBefore,
    purchasesBefore,
    summaryKey,
  ]);
  const summary = summaryLoaded === summaryKey ? summaryStored : null;
  const key =
      company.tenantId +
      ":" +
      mode +
      ":" +
      accountId +
      ":" +
      supplierId +
      ":" +
      before +
      ":" +
      reload,
    loading = !!company.tenantId && loaded !== key;
  useEffect(() => {
    if (!company.tenantId) return;
    const c = new AbortController();
    const q = new URLSearchParams();
    if (before) q.set("before", before);
    if (supplierId) q.set("supplierId", supplierId);
    const path =
      mode === "expenses"
        ? "/api/v1/expenses"
        : accountId
          ? "/api/v1/payables/" + accountId
          : "/api/v1/payables";
    purchasingApi<{
      payables?: Account[];
      expenses?: Expense[];
      payable?: Account;
      payments?: Payment[];
    }>(path + (q.size ? "?" + q : ""), company.tenantId, {
      signal: c.signal,
    })
      .then((d) => {
        if (c.signal.aborted) return;
        setRows(d.payables ?? []);
        setExpenses(d.expenses ?? []);
        setDetail(
          d.payable ? { payable: d.payable, payments: d.payments ?? [] } : null,
        );
        setError("");
        setLoaded(key);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setRows([]);
          setExpenses([]);
          setDetail(null);
          setError(e instanceof Error ? e.message : "No pudimos cargar datos.");
          setLoaded(key);
        }
      });
    if (supplierId)
      purchasingApi<{
        suppliers: { id: string; name: string; status: string }[];
      }>("/api/v1/suppliers", company.tenantId, { signal: c.signal })
        .then((d) => {
          if (!c.signal.aborted) {
            setSupplier(d.suppliers.find((x) => x.id === supplierId) ?? null);
            setSupplierLoaded(supplierKey);
          }
        })
        .catch(() => {
          if (!c.signal.aborted) {
            setSupplier(null);
            setSupplierLoaded(supplierKey);
          }
        });
    return () => c.abort();
  }, [
    company.tenantId,
    mode,
    accountId,
    supplierId,
    before,
    reload,
    key,
    supplierKey,
  ]);
  const visible = loaded === key,
    canWrite = company.permissions.includes(
      mode === "expenses" ? "expenses.write" : "payables.pay",
    );
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          tenantId={company.tenantId}
          current={supplierId ? "/suppliers" : "/" + mode}
          permissions={company.permissions}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace stack">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Operación financiera</p>
            <h1>
              {supplierId
                ? visible
                  ? ((supplierLoaded === supplierKey
                      ? supplier?.name
                      : undefined) ?? "Proveedor")
                  : "Proveedor"
                : mode === "expenses"
                  ? "Gastos"
                  : accountId
                    ? "Cuenta por pagar"
                    : "Cuentas por pagar"}
            </h1>
            <p className="muted">
              Importes exactos en MXN. Tarjeta y banco son registros; no se
              integra un banco real.
            </p>
          </div>
        </div>
        {company.tenants.length > 1 ? (
          <label>
            Empresa
            <select
              value={company.tenantId}
              onChange={(e) => {
                company.setTenantId(e.target.value);
                setBefore(undefined);
                setSummaryBefore(undefined);
                setPurchasesBefore(undefined);
                setGlobalNotice("");
              }}
            >
              {company.tenants.map((t, i) => (
                <option key={t.tenantId} value={t.tenantId}>
                  Empresa {i + 1}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {(company.error || error) && (
          <p role="alert" className="error">
            {company.error || error}
          </p>
        )}
        {globalNotice && <p role="status">{globalNotice}</p>}
        {company.loading || loading ? (
          <p role="status">Cargando…</p>
        ) : !company.tenantId ? (
          <p>No tienes acceso financiero en una empresa activa.</p>
        ) : visible ? (
          <>
            {supplierId ? (
              <section className="panel stack">
                <h2>Historial del proveedor</h2>
                <p>
                  Estado:{" "}
                  {supplierLoaded !== supplierKey
                    ? "Cargando"
                    : !supplier
                      ? "No disponible"
                      : supplier.status === "inactive"
                        ? "Inactivo"
                        : "Activo"}
                  . Las compras y pagos históricos se conservan.
                </p>
                <p>
                  Pendiente total:{" "}
                  {summary ? mxn(summary.outstanding) : "No disponible"} ·
                  Cuentas abiertas: {summary?.openAccounts ?? "No disponible"}
                </p>
                <h3>Pagos realizados</h3>
                {summary?.payments.map((p) => (
                  <p key={p.id}>
                    {formatDateTime(p.createdAt)} · {methodName(p.method)} ·{" "}
                    {mxn(p.amount.minorUnits)}{" "}
                    <Link
                      href={
                        "/payables/" +
                        p.payableId +
                        "?tenantId=" +
                        company.tenantId
                      }
                    >
                      Ver cuenta
                    </Link>
                  </p>
                ))}
                {summaryBefore && (
                  <button
                    className="secondary"
                    onClick={() => setSummaryBefore(undefined)}
                  >
                    Pagos recientes
                  </button>
                )}
                {summary?.payments.length === 100 && (
                  <button
                    className="secondary"
                    onClick={() =>
                      setSummaryBefore(summary.payments.at(-1)?.id)
                    }
                  >
                    Pagos anteriores del proveedor
                  </button>
                )}
                {(summary?.purchases ?? []).map((p, i) => (
                  <p key={p.id}>
                    <Link
                      href={
                        "/purchases/" + p.id + "?tenantId=" + company.tenantId
                      }
                    >
                      Compra {i + 1}
                    </Link>{" "}
                    · {p.status} · {formatDateTime(p.createdAt)}
                  </p>
                ))}
                {purchasesBefore && (
                  <button
                    className="secondary"
                    onClick={() => setPurchasesBefore(undefined)}
                  >
                    Compras recientes
                  </button>
                )}
                {summary?.purchases.length === 100 && (
                  <button
                    className="secondary"
                    onClick={() =>
                      setPurchasesBefore(summary.purchases.at(-1)?.id)
                    }
                  >
                    Compras anteriores del proveedor
                  </button>
                )}
              </section>
            ) : null}
            {detail ? (
              <>
                <section className="panel stack">
                  <h2>{detail.payable.supplierName}</h2>
                  <p>{stateName(detail.payable.status)}</p>
                  <p>
                    Original {mxn(detail.payable.originalAmount.minorUnits)} ·
                    Pagado {mxn(detail.payable.paidAmount.minorUnits)} ·
                    Pendiente {mxn(detail.payable.outstandingAmount.minorUnits)}
                  </p>
                  <Link
                    href={
                      "/purchases/" +
                      detail.payable.purchaseOrderId +
                      "?tenantId=" +
                      company.tenantId
                    }
                  >
                    Ver compra
                  </Link>
                  <Link
                    href={
                      "/suppliers/" +
                      detail.payable.supplierId +
                      "?tenantId=" +
                      company.tenantId
                    }
                  >
                    Ver proveedor e historial
                  </Link>
                </section>
                <section className="panel stack">
                  <h2>Pagos realizados</h2>
                  {detail.payments.length ? (
                    detail.payments.map((p) => (
                      <p key={p.id}>
                        {formatDateTime(p.createdAt)} · {methodName(p.method)} ·{" "}
                        {mxn(p.amount.minorUnits)}
                      </p>
                    ))
                  ) : (
                    <p>Sin pagos registrados.</p>
                  )}
                  {before && (
                    <button
                      className="secondary"
                      onClick={() => setBefore(undefined)}
                    >
                      Pagos recientes
                    </button>
                  )}
                  {detail.payments.length === 100 && (
                    <button
                      className="secondary"
                      onClick={() => setBefore(detail.payments.at(-1)?.id)}
                    >
                      Pagos anteriores
                    </button>
                  )}
                </section>
              </>
            ) : null}
            {canWrite && (mode === "expenses" || !!detail) && (
              <FinancialForm
                key={company.tenantId + ":" + accountId}
                userId={userId}
                tenant={company.tenantId}
                mode={mode}
                {...(detail ? { account: detail.payable } : {})}
                onStarted={() => setGlobalNotice("")}
                onSaved={(message) => {
                  if (message) setGlobalNotice(message);
                  setReload((n) => n + 1);
                }}
              />
            )}
            {mode === "expenses" ? (
              <section className="panel stack">
                <h2>Gastos registrados</h2>
                {expenses.map((e) => (
                  <article className="stack" key={e.id}>
                    <strong>{e.description}</strong>
                    <p>
                      {e.category} · {methodName(e.method)} ·{" "}
                      {mxn(e.amount.minorUnits)} · {formatDateTime(e.createdAt)}
                    </p>
                  </article>
                ))}
                {!expenses.length && <p>No hay gastos en esta página.</p>}
              </section>
            ) : !accountId ? (
              <section className="panel stack">
                <h2>
                  {supplierId ? "Cuentas de compras" : "Compras recibidas"}
                </h2>
                {rows.map((r) => (
                  <article key={r.id} className="stack">
                    <strong>{r.supplierName}</strong>
                    <p>
                      {formatDateTime(r.createdAt)} · {stateName(r.status)}
                    </p>
                    <p>
                      Original {mxn(r.originalAmount.minorUnits)} · Pagado{" "}
                      {mxn(r.paidAmount.minorUnits)} · Pendiente{" "}
                      {mxn(r.outstandingAmount.minorUnits)}
                    </p>
                    <Link
                      href={
                        "/payables/" + r.id + "?tenantId=" + company.tenantId
                      }
                    >
                      Ver cuenta y pagos
                    </Link>
                  </article>
                ))}
                {!rows.length && (
                  <p>No hay cuentas registradas en esta página.</p>
                )}
              </section>
            ) : null}
            {!accountId ? (
              <div className="actions">
                {before && (
                  <button
                    className="secondary"
                    onClick={() => setBefore(undefined)}
                  >
                    Más recientes
                  </button>
                )}
                {(mode === "expenses" ? expenses : rows).length === 100 && (
                  <button
                    className="secondary"
                    onClick={() =>
                      setBefore(
                        (mode === "expenses" ? expenses : rows).at(-1)?.id,
                      )
                    }
                  >
                    Ver anteriores
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
function FinancialForm({
  userId,
  tenant,
  mode,
  account,
  onStarted,
  onSaved,
}: {
  userId: string;
  tenant: string;
  mode: "payables" | "expenses";
  account?: Account;
  onStarted: () => void;
  onSaved: (message?: string) => void;
}) {
  const [method, setMethod] = useState("card"),
    [location, setLocation] = useState(account?.locationId ?? ""),
    [locations, setLocations] = useState<
      { id: string; name: string; status: string }[]
    >([]),
    [shift, setShift] = useState<string | undefined>(),
    [pending, setPending] = useState<
      ExpenseInputDto | SupplierPaymentDto | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [storageReady, setStorageReady] = useState(false);
  const storageKey =
    "smartretail:financial:" +
    userId +
    ":" +
    tenant +
    ":" +
    mode +
    ":" +
    (account?.id ?? "new");
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        const text = sessionStorage.getItem(storageKey);
        if (text) {
          if (text.length > 8192) throw Error("Invalid saved command");
          const parsed = (
            mode === "expenses" ? ExpenseSchema : SupplierPaymentSchema
          ).safeParse(JSON.parse(text));
          if (!parsed.success) throw Error("Invalid saved command");
          setPending(parsed.data);
        }
      } catch {
        setStorageReady(false);
        setError(
          "No pudimos recuperar la operación. Conserva esta página y verifica el historial antes de crear otro registro.",
        );
        return;
      }
      setStorageReady(true);
    });
    return () => {
      live = false;
    };
  }, [storageKey, mode]);
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<{
      locations: { id: string; name: string; status: string }[];
    }>("/api/v1/locations", tenant, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted)
          setLocations(d.locations.filter((l) => l.status === "active"));
      })
      .catch(() => {
        if (!c.signal.aborted) setError("No pudimos consultar sucursales.");
      });
    return () => c.abort();
  }, [tenant]);
  useEffect(() => {
    if (method !== "cash" || !location) return;
    const c = new AbortController();
    purchasingApi<{ shift: { id: string } | null }>(
      "/api/v1/cash?locationId=" + location,
      tenant,
      { signal: c.signal },
    )
      .then((d) => {
        if (!c.signal.aborted) setShift(d.shift?.id);
      })
      .catch(() => {
        if (!c.signal.aborted) setShift(undefined);
      });
    return () => c.abort();
  }, [tenant, method, location]);
  async function send(value: ExpenseInputDto | SupplierPaymentDto) {
    setBusy(true);
    onStarted();
    setError("");
    setNotice("");
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
      setPending(value);
      const result = await purchasingApi<{ replayed: boolean }>(
        mode === "expenses"
          ? "/api/v1/expenses"
          : "/api/v1/payables/" + account?.id + "/payments",
        tenant,
        { method: "POST", body: JSON.stringify(value) },
      );
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setNotice(
        result.replayed
          ? "Operación ya registrada; no se duplicó."
          : "Operación registrada.",
      );
      onSaved(
        result.replayed
          ? "Operaci\u00f3n ya registrada; no se duplic\u00f3."
          : "Operaci\u00f3n registrada.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos confirmar la operación.",
      );
      if (
        e instanceof PurchasingApiError &&
        [400, 404, 409].includes(e.status)
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onStarted();
    setNotice("");
    if (pending) {
      await send(pending);
      return;
    }
    try {
      const data = new FormData(e.currentTarget);
      const payment = {
        id: crypto.randomUUID(),
        method,
        amount: {
          currency: "MXN",
          minorUnits: decimalToMinorUnits(String(data.get("amount") ?? "")),
        },
        ...(method === "cash" ? { shiftId: shift } : {}),
      };
      const value =
        mode === "expenses"
          ? ExpenseSchema.parse({
              ...payment,
              category: data.get("category"),
              description: String(data.get("description") ?? "").trim(),
              ...(location ? { locationId: location } : {}),
            })
          : SupplierPaymentSchema.parse(payment);
      await send(value);
    } catch {
      setError(
        "Revisa el importe y los datos. Efectivo requiere sucursal y turno abierto.",
      );
    }
  }
  return (
    <section className="panel stack">
      <h2>{mode === "expenses" ? "Nuevo gasto" : "Registrar pago"}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <p role="status">
          Operación pendiente de confirmación: {methodName(pending.method)} ·{" "}
          {mxn(pending.amount.minorUnits)}. Reintenta el mismo registro.
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <fieldset disabled={busy || !!pending || !storageReady}>
          {mode === "expenses" ? (
            <>
              <label>
                Categoría
                <select name="category">
                  {[
                    "renta",
                    "servicios",
                    "transporte",
                    "mantenimiento",
                    "insumos",
                    "otros",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Descripción
                <input name="description" maxLength={500} required />
              </label>
            </>
          ) : null}
          <label>
            Método de pago
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="card">Tarjeta</option>
              <option value="bank">Banco (registro)</option>
              <option value="cash">Efectivo</option>
            </select>
          </label>
          {mode === "expenses" && (
            <label>
              Sucursal
              <select
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setShift(undefined);
                }}
              >
                <option value="">Gasto general (sin sucursal)</option>
                {locations.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Importe (MXN)
            <input
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              required
            />
          </label>
          {method === "cash" && (
            <p>
              {shift
                ? "Turno abierto disponible."
                : "Necesitas un turno abierto en esta sucursal."}
            </p>
          )}
        </fieldset>
        <button
          disabled={
            busy || !storageReady || (!pending && method === "cash" && !shift)
          }
        >
          {busy
            ? "Registrando…"
            : pending
              ? "Reintentar mismo registro"
              : "Confirmar " + (mode === "expenses" ? "gasto" : "pago")}
        </button>
      </form>
    </section>
  );
}
