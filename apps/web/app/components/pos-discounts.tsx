"use client";
import { useEffect, useState } from "react";
import type {
  SaleDraftDto,
  CompletedSaleDto,
  DiscountIntentDto,
  DiscountDetailsDto,
} from "@smartretail/contracts";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
export type PosPriceQuote = {
  key: string;
  sale: CompletedSaleDto;
  details?: DiscountDetailsDto;
  discounts: DiscountIntentDto;
};
export default function PosDiscounts({
  tenantId,
  locationId,
  draft,
  canDiscount,
  disabled,
  onQuote,
}: {
  tenantId: string;
  locationId: string;
  draft: SaleDraftDto;
  canDiscount: boolean;
  disabled: boolean;
  onQuote: (value: PosPriceQuote | null) => void;
}) {
  const [intent, setIntent] = useState<DiscountIntentDto>({}),
    [revision, setRevision] = useState(0),
    [scope, setScope] = useState("sale"),
    [type, setType] = useState<"amount" | "percentage">("percentage"),
    [value, setValue] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [quote, setQuote] = useState<PosPriceQuote | null>(null);
  const serialized = JSON.stringify(draft),
    key = JSON.stringify({ tenantId, locationId, draft });
  const ids = draft.lines.map((l) => l.productId);
  const filtered = (intent.lines ?? []).filter((l) =>
    ids.includes(l.productId),
  );
  const effectiveIntent = {
    ...intent,
    ...(intent.lines ? { lines: filtered } : {}),
  };
  const serializedIntent = JSON.stringify(effectiveIntent);
  if (filtered.length !== (intent.lines ?? []).length)
    setIntent(effectiveIntent);
  if (scope !== "sale" && !ids.includes(scope)) setScope("sale");
  useEffect(() => {
    const controller = new AbortController();
    onQuote(null);
    if (!locationId || !draft.lines.length) return () => controller.abort();
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setQuote(null);
        setError("");
        setBusy(true);
      }
    });
    fetch("/api/v1/sales/quote", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({
        draft: JSON.parse(serialized),
        locationId,
        discounts: JSON.parse(serializedIntent),
      }),
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error ?? "No pudimos calcular los descuentos.");
        if (!controller.signal.aborted) {
          const priced: PosPriceQuote = {
            ...data,
            key,
            discounts: JSON.parse(serializedIntent),
          };
          setQuote(priced);
          onQuote(priced);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No pudimos calcular la venta.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [
    serialized,
    tenantId,
    locationId,
    serializedIntent,
    revision,
    onQuote,
    key,
    draft.lines.length,
  ]);
  const mxn = (s: string) => `$${minorUnitsToDecimal(s)} MXN`;
  return (
    <section aria-label="Descuentos y cupones" className="stack">
      <h3>Descuentos y cupones</h3>
      <fieldset disabled={disabled} className="stack">
        {error && (
          <p id="pos-discount-error" role="alert" className="error">
            {error}
          </p>
        )}
        {busy && <p role="status">Calculando precio actual…</p>}
        {canDiscount && (
          <details>
            <summary>Descuento manual</summary>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const spec = { type, value: decimalToMinorUnits(value) };
                  if (type === "percentage" && BigInt(spec.value) > 10000n)
                    throw new Error("El porcentaje debe estar entre 0 y 100.");
                  setRevision((r) => r + 1);
                  onQuote(null);
                  setQuote(null);
                  setIntent((current) =>
                    scope === "sale"
                      ? { ...current, sale: spec }
                      : {
                          ...current,
                          lines: [
                            ...(current.lines ?? []).filter(
                              (l) => l.productId !== scope,
                            ),
                            { productId: scope, discount: spec },
                          ],
                        },
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Revisa el descuento.",
                  );
                }
              }}
            >
              <label>
                Aplicar a
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="sale">Toda la venta</option>
                  {draft.lines.map((l) => (
                    <option key={l.productId} value={l.productId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
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
                {type === "percentage" ? "Porcentaje (%)" : "Descuento (MXN)"}
                <input
                  required
                  aria-describedby={error ? "pos-discount-error" : undefined}
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <p className="muted">
                Cajeros: máximo manual de 20%. Un descuento manual de línea
                reemplaza su promoción.
              </p>
              <button type="submit" disabled={busy}>
                Aplicar descuento
              </button>
            </form>
          </details>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setRevision((r) => r + 1);
            onQuote(null);
            setQuote(null);
            setIntent((current) => ({
              ...current,
              couponCode: code.trim().toUpperCase(),
            }));
          }}
        >
          <label>
            Cupón
            <input
              aria-describedby={error ? "pos-discount-error" : undefined}
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
            />
          </label>
          <button disabled={busy || !code.trim()}>Aplicar cupón</button>
        </form>
        {(intent.sale || intent.lines?.length || intent.couponCode) && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setRevision((r) => r + 1);
              onQuote(null);
              setQuote(null);
              setIntent({});
              setCode("");
              setValue("");
            }}
          >
            Quitar descuentos y cupón
          </button>
        )}
        {quote?.details && (
          <div role="status">
            {quote.details.lines
              .filter((l) => l.source !== "none")
              .map((l) => (
                <p key={l.productId}>
                  {draft.lines.find((p) => p.productId === l.productId)?.name}:{" "}
                  {l.source === "promotion"
                    ? l.promotionName
                    : "Descuento manual"}{" "}
                  · −{mxn(l.lineDiscount)}
                </p>
              ))}
            {quote.details.manualSale && (
              <p>Descuento de venta: −{mxn(quote.details.saleDiscountTotal)}</p>
            )}
            {quote.details.coupon && (
              <p>
                Cupón {quote.details.coupon.code}: −
                {mxn(quote.details.couponDiscountTotal)}
              </p>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}
