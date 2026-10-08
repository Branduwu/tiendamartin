import type { OperationalReport } from "@smartretail/application";
function cell(value: string): string {
  // Neutralize spreadsheet formulas in untrusted product names, including whitespace prefixes.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function reportingCsv(
  report: OperationalReport,
  kind: "sales" | "products",
): string {
  const rows =
    kind === "sales"
      ? [
          [
            "Fecha México",
            "Ventas centavos MXN",
            "Cantidad",
            "Ticket promedio centavos MXN",
            "Efectivo centavos MXN",
            "Tarjeta centavos MXN",
            "Devoluciones centavos MXN",
            "Ventas netas con impuestos centavos MXN",
            "Bruto comercial centavos MXN",
            "Descuentos centavos MXN",
            "Impuestos de ventas centavos MXN",
            "Impuestos devueltos centavos MXN",
            "Venta comercial neta sin impuestos centavos MXN",
          ],
          ...report.days.map((d) => [
            d.date,
            d.gross,
            d.count,
            d.average,
            d.cash,
            d.card,
            d.refunds,
            d.net,
            d.baseGross,
            d.discounts,
            d.taxCollected,
            d.taxRefunded,
            d.netCommercial,
          ]),
          ...(report.financial
            ? [
                ["Métrica operativa financiera", "Valor"],
                [
                  "Saldo actual por pagar centavos MXN",
                  report.financial.outstanding,
                ],
                ["Gastos del período centavos MXN", report.financial.expenses],
                [
                  "Pagos a proveedores del período centavos MXN",
                  report.financial.supplierPayments,
                ],
                [
                  "Efectivo por gastos centavos MXN",
                  report.financial.expenseCashOut,
                ],
                [
                  "Efectivo por proveedores centavos MXN",
                  report.financial.supplierCashOut,
                ],
              ]
            : []),
          ...(report.credit
            ? [
                ["Métrica de crédito", "Valor"],
                [
                  "Saldo actual por cobrar centavos MXN",
                  report.credit.outstanding,
                ],
                [
                  "Crédito generado en período centavos MXN",
                  report.credit.generated,
                ],
                [
                  "Abonos cobrados en período centavos MXN",
                  report.credit.collected,
                ],
                ["Cuentas abiertas actuales", report.credit.openAccounts],
              ]
            : []),
        ]
      : [
          [
            "Producto",
            "Unidad",
            "Cantidad milésimas",
            "Ingresos sin impuestos centavos MXN",
            "Stock milésimas",
          ],
          ...report.products.map((p) => [
            p.name,
            p.unit,
            p.quantity,
            p.revenue,
            p.stock,
          ]),
        ];
  return (
    "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}
