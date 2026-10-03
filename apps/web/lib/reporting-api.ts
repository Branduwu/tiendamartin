import "server-only";
import { randomUUID } from "node:crypto";
import { ReportQuerySchema, UuidSchema } from "@smartretail/contracts";
import {
  PermissionDeniedError,
  reportFilters,
  reportPeriod,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { reportingForUser } from "./database";
import { InvalidInput, reply } from "./api";
import { reportingCsv } from "./reporting-csv";
export async function handleReports(
  request: Request,
  output: "json" | "options" | "sales" | "products" = "json",
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((k) => params.getAll(k).length !== 1))
      throw new InvalidInput();
    const repo = reportingForUser(userId, tenant.data);
    if (output === "options") {
      if (params.size) throw new InvalidInput();
      return reply(await repo.reportOptions());
    }
    const parsed = ReportQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new InvalidInput();
    const { period, from, to, ...rest } = parsed.data;
    const filters = reportFilters({
      ...(period === "custom" && from && to
        ? { from, to }
        : reportPeriod(period === "custom" ? "today" : period)),
      lowStockMilliUnits: rest.lowStockMilliUnits,
      ...(rest.locationId ? { locationId: rest.locationId } : {}),
      ...(rest.productId ? { productId: rest.productId } : {}),
      ...(rest.supplierId ? { supplierId: rest.supplierId } : {}),
      ...(rest.customerId ? { customerId: rest.customerId } : {}),
      ...(rest.paymentMethod ? { paymentMethod: rest.paymentMethod } : {}),
    });
    const report = await repo.operationalReport(filters);
    if (output === "json") return reply(report);
    return new Response(reportingCsv(report, output), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${output}-${filters.from}-${filters.to}.csv"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof PermissionDeniedError)
      return reply(
        { error: "No tienes permiso para consultar este reporte." },
        403,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply(
        { error: "Revisa el periodo y los filtros del reporte." },
        400,
      );
    console.error(
      JSON.stringify({
        operation: "reports.read",
        correlationId,
        outcome: "unexpected_error",
        at: new Date().toISOString(),
      }),
    );
    return reply({ error: "No pudimos consultar el reporte. Reintenta." }, 500);
  }
}
