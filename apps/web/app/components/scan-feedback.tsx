"use client";
import { useEffect, useRef, useState } from "react";

/** One visible acknowledgement per confirmed read; replacement resets its lifetime. */
export function useScanFeedback() {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function announce(value: string) {
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    // Give the persistent live region an empty rendered frame, even for identical reads.
    setMessage("");
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setMessage(value);
        timer.current = setTimeout(() => setMessage(""), 3000);
      });
    });
  }
  return { message, announce };
}

export function ScanFeedback({ message }: { message: string }) {
  return (
    <div
      className={message ? "scan-feedback" : "sr-only"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
