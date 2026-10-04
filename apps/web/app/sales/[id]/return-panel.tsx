"use client";
import { formatDateTime } from "../../components/presentation";
import { useEffect, useRef, useState } from "react";
import { completeSale, quantity, quoteSaleReturn } from "@smartretail/domain";
import {
  CreateSaleReturnSchema,
  type StoredSaleDto,
  type SaleReturnDto,
  type CreateSaleReturnDto,
  type CashShiftDto,
} from "@smartretail/contracts";
import { checkoutInput } from "../../../lib/sale-mapping";
import { returnedInput } from "../../../lib/return-mapping";
import {
  decimalToMilliUnits,
  milliUnitsToDecimal,
} from "../../../lib/quantity-input";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../../lib/money-input";
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api<T>(url: string, init: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: "no-store" });
  const b = await r.json();
  if (!r.ok)
    throw new ApiError(
      b.error ?? "No se pudo confirmar la operación.",
      r.status,
    );
  return b as T;
}
const mxn = (value: string) => `$${minorUnitsToDecimal(value)} MXN`;
type Settlement = {
  outstandingAmount: { currency: "MXN"; minorUnits: string };
  payments: {
    method: "cash" | "card";
    amount: { currency: "MXN"; minorUnits: string };
  }[];
};
export default function ReturnPanel({
  recorded,
  initial,
  initialSettlement,
  userId,
  canReturn,
}: {
  recorded: StoredSaleDto;
  initial: SaleReturnDto[];
  initialSettlement: Settlement;
  userId: string;
  canReturn: boolean;
}) {
  const tenant = recorded.tenantId,
    url = `/api/v1/sales/${recorded.sale.id}/returns`,
    key = `smartretail.pending-return.${userId}.${tenant}.${recorded.sale.id}`;
  const [settlement, setSettlement] = useState(initialSettlement);
  const [returns, setReturns] = useState(initial),
    [opened, setOpened] = useState(false),
    [texts, setTexts] = useState<Record<string, string>>({}),
    [method, setMethod] = useState<"cash" | "card" | "mixed">(
      recorded.payments.some((p) => p.method === "cash") ? "cash" : "card",
    ),
    [cash, setCash] = useState("0.00"),
    [shift, setShift] = useState<CashShiftDto | null>(null),
    [pending, setPending] = useState<CreateSaleReturnDto | null>(null),
    [blocked, setBlocked] = useState(false),
    [ready, setReady] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState<SaleReturnDto | null>(null);
  const sendingRef = useRef(false),
    locked = sending || pending !== null || blocked || !ready;
  useEffect(() => {
    // Browser-only recovery after mount; controls remain disabled until ready.
    const frame = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(key);
        if (raw !== null) {
          if (raw.length > 65536) throw new Error("Pending return too large");
          const parsed = CreateSaleReturnSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) throw new Error("Pending return invalid");
          setPending(parsed.data);
          setOpened(true);
          setTexts(
            Object.fromEntries(
              parsed.data.lines.map((l) => [
                l.productId,
                milliUnitsToDecimal(l.quantity.milliUnits),
              ]),
            ),
          );
          setMethod(
            parsed.data.refunds.length === 2
              ? "mixed"
              : (parsed.data.refunds[0]?.method ?? "cash"),
          );
          setCash(
            minorUnitsToDecimal(
              parsed.data.refunds.find((p) => p.method === "cash")?.amount
                .minorUnits ?? "0",
            ),
          );
        }
      } catch {
        setBlocked(true);
        setError(
          "Hay una devolución pendiente no recuperable. Conservamos su comando; consulta su estado antes de continuar.",
        );
      } finally {
        setReady(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  useEffect(() => {
    if (!opened) return;
    const c = new AbortController();
    api<{ shift: CashShiftDto | null }>(
      `/api/v1/cash?locationId=${recorded.locationId}`,
      { headers: { "x-tenant-id": tenant }, signal: c.signal },
    )
      .then((data) => {
        if (!c.signal.aborted) setShift(data.shift);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            "No se pudo consultar la caja. Reintenta la consulta antes de reembolsar efectivo.",
          );
      });
    return () => c.abort();
  }, [opened, recorded.locationId, tenant]);
  const previous = returns.map(returnedInput);
  const original = completeSale(
    checkoutInput({
      draft: { ...recorded.sale, status: "draft" },
      locationId: recorded.locationId,
      payments: recorded.payments,
      movements: [],
    }).draft,
  );
  const returned = (pid: string) =>
    previous.reduce(
      (sum, r) =>
        sum +
        (r.lines.find((l) => l.productId === pid)?.quantity.milliUnits ?? 0n),
      0n,
    );
  const available = (m: "cash" | "card") =>
    BigInt(
      settlement.payments.find((p) => p.method === m)?.amount.minorUnits ?? "0",
    ) -
    previous.reduce(
      (sum, r) =>
        sum + (r.refunds.find((p) => p.method === m)?.amount.minorUnits ?? 0n),
      0n,
    );
  let previewLines: ReturnType<typeof quoteSaleReturn>["lines"] = [];
  let previewError = "",
    total = 0n;
  let selections: {
    saleLineId: string;
    productId: string;
    quantity: ReturnType<typeof quantity>;
  }[] = [];
  try {
    selections = original.lines.flatMap((l) => {
      const amount = BigInt(decimalToMilliUnits(texts[l.productId] ?? "0"));
      return amount === 0n
        ? []
        : [
            {
              saleLineId: l.productId,
              productId: l.productId,
              quantity: quantity(l.unit, amount),
            },
          ];
    });
    if (selections.length) {
      const quote = quoteSaleReturn(original, selections, previous);
      total = quote.total.minorUnits;
      previewLines = quote.lines;
    }
  } catch {
    previewError =
      "Revisa las cantidades: sólo puedes devolver lo que queda de la venta original.";
  }
  const debtReduction =
    total < BigInt(settlement.outstandingAmount.minorUnits)
      ? total
      : BigInt(settlement.outstandingAmount.minorUnits);
  const refundTotal = total - debtReduction;
  async function submit() {
    if (sendingRef.current || blocked || !ready) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      let command = pending;
      if (!command) {
        if (previewError || !selections.length)
          throw new Error("Selecciona cantidades válidas.");
        const refunds: CreateSaleReturnDto["refunds"] = [];
        let cashAmount = 0n;
        if (refundTotal > 0n) {
          cashAmount =
            method === "cash"
              ? refundTotal
              : method === "mixed"
                ? BigInt(decimalToMinorUnits(cash))
                : 0n;
          const cardAmount = refundTotal - cashAmount;
          if (
            cashAmount < 0n ||
            cardAmount < 0n ||
            (method === "mixed" && (cashAmount === 0n || cardAmount === 0n))
          )
            throw new Error("Revisa la distribución del reembolso.");
          if (cashAmount > available("cash") || cardAmount > available("card"))
            throw new Error(
              "El método supera lo pagado originalmente y aún no reembolsado.",
            );
          if (cashAmount > 0n)
            refunds.push({
              method: "cash",
              amount: { currency: "MXN", minorUnits: cashAmount.toString() },
            });
          if (cardAmount > 0n)
            refunds.push({
              method: "card",
              amount: { currency: "MXN", minorUnits: cardAmount.toString() },
            });
        }
        if (cashAmount > 0n && (!shift || shift.status !== "open"))
          throw new Error(
            "Abre caja en la ubicación original antes de reembolsar efectivo.",
          );
        command = CreateSaleReturnSchema.parse({
          id: crypto.randomUUID(),
          ...(cashAmount > 0n
            ? { shiftId: shift?.id, cashMovementId: crypto.randomUUID() }
            : {}),
          lines: selections.map((l) => ({
            ...l,
            quantity: {
              unit: l.quantity.unit,
              milliUnits: l.quantity.milliUnits.toString(),
            },
            movementId: crypto.randomUUID(),
          })),
          refunds,
        });
        if (
          new TextEncoder().encode(JSON.stringify(command)).byteLength > 16384
        )
          throw new Error(
            "La devolución supera el límite técnico de transporte.",
          );
        sessionStorage.setItem(key, JSON.stringify(command));
        setPending(command);
      }
      const result = await api<{ record: SaleReturnDto; replayed: boolean }>(
        url,
        {
          method: "POST",
          headers: {
            "x-tenant-id": tenant,
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
        },
      );
      setConfirmed(result.record);
      setReturns((current) =>
        current.some((r) => r.id === result.record.id)
          ? current
          : [...current, result.record],
      );
      setPending(null);
      sessionStorage.removeItem(key);
      setTexts({});
      setOpened(false);
      try {
        const updated = await api<{
          returns: SaleReturnDto[];
          settlement: Settlement;
        }>(url, {
          headers: { "x-tenant-id": tenant },
        });
        setReturns(updated.returns);
        setSettlement(updated.settlement);
      } catch {
        setError(
          "Devolución confirmada. Recarga el ticket para consultar todos los registros.",
        );
      }
    } catch (e) {
      if (e instanceof ApiError && [400, 404, 409].includes(e.status)) {
        setPending(null);
        sessionStorage.removeItem(key);
      }
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo confirmar. Reintenta con el mismo identificador.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  return (
    <section className="returns-panel" aria-labelledby="returns-title">
      <h2 id="returns-title">Devoluciones y reembolsos registrados</h2>
      <p>
        La venta original permanece intacta. Tarjeta: registro contable, sin
        confirmación bancaria.
      </p>
      {confirmed && (
        <p role="status" className="notice">
          Reembolso en dinero registrado:{" "}
          {mxn(
            confirmed.refunds
              .reduce((sum, p) => sum + BigInt(p.amount.minorUnits), 0n)
              .toString(),
          )}
          .{" "}
          {confirmed.debtReduction && (
            <>Reducción de deuda: {mxn(confirmed.debtReduction.minorUnits)}. </>
          )}
          Devolución {confirmed.id}.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!returns.length && <p>No hay devoluciones registradas.</p>}
      {returns.map((r) => (
        <article key={r.id} className="ticket-lines return-record">
          <h3>Devolución registrada</h3>
          <details className="reference no-print">
            <summary>Referencia de la devolución</summary>
            <span className="sale-id">{r.id}</span>
          </details>
          <p className="sale-id print-only">Devolución: {r.id}</p>
          <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
          {r.lines.map((l) => (
            <p key={l.productId}>
              {recorded.sale.lines.find((s) => s.productId === l.productId)
                ?.name ?? l.productId}
              : {milliUnitsToDecimal(l.quantity.milliUnits)} {l.quantity.unit} ·{" "}
              {mxn(l.refunded.minorUnits)}
            </p>
          ))}
          <strong>
            Valor de mercancía devuelta: {mxn(r.total.minorUnits)}
          </strong>
          {r.debtReduction && (
            <p>Deuda reducida: {mxn(r.debtReduction.minorUnits)}</p>
          )}
          <p>
            Total reembolsado en dinero:{" "}
            {mxn(
              r.refunds
                .reduce((sum, p) => sum + BigInt(p.amount.minorUnits), 0n)
                .toString(),
            )}
          </p>
          {r.refunds.map((p) => (
            <p key={p.method}>
              {p.method === "cash" ? "Efectivo" : "Tarjeta (registro contable)"}
              : {mxn(p.amount.minorUnits)}
            </p>
          ))}
        </article>
      ))}
      {canReturn && (
        <div className="no-print">
          {!opened && (
            <button
              type="button"
              disabled={locked}
              onClick={() => setOpened(true)}
            >
              Devolver productos
            </button>
          )}
          {opened && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="stack"
            >
              <p>
                Usamos los precios de la venta original. No reservamos ni
                ajustamos existencias hasta confirmar.
              </p>
              {recorded.sale.lines.map((l) => {
                const done = returned(l.productId),
                  remaining = BigInt(l.quantity.milliUnits) - done;
                return (
                  <section key={l.productId}>
                    <strong>{l.name}</strong>
                    <p>
                      Comprado: {milliUnitsToDecimal(l.quantity.milliUnits)} ·
                      Ya devuelto: {milliUnitsToDecimal(done.toString())} ·
                      Disponible: {milliUnitsToDecimal(remaining.toString())}{" "}
                      {l.unit}
                    </p>
                    <p>
                      Importe de esta devolución:{" "}
                      {mxn(
                        (
                          previewLines.find((p) => p.productId === l.productId)
                            ?.refunded.minorUnits ?? 0n
                        ).toString(),
                      )}
                    </p>
                    <label>
                      Cantidad a devolver ({l.name})
                      <input
                        inputMode="decimal"
                        disabled={locked || remaining === 0n}
                        value={texts[l.productId] ?? "0"}
                        onChange={(e) =>
                          setTexts({ ...texts, [l.productId]: e.target.value })
                        }
                      />
                    </label>
                  </section>
                );
              })}
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() =>
                  setTexts(
                    Object.fromEntries(
                      recorded.sale.lines.map((l) => [
                        l.productId,
                        milliUnitsToDecimal(
                          (
                            BigInt(l.quantity.milliUnits) -
                            returned(l.productId)
                          ).toString(),
                        ),
                      ]),
                    ),
                  )
                }
              >
                Devolver todo lo disponible
              </button>
              {!pending && previewError && (
                <p role="alert" className="error">
                  {previewError}
                </p>
              )}
              <p>
                Total histórico a reembolsar:{" "}
                <strong>
                  {mxn(
                    (pending
                      ? pending.refunds.reduce(
                          (sum, p) => sum + BigInt(p.amount.minorUnits),
                          0n,
                        )
                      : refundTotal
                    ).toString(),
                  )}
                </strong>
              </p>
              <p>
                Disponible por método: efectivo {""}
                {mxn(available("cash").toString())}; tarjeta{" "}
                {mxn(available("card").toString())}.
              </p>
              <p>
                Valor de mercancía devuelta: {mxn(total.toString())}. Primero
                reduce deuda: {mxn(debtReduction.toString())}; sólo el excedente
                se reembolsa en dinero.
              </p>
              <label>
                Método de reembolso
                <select
                  disabled={locked}
                  value={method}
                  onChange={(e) =>
                    setMethod(e.target.value as "cash" | "card" | "mixed")
                  }
                >
                  <option value="cash" disabled={available("cash") === 0n}>
                    Efectivo
                  </option>
                  <option value="card" disabled={available("card") === 0n}>
                    Tarjeta (registro contable)
                  </option>
                  <option
                    value="mixed"
                    disabled={
                      available("cash") === 0n || available("card") === 0n
                    }
                  >
                    Mixto
                  </option>
                </select>
              </label>
              {method === "mixed" && (
                <label>
                  Efectivo a reembolsar (MXN)
                  <input
                    inputMode="decimal"
                    value={cash}
                    disabled={locked}
                    onChange={(e) => setCash(e.target.value)}
                  />
                </label>
              )}
              {shift?.status !== "open" && (
                <p>
                  Sin caja abierta en la ubicación original. Efectivo requiere
                  un turno abierto actual.
                </p>
              )}
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => {
                  void api<{ shift: CashShiftDto | null }>(
                    `/api/v1/cash?locationId=${recorded.locationId}`,
                    { headers: { "x-tenant-id": tenant } },
                  )
                    .then((data) => {
                      setShift(data.shift);
                      setError("");
                    })
                    .catch(() => setError("No se pudo actualizar la caja."));
                }}
              >
                Actualizar caja
              </button>
              {pending && (
                <p role="status" className="notice">
                  Conservamos la devolución {pending.id} para reintentar sin
                  duplicar stock ni efectivo.
                </p>
              )}
              <button
                disabled={
                  sending ||
                  blocked ||
                  !ready ||
                  (!pending && (!selections.length || !!previewError))
                }
              >
                {sending
                  ? "Registrando devolución…"
                  : pending
                    ? "Reintentar la misma devolución"
                    : "Registrar devolución"}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
