"use client";
import { ScanFeedback, useScanFeedback } from "../components/scan-feedback";
import { LoadingLabel } from "../components/ui";
import { useEffect, useState, type FormEvent } from "react";
import {
  CreateProductSchema,
  UnitCodeSchema,
  type ProductDto,
  type CreateProductDto,
  type UpdateProductDto,
  type TaxProfileDto,
} from "@smartretail/contracts";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
import { purchasingApi } from "../components/purchasing-client";
import dynamic from "next/dynamic";
import ProductPhotoInput, {
  type PhotoChange,
} from "../components/product-photo-input";
const SmartScanner = dynamic(() => import("../components/smart-scanner"), {
  ssr: false,
});
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
  tenantId,
  busy,
  onSave,
  onCancel,
  initialBarcode = "",
  onCodeCaptured,
}: {
  product: ProductDto | null;
  tenantId: string;
  busy: boolean;
  onSave: (
    value: CreateProductDto | UpdateProductDto,
    photo?: PhotoChange,
  ) => Promise<void>;
  onCancel: () => void;
  initialBarcode?: string;
  onCodeCaptured?: () => void;
}) {
  const feedback = useScanFeedback();
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<TaxProfileDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [barcode, setBarcode] = useState(product?.barcode ?? initialBarcode),
    [scanner, setScanner] = useState(false),
    [photo, setPhoto] = useState<PhotoChange>();
  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ profiles: TaxProfileDto[] }>("/api/v1/taxes", tenantId, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setProfiles(data.profiles);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "No pudimos cargar los impuestos. Recarga antes de guardar.",
          );
      });
    return () => controller.abort();
  }, [tenantId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !loaded || photoProcessing) return;
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const raw = {
        name: String(form.get("name")),
        ...(form.get("taxProfileId")
          ? { taxProfileId: String(form.get("taxProfileId")) }
          : {}),
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
      if (!product) await onSave(parsed.data, photo);
      else {
        const patch: UpdateProductDto = {};
        for (const field of ["name", "sku", "unit", "status"] as const) {
          if (parsed.data[field] !== product[field])
            Object.assign(patch, { [field]: parsed.data[field] });
        }
        if (parsed.data.barcode !== product.barcode)
          patch.barcode = parsed.data.barcode ?? null;
        if (parsed.data.taxProfileId !== product.taxProfileId)
          patch.taxProfileId = parsed.data.taxProfileId ?? null;
        if (
          parsed.data.purchaseCost.minorUnits !==
          product.purchaseCost.minorUnits
        )
          patch.purchaseCost = parsed.data.purchaseCost;
        if (parsed.data.salePrice.minorUnits !== product.salePrice.minorUnits)
          patch.salePrice = parsed.data.salePrice;
        if (!Object.keys(patch).length && !photo) {
          onCancel();
          return;
        }
        await onSave(patch, photo);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Revisa los importes.");
    }
  }
  return (
    <section className="card" aria-labelledby="form-title">
      <h2 id="form-title">{product ? "Editar producto" : "Nuevo producto"}</h2>
      {!onCodeCaptured && <ScanFeedback message={feedback.message} />}
      <form onSubmit={submit} className="stack">
        <fieldset disabled={busy || !loaded} className="form-grid">
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
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => setScanner(true)}
            >
              Escanear código
            </button>
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
            Impuesto
            <select
              name="taxProfileId"
              aria-label="Impuesto"
              defaultValue={product?.taxProfileId ?? ""}
              key={loaded ? "loaded" : "loading"}
            >
              <option value="">Sin impuesto configurado</option>
              {profiles
                .filter((p) => p.active || p.id === product?.taxProfileId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {minorUnitsToDecimal(p.rate)}%
                    {p.active ? "" : " (inactivo)"}
                  </option>
                ))}
            </select>
            <small>
              Se añade después de descuentos. Un perfil inactivo bloquea nuevas
              ventas.
            </small>
          </label>
          <label>
            Estado
            <select name="status" defaultValue={product?.status ?? "active"}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
        </fieldset>
        <ProductPhotoInput
          onProcessing={setPhotoProcessing}
          tenantId={tenantId}
          {...(product ? { productId: product.id } : {})}
          busy={busy}
          onChange={setPhoto}
        />
        <p className="muted">
          Importes con punto decimal y hasta dos decimales. Ejemplo: 123.45.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button disabled={busy || !loaded || photoProcessing} type="submit">
            <LoadingLabel busy={busy} label="Guardando…">
              Guardar producto
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
      {scanner && (
        <SmartScanner
          onClose={() => setScanner(false)}
          onCode={(code) => {
            setBarcode(code);
            if (onCodeCaptured) onCodeCaptured();
            else
              feedback.announce(
                "✓ Código capturado. Revisa el producto antes de guardar.",
              );
            setScanner(false);
          }}
        />
      )}
    </section>
  );
}
