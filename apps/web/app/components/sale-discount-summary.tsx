import type { StoredSaleDto } from "@smartretail/contracts";
import { minorUnitsToDecimal } from "../../lib/money-input";
export default function SaleDiscountSummary({
  recorded,
}: {
  recorded: StoredSaleDto;
}) {
  const tax = recorded.sale.lines.reduce(
    (sum, line) => sum + BigInt(line.tax?.amount.minorUnits ?? "0"),
    0n,
  );
  const reduction = recorded.sale.lines.reduce(
      (s, l) => s + BigInt(l.discount?.minorUnits ?? "0"),
      0n,
    ),
    mxn = (v: bigint) => `$${minorUnitsToDecimal(v.toString())} MXN`;
  return (
    <section aria-label="Resumen de la venta">
      <p>
        Importe original:{" "}
        {mxn(BigInt(recorded.sale.total.minorUnits) - tax + reduction)}
      </p>
      <p>Descuento total: {mxn(reduction)}</p>
      <p>Impuestos: {mxn(tax)}</p>
      {!recorded.sale.lines.some((l) => l.tax) && (
        <p>Sin impuesto configurado.</p>
      )}
      <p>Total: {mxn(BigInt(recorded.sale.total.minorUnits))}</p>
      {recorded.sale.lines
        .filter((l) => l.tax)
        .map((l) => (
          <p key={"tax-" + l.productId}>
            {l.name}: {l.tax?.name} · {minorUnitsToDecimal(l.tax!.rate)}% ·{" "}
            {mxn(BigInt(l.tax!.amount.minorUnits))}
          </p>
        ))}
      {recorded.details?.lines
        .filter((l) => l.source !== "none")
        .map((l) => (
          <p key={l.productId}>
            {recorded.sale.lines.find((p) => p.productId === l.productId)?.name}
            : {l.source === "promotion" ? l.promotionName : "Descuento manual"}
          </p>
        ))}
      {recorded.details?.manualSale && (
        <p>
          Descuento manual de venta:{" "}
          {mxn(BigInt(recorded.details.saleDiscountTotal))}
        </p>
      )}
      {recorded.details?.coupon && (
        <p>
          Cupón {recorded.details.coupon.code}:{" "}
          {mxn(BigInt(recorded.details.couponDiscountTotal))}
        </p>
      )}
    </section>
  );
}
