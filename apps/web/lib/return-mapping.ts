import { quantity, money, productId, saleReturnId } from "@smartretail/domain";
import type {
  CreateSaleReturnDto,
  SaleReturnDto,
} from "@smartretail/contracts";
import type {
  SaleReturnInput,
  StoredSaleReturn,
} from "@smartretail/application";
export function returnInput(dto: CreateSaleReturnDto): SaleReturnInput {
  return {
    ...dto,
    lines: dto.lines.map((l) => ({
      ...l,
      quantity: quantity(l.quantity.unit, BigInt(l.quantity.milliUnits)),
    })),
    refunds: dto.refunds.map((p) => ({
      method: p.method,
      amount: money(BigInt(p.amount.minorUnits)),
    })),
  };
}
export function returnedInput(dto: SaleReturnDto): StoredSaleReturn {
  const { debtReduction, ...rest } = dto;
  return {
    ...rest,
    id: saleReturnId(dto.id),
    total: money(BigInt(dto.total.minorUnits)),
    ...(debtReduction === undefined
      ? {}
      : { debtReduction: money(BigInt(debtReduction.minorUnits)) }),
    lines: dto.lines.map(({ refundedTax, ...l }) => ({
      ...l,
      saleLineId: productId(l.saleLineId),
      productId: productId(l.productId),
      quantity: quantity(l.quantity.unit, BigInt(l.quantity.milliUnits)),
      refunded: money(BigInt(l.refunded.minorUnits)),
      ...(refundedTax === undefined
        ? {}
        : { refundedTax: money(BigInt(refundedTax.minorUnits)) }),
    })),
    refunds: dto.refunds.map((p) => ({
      method: p.method,
      amount: money(BigInt(p.amount.minorUnits)),
    })),
  };
}
export function returnedDto(record: StoredSaleReturn): SaleReturnDto {
  const moneyDto = (m: { minorUnits: bigint }) => ({
    currency: "MXN" as const,
    minorUnits: m.minorUnits.toString(),
  });
  const { debtReduction, ...rest } = record;
  return {
    ...rest,
    total: moneyDto(record.total),
    ...(debtReduction === undefined
      ? {}
      : { debtReduction: moneyDto(debtReduction) }),
    lines: record.lines.map(({ refundedTax, ...l }) => ({
      ...l,
      quantity: {
        unit: l.quantity.unit,
        milliUnits: l.quantity.milliUnits.toString(),
      },
      refunded: moneyDto(l.refunded),
      ...(refundedTax === undefined
        ? {}
        : { refundedTax: moneyDto(refundedTax) }),
    })),
    refunds: record.refunds.map((p) => ({
      method:
        p.method === "credit"
          ? (() => {
              throw new TypeError("Credit refund forbidden");
            })()
          : p.method,
      amount: moneyDto(p.amount),
    })),
  };
}
