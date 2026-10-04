import type { InventoryAlert } from "./inventory-minimum";
import { productId } from "@smartretail/domain";
/** Reporting queries are read-only projections, outside the commercial domain. */
export type ReportFilters = Readonly<{
  from: string;
  to: string;
  locationId?: string;
  productId?: string;
  supplierId?: string;
  customerId?: string;
  paymentMethod?: "cash" | "card";
}>;
export type SalesMetrics = Readonly<{
  gross: string;
  count: string;
  average: string;
  cash: string;
  card: string;
  refunds: string;
  net: string;
  baseGross: string;
  discounts: string;
  taxCollected: string;
  taxRefunded: string;
  netCommercial: string;
  customers: string;
  associated: string;
  general: string;
}>;
export type OperationalReport = Readonly<{
  filters: ReportFilters;
  timezone: "America/Mexico_City";
  today: string;
  todaySales: SalesMetrics;
  sales: SalesMetrics;
  days: readonly (SalesMetrics & { date: string })[];
  products: readonly {
    id: string;
    name: string;
    unit: string;
    quantity: string;
    revenue: string;
    stock: string;
  }[];
  inventory: {
    low: string;
    empty: string;
    alerts: readonly InventoryAlert[];
  };
  purchases: {
    created: string;
    pending: string;
    partial: string;
    received: string;
    orderedAmount: string;
    receivedAmount: string;
  };
  cash: {
    open: string;
    closed: string;
    expected: string;
    shortage: string;
    surplus: string;
    cashIn: string;
    cashOut: string;
  };
}>;
export interface ReportingQueries {
  operationalReport(filters: ReportFilters): Promise<OperationalReport>;
  reportOptions(): Promise<ReportOptions>;
}
export type ReportOptions = Record<
  "locations" | "products" | "customers" | "suppliers",
  readonly { id: string; name: string }[]
>;

export const REPORT_TIMEZONE = "America/Mexico_City";
export function mexicoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function day(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new TypeError("Invalid report date");
  const time = Date.parse(value + "T00:00:00Z");
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value ||
    value < "2000-01-01" ||
    value > "2099-12-31"
  )
    throw new TypeError("Invalid report date");
  return time;
}
export function reportFilters(input: ReportFilters): ReportFilters {
  const start = day(input.from),
    end = day(input.to);
  if (end < start || end - start > 365 * 86400000)
    throw new RangeError("Report range must contain 1 to 366 days");
  for (const id of [
    input.locationId,
    input.productId,
    input.supplierId,
    input.customerId,
  ])
    if (id !== undefined) productId(id);
  if (
    input.paymentMethod !== undefined &&
    input.paymentMethod !== "cash" &&
    input.paymentMethod !== "card"
  )
    throw new TypeError("Invalid payment filter");
  return Object.freeze({ ...input });
}
export function reportPeriod(
  period: "today" | "7d" | "30d",
  now = new Date(),
): Pick<ReportFilters, "from" | "to"> {
  const to = mexicoDate(now);
  const days =
    period === "today"
      ? 0
      : period === "7d"
        ? 6
        : period === "30d"
          ? 29
          : undefined;
  if (days === undefined) throw new TypeError("Invalid report period");
  return {
    from: new Date(day(to) - days * 86400000).toISOString().slice(0, 10),
    to,
  };
}
