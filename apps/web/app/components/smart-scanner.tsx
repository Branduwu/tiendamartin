"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./ui";
import {
  cameraMessage,
  imageFileAllowed,
  scanCode,
  stopCamera,
  stableScan,
  cameraScanArea,
  type ScanResult,
} from "../../lib/scanner";
export default function SmartScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    accepted = useRef(false),
    confirmed = useRef(false);
  const [message, setMessage] = useState(""),
    [active, setActive] = useState(false),
    [waiting, setWaiting] = useState(false),
    [manual, setManual] = useState(""),
    [result, setResult] = useState<ScanResult | null>(null);
  const stop = () => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    stopCamera(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        stop();
        setActive(false);
        setWaiting(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    const leaving = () => stop();
    window.addEventListener("pagehide", leaving);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
    };
  }, []);
  const close = () => {
    stop();
    onClose();
  };
  function confirm(code: string) {
    if (confirmed.current) return;
    confirmed.current = true;
    stop();
    onCode(code);
  }
  function found(value: ScanResult) {
    if (accepted.current) return;
    accepted.current = true;
    stop();
    setActive(false);
    setWaiting(false);
    if (value.value.length > 2048) {
      setMessage(
        "El contenido del código es demasiado largo. Escribe el código del producto.",
      );
      return;
    }
    setResult(value);
  }
  async function camera() {
    stop();
    const token = generation.current;
    accepted.current = false;
    setResult(null);
    setMessage("");
    setWaiting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Unavailable");
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (token !== generation.current) {
        stopCamera(media);
        return;
      }
      stream.current = media;
      const el = video.current;
      if (!el) {
        stop();
        return;
      }
      el.srcObject = media;
      await el.play();
      const { scannerEngine } = await import("../../lib/scanner-engine");
      const detect = await scannerEngine();
      if (token !== generation.current) return;
      setWaiting(false);
      setActive(true);
      const stable = stableScan();
      const canvas = document.createElement("canvas");
      const loop = async () => {
        if (token !== generation.current || accepted.current) return;
        if (el.readyState >= 2 && el.videoWidth) {
          const area = cameraScanArea(
            el.videoWidth,
            el.videoHeight,
            el.clientWidth,
            el.clientHeight,
          );
          const scale = Math.min(1, 1280 / area.width);
          canvas.width = Math.max(1, Math.round(area.width * scale));
          canvas.height = Math.max(1, Math.round(area.height * scale));
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(
              el,
              area.x,
              area.y,
              area.width,
              area.height,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            try {
              const values = await detect(
                ctx.getImageData(0, 0, canvas.width, canvas.height),
              );
              if (token === generation.current) {
                const reading = stable(values);
                if (reading) {
                  found(reading);
                  return;
                }
              }
            } catch {
              if (token === generation.current) {
                stop();
                setActive(false);
                setMessage(
                  "No pudimos leer la cámara. Intenta una foto o escribe el código.",
                );
              }
              return;
            }
          } else stable([]);
        } else stable([]);
        if (token === generation.current)
          timer.current = setTimeout(() => void loop(), 250);
      };
      void loop();
    } catch (error) {
      if (token === generation.current) {
        stop();
        setWaiting(false);
        setActive(false);
        setMessage(cameraMessage(error));
      }
    }
  }
  async function photo(file?: File) {
    stop();
    setWaiting(false);
    const token = generation.current;
    accepted.current = false;
    setActive(false);
    setResult(null);
    if (!file) return;
    if (!imageFileAllowed(file)) {
      setMessage("Elige JPEG, PNG o WebP de hasta 8 MB.");
      return;
    }
    setWaiting(true);
    setMessage("");
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 24_000_000)
        throw new Error("Large image");
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const { scannerEngine } = await import("../../lib/scanner-engine");
      const detect = await scannerEngine(),
        values = await detect(
          ctx.getImageData(0, 0, canvas.width, canvas.height),
        );
      if (token !== generation.current) return;
      if (values.length === 1 && values[0]) found(values[0]);
      else
        setMessage(
          "No pudimos leer un único código válido en la foto. Muestra sólo un código, con mejor luz, o escríbelo.",
        );
    } catch {
      if (token === generation.current)
        setMessage(
          "No pudimos leer esta imagen. Elige otra foto o escribe el código.",
        );
    } finally {
      bitmap?.close();
      if (token === generation.current) setWaiting(false);
    }
  }
  return (
    <Dialog open title="Escanear producto" onClose={close}>
      <p>
        Usa la cámara, una foto o el código escrito. Las fotos para leer códigos
        no se guardan.
      </p>
      <p role="status" aria-live="polite" aria-atomic="true">
        {message ||
          (result
            ? result.format === "QRCode" || result.format === "qr_code"
              ? "✓ QR leído. Revisa el contenido antes de continuar."
              : "✓ Código detectado. Confirma para continuar."
            : waiting
              ? "Preparando lectura…"
              : active
                ? "Buscando código… Mantén las barras dentro del recuadro hasta confirmar la lectura."
                : "Puedes escribir un código sin usar la cámara.")}
      </p>

      {result && (
        <section className="scanner-result">
          <h3>
            {result.format === "QRCode" || result.format === "qr_code"
              ? "✓ QR leído"
              : "✓ Código detectado"}
          </h3>
          <p className="safe-code">{result.value}</p>
          {scanCode(result.value) ? (
            <button
              type="button"
              onClick={() => {
                stop();
                confirm(result.value);
              }}
            >
              Usar este código
            </button>
          ) : (
            <p>
              {/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(result.value)
                ? "Este QR contiene un enlace."
                : "Este QR contiene texto."}{" "}
              No lo abrimos ni ejecutamos. Escribe el código del producto para
              buscarlo.
            </p>
          )}
          {(result.format === "EAN13" || result.format === "ean_13") &&
            /^0\d{12}$/.test(result.value) && (
              <button
                type="button"
                className="secondary"
                onClick={() => confirm(result.value.slice(1))}
              >
                Usar equivalente UPC-A ({result.value.slice(1)})
              </button>
            )}
        </section>
      )}
      <div className="scanner-viewfinder" hidden={!!result}>
        <video ref={video} muted playsInline aria-label="Vista de la cámara" />
        <span>
          {active
            ? "Coloca el código dentro del recuadro"
            : "La cámara está apagada"}
        </span>
      </div>
      <div className="actions">
        <button type="button" disabled={waiting} onClick={() => void camera()}>
          {waiting ? "Preparando…" : "Escanear con cámara"}
        </button>
        {active && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              stop();
              setActive(false);
            }}
          >
            Apagar cámara
          </button>
        )}
      </div>
      <label>
        Subir foto para leer código
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            void photo(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const code = scanCode(manual);
          if (code) {
            stop();
            confirm(code);
          } else
            setMessage(
              "Escribe un código de producto de hasta 128 caracteres, sin enlaces ni HTML.",
            );
        }}
        className="stack"
      >
        <label>
          Escribir código manualmente
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            maxLength={128}
          />
        </label>
        <button type="submit" disabled={!manual}>
          Usar código escrito
        </button>
      </form>
    </Dialog>
  );
}
