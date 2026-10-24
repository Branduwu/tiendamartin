"use client";
import { ScanFeedback, useScanFeedback } from "../components/scan-feedback";
import { LoadingLabel } from "../components/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  documentPrefill,
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
  documentPrefill?: { name: string; sku: string; cost: string | null };
  onCodeCaptured?: () => void;
}) {
  const feedback = useScanFeedback();
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [dirty, setDirty] = useState(false);
  const [taxRetry, setTaxRetry] = useState(0);
  const [taxFailed, setTaxFailed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  function cancelEditing() {
    if (
      !dirty ||
      window.confirm("¿Descartar los cambios sin guardar de este producto?")
    )
      onCancel();
  }
  const invalid = (name: string) => ({
    "aria-invalid": !!fieldErrors[name],
    "aria-describedby": fieldErrors[name] ? `product-error-${name}` : undefined,
  });

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
          setTaxFailed(false);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTaxFailed(true);
          setError(
            "No pudimos cargar los impuestos. Reintenta la consulta antes de guardar; tus campos se conservan.",
          );
        }
      });
    return () => controller.abort();
  }, [tenantId, taxRetry]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !loaded || photoProcessing) return;
    setError("");
    setFieldErrors({});
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
        const labels: Record<string, string> = {
          name: "Usa un nombre de hasta 120 caracteres, sin espacios al inicio o al final.",
          sku: "Usa mayúsculas y números; punto, guion o guion bajo sólo en el interior (hasta 64 caracteres).",
          barcode: "Usa hasta 128 caracteres ASCII visibles sin espacios.",
          unit: "Selecciona una unidad válida.",
          status: "Selecciona un estado válido.",
          taxProfileId: "Selecciona un impuesto disponible.",
          purchaseCost: "Revisa el costo en MXN.",
          salePrice: "Revisa el precio en MXN.",
        };
        setFieldErrors(
          Object.fromEntries(
            parsed.error.issues.map((issue) => {
              const name = String(issue.path[0]);
              return [name, labels[name] ?? "Revisa este campo."];
            }),
          ),
        );
        setError("Revisa los campos indicados. No se guardó el producto.");
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
    <section className="card product-form-ux" aria-labelledby="form-title">
      <h2 id="form-title">{product ? "Editar producto" : "Nuevo producto"}</h2>
      {!onCodeCaptured && <ScanFeedback message={feedback.message} />}
      <p className="muted">
        Los campos marcados con * son obligatorios. Guardar datos no cambia las
        existencias.
      </p>
      <form
        onSubmit={submit}
        className="stack product-editor"
        onChangeCapture={() => setDirty(true)}
      >
        <fieldset disabled={busy || !loaded} className="product-fieldset">
          <legend>Identificación</legend>
          <div className="form-grid">
            <label>
              Nombre *
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={product?.name ?? documentPrefill?.name ?? ""}
                {...invalid("name")}
                autoComplete="off"
              />
            </label>
            <label>
              SKU *
              <input
                name="sku"
                required
                maxLength={64}
                defaultValue={product?.sku ?? documentPrefill?.sku ?? ""}
                {...invalid("sku")}
                aria-describedby={
                  fieldErrors.sku ? "product-error-sku sku-help" : "sku-help"
                }
                autoCapitalize="characters"
                spellCheck={false}
              />
              <small id="sku-help">
                Mayúsculas y números. Punto, guion o guion bajo sólo en el
                interior. Ejemplo: CAFE-01.
              </small>
            </label>
            <div className="product-barcode-field">
              <label>
                Código de barras (opcional)
                <input
                  name="barcode"
                  maxLength={128}
                  value={barcode}
                  {...invalid("barcode")}
                  onChange={(e) => setBarcode(e.target.value)}
                  spellCheck={false}
                />
                <small>Sin espacios; captura manual o escaneo.</small>
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => setScanner(true)}
              >
                Escanear código
              </button>
            </div>
            <label>
              Unidad *
              <select
                name="unit"
                defaultValue={product?.unit ?? "piece"}
                {...invalid("unit")}
              >
                {UnitCodeSchema.options.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitLabels[unit]}
                  </option>
                ))}
              </select>
              <small>
                La misma unidad se utiliza en inventario, ventas y compras.
              </small>
            </label>
          </div>
        </fieldset>
        <fieldset disabled={busy || !loaded} className="product-fieldset">
          <legend>Precios e impuestos</legend>
          <div className="form-grid">
            <label>
              Costo de compra (MXN) *
              <input
                name="purchaseCost"
                required
                inputMode="decimal"
                maxLength={128}
                {...invalid("purchaseCost")}
                defaultValue={
                  documentPrefill?.cost === null
                    ? ""
                    : minorUnitsToDecimal(
                        product?.purchaseCost.minorUnits ??
                          documentPrefill?.cost ??
                          "0",
                      )
                }
              />
            </label>
            <label>
              Precio de venta (MXN) *
              <input
                name="salePrice"
                required
                inputMode="decimal"
                maxLength={128}
                {...invalid("salePrice")}
                defaultValue={
                  documentPrefill
                    ? ""
                    : minorUnitsToDecimal(product?.salePrice.minorUnits ?? "0")
                }
              />
            </label>
            <label>
              Impuesto
              <select
                name="taxProfileId"
                aria-label="Impuesto"
                {...invalid("taxProfileId")}
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
                Se añade después de descuentos. Un perfil inactivo bloquea
                nuevas ventas.
              </small>
            </label>
          </div>
          <p className="muted">
            Importes no negativos, con punto y hasta dos decimales. Ejemplo:
            123.45. No uses comas ni el símbolo $.
          </p>
        </fieldset>
        <fieldset disabled={busy || !loaded} className="product-fieldset">
          <legend>Disponibilidad</legend>
          <label>
            Estado *
            <select
              name="status"
              defaultValue={product?.status ?? "active"}
              {...invalid("status")}
            >
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
        </fieldset>
        {Object.entries(fieldErrors).map(([name, message]) => (
          <p id={`product-error-${name}`} className="error" key={name}>
            {message}
          </p>
        ))}
        {taxFailed && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              setTaxRetry((n) => n + 1);
            }}
          >
            Reintentar impuestos
          </button>
        )}
        {!documentPrefill && (
          <ProductPhotoInput
            onProcessing={setPhotoProcessing}
            tenantId={tenantId}
            {...(product ? { productId: product.id } : {})}
            busy={busy}
            onChange={(value) => {
              setPhoto(value);
              setDirty(true);
            }}
          />
        )}
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="error">
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
            disabled={busy || photoProcessing}
            onClick={cancelEditing}
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
            setDirty(true);
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
