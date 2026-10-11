"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  type ProductDto,
  type SupplierDto,
  type InventoryLocationDto,
  type PurchaseOrderDto,
  CreatePurchaseOrderSchema,
} from "@smartretail/contracts";
import AppNavigation from "../../components/app-navigation";
import { Button, ContextHelp, Dialog } from "../../components/ui";
import {
  purchasingApi,
  PurchasingApiError,
  usePurchasingCompany,
} from "../../components/purchasing-client";
import {
  detectedAmount,
  documentWarnings,
  normalizedDocumentText,
  proposeDocument,
  suggestProducts,
  type DocumentProposal,
  type DocumentLine,
} from "../../../lib/document-proposal";
import {
  possibleDuplicate,
  reviewedDraft,
  reviewedAmount,
  DocumentReviewError,
  type ReviewLine,
} from "../../../lib/document-review";
import { minorUnitsToDecimal } from "../../../lib/money-input";
import { milliUnitsToDecimal } from "../../../lib/quantity-input";
import { DocumentFormatError } from "../../../lib/document-preflight";
import "./document-capture.css";
const ProductForm = dynamic(() => import("../../products/product-form"));
type Pending = {
  tenantId: string;
  value: ReturnType<typeof CreatePurchaseOrderSchema.parse>;
  saveOriginal: boolean;
};
const unitLabels = {
  piece: "Pieza",
  kg: "Kilogramo",
  g: "Gramo",
  l: "Litro",
  ml: "Mililitro",
  m: "Metro",
  cm: "Centímetro",
};
const blankLine = (): DocumentLine => ({
  description: "",
  code: "",
  quantity: detectedAmount("", true),
  unit: null,
  unitRaw: "",
  cost: detectedAmount(""),
  amount: detectedAmount(""),
});
function reviewLine(proposal: DocumentLine): ReviewLine {
  return {
    proposal,
    productId: "",
    unit: proposal.unit ?? "",
    quantity:
      proposal.quantity.value === null
        ? ""
        : milliUnitsToDecimal(proposal.quantity.value),
    cost:
      proposal.cost.value === null
        ? ""
        : minorUnitsToDecimal(proposal.cost.value),
    confirmed: false,
    ignored: false,
  };
}
async function documentRequest(
  path: string,
  tenantId: string,
  file: File,
  method: "POST" | "PUT",
  signal?: AbortSignal,
) {
  const response = await fetch(path, {
    method,
    body: file,
    headers: { "x-tenant-id": tenantId, "content-type": file.type },
    ...(signal ? { signal } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    const data: unknown = await response.json();
    throw new Error(
      data &&
        typeof data === "object" &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "No pudimos validar el documento.",
    );
  }
}
export default function DocumentCapturePanel({
  initialTenantId,
}: {
  initialTenantId?: string | undefined;
}) {
  const company = usePurchasingCompany("purchases.read", initialTenantId);
  const [products, setProducts] = useState<ProductDto[]>([]),
    [suppliers, setSuppliers] = useState<SupplierDto[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]),
    [orders, setOrders] = useState<PurchaseOrderDto[]>([]);
  const [loadedTenant, setLoadedTenant] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [previewReady, setPreviewReady] = useState(false);
  const [previewPage, setPreviewPage] = useState(1),
    [pageCount, setPageCount] = useState(1);
  const [preparing, setPreparing] = useState(false),
    [optimizedPhoto, setOptimizedPhoto] = useState(false);
  const [proposal, setProposal] = useState<DocumentProposal | null>(null),
    [lines, setLines] = useState<ReviewLine[]>([]),
    [supplierId, setSupplierId] = useState(""),
    [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [method, setMethod] = useState("");
  const [errorField, setErrorField] = useState("");
  const fieldFeedback = (id: string) => ({
    id,
    "aria-invalid": errorField === id || undefined,
    "aria-describedby": errorField === id ? "document-review-error" : undefined,
  });
  const [confirmed, setConfirmed] = useState(false),
    [saveOriginal, setSaveOriginal] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [createdId, setCreatedId] = useState("");
  const [creatingProduct, setCreatingProduct] = useState<number | null>(null),
    [creatingSupplier, setCreatingSupplier] = useState(false),
    [supplierName, setSupplierName] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    controller = useRef<AbortController | null>(null),
    sending = useRef(false),
    selecting = useRef(false),
    currentTenant = useRef(company.tenantId),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    currentTenant.current = company.tenantId;
    controller.current?.abort();
  }, [company.tenantId]);
  const canWrite = company.permissions.includes("purchases.write"),
    locked = busy || preparing || pending !== null || !!createdId;
  const ready =
    !!company.tenantId && canWrite && loadedTenant === company.tenantId;
  useEffect(() => {
    if (!company.tenantId || !canWrite) return;
    const abort = new AbortController();
    Promise.all([
      purchasingApi<{ products: ProductDto[] }>(
        "/api/v1/products",
        company.tenantId,
        { signal: abort.signal },
      ),
      purchasingApi<{ suppliers: SupplierDto[] }>(
        "/api/v1/suppliers",
        company.tenantId,
        { signal: abort.signal },
      ),
      purchasingApi<{ locations: InventoryLocationDto[] }>(
        "/api/v1/locations",
        company.tenantId,
        { signal: abort.signal },
      ),
      purchasingApi<{ purchases: PurchaseOrderDto[] }>(
        "/api/v1/purchases",
        company.tenantId,
        { signal: abort.signal },
      ),
    ])
      .then(([p, s, l, o]) => {
        if (abort.signal.aborted) return;
        setProducts(p.products);
        setSuppliers(s.suppliers);
        setLocations(l.locations);
        setOrders(o.purchases);
        setLoadedTenant(company.tenantId);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "No pudimos cargar productos, proveedores o sucursales. Recarga o usa una compra manual.",
          );
      });
    return () => abort.abort();
  }, [company.tenantId, canWrite]);
  useEffect(() => {
    if (!file || !canvas.current) return;
    const abort = new AbortController(),
      target = canvas.current;
    import("../../../lib/document-extraction")
      .then((engine) =>
        engine.previewDocument(file, target, abort.signal, previewPage),
      )
      .then((pages) => {
        if (!abort.signal.aborted) {
          setPreviewReady(true);
          setPageCount(pages ?? 1);
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setError(
            error instanceof DocumentFormatError
              ? error.message
              : "No pudimos mostrar el documento. Elige una imagen válida o un PDF de hasta 5 páginas.",
          );
      });
    return () => {
      abort.abort();
      target.width = target.height = 0;
    };
  }, [file, previewPage]);
  useEffect(() => () => controller.current?.abort(), []);
  async function choose(next: File | undefined) {
    if (!next || locked || !ready || selecting.current) return;
    selecting.current = true;
    controller.current?.abort();
    const abort = new AbortController(),
      tenantId = company.tenantId;
    controller.current = abort;
    setPreparing(true);
    setFile(null);
    setPreviewReady(false);
    setProposal(null);
    setLines([]);
    setConfirmed(false);
    setSupplierId("");
    setPreviewPage(1);
    setPageCount(1);
    setCreatingProduct(null);
    setCreatingSupplier(false);
    setOptimizedPhoto(false);
    setError("");
    setErrorField("");
    setNotice("Preparando documento…");
    try {
      const { prepareDocumentFile } =
        await import("../../../lib/document-photo");
      const prepared = await prepareDocumentFile(next, abort.signal);
      if (abort.signal.aborted || currentTenant.current !== tenantId) return;
      setFile(prepared.file);
      setOptimizedPhoto(prepared.optimized);
      setNotice(
        prepared.optimized
          ? "✓ Foto ajustada automáticamente. Revisa que el texto sea legible antes de continuar."
          : "",
      );
    } catch (e) {
      if (!abort.signal.aborted && currentTenant.current === tenantId) {
        setError(e instanceof Error ? e.message : "Documento inválido.");
        setNotice("");
      }
    } finally {
      if (controller.current === abort) {
        selecting.current = false;
        setPreparing(false);
        controller.current = null;
      }
    }
  }
  async function extract() {
    if (
      !file ||
      !previewReady ||
      busy ||
      !canWrite ||
      loadedTenant !== company.tenantId
    )
      return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setNotice("Preparando documento…");
    try {
      await documentRequest(
        "/api/v1/purchases/document",
        company.tenantId,
        file,
        "POST",
        abort.signal,
      );
      const { extractDocument } =
        await import("../../../lib/document-extraction");
      const result = await extractDocument(file, abort.signal, (message) => {
        if (!abort.signal.aborted) setNotice(message);
      });
      abort.signal.throwIfAborted();
      const detected = proposeDocument(result.text);
      if (result.confidence !== null && result.confidence < 80) {
        for (const field of [detected.subtotal, detected.tax, detected.total])
          if (field.state === "Detectado") field.state = "Revisar";
        for (const line of detected.lines)
          for (const field of [line.quantity, line.cost, line.amount])
            if (field.state === "Detectado") field.state = "Revisar";
      }
      setProposal(detected);
      setLines(detected.lines.map(reviewLine));
      setMethod(result.method);
      setConfirmed(false);
      setNotice(
        detected.lines.length
          ? "✓ Documento leído. Revisa la información detectada."
          : "No pudimos identificar líneas. Puedes añadirlas aquí o cargar la compra manualmente.",
      );
      setTimeout(() => heading.current?.focus(), 0);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos leer suficiente información.",
        );
        setNotice("");
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function changeLine(index: number, change: Partial<ReviewLine>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...change } : line)),
    );
    setConfirmed(false);
  }
  function changeDocument(
    field: "supplier" | "reference" | "date" | "currency",
    value: string,
  ) {
    setProposal((p) => (p ? { ...p, [field]: value } : p));
    setConfirmed(false);
  }
  async function createDraft() {
    if (
      sending.current ||
      !proposal ||
      !file ||
      !canWrite ||
      loadedTenant !== company.tenantId ||
      createdId
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    let attempted = pending;
    try {
      if (!confirmed && !pending)
        throw new Error(
          "Confirma que revisaste los datos antes de crear el borrador.",
        );
      const command = pending ?? {
        tenantId: company.tenantId,
        value: reviewedDraft(
          crypto.randomUUID(),
          supplierId,
          locationId,
          proposal,
          lines,
          products,
        ),
        saveOriginal,
      };
      setPending(command);
      attempted = command;
      const data = await purchasingApi<{ purchase: PurchaseOrderDto }>(
        "/api/v1/purchases",
        command.tenantId,
        { method: "POST", body: JSON.stringify(command.value) },
      );
      if (command.saveOriginal) {
        try {
          await documentRequest(
            `/api/v1/purchases/${data.purchase.id}/document`,
            command.tenantId,
            file,
            "PUT",
          );
        } catch {
          setNotice(
            "Borrador creado; el documento no se guardó. Reintenta para adjuntarlo sin duplicar la compra.",
          );
          return;
        }
      }
      setCreatedId(data.purchase.id);
      setPending(null);
      setNotice(
        "✓ Borrador creado. El inventario no cambió; recibe mercancía desde la compra cuando corresponda.",
      );
    } catch (e) {
      if (e instanceof PurchasingApiError && e.status === 409 && attempted) {
        try {
          const existing = await purchasingApi<{ purchase: PurchaseOrderDto }>(
            `/api/v1/purchases/${attempted.value.id}`,
            attempted.tenantId,
          );
          setCreatedId(existing.purchase.id);
          setPending(null);
          setNotice(
            "El borrador ya existe. Revisa la compra antes de volver a intentar; no creamos otra.",
          );
        } catch (lookup) {
          if (lookup instanceof PurchasingApiError && lookup.status === 404)
            setPending(null);
        }
      }
      // A definitive validation rejection rolled the command back; permit correction.
      // Network/5xx ambiguity retains the command identity and frozen payload.
      if (e instanceof PurchasingApiError && [400, 403, 404].includes(e.status))
        setPending(null);
      setError(
        e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "Revisa proveedor, sucursal, productos, cantidades y costos.",
      );
      const target =
        e instanceof DocumentReviewError ? e.fieldId : "document-review-error";
      setErrorField(e instanceof DocumentReviewError ? e.fieldId : "");
      requestAnimationFrame(() => document.getElementById(target)?.focus());
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const currentProposal = proposal
    ? {
        ...proposal,
        lines: lines
          .filter((line) => !line.ignored)
          .map((line) => ({
            ...line.proposal,
            unit: line.unit || null,
            quantity: reviewedAmount(line.quantity, true),
            cost: reviewedAmount(line.cost),
          })),
      }
    : null;
  const warnings = currentProposal
    ? documentWarnings(
        currentProposal,
        lines.flatMap((line, index) => (line.ignored ? [] : [index + 1])),
      )
    : [];
  const identity = proposal
    ? {
        reference: proposal.reference,
        date: proposal.date,
        total: detectedAmount(proposal.total.raw).value ?? "",
      }
    : null;
  const duplicate = identity && possibleDuplicate(orders, supplierId, identity);
  const newLine = creatingProduct === null ? null : lines[creatingProduct];
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          current="/purchases"
          tenantId={company.tenantId}
          permissions={company.permissions}
          blocked={locked}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Abastecimiento</p>
            <h1>Capturar documento</h1>
            <p className="muted">
              Una propuesta para revisar. El inventario cambia sólo al recibir
              mercancía.
            </p>
          </div>
          <Link
            href={`/purchases?tenantId=${encodeURIComponent(company.tenantId)}`}
          >
            Compra manual
          </Link>
        </div>
        <p role="status" aria-live="polite">
          {notice || (company.loading ? "Cargando empresa…" : "")}
        </p>
        {(error || company.error) && (
          <p
            id="document-review-error"
            className="error"
            role="alert"
            tabIndex={-1}
          >
            {error || company.error}
          </p>
        )}
        {!company.loading && !canWrite ? (
          <section className="card">
            <h2>Captura no disponible</h2>
            <p>Necesitas permiso para crear compras en esta empresa.</p>
          </section>
        ) : (
          <>
            {company.tenants.length > 1 && (
              <label>
                Empresa
                <select
                  value={company.tenantId}
                  disabled={!!file || locked}
                  onChange={(e) => company.setTenantId(e.target.value)}
                >
                  {company.tenants.map((t) => (
                    <option key={t.tenantId} value={t.tenantId}>
                      {t.tenantName ?? "Empresa"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!proposal && !createdId && (
              <section className="card stack">
                <h2>Elige una foto o PDF</h2>
                <p>
                  Documento completo, buena luz, sin reflejos y cámara paralela.
                  Las fotos de hasta 12 MB y 50 megapíxeles se ajustan aquí si
                  hace falta. PDF de hasta 4 MB y 5 páginas.
                </p>
                <div className="form-grid">
                  <label>
                    Tomar foto
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      disabled={locked || !ready}
                      onChange={(e) => {
                        void choose(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label>
                    Subir imagen o PDF
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      disabled={locked || !ready}
                      onChange={(e) => {
                        void choose(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {preparing && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      controller.current?.abort();
                      controller.current = null;
                      selecting.current = false;
                      setPreparing(false);
                      setNotice(
                        "Preparación cancelada. No se creó ninguna compra.",
                      );
                    }}
                  >
                    Cancelar preparación
                  </Button>
                )}
                <Link
                  href="/help/document-photo"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Cómo tomar una foto legible
                </Link>
              </section>
            )}
            <div className="document-review-grid">
              {file && (
                <section className="card document-preview">
                  <h2>Documento</h2>
                  <p className="document-filename">{file.name}</p>
                  <canvas
                    ref={canvas}
                    role="img"
                    aria-label="Vista previa pasiva del documento seleccionado"
                  />
                  <p className="muted">
                    {file.type === "application/pdf"
                      ? `Página ${previewPage} de ${pageCount}. Se leen todas las páginas permitidas.`
                      : optimizedPhoto
                        ? "Copia optimizada para leer y guardar. La foto original permanece en tu dispositivo."
                        : "Documento original seleccionado."}
                  </p>
                  {file.type === "application/pdf" && pageCount > 1 && (
                    <div className="actions">
                      <Button
                        variant="secondary"
                        disabled={busy || previewPage <= 1}
                        onClick={() => {
                          setPreviewReady(false);
                          setPreviewPage((p) => p - 1);
                        }}
                      >
                        Página anterior
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || previewPage >= pageCount}
                        onClick={() => {
                          setPreviewReady(false);
                          setPreviewPage((p) => p + 1);
                        }}
                      >
                        Página siguiente
                      </Button>
                    </div>
                  )}
                  {!proposal && !createdId && (
                    <div className="actions">
                      <Button
                        disabled={!previewReady || !ready}
                        busy={busy}
                        onClick={() => void extract()}
                      >
                        Usar documento
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={locked}
                        onClick={() => {
                          setFile(null);
                          setPreviewReady(false);
                        }}
                      >
                        Elegir otro / volver a tomar
                      </Button>
                    </div>
                  )}
                  {busy && !pending && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        controller.current?.abort();
                        setNotice(
                          "Lectura cancelada. No se creó ninguna compra.",
                        );
                      }}
                    >
                      Cancelar lectura
                    </Button>
                  )}
                </section>
              )}
              {proposal && !createdId && (
                <section
                  className="stack"
                  aria-labelledby="document-review-heading"
                >
                  <div>
                    <h2
                      id="document-review-heading"
                      ref={heading}
                      tabIndex={-1}
                    >
                      Revisa los datos detectados
                    </h2>
                    <p>
                      SmartRetail puede equivocarse al leer documentos. Confirma
                      los datos antes de crear la compra.
                    </p>
                    <p className="muted">
                      Lectura: {method}. Todos los valores son propuestas.
                    </p>
                  </div>
                  <fieldset className="card stack" disabled={locked}>
                    <legend>Proveedor y documento</legend>
                    <p>
                      Proveedor detectado:{" "}
                      {proposal.supplier || "No identificado"}
                    </p>
                    {suppliers
                      .filter(
                        (s) =>
                          s.status === "active" &&
                          proposal.supplier &&
                          normalizedDocumentText(s.name).includes(
                            normalizedDocumentText(proposal.supplier),
                          ),
                      )
                      .map((s) => (
                        <p key={s.id}>
                          Coincidencia probable: {s.name}. Elígelo para
                          confirmar.
                        </p>
                      ))}
                    <label>
                      Proveedor
                      <select
                        {...fieldFeedback("doc-supplier")}
                        value={supplierId}
                        onChange={(e) => {
                          setSupplierId(e.target.value);
                          setConfirmed(false);
                        }}
                      >
                        <option value="">Selecciona un proveedor</option>
                        {suppliers
                          .filter((s) => s.status === "active")
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {company.permissions.includes("suppliers.write") && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setCreatingSupplier(true);
                          setSupplierName(proposal.supplier);
                        }}
                      >
                        Crear proveedor
                      </Button>
                    )}
                    <label>
                      Sucursal
                      <select
                        {...fieldFeedback("doc-location")}
                        value={locationId}
                        onChange={(e) => {
                          setLocationId(e.target.value);
                          setConfirmed(false);
                        }}
                      >
                        <option value="">Selecciona una sucursal</option>
                        {locations
                          .filter((l) => l.status === "active")
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Folio / referencia
                        <input
                          maxLength={100}
                          value={proposal.reference}
                          onChange={(e) =>
                            changeDocument("reference", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Fecha
                        <input
                          type="date"
                          value={proposal.date}
                          onChange={(e) =>
                            changeDocument("date", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Moneda
                        <select
                          {...fieldFeedback("doc-currency")}
                          value={proposal.currency}
                          onChange={(e) =>
                            changeDocument("currency", e.target.value)
                          }
                        >
                          <option value="">No identificada: confirma</option>
                          <option value="MXN">MXN</option>
                        </select>
                      </label>
                    </div>
                  </fieldset>
                  <h3 id="doc-lines" tabIndex={-1}>
                    Productos
                  </h3>
                  {lines.map((line, index) => (
                    <fieldset
                      className="card stack document-line"
                      key={index}
                      disabled={locked}
                    >
                      <legend>
                        Línea {index + 1}
                        {line.ignored ? " · Ignorada" : ""}
                      </legend>
                      <p>
                        {line.proposal.description ||
                          "Sin descripción identificada"}
                      </p>
                      <p className="muted">
                        Código: {line.proposal.code || "No identificado"} ·
                        Unidad detectada:{" "}
                        {line.proposal.unitRaw || "No identificada"}
                      </p>
                      {!line.ignored && (
                        <>
                          {suggestProducts(line.proposal, products).map((p) => (
                            <div className="actions" key={p.id}>
                              <span>Coincidencia sugerida: {p.name}</span>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  changeLine(index, {
                                    productId: p.id,
                                    confirmed: false,
                                  })
                                }
                              >
                                Elegir {p.name}
                              </Button>
                            </div>
                          ))}
                          <label>
                            Producto de la línea {index + 1}
                            <select
                              {...fieldFeedback(`doc-product-${index}`)}
                              value={line.productId}
                              onChange={(e) =>
                                changeLine(index, {
                                  productId: e.target.value,
                                  confirmed: false,
                                })
                              }
                            >
                              <option value="">Selecciona un producto</option>
                              {products
                                .filter((p) => p.status === "active")
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} · {p.sku}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <div className="form-grid">
                            <label>
                              Cantidad
                              <input
                                {...fieldFeedback(`doc-quantity-${index}`)}
                                inputMode="decimal"
                                maxLength={128}
                                value={line.quantity}
                                onChange={(e) =>
                                  changeLine(index, {
                                    quantity: e.target.value,
                                  })
                                }
                              />
                              <small>
                                {line.proposal.quantity.state} ·{" "}
                                {line.proposal.quantity.raw ||
                                  "Sin valor detectado"}
                              </small>
                            </label>
                            <label>
                              Unidad
                              <select
                                {...fieldFeedback(`doc-unit-${index}`)}
                                value={line.unit}
                                onChange={(e) =>
                                  changeLine(index, { unit: e.target.value })
                                }
                              >
                                <option value="">Revisar unidad</option>
                                {Object.entries(unitLabels).map(
                                  ([key, label]) => (
                                    <option key={key} value={key}>
                                      {label}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label>
                              Costo unitario (MXN)
                              <input
                                {...fieldFeedback(`doc-cost-${index}`)}
                                inputMode="decimal"
                                maxLength={128}
                                value={line.cost}
                                onChange={(e) =>
                                  changeLine(index, { cost: e.target.value })
                                }
                              />
                              <small>
                                {line.proposal.cost.state} ·{" "}
                                {line.proposal.cost.raw ||
                                  "Sin valor detectado"}
                              </small>
                            </label>
                          </div>
                          <p>
                            Importe detectado:{" "}
                            {line.proposal.amount.raw || "No identificado"} ·{" "}
                            {line.proposal.amount.state}
                          </p>
                          <ContextHelp
                            label="Cómo corregir cantidades e importes"
                            href="/help/document-amounts"
                            keepPage
                          >
                            Usa punto decimal. No convertimos cajas a piezas ni
                            resolvemos importes ambiguos; confirma la unidad del
                            producto.
                          </ContextHelp>
                          <label className="document-check">
                            <input
                              type="checkbox"
                              checked={line.confirmed}
                              disabled={!line.productId || locked}
                              onChange={(e) =>
                                changeLine(index, {
                                  confirmed: e.target.checked,
                                })
                              }
                            />{" "}
                            Confirmo el producto de esta línea
                          </label>
                          {company.permissions.includes("products.write") && (
                            <Button
                              variant="secondary"
                              onClick={() => setCreatingProduct(index)}
                            >
                              Crear producto para esta línea
                            </Button>
                          )}
                        </>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          changeLine(index, {
                            ignored: !line.ignored,
                            confirmed: false,
                          })
                        }
                      >
                        {line.ignored ? "Incluir línea" : "Ignorar línea"}
                      </Button>
                    </fieldset>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={locked || lines.length >= 50}
                    onClick={() => {
                      setLines((l) => [...l, reviewLine(blankLine())]);
                      setConfirmed(false);
                    }}
                  >
                    Añadir línea manualmente
                  </Button>
                  <fieldset className="card stack" disabled={locked}>
                    <legend>Totales del documento</legend>
                    <div className="form-grid">
                      {(["subtotal", "tax", "total"] as const).map((field) => (
                        <label key={field}>
                          {field === "tax"
                            ? "Impuestos detectados"
                            : field === "total"
                              ? "Total"
                              : "Subtotal"}
                          <input
                            inputMode="decimal"
                            maxLength={128}
                            value={proposal[field].raw}
                            onChange={(e) => {
                              setProposal((p) =>
                                p
                                  ? {
                                      ...p,
                                      [field]: detectedAmount(e.target.value),
                                    }
                                  : p,
                              );
                              setConfirmed(false);
                            }}
                          />
                          <small>{proposal[field].state}</small>
                        </label>
                      ))}
                    </div>
                    <p>
                      Los impuestos son datos del documento, no una validación
                      fiscal. La compra usa los costos que confirmas por línea;
                      revisa cómo deben representar tu costo de adquisición.
                    </p>
                  </fieldset>
                  {warnings.length > 0 && (
                    <div className="card" role="status">
                      <h3>Revisa los importes detectados</h3>
                      <ul>
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                      <p>Las advertencias no corrigen datos automáticamente.</p>
                    </div>
                  )}
                  {duplicate && (
                    <p role="status">
                      Puede que esta compra ya exista. Revisa proveedor, folio,
                      fecha y total antes de continuar.
                    </p>
                  )}
                  <label className="document-check">
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={saveOriginal}
                      onChange={(e) => setSaveOriginal(e.target.checked)}
                    />{" "}
                    {optimizedPhoto
                      ? "Guardar la copia optimizada privada junto a la compra"
                      : "Guardar el original privado junto a la compra"}
                  </label>
                  <label className="document-check">
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{" "}
                    Revisé proveedor, productos, unidades, costos y
                    advertencias. Crearé un borrador, sin modificar inventario.
                  </label>
                  <div className="actions">
                    <Button
                      busy={busy}
                      disabled={
                        (!confirmed && !pending) ||
                        loadedTenant !== company.tenantId
                      }
                      onClick={() => void createDraft()}
                    >
                      {pending
                        ? "Reintentar el mismo borrador"
                        : "Crear borrador de compra"}
                    </Button>
                    {!pending && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setProposal(null);
                          setLines([]);
                          setNotice(
                            "Revisión cancelada. No se creó ninguna compra.",
                          );
                        }}
                      >
                        Cancelar revisión
                      </Button>
                    )}
                  </div>
                  {pending && (
                    <p>
                      El intento conserva el mismo identificador y datos. No
                      cambies de documento hasta confirmar la respuesta.
                    </p>
                  )}
                </section>
              )}
            </div>
            {createdId && (
              <section className="card">
                <h2>Borrador creado</h2>
                <p>El inventario no cambió.</p>
                <div className="actions">
                  <Link
                    href={`/purchases/${createdId}?tenantId=${encodeURIComponent(company.tenantId)}`}
                  >
                    Ver compra / recibir mercancía
                  </Link>
                  <Link
                    href={`/products?tenantId=${encodeURIComponent(company.tenantId)}`}
                  >
                    Revisar productos
                  </Link>
                </div>
              </section>
            )}
            {newLine && creatingProduct !== null && (
              <Dialog
                open
                title="Crear producto desde documento"
                blocked={busy}
                onClose={() => setCreatingProduct(null)}
              >
                <ProductForm
                  product={null}
                  tenantId={company.tenantId}
                  busy={busy}
                  initialBarcode={
                    /^\d{8,14}$/.test(newLine.proposal.code)
                      ? newLine.proposal.code
                      : ""
                  }
                  documentPrefill={{
                    name: newLine.proposal.description,
                    sku: /^[A-Z0-9_-]{1,64}$/.test(newLine.proposal.code)
                      ? newLine.proposal.code
                      : "",
                    cost: newLine.proposal.cost.value,
                  }}
                  onCancel={() => setCreatingProduct(null)}
                  onSave={async (value) => {
                    setBusy(true);
                    try {
                      const result = await purchasingApi<{
                        product: ProductDto;
                      }>("/api/v1/products", company.tenantId, {
                        method: "POST",
                        body: JSON.stringify(value),
                      });
                      setProducts((p) => [...p, result.product]);
                      changeLine(creatingProduct, {
                        productId: result.product.id,
                        confirmed: false,
                      });
                      setCreatingProduct(null);
                      setNotice(
                        "Producto creado. Confirma su selección y unidad en la revisión.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </Dialog>
            )}
            {creatingSupplier && (
              <Dialog
                open
                title="Crear proveedor desde documento"
                blocked={busy}
                onClose={() => setCreatingSupplier(false)}
              >
                <section className="card stack">
                  <h2>Crear proveedor</h2>
                  <label>
                    Nombre del proveedor
                    <input
                      maxLength={200}
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="actions">
                    <Button
                      busy={busy}
                      disabled={!supplierName.trim()}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await purchasingApi<{
                            supplier: SupplierDto;
                          }>("/api/v1/suppliers", company.tenantId, {
                            method: "POST",
                            body: JSON.stringify({
                              id: crypto.randomUUID(),
                              name: supplierName,
                              status: "active",
                            }),
                          });
                          setSuppliers((s) => [...s, result.supplier]);
                          setSupplierId(result.supplier.id);
                          setCreatingSupplier(false);
                          setConfirmed(false);
                        } catch {
                          setError(
                            "No pudimos crear el proveedor. Revisa los datos y permisos.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Guardar proveedor
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setCreatingSupplier(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </section>
              </Dialog>
            )}
          </>
        )}
      </main>
    </>
  );
}
