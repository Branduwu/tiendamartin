import "server-only";
import { randomUUID } from "node:crypto";
import {
  OpenCashShiftSchema,
  CashMovementInputSchema,
  CloseCashShiftSchema,
  UuidSchema,
} from "@smartretail/contracts";
import { money } from "@smartretail/domain";
import {
  openCashRegisterShift,
  recordCashMovement,
  closeCashRegisterShift,
  CashStateConflictError,
  PermissionDeniedError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { cashForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  reply,
  jsonBody,
  requireSameOrigin,
} from "./api";
import { cashShiftDto, moneyDto } from "./cash-mapping";
export async function handleCash(
  request: Request,
  operation: "current" | "open" | "move" | "close" | "history",
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const repo = cashForUser(userId, tenant.data);
    if (operation === "history") {
      const q = new URL(request.url).searchParams;
      if (
        [...q.keys()].some((k) => k !== "locationId") ||
        q.getAll("locationId").length !== 1
      )
        throw new InvalidInput();
      const location = UuidSchema.safeParse(q.get("locationId"));
      if (!location.success) throw new InvalidInput();
      const history = await repo.history(location.data);
      return reply({
        history: {
          shifts: history.shifts.map((s) => ({
            ...s,
            openingCash: moneyDto(s.openingCash),
            countedCash: s.countedCash ? moneyDto(s.countedCash) : null,
            difference: s.difference ? moneyDto(s.difference) : null,
          })),
          movements: history.movements.map((m) => ({
            ...m,
            amount: moneyDto(m.amount),
          })),
        },
      });
    }
    if (operation === "current") {
      const q = new URL(request.url).searchParams;
      if (
        [...q.keys()].some((k) => k !== "locationId") ||
        q.getAll("locationId").length !== 1
      )
        throw new InvalidInput();
      const location = UuidSchema.safeParse(q.get("locationId"));
      if (!location.success) throw new InvalidInput();
      const shift = await repo.currentShift(location.data);
      return reply({ shift: shift ? cashShiftDto(shift) : null });
    }
    requireSameOrigin(request);
    const body = await jsonBody(request);
    let result: unknown, id: string;
    if (operation === "open") {
      const p = OpenCashShiftSchema.safeParse(body);
      if (!p.success) throw new InvalidInput();
      id = p.data.id;
      result = {
        shift: cashShiftDto(
          await openCashRegisterShift(repo, {
            ...p.data,
            openingCash: money(BigInt(p.data.openingCash.minorUnits)),
          }),
        ),
      };
    } else if (operation === "move") {
      const p = CashMovementInputSchema.safeParse(body);
      if (!p.success) throw new InvalidInput();
      id = p.data.id;
      const movement = await recordCashMovement(repo, {
        ...p.data,
        amount: money(BigInt(p.data.amount.minorUnits)),
      });
      result = { movement: { ...movement, amount: moneyDto(movement.amount) } };
    } else {
      const p = CloseCashShiftSchema.safeParse(body);
      if (!p.success) throw new InvalidInput();
      id = p.data.shiftId;
      result = {
        shift: cashShiftDto(
          await closeCashRegisterShift(
            repo,
            id,
            money(BigInt(p.data.countedCash.minorUnits)),
          ),
        ),
      };
    }
    console.info(
      JSON.stringify({
        operation: `cash.${operation}`,
        operationId: id,
        userId,
        tenantId: tenant.data,
        at: new Date().toISOString(),
        correlationId,
      }),
    );
    return reply(result, operation === "close" ? 200 : 201);
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (e instanceof CashStateConflictError)
      return reply(
        {
          error:
            "El turno cambió, ya está cerrado o el efectivo disponible es insuficiente. Actualiza la caja.",
        },
        409,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply(
        { error: "Revisa el importe, la ubicación y el motivo." },
        400,
      );
    console.error(
      JSON.stringify({
        operation: `cash.${operation}`,
        correlationId,
        outcome: "unexpected_error",
      }),
    );
    return reply(
      {
        error:
          operation === "history"
            ? "No pudimos consultar el historial de caja. Puedes reintentar la consulta."
            : "No se pudo confirmar la operación de caja. Consulta su estado antes de reintentar.",
        correlationId,
      },
      500,
    );
  }
}
