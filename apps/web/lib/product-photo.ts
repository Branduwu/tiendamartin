import { imageFileAllowed } from "./scanner";
export async function prepareProductPhoto(file: File): Promise<Blob> {
  if (!imageFileAllowed(file))
    throw new Error("Elige JPEG, PNG o WebP de hasta 8 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000)
      throw new Error(
        "La foto tiene demasiada resolución. Elige una más pequeña.",
      );
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No pudimos preparar la foto.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob || blob.size > 3 * 1024 * 1024)
      throw new Error("La foto sigue siendo demasiado grande. Elige otra.");
    return blob;
  } finally {
    bitmap.close();
  }
}
