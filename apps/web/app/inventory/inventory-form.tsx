"use client";
import { useState, type SubmitEvent } from "react";
import {
  CreateInventoryLocationSchema,
  InventoryReceiptSchema,
  InventoryIssueSchema,
  InventoryAdjustmentSchema,
  InventoryCountSchema,
  InventoryTransferSchema,
  type InventoryLocationDto,
  type InventoryStockDto,
} from "@smartretail/contracts";
import { decimalToMilliUnits } from "../../lib/quantity-input";
export type Action =
  "location" | "receive" | "issue" | "adjustment" | "count" | "transfer";
export type Command = Readonly<{ path: string; body: unknown }>;
const labels: Record<Action, string> = {
  location: "Nueva ubicación",
  receive: "Recibir",
  issue: "Retirar",
  adjustment: "Ajustar",
  count: "Contar",
  transfer: "Transferir",
};
export default function InventoryForm({
  action,
  row,
  locations,
  busy,
  pending,
  onSave,
  onCancel,
}: {
  action: Action;
  row: InventoryStockDto | undefined;
  locations: InventoryLocationDto[];
  busy: boolean;
  pending: Command | undefined;
  onSave: (command: Command) => Promise<void>;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [destination, setDestination] = useState(
    locations.find((place) => place.id !== row?.locationId)?.id ?? "",
  );
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const frozen = busy || pending !== undefined;
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (pending) {
      await onSave(pending);
      return;
    }
    let command: Command;
    try {
      // Generate once after validation; retain the exact payload on uncertain response.
      const id = crypto.randomUUID();
      if (action === "location")
        command = {
          path: "/api/v1/locations",
          body: CreateInventoryLocationSchema.parse({
            id,
            code,
            name,
            status: "active",
          }),
        };
      else {
        if (!row) throw new Error();
        const q = {
          unit: row.quantity.unit,
          milliUnits: decimalToMilliUnits(amount, action === "adjustment"),
        };
        const target = {
          id,
          productId: row.productId,
          locationId: row.locationId,
        };
        let body: unknown;
        if (action === "receive")
          body = InventoryReceiptSchema.parse({
            ...target,
            type: "receipt",
            quantity: q,
          });
        else if (action === "issue")
          body = InventoryIssueSchema.parse({
            ...target,
            type: "issue",
            quantity: q,
          });
        else if (action === "adjustment")
          body = InventoryAdjustmentSchema.parse({
            ...target,
            type: "adjustment",
            delta: q,
            reason,
          });
        else if (action === "count")
          body = InventoryCountSchema.parse({ ...target, counted: q, reason });
        else
          body = InventoryTransferSchema.parse({
            id,
            productId: row.productId,
            sourceLocationId: row.locationId,
            destinationLocationId: destination,
            issueMovementId: crypto.randomUUID(),
            receiptMovementId: crypto.randomUUID(),
            quantity: q,
          });
        command = { path: `/api/v1/inventory/${action}`, body };
      }
    } catch {
      setError(
        "Revisa los campos: máximo 3 decimales, cantidad válida y motivo requerido para ajustes y conteos.",
      );
      return;
    }
    await onSave(command);
  }
  return (
    <form className="card stack" onSubmit={submit} aria-label={labels[action]}>
      <h2>
        {labels[action]}
        {row ? ` · ${row.productName}` : ""}
      </h2>
      {row && (
        <p className="muted">
          Ubicación: {row.locationName} · Unidad: {row.quantity.unit}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset className="form-grid" disabled={frozen}>
        {action === "location" ? (
          <>
            <label>
              Código
              <input
                required
                maxLength={32}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="ALMACEN-2"
              />
            </label>
            <label>
              Nombre
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              {action === "count"
                ? "Cantidad física contada"
                : action === "adjustment"
                  ? "Delta"
                  : "Cantidad"}
              <input
                type="text"
                inputMode={action === "adjustment" ? "text" : "decimal"}
                required
                maxLength={128}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-describedby="quantity-help"
              />
              <span id="quantity-help" className="muted">
                Usa punto decimal, máximo 3 decimales.
                {action === "adjustment" ? " Delta positivo o negativo." : ""}
              </span>
            </label>
            {(action === "adjustment" || action === "count") && (
              <label>
                Motivo
                <input
                  required
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            )}
            {action === "transfer" && (
              <label>
                Destino
                <select
                  required
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                >
                  {locations
                    .filter((place) => place.id !== row?.locationId)
                    .map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name} · {place.code}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </>
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy
            ? "Confirmando…"
            : pending
              ? "Reintentar mismo comando"
              : "Confirmar"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={frozen}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
      {pending && !busy && (
        <p className="muted">
          Conservamos el comando hasta confirmar su resultado. No recargues ni
          cierres esta página durante el reintento.
        </p>
      )}
    </form>
  );
}
