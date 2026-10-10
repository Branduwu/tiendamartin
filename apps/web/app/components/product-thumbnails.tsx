"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
export function useProductPhotos(tenantId: string, refresh = 0) {
  const [result, setResult] = useState<{
    tenantId: string;
    photos: Record<string, string>;
  }>({ tenantId: "", photos: {} });
  useEffect(() => {
    const c = new AbortController();
    if (tenantId)
      fetch("/api/v1/product-images", {
        headers: { "x-tenant-id": tenantId },
        signal: c.signal,
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) throw Error();
          return r.json() as Promise<{
            images: { productId: string; imageId: string }[];
          }>;
        })
        .then((data) => {
          if (!c.signal.aborted)
            setResult({
              tenantId,
              photos: Object.fromEntries(
                data.images.map((i) => [i.productId, i.imageId]),
              ),
            });
        })
        .catch(() => {
          /* Photos are optional; operation remains available. */
        });
    return () => c.abort();
  }, [tenantId, refresh]);
  return result.tenantId === tenantId ? result.photos : {};
}
export function ProductThumbnail({
  tenantId,
  productId,
}: {
  tenantId: string;
  productId: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? null : (
    <Image
      className="product-thumbnail"
      src={`/api/v1/products/${productId}/image?tenantId=${tenantId}`}
      width={36}
      height={36}
      alt=""
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
