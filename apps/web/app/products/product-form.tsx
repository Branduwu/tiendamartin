"use client";
import { useState, type FormEvent } from "react";
import {
  CreateProductSchema,
  UnitCodeSchema,
  type ProductDto,
  type CreateProductDto,
  type UpdateProductDto,
} from "@smartretail/contracts";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
const unitLabels = {
  piece: "Pieza",
  kg: "Kilogramo",
  g: "Gramo",
  l: "Litro",
  ml: "Mililitro",
  m: "Metro",
  cm: "Centímetro",
};
export default function ProductForm({
  product,
  busy,
  onSave,
  onCancel,
}: {
  product: ProductDto | null;
  busy: boolean;
  onSave: (value: CreateProductDto | UpdateProductDto) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const raw = {
        name: String(form.get("name")),
        sku: String(form.get("sku")),
        ...(form.get("barcode")
          ? { barcode: String(form.get("barcode")) }
          : {}),
        unit: form.get("unit"),
        status: form.get("status"),
        purchaseCost: {
          currency: "MXN",
          minorUnits: decimalToMinorUnits(String(form.get("purchaseCost"))),
        },
        salePrice: {
          currency: "MXN",
          minorUnits: decimalToMinorUnits(String(form.get("salePrice"))),
        },
      };
      const parsed = CreateProductSchema.safeParse(raw);
      if (!parsed.success) {
        setError(
          "Revisa nombre, SKU (mayúsculas, números, guion o guion bajo), código de barras e importes.",
        );
        return;
      }
      if (!product) await onSave(parsed.data);
      else {
        const patch: UpdateProductDto = {};
        for (const field of ["name", "sku", "unit", "status"] as const) {
          if (parsed.data[field] !== product[field])
            Object.assign(patch, { [field]: parsed.data[field] });
        }
        if (parsed.data.barcode !== product.barcode)
          patch.barcode = parsed.data.barcode ?? null;
        if (
          parsed.data.purchaseCost.minorUnits !==
          product.purchaseCost.minorUnits
        )
          patch.purchaseCost = parsed.data.purchaseCost;
        if (parsed.data.salePrice.minorUnits !== product.salePrice.minorUnits)
          patch.salePrice = parsed.data.salePrice;
        if (!Object.keys(patch).length) {
          onCancel();
          return;
        }
        await onSave(patch);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Revisa los importes.");
    }
  }
  return (
    <section className="card" aria-labelledby="form-title">
      <h2 id="form-title">{product ? "Editar producto" : "Nuevo producto"}</h2>
      <form onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="form-grid">
          <label>
            Nombre
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={product?.name ?? ""}
            />
          </label>
          <label>
            SKU
            <input
              name="sku"
              required
              maxLength={64}
              defaultValue={product?.sku ?? ""}
              aria-describedby="sku-help"
            />
            <small id="sku-help">
              Mayúsculas, números, guion y guion bajo.
            </small>
          </label>
          <label>
            Código de barras <span className="muted">(opcional)</span>
            <input
              name="barcode"
              maxLength={128}
              defaultValue={product?.barcode ?? ""}
            />
          </label>
          <label>
            Unidad
            <select name="unit" defaultValue={product?.unit ?? "piece"}>
              {UnitCodeSchema.options.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabels[unit]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Costo (MXN)
            <input
              name="purchaseCost"
              required
              inputMode="decimal"
              maxLength={128}
              defaultValue={minorUnitsToDecimal(
                product?.purchaseCost.minorUnits ?? "0",
              )}
            />
          </label>
          <label>
            Precio (MXN)
            <input
              name="salePrice"
              required
              inputMode="decimal"
              maxLength={128}
              defaultValue={minorUnitsToDecimal(
                product?.salePrice.minorUnits ?? "0",
              )}
            />
          </label>
          <label>
            Estado
            <select name="status" defaultValue={product?.status ?? "active"}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
        </fieldset>
        <p className="muted">
          Importes con punto decimal y hasta dos decimales. Ejemplo: 123.45.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button disabled={busy} type="submit">
            {busy ? "Guardando…" : "Guardar producto"}
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
