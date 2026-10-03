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
  return {
    ...dto,
    id: saleReturnId(dto.id),
    total: money(BigInt(dto.total.minorUnits)),
    lines: dto.lines.map((l) => ({
      ...l,
      saleLineId: productId(l.saleLineId),
      productId: productId(l.productId),
      quantity: quantity(l.quantity.unit, BigInt(l.quantity.milliUnits)),
      refunded: money(BigInt(l.refunded.minorUnits)),
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
  return {
    ...record,
    total: moneyDto(record.total),
    lines: record.lines.map((l) => ({
      ...l,
      quantity: {
        unit: l.quantity.unit,
        milliUnits: l.quantity.milliUnits.toString(),
      },
      refunded: moneyDto(l.refunded),
    })),
    refunds: record.refunds.map((p) => ({
      method: p.method,
      amount: moneyDto(p.amount),
    })),
  };
}
