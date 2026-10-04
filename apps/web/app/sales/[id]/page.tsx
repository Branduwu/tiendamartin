import { formatDateTime } from "../../components/presentation";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { SaleIdSchema, UuidSchema } from "@smartretail/contracts";
import {
  PermissionDeniedError,
  SaleNotFoundError,
} from "@smartretail/application";
import { verifiedUserId } from "../../../lib/auth";
import {
  salesForUser,
  tenantsForUser,
  inventoryForUser,
  returnsForUser,
} from "../../../lib/database";
import { minorUnitsToDecimal } from "../../../lib/money-input";
import { milliUnitsToDecimal } from "../../../lib/quantity-input";
import { storedSaleDto } from "../../../lib/sale-mapping";
import SaleDiscountSummary from "../../components/sale-discount-summary";
import { returnedDto } from "../../../lib/return-mapping";
import ReturnPanel from "./return-panel";
import PrintButton from "./print-button";
export const dynamic = "force-dynamic";
async function loadTicket(
  userId: string,
  id: string,
  tenantId: string | undefined,
) {
  try {
    const memberships = await tenantsForUser(userId);
    const selected =
      tenantId ??
      memberships.find((m) => m.permissions.includes("sales.read"))?.tenantId;
    const tenant = UuidSchema.safeParse(selected);
    if (!tenant.success) throw new SaleNotFoundError();
    const [recorded, locations, returns, settlement] = await Promise.all([
      salesForUser(userId, tenant.data).readSale(id),
      inventoryForUser(userId, tenant.data).listLocations(),
      returnsForUser(userId, tenant.data).listReturns(id),
      returnsForUser(userId, tenant.data).settlement(id),
    ]);
    return {
      recorded,
      locations,
      returns,
      settlement,
      canReturn: memberships.some(
        (m) =>
          m.tenantId === tenant.data && m.permissions.includes("sales.return"),
      ),
    };
  } catch (e) {
    if (e instanceof SaleNotFoundError) notFound();
    return {
      error:
        e instanceof PermissionDeniedError
          ? "Sin acceso al ticket"
          : "No se pudo cargar el ticket",
    };
  }
}
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const userId = await verifiedUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const { tenantId } = await searchParams;
  const sale = SaleIdSchema.safeParse(id);
  if (!sale.success) notFound();
  const result = await loadTicket(userId, sale.data, tenantId);
  if ("error" in result)
    return (
      <main className="workspace">
        <h1>{result.error}</h1>
        <Link href="/sales">Volver a ventas</Link>
      </main>
    );
  const { recorded, locations, returns, canReturn, settlement } = result;
  const mxn = (v: bigint) => `$${minorUnitsToDecimal(v.toString())} MXN`;
  return (
    <main className="ticket">
      <nav className="no-print">
        <Link href="/sales">Volver a ventas</Link>
        <PrintButton />
      </nav>
      <h1>SmartRetail</h1>
      <h2>Ticket de venta</h2>
      <p className="badge active">Venta original</p>
      <p>Cliente: {recorded.customerName ?? "Público general"}</p>
      <p>
        Cajero:{" "}
        {"createdByName" in recorded &&
        typeof recorded.createdByName === "string"
          ? recorded.createdByName
          : "Cajero registrado"}
      </p>
      <p className="sale-id">Venta: {recorded.sale.id}</p>
      <p>
        <time dateTime={recorded.createdAt}>
          {formatDateTime(recorded.createdAt)}
        </time>
      </p>
      <p>
        Ubicación:{" "}
        {locations.find((l) => l.id === recorded.locationId)?.name ??
          ("locationName" in recorded &&
          typeof recorded.locationName === "string"
            ? recorded.locationName
            : "Ubicación registrada")}
      </p>
      <p className="sale-id">
        Turno: {recorded.shiftId ?? "Venta anterior a caja"}
      </p>
      <div className="ticket-lines">
        {recorded.sale.lines.map((l) => (
          <section key={l.productId}>
            <strong>{l.name}</strong>
            <p>{l.sku}</p>
            <p>
              {milliUnitsToDecimal(l.quantity.milliUnits.toString())} {l.unit} ×{" "}
              {mxn(l.unitPrice.minorUnits)}
            </p>
            <p>Total línea: {mxn(l.lineTotal.minorUnits)}</p>
            {l.discount !== undefined && (
              <p>
                Descuento de línea: {mxn(l.discount.minorUnits)} · Importe
                original: {mxn(l.lineTotal.minorUnits + l.discount.minorUnits)}
              </p>
            )}
          </section>
        ))}
      </div>
      <h2 className="ticket-total">
        Total: {mxn(recorded.sale.total.minorUnits)}
      </h2>
      <SaleDiscountSummary recorded={storedSaleDto(recorded)} />
      <h3>Pagos</h3>
      {recorded.payments.map((p) => (
        <p key={p.method}>
          {p.method === "cash"
            ? "Efectivo"
            : p.method === "credit"
              ? "Crédito pendiente"
              : "Tarjeta"}
          : {mxn(p.amount.minorUnits)}
        </p>
      ))}
      {!recorded.payments.length && <p>Sin pago: total cero.</p>}
      <ReturnPanel
        key={`${recorded.tenantId}/${recorded.sale.id}/${userId}`}
        recorded={storedSaleDto(recorded)}
        initial={returns.map(returnedDto)}
        initialSettlement={settlement}
        userId={userId}
        canReturn={canReturn}
      />
      <p className="muted">
        Comprobante básico de venta. No es un comprobante fiscal.
      </p>
    </main>
  );
}
