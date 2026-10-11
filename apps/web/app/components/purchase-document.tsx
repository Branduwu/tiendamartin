"use client";
import { useState } from "react";
import { Button } from "./ui";
export default function PurchaseDocument({
  tenantId,
  purchaseId,
}: {
  tenantId: string;
  purchaseId: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="stack">
      <Button
        variant="secondary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch(
              `/api/v1/purchases/${purchaseId}/document`,
              { headers: { "x-tenant-id": tenantId }, cache: "no-store" },
            );
            if (!response.ok) {
              setMessage(
                response.status === 404
                  ? "Esta compra no tiene un documento original disponible."
                  : "No pudimos obtener el documento. Revisa tus permisos.",
              );
              return;
            }
            const blob = await response.blob(),
              url = URL.createObjectURL(blob),
              link = document.createElement("a");
            link.href = url;
            link.download =
              blob.type === "application/pdf"
                ? "documento-compra.pdf"
                : "documento-compra." +
                  (blob.type === "image/jpeg"
                    ? "jpg"
                    : blob.type === "image/webp"
                      ? "webp"
                      : "png");
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch {
            setMessage(
              "No pudimos obtener el documento. Reintenta cuando tengas conexión.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Descargar documento original
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
