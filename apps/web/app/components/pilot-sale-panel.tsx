"use client";
import { useEffect, useRef, type ReactNode } from "react";

export default function PilotSalePanel({
  children,
  count,
  total,
}: {
  children: ReactNode;
  count: number;
  total: string;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (count === 0 && matchMedia("(max-width: 760px)").matches)
      panel.current?.close();
  }, [count]);
  useEffect(() => {
    const mobile = matchMedia("(max-width: 760px)");
    const sync = () => {
      const dialog = panel.current;
      if (!dialog) return;
      if (dialog.open) dialog.close();
      if (!mobile.matches) dialog.setAttribute("open", "");
    };
    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (matchMedia("(max-width: 760px)").matches) {
          dialog.style.removeProperty("--pos-panel-height");
          return;
        }
        const top = Math.max(16, dialog.getBoundingClientRect().top);
        dialog.style.setProperty(
          "--pos-panel-height",
          `${Math.max(160, window.innerHeight - top - 16)}px`,
        );
      });
    };
    const observer = new ResizeObserver(fit);
    const workspace = dialog.closest("main");
    if (workspace) observer.observe(workspace);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
    };
  }, [count, total]);
  return (
    <>
      {count > 0 && (
        <button
          ref={trigger}
          type="button"
          className="mobile-sale-bar"
          aria-label={`Ver carrito: ${count} ${count === 1 ? "producto" : "productos"}, ${total}`}
          aria-haspopup="dialog"
          onClick={() => panel.current?.showModal()}
        >
          <span>
            {count} {count === 1 ? "producto" : "productos"}
            <strong>{total}</strong>
          </span>
          <span>Ver carrito</span>
        </button>
      )}
      <dialog
        ref={panel}
        className="pilot-sale-panel"
        aria-labelledby="cart-title"
        onClose={() => {
          if (matchMedia("(max-width: 760px)").matches)
            if (trigger.current) trigger.current.focus();
            else
              (
                document.querySelector<HTMLElement>(".pos-confirmation") ??
                document.getElementById("catalog-title")
              )?.focus();
        }}
      >
        <button
          type="button"
          className="ghost sale-panel-close"
          aria-label="Cerrar venta actual"
          onClick={() => panel.current?.close()}
        >
          Cerrar
        </button>
        {children}
      </dialog>
    </>
  );
}
