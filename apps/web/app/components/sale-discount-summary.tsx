import type { StoredSaleDto } from "@smartretail/contracts";
import { minorUnitsToDecimal } from "../../lib/money-input";
export default function SaleDiscountSummary({
  recorded,
}: {
  recorded: StoredSaleDto;
}) {
  if (!recorded.details) return null;
  const reduction = recorded.sale.lines.reduce(
      (s, l) => s + BigInt(l.discount?.minorUnits ?? "0"),
      0n,
    ),
    mxn = (v: bigint) => `$${minorUnitsToDecimal(v.toString())} MXN`;
  return (
    <section aria-label="Descuentos de la venta">
      <p>
        Importe original:{" "}
        {mxn(BigInt(recorded.sale.total.minorUnits) + reduction)}
      </p>
      <p>Descuento total: {mxn(reduction)}</p>
      {recorded.details.lines
        .filter((l) => l.source !== "none")
        .map((l) => (
          <p key={l.productId}>
            {recorded.sale.lines.find((p) => p.productId === l.productId)?.name}
            : {l.source === "promotion" ? l.promotionName : "Descuento manual"}
          </p>
        ))}
      {recorded.details.manualSale && (
        <p>
          Descuento manual de venta:{" "}
          {mxn(BigInt(recorded.details.saleDiscountTotal))}
        </p>
      )}
      {recorded.details.coupon && (
        <p>
          Cupón {recorded.details.coupon.code}:{" "}
          {mxn(BigInt(recorded.details.couponDiscountTotal))}
        </p>
      )}
    </section>
  );
}
