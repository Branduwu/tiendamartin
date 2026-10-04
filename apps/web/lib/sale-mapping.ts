import type { TaxSnapshot } from "@smartretail/domain";
const taxDto = (t: TaxSnapshot) => ({
  profileId: t.profileId,
  name: t.name,
  rate: t.rate.toString(),
  base: { currency: "MXN" as const, minorUnits: t.base.minorUnits.toString() },
  amount: {
    currency: "MXN" as const,
    minorUnits: t.amount.minorUnits.toString(),
  },
});
import {
  saleId,
  productId,
  productName,
  sku,
  money,
  quantity,
  type SaleDraft,
  type CompletedSale,
  discount,
} from "@smartretail/domain";
import type {
  CheckoutDto,
  StoredSaleDto,
  CompletedSaleDto,
} from "@smartretail/contracts";
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
      ...(l.tax === undefined
        ? {}
        : {
            tax: {
              profileId: l.tax.profileId,
              name: l.tax.name,
              rate: BigInt(l.tax.rate),
              base: money(BigInt(l.tax.base.minorUnits)),
              amount: money(BigInt(l.tax.amount.minorUnits)),
            },
          }),
      ...(l.discount === undefined
        ? {}
        : { discount: money(BigInt(l.discount.minorUnits)) }),
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
    ...(dto.taxes === undefined
      ? {}
      : { taxes: dto.taxes.map((t) => ({ ...t, rate: BigInt(t.rate) })) }),
    payments: dto.payments.map((p) => ({
      method: p.method,
      amount: money(BigInt(p.amount.minorUnits)),
    })),
    ...(dto.discounts === undefined
      ? {}
      : {
          discounts: {
            ...(dto.discounts.sale === undefined
              ? {}
              : {
                  sale: discount(
                    dto.discounts.sale.type,
                    BigInt(dto.discounts.sale.value),
                  ),
                }),
            ...(dto.discounts.lines === undefined
              ? {}
              : {
                  lines: dto.discounts.lines.map((l) => ({
                    productId: l.productId,
                    discount: discount(
                      l.discount.type,
                      BigInt(l.discount.value),
                    ),
                  })),
                }),
            ...(dto.discounts.couponCode === undefined
              ? {}
              : { couponCode: dto.discounts.couponCode }),
          },
        }),
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
        productId: l.productId,
        name: l.name,
        sku: l.sku,
        unit: l.unit,
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
        ...(l.tax === undefined ? {} : { tax: taxDto(l.tax) }),
        ...(l.discount === undefined
          ? {}
          : {
              discount: {
                currency: "MXN" as const,
                minorUnits: l.discount.minorUnits.toString(),
              },
            }),
      })),
    },
    payments: recorded.payments.map((p) => ({
      method: p.method,
      amount: { currency: "MXN", minorUnits: p.amount.minorUnits.toString() },
    })),
  };
}
export function completedSaleDto(sale: CompletedSale): CompletedSaleDto {
  return {
    ...sale,
    total: { currency: "MXN", minorUnits: sale.total.minorUnits.toString() },
    lines: sale.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      unit: l.unit,
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
      ...(l.tax === undefined ? {} : { tax: taxDto(l.tax) }),
      ...(l.discount === undefined
        ? {}
        : {
            discount: {
              currency: "MXN",
              minorUnits: l.discount.minorUnits.toString(),
            },
          }),
    })),
  };
}
