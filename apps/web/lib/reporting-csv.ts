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
            "Venta neta centavos MXN",
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
          ]),
        ]
      : [
          [
            "Producto",
            "Unidad",
            "Cantidad milésimas",
            "Ingresos centavos MXN",
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
