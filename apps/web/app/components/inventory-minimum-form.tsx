"use client";
import { LoadingLabel } from "./ui";
import { useState, type FormEvent } from "react";
import { QuantitySchema, type InventoryStockDto } from "@smartretail/contracts";
import {
  decimalToMilliUnits,
  milliUnitsToDecimal,
} from "../../lib/quantity-input";

export default function InventoryMinimumForm({
  row,
  busy,
  onSave,
  onCancel,
}: {
  row: InventoryStockDto;
  busy: boolean;
  onSave: (
    minimum: {
      unit: InventoryStockDto["quantity"]["unit"];
      milliUnits: string;
    } | null,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(
    row.minimumStock ? milliUnitsToDecimal(row.minimumStock.milliUnits) : "",
  );
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const minimum =
        value === ""
          ? null
          : QuantitySchema.parse({
              unit: row.quantity.unit,
              milliUnits: decimalToMilliUnits(value),
            });
      if (
        minimum &&
        (BigInt(minimum.milliUnits) > 9223372036854775807n ||
          (minimum.unit === "piece" &&
            BigInt(minimum.milliUnits) % 1000n !== 0n))
      )
        throw new Error();
      await onSave(minimum);
    } catch {
      setError(
        "Usa una cantidad no negativa, máximo 3 decimales y piezas enteras.",
      );
    }
  }
  return (
    <section className="card" aria-labelledby="minimum-title">
      <h2 id="minimum-title">Mínimo de {row.productName}</h2>
      <p className="muted">
        {row.locationName} · Deja el campo vacío para quitar el mínimo. Esta
        configuración no cambia las existencias.
      </p>
      <form className="stack" onSubmit={submit}>
        <label htmlFor="minimum-value">
          Stock mínimo ({row.quantity.unit})
        </label>
        <input
          id="minimum-value"
          autoFocus
          inputMode="decimal"
          maxLength={128}
          value={value}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby="minimum-help"
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
        <p
          id="minimum-help"
          className={error ? "error" : "muted"}
          role={error ? "alert" : undefined}
        >
          {error ||
            "Opcional. Cero es un mínimo configurado; vacío lo desactiva."}
        </p>
        <div className="actions">
          <button disabled={busy}>
            <LoadingLabel busy={busy} label="Guardando…">
              Guardar mínimo
            </LoadingLabel>
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
