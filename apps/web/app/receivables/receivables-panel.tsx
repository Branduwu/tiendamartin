"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ReceivablePaymentInputSchema,
  type ReceivableDto,
  type ReceivablePaymentDto,
  type ReceivablePaymentInputDto,
  type CashShiftDto,
} from "@smartretail/contracts";
import AppNavigation from "../components/app-navigation";
import {
  purchasingApi,
  PurchasingApiError,
  usePurchasingCompany,
} from "../components/purchasing-client";
import { formatDateTime } from "../components/presentation";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
const mxn = (value: string) => "$" + minorUnitsToDecimal(value) + " MXN";
const status = (value: ReceivableDto["status"]) =>
  value === "paid"
    ? "Liquidada"
    : value === "open"
      ? "Pendiente"
      : "Parcialmente pagada";
export function CustomerReceivables({
  tenant,
  customerId,
}: {
  tenant: string;
  customerId: string;
}) {
  const [rows, setRows] = useState<ReceivableDto[]>([]),
    [error, setError] = useState("");
  const [before, setBefore] = useState<string | undefined>(),
    [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<{ receivables: ReceivableDto[]; nextCursor: string | null }>(
      `/api/v1/receivables?customerId=${customerId}` +
        (before ? `&before=${before}` : ""),
      tenant,
      { signal: c.signal },
    )
      .then((d) => {
        if (!c.signal.aborted) {
          setRows(d.receivables);
          setNext(d.nextCursor);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError("No pudimos consultar las cuentas.");
      });
    return () => c.abort();
  }, [tenant, customerId, before]);
  return (
    <section className="card">
      <h2>Cuentas y abonos</h2>
      <p className="muted">
        Las devoluciones reducen primero la deuda de su venta. Consulta cada
        cuenta para ver abonos; liquidada puede incluir deuda cancelada por
        devolución.
      </p>
      {error && <p role="alert">{error}</p>}
      <AccountList rows={rows} tenant={tenant} />
      <p className="muted">
        Hasta 100 cuentas por página, incluidas liquidadas.
      </p>
      <div className="actions">
        {before && (
          <button className="secondary" onClick={() => setBefore(undefined)}>
            Cuentas recientes
          </button>
        )}
        {next && (
          <button className="secondary" onClick={() => setBefore(next)}>
            Cuentas anteriores
          </button>
        )}
      </div>
      <PaymentHistory
        key={tenant + customerId}
        tenant={tenant}
        customerId={customerId}
      />
    </section>
  );
}
function AccountList({
  rows,
  tenant,
}: {
  rows: readonly ReceivableDto[];
  tenant: string;
}) {
  return !rows.length ? (
    <p>No hay cuentas por cobrar visibles.</p>
  ) : (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Fecha</th>
            <th>Crédito original</th>
            <th>Pagado</th>
            <th>Pendiente</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Cliente">{r.customerName}</td>
              <td data-label="Fecha">{formatDateTime(r.createdAt)}</td>
              <td data-label="Crédito original">
                {mxn(r.originalAmount.minorUnits)}
              </td>
              <td data-label="Pagado">{mxn(r.paidAmount.minorUnits)}</td>
              <td data-label="Pendiente">
                {mxn(r.outstandingAmount.minorUnits)}
              </td>
              <td data-label="Estado">{status(r.status)}</td>
              <td data-label="Acciones">
                <Link href={`/receivables/${r.id}?tenantId=${tenant}`}>
                  Ver cuenta y abonos
                </Link>
                {" · "}
                <Link href={`/sales/${r.saleId}?tenantId=${tenant}`}>
                  Ver venta
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function PaymentHistory({
  tenant,
  customerId,
  receivableId,
  reloadToken = "",
}: {
  tenant: string;
  customerId?: string;
  receivableId?: string;
  reloadToken?: string;
}) {
  const [rows, setRows] = useState<ReceivablePaymentDto[]>([]),
    [before, setBefore] = useState<string | undefined>(),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    const url = customerId
      ? `/api/v1/customers/${customerId}/payments`
      : `/api/v1/receivables/${receivableId}`;
    purchasingApi<{
      payments: ReceivablePaymentDto[];
      nextCursor?: string | null;
    }>(url + (before ? `?before=${before}` : ""), tenant, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) {
          setRows(d.payments);
          setNext(
            d.payments.length === 100 ? (d.payments.at(-1)?.id ?? null) : null,
          );
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("No pudimos consultar el historial de abonos.");
      });
    return () => c.abort();
  }, [tenant, customerId, receivableId, before, reloadToken]);
  return (
    <div className="stack">
      <h2>Historial de abonos</h2>
      {error && <p role="alert">{error}</p>}
      {!rows.length ? (
        <p>Aún no hay abonos visibles.</p>
      ) : (
        <ul>
          {rows.map((p) => (
            <li key={p.id}>
              {formatDateTime(p.createdAt)} ·{" "}
              {p.method === "cash" ? "Efectivo" : "Tarjeta"} ·{" "}
              {mxn(p.amount.minorUnits)} ·{" "}
              <Link href={`/receivables/${p.receivableId}?tenantId=${tenant}`}>
                Ver cuenta
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Hasta 100 abonos por página.</p>
      <div className="actions">
        {before && (
          <button className="secondary" onClick={() => setBefore(undefined)}>
            Abonos recientes
          </button>
        )}
        {next && (
          <button className="secondary" onClick={() => setBefore(next)}>
            Abonos anteriores
          </button>
        )}
      </div>
    </div>
  );
}
export default function ReceivablesPanel({
  id,
  preferredTenant,
  userId,
}: {
  id?: string;
  preferredTenant?: string;
  userId: string;
}) {
  const company = usePurchasingCompany("receivables.read", preferredTenant),
    [rows, setRows] = useState<ReceivableDto[]>([]),
    [detail, setDetail] = useState<{
      receivable: ReceivableDto;
      payments: ReceivablePaymentDto[];
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [method, setMethod] = useState<"cash" | "card">("card"),
    [shift, setShift] = useState<CashShiftDto | null>(null),
    [pending, setPending] = useState<ReceivablePaymentInputDto | null>(null),
    [saving, setSaving] = useState(false),
    [reload, setReload] = useState(0);
  const [before, setBefore] = useState<string | undefined>(),
    [next, setNext] = useState<string | null>(null),
    [loadedKey, setLoadedKey] = useState("");
  const queryKey = company.tenantId + ":" + (id ?? "") + ":" + (before ?? "");
  const pendingKey =
    id && company.tenantId
      ? `smartretail.pending-collection.${userId}.${company.tenantId}.${id}`
      : "";
  const [recoveredKey, setRecoveredKey] = useState(""),
    [blocked, setBlocked] = useState(false);
  const sending = useRef(false),
    canPay = company.permissions.includes("receivables.pay");
  useEffect(() => {
    if (!pendingKey) return;
    const frame = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(pendingKey);
        if (raw !== null) {
          if (raw.length > 2048) throw new Error("Invalid pending collection");
          const command = ReceivablePaymentInputSchema.parse(JSON.parse(raw));
          setPending(command);
          setMethod(command.method);
        } else setPending(null);
        setBlocked(false);
      } catch {
        setBlocked(true);
        setError(
          "Hay un abono pendiente no recuperable. Consulta la cuenta antes de continuar; conservamos su comando.",
        );
      } finally {
        setRecoveredKey(pendingKey);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingKey]);
  useEffect(() => {
    if (!company.tenantId) return;
    const c = new AbortController();
    purchasingApi<{
      receivables?: ReceivableDto[];
      receivable?: ReceivableDto;
      payments?: ReceivablePaymentDto[];
      nextCursor?: string | null;
    }>(
      "/api/v1/receivables" +
        (id ? "/" + id : "") +
        (!id && before ? `?before=${before}` : ""),
      company.tenantId,
      {
        signal: c.signal,
      },
    )
      .then((d) => {
        if (c.signal.aborted) return;
        setRows(d.receivables ?? []);
        setNext(d.nextCursor ?? null);
        setLoadedKey(queryKey);
        setDetail(
          d.receivable
            ? { receivable: d.receivable, payments: d.payments ?? [] }
            : null,
        );
        setLoading(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "No pudimos consultar cuentas.",
          );
          setLoading(false);
          setRows([]);
          setDetail(null);
          setShift(null);
          setNext(null);
          setLoadedKey(queryKey);
        }
      });
    return () => c.abort();
  }, [id, company.tenantId, reload, before, queryKey]);
  useEffect(() => {
    if (!detail || method !== "cash") return;
    const c = new AbortController();
    purchasingApi<{ shift: CashShiftDto | null }>(
      `/api/v1/cash?locationId=${detail.receivable.locationId}`,
      company.tenantId,
      { signal: c.signal },
    )
      .then((d) => {
        if (!c.signal.aborted) setShift(d.shift);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("No pudimos consultar la caja de esta cuenta.");
      });
    return () => c.abort();
  }, [detail, method, company.tenantId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || sending.current || blocked || recoveredKey !== pendingKey)
      return;
    const data = new FormData(event.currentTarget);
    sending.current = true;
    setSaving(true);
    setError("");
    let command = pending;
    try {
      if (!command) {
        command = ReceivablePaymentInputSchema.parse({
          id: crypto.randomUUID(),
          method,
          amount: {
            currency: "MXN",
            minorUnits: decimalToMinorUnits(String(data.get("amount") ?? "")),
          },
          ...(method === "cash" && shift ? { shiftId: shift.id } : {}),
        });
        sessionStorage.setItem(pendingKey, JSON.stringify(command));
        setPending(command);
      }
      const result = await purchasingApi<{
        receivable: ReceivableDto;
        payments: ReceivablePaymentDto[];
        replayed: boolean;
      }>(`/api/v1/receivables/${id}/payments`, company.tenantId, {
        method: "POST",
        body: JSON.stringify(command),
      });
      setDetail(result);
      setPending(null);
      sessionStorage.removeItem(pendingKey);
      setNotice(
        result.replayed
          ? "Abono ya registrado; no se duplicó."
          : "Abono registrado.",
      );
    } catch (e) {
      if (
        e instanceof PurchasingApiError &&
        [400, 404, 409].includes(e.status)
      ) {
        setPending(null);
        sessionStorage.removeItem(pendingKey);
        setReload((n) => n + 1);
      }
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos confirmar el abono. Conservamos su identificador para reintentar.",
      );
    } finally {
      setSaving(false);
      sending.current = false;
    }
  }
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/products">
          SmartRetail
        </Link>
        <AppNavigation
          tenantId={company.tenantId}
          current="/receivables"
          permissions={company.permissions}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <div className="heading">
          <div>
            <h1>{id ? "Cuenta por cobrar" : "Cuentas por cobrar"}</h1>
            <p className="muted">
              El crédito pendiente no es efectivo cobrado. Los abonos no generan
              otra venta.
            </p>
          </div>
          {id && <Link href="/receivables">Volver a cuentas</Link>}
        </div>
        {error || company.error ? (
          <p className="error" role="alert">
            {error || company.error}
          </p>
        ) : null}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {company.tenants.length > 1 && (
          <label>
            Empresa
            <select
              value={company.tenantId}
              disabled={saving || pending !== null}
              onChange={(e) => {
                setBefore(undefined);
                company.setTenantId(e.target.value);
              }}
            >
              {company.tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {"Empresa " + (company.tenants.indexOf(t) + 1)}
                </option>
              ))}
            </select>
          </label>
        )}
        {!company.loading && !company.tenants.length ? (
          <p>No tienes permiso para consultar cuentas por cobrar.</p>
        ) : loading || company.loading || loadedKey !== queryKey ? (
          <p role="status">Cargando cuentas…</p>
        ) : !id ? (
          <>
            <AccountList rows={rows} tenant={company.tenantId} />
            <p className="muted">
              Hasta 100 cuentas por página, incluidas liquidadas.
            </p>
            <div className="actions">
              {before && (
                <button
                  className="secondary"
                  onClick={() => setBefore(undefined)}
                >
                  Cuentas recientes
                </button>
              )}
              {next && (
                <button className="secondary" onClick={() => setBefore(next)}>
                  Cuentas anteriores
                </button>
              )}
            </div>
          </>
        ) : (
          detail && (
            <>
              <section className="card">
                <h2>{detail.receivable.customerName}</h2>
                <p>{status(detail.receivable.status)}</p>
                <dl className="summary-grid">
                  <div>
                    <dt>Crédito original</dt>
                    <dd>{mxn(detail.receivable.originalAmount.minorUnits)}</dd>
                  </div>
                  <div>
                    <dt>Abonos cobrados</dt>
                    <dd>{mxn(detail.receivable.paidAmount.minorUnits)}</dd>
                  </div>
                  <div>
                    <dt>Deuda cancelada por devoluciones</dt>
                    <dd>{mxn(detail.receivable.returnedAmount.minorUnits)}</dd>
                  </div>
                  <div>
                    <dt>Saldo pendiente</dt>
                    <dd>
                      {mxn(detail.receivable.outstandingAmount.minorUnits)}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/sales/${detail.receivable.saleId}?tenantId=${company.tenantId}`}
                >
                  Ver venta y ticket
                </Link>
                {" · "}
                <Link
                  href={`/customers/${detail.receivable.customerId}?tenantId=${company.tenantId}`}
                >
                  Ver cliente
                </Link>
              </section>
              {canPay && (detail.receivable.status !== "paid" || pending) && (
                <section className="card">
                  <h2>Registrar abono</h2>
                  <form className="stack" onSubmit={submit}>
                    {pending && (
                      <p role="status">
                        Abono pendiente:{" "}
                        <strong>{mxn(pending.amount.minorUnits)}</strong> ·{" "}
                        {pending.method === "cash" ? "Efectivo" : "Tarjeta"}.
                        Reintentar conserva el mismo identificador.
                      </p>
                    )}
                    <label>
                      Importe del abono (MXN)
                      <input
                        name="amount"
                        inputMode="decimal"
                        required
                        maxLength={30}
                        disabled={
                          saving ||
                          pending !== null ||
                          blocked ||
                          recoveredKey !== pendingKey
                        }
                      />
                    </label>
                    <label>
                      Método del abono
                      <select
                        value={method}
                        disabled={
                          saving ||
                          pending !== null ||
                          blocked ||
                          recoveredKey !== pendingKey
                        }
                        onChange={(e) =>
                          setMethod(e.target.value as "cash" | "card")
                        }
                      >
                        <option value="card">Tarjeta</option>
                        <option value="cash">Efectivo</option>
                      </select>
                    </label>
                    {method === "cash" && (
                      <p>
                        {shift?.status === "open"
                          ? "Se registrará una entrada en la caja abierta de esta sucursal."
                          : "Necesitas abrir caja en la sucursal de esta venta."}
                      </p>
                    )}
                    <button
                      disabled={
                        saving ||
                        blocked ||
                        recoveredKey !== pendingKey ||
                        (!pending &&
                          method === "cash" &&
                          shift?.status !== "open")
                      }
                    >
                      {saving
                        ? "Confirmando…"
                        : pending
                          ? "Reintentar mismo abono"
                          : "Confirmar abono"}
                    </button>
                    {pending && (
                      <p className="muted">
                        Conservamos el identificador del abono mientras su
                        resultado esté pendiente. Consulta la cuenta antes de
                        cambiarlo.
                      </p>
                    )}
                  </form>
                </section>
              )}
              <section className="card">
                <PaymentHistory
                  key={company.tenantId + (id ?? "")}
                  tenant={company.tenantId}
                  {...(id === undefined ? {} : { receivableId: id })}
                  reloadToken={
                    detail.receivable.paidAmount.minorUnits + ":" + reload
                  }
                />
                <button
                  className="secondary"
                  disabled={saving}
                  onClick={() => setReload((n) => n + 1)}
                >
                  Actualizar saldo
                </button>
              </section>
            </>
          )
        )}
      </main>
    </>
  );
}
