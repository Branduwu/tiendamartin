"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { prepareProductPhoto } from "../../lib/product-photo";
export type PhotoChange = { blob: Blob | null; expected: string | null };
export default function ProductPhotoInput({
  tenantId,
  productId,
  busy,
  onChange,
  onProcessing,
}: {
  tenantId: string;
  productId?: string;
  busy: boolean;
  onChange: (value: PhotoChange) => void;
  onProcessing: (value: boolean) => void;
}) {
  const [imageId, setImageId] = useState<string | null>(null),
    [loaded, setLoaded] = useState(!productId),
    [preview, setPreview] = useState<string | null>(null),
    [changed, setChanged] = useState(false),
    [processing, setProcessing] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    if (!productId) return;
    const c = new AbortController();
    fetch(
      `/api/v1/products/${productId}/image?tenantId=${tenantId}&metadata=1`,
      { signal: c.signal, cache: "no-store" },
    )
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json() as Promise<{ imageId: string | null }>;
      })
      .then((data) => {
        if (!c.signal.aborted) {
          setImageId(data.imageId);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("No pudimos cargar la foto. Recarga antes de cambiarla.");
      });
    return () => c.abort();
  }, [tenantId, productId]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function select(file?: File) {
    if (!file) return;
    const token = ++generation.current;
    setProcessing(true);
    onProcessing(true);
    setError("");
    try {
      const blob = await prepareProductPhoto(file);
      if (token !== generation.current) return;
      setPreview(URL.createObjectURL(blob));
      setChanged(true);
      onChange({ blob, expected: imageId });
    } catch (e) {
      if (token === generation.current)
        setError(
          e instanceof Error ? e.message : "No pudimos preparar la foto.",
        );
    } finally {
      if (token === generation.current) {
        setProcessing(false);
        onProcessing(false);
      }
    }
  }
  const src =
    preview ??
    (!changed && imageId && productId
      ? `/api/v1/products/${productId}/image?tenantId=${tenantId}`
      : null);
  return (
    <section className="product-photo-input">
      <h3>
        Foto del producto <span className="muted">(opcional)</span>
      </h3>
      {src ? (
        <Image
          src={src}
          alt="Foto principal del producto"
          width={160}
          height={160}
          unoptimized
        />
      ) : (
        <p>Sin foto principal.</p>
      )}
      <p>
        Una foto. JPEG, PNG o WebP hasta 8 MB; se reduce y elimina metadata
        antes de guardar.
      </p>
      <fieldset disabled={busy || processing || !loaded}>
        <label>
          Tomar foto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => {
              void select(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <label>
          Seleccionar imagen
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void select(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {src && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              generation.current++;
              setPreview(null);
              setChanged(true);
              onChange({ blob: null, expected: imageId });
            }}
          >
            Eliminar foto
          </button>
        )}
      </fieldset>
      <p role="status">
        {processing
          ? "Preparando foto…"
          : changed
            ? "Vista previa. La foto se aplica al guardar el producto."
            : ""}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
