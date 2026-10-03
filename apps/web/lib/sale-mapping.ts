import {
  saleId,
  productId,
  productName,
  sku,
  money,
  quantity,
  type SaleDraft,
} from "@smartretail/domain";
import type { CheckoutDto, StoredSaleDto } from "@smartretail/contracts";
import type { SaleCheckoutInput, StoredSale } from "@smartretail/application";
export function checkoutInput(dto: CheckoutDto): SaleCheckoutInput {
  const draft: SaleDraft = {
    id: saleId(dto.draft.id),
    ...(dto.draft.customerId === undefined
      ? {}
      : { customerId: dto.draft.customerId }),
    status: "draft",
    total: money(BigInt(dto.draft.total.minorUnits)),
    lines: dto.draft.lines.map((l) => ({
      productId: productId(l.productId),
      name: productName(l.name),
      sku: sku(l.sku),
      unit: l.unit,
      quantity: quantity(l.quantity.unit, BigInt(l.quantity.milliUnits)),
      unitPrice: money(BigInt(l.unitPrice.minorUnits)),
      lineTotal: money(BigInt(l.lineTotal.minorUnits)),
    })),
  };
  return {
    ...(dto.shiftId === undefined ? {} : { shiftId: dto.shiftId }),
    ...(dto.suspendedSaleId === undefined
      ? {}
      : { suspendedSaleId: dto.suspendedSaleId }),
    draft,
    locationId: dto.locationId,
    movements: dto.movements,
    payments: dto.payments.map((p) => ({
      method: p.method,
      amount: money(BigInt(p.amount.minorUnits)),
    })),
  };
}
export function storedSaleDto(recorded: StoredSale): StoredSaleDto {
  return {
    ...recorded,
    sale: {
      ...recorded.sale,
      total: {
        currency: "MXN",
        minorUnits: recorded.sale.total.minorUnits.toString(),
      },
      lines: recorded.sale.lines.map((l) => ({
        ...l,
        quantity: {
          unit: l.quantity.unit,
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
    payments: recorded.payments.map((p) => ({
      method: p.method,
      amount: { currency: "MXN", minorUnits: p.amount.minorUnits.toString() },
    })),
  };
}
