import type { ProductDto } from "@smartretail/contracts";
import { barcodePattern, barcodeBars } from "../../lib/barcode";
import { formatLabelPrice, type LabelSize } from "../../lib/product-labels";

export default function ProductLabel({
  product,
  size,
}: {
  product: ProductDto;
  size: LabelSize;
}) {
  let pattern: string | undefined;
  let warning: string | undefined;
  if (!product.barcode) warning = "Sin código de barras · necesita uno.";
  else {
    try {
      const bits = barcodePattern(product.barcode);
      // 10 modules of quiet zone on both sides; never squeeze bars below 0.254mm.
      if ((bits.length + 20) * 0.254 > (size === "small" ? 44 : 64))
        warning =
          "Código demasiado largo para este formato; no se imprimen barras.";
      else pattern = bits;
    } catch {
      warning = "Código no representable; no se imprimen barras.";
    }
  }
  return (
    <article
      className={`product-label product-label-${size}`}
      aria-label={`Etiqueta de ${product.name}`}
    >
      <strong className="label-name">{product.name}</strong>
      <span className="label-sku">SKU: {product.sku}</span>
      <strong className="label-price">
        {formatLabelPrice(product.salePrice.minorUnits)}
      </strong>
      {pattern && (
        <svg
          className="label-barcode"
          role="img"
          aria-label={`Código de barras: ${product.barcode}`}
          data-encoded-value={product.barcode}
          viewBox={`0 0 ${pattern.length + 20} 40`}
          preserveAspectRatio="none"
          style={{
            width: `${(pattern.length + 20) * 0.254}mm`,
            height: size === "small" ? "8mm" : "12mm",
          }}
        >
          <rect width={pattern.length + 20} height={40} fill="white" />
          {barcodeBars(pattern).map((bar) => (
            <rect
              key={bar.x}
              x={bar.x}
              y={0}
              width={bar.width}
              height={40}
              fill="black"
            />
          ))}
        </svg>
      )}
      {product.barcode && (
        <span className="label-barcode-value">{product.barcode}</span>
      )}
      {warning && <span className="label-warning">{warning}</span>}
    </article>
  );
}
