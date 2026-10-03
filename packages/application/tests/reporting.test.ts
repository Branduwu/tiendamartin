import { expect, it } from "vitest";
import { mexicoDate, reportFilters, reportPeriod } from "../src/reporting";
const valid = {
  from: "2026-10-01",
  to: "2026-10-03",
  lowStockMilliUnits: "1000",
};
it("resolves today at Mexico midnight instead of UTC date", () => {
  expect(mexicoDate(new Date("2026-10-03T05:59:59Z"))).toBe("2026-10-02");
  expect(mexicoDate(new Date("2026-10-03T06:00:00Z"))).toBe("2026-10-03");
});
it("handles historical Mexican daylight saving with IANA timezone", () => {
  expect(mexicoDate(new Date("2021-07-03T04:59:59Z"))).toBe("2021-07-02");
  expect(mexicoDate(new Date("2021-07-03T05:00:00Z"))).toBe("2021-07-03");
});
it("7 and 30 days include today across month boundaries", () => {
  expect(reportPeriod("7d", new Date("2026-10-03T12:00:00Z"))).toEqual({
    from: "2026-09-27",
    to: "2026-10-03",
  });
  expect(reportPeriod("30d", new Date("2026-10-03T12:00:00Z"))).toEqual({
    from: "2026-09-04",
    to: "2026-10-03",
  });
});
it("accepts actual leap day and maximum 366 day inclusive range", () => {
  expect(
    reportFilters({ ...valid, from: "2024-01-01", to: "2024-12-31" }).to,
  ).toBe("2024-12-31");
  expect(
    reportFilters({ ...valid, from: "2024-02-29", to: "2024-02-29" }).from,
  ).toBe("2024-02-29");
});
it("rejects impossible reversed oversized and unbounded dates", () => {
  for (const [from, to] of [
    ["2026-02-29", "2026-03-01"],
    ["2026-10-04", "2026-10-03"],
    ["2024-01-01", "2025-01-01"],
    ["1999-12-31", "2000-01-01"],
    ["bad", "2026-10-03"],
  ])
    expect(() =>
      reportFilters({ ...valid, from: from ?? "", to: to ?? "" }),
    ).toThrow();
});
it("threshold is canonical bounded integer without money/quantity coercion", () => {
  for (const value of ["-1", "01", "1.5", "1e3", " 1", "9".repeat(19)])
    expect(() =>
      reportFilters({ ...valid, lowStockMilliUnits: value }),
    ).toThrow();
  expect(
    reportFilters({ ...valid, lowStockMilliUnits: "0" }).lowStockMilliUnits,
  ).toBe("0");
});
it("validates primitive references and payment filters for non HTTP callers", () => {
  expect(() => reportFilters({ ...valid, productId: "bad" })).toThrow();
  expect(() =>
    reportFilters({ ...valid, paymentMethod: "other" as "cash" }),
  ).toThrow();
});
it("snapshots filters immutably without changing caller input", () => {
  const copy = { ...valid };
  const result = reportFilters(copy);
  copy.to = "2026-10-04";
  expect(result.to).toBe("2026-10-03");
  expect(Object.isFrozen(result)).toBe(true);
});
