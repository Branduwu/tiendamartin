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
  return (
    <>
      {count > 0 && (
        <button
          ref={trigger}
          type="button"
          className="mobile-sale-bar"
          onClick={() => panel.current?.showModal()}
        >
          <span>
            {count} {count === 1 ? "producto" : "productos"}
            <strong>{total}</strong>
          </span>
          <span>Ver venta</span>
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
