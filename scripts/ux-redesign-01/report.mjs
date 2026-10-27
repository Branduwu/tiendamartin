const uid = (n) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`,
  tenant = uid(1),
  otherTenant = uid(2);
function metrics(gross = "123456", count = "5") {
  return {
    gross,
    count,
    average: "24691",
    cash: gross,
    card: "0",
    refunds: "0",
    net: gross,
    baseGross: gross,
    discounts: "0",
    taxCollected: "0",
    taxRefunded: "0",
    netCommercial: gross,
    customers: "1",
    associated: "2",
    general: "3",
  };
}
export function report(
  mode = "normal",
  tenantId = tenant,
  query = "period=today",
) {
  const q = new URLSearchParams(query),
    filters = {
      from:
        q.get("from") ??
        (q.get("period") === "7d" ? "2026-10-18" : "2026-10-24"),
      to: q.get("to") ?? "2026-10-24",
      ...Object.fromEntries(
        [...q].filter(([k]) =>
          [
            "locationId",
            "productId",
            "customerId",
            "supplierId",
            "paymentMethod",
          ].includes(k),
        ),
      ),
    };
  const sales = metrics(
    mode === "large"
      ? "900719925474099312345"
      : mode === "zero" || mode === "no-days" || mode === "free"
        ? "0"
        : "123456",
    mode === "zero" || mode === "no-days" ? "0" : "5",
  );
  if (mode === "zero") {
    sales.average = "0";
    sales.customers = "0";
    sales.associated = "0";
    sales.general = "0";
  }
  if (mode === "negative") {
    sales.net = "-12345";
    sales.netCommercial = "-12345";
    sales.refunds = "135801";
  }
  return {
    filters,
    timezone: "America/Mexico_City",
    today: "2026-10-24",
    context: {
      businessName: tenantId === tenant ? "Negocio de prueba" : "Otro negocio",
      branchName: "Sucursal Centro",
      locale: "es-MX",
      currency: "MXN",
    },
    todaySales: metrics("123456"),
    sales,
    days:
      mode === "no-days"
        ? []
        : [
            { ...sales, date: filters.from },
            ...(filters.from !== filters.to
              ? [{ ...sales, date: filters.to }]
              : []),
          ],
    products:
      mode === "zero" || mode === "no-days"
        ? []
        : [
            {
              id: uid(41),
              name: "Café molido de prueba con un nombre amplio",
              unit: "piece",
              quantity: "5000",
              revenue: sales.gross,
              stock: "12000",
            },
          ],
    inventory: {
      low: "1",
      empty: "0",
      alerts: [
        {
          id: uid(41),
          name: "Café molido de prueba",
          unit: "piece",
          stock: "2000",
          minimum: "5000",
          locationId: uid(11),
          locationName: "Sucursal Centro",
          state: "low",
        },
      ],
    },
    purchases: {
      created: "2",
      pending: "1",
      partial: "0",
      received: "1",
      orderedAmount: "10000",
      receivedAmount: "5000",
    },
    cash: {
      open: "1",
      closed: "0",
      expected: "10000",
      shortage: "0",
      surplus: "0",
      cashIn: "0",
      cashOut: "0",
    },
    credit:
      mode === "minimal"
        ? undefined
        : {
            outstanding: "5000",
            generated: "5000",
            collected: "0",
            openAccounts: "1",
          },
    financial:
      mode === "minimal"
        ? undefined
        : {
            outstanding: "1000",
            expenses: "0",
            supplierPayments: "0",
            expenseCashOut: "0",
            supplierCashOut: "0",
          },
  };
}
