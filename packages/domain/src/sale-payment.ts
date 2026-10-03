import { money, addMoney, type Money } from "./money";

export type SalePayment = Readonly<{ method: "cash" | "card"; amount: Money }>;

/** Registered tender only; card does not represent a gateway charge. */
export function salePayments(
  input: readonly SalePayment[],
  total: Money,
): readonly SalePayment[] {
  if (!Array.isArray(input) || input.length > 2)
    throw new TypeError("Invalid payments");
  const methods = new Set<string>();
  let paid = money(0n);
  const copies = input.map((payment) => {
    if (!payment || !["cash", "card"].includes(payment.method))
      throw new TypeError("Invalid payment method");
    if (methods.has(payment.method))
      throw new TypeError("Duplicate payment method");
    methods.add(payment.method);
    const amount = addMoney(payment.amount, money(0n));
    if (amount.minorUnits <= 0n)
      throw new TypeError("Payment must be positive");
    paid = addMoney(paid, amount);
    return Object.freeze({ method: payment.method, amount });
  });
  const expected = addMoney(total, money(0n));
  if (expected.minorUnits < 0n || paid.minorUnits !== expected.minorUnits)
    throw new TypeError("Payments must equal sale total");
  return Object.freeze(copies);
}
