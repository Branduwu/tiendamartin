"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
export default function MobileNavigation({
  children,
}: {
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  useEffect(() => {
    dialog.current?.close();
  }, [path]);
  useEffect(() => {
    const media = matchMedia("(min-width: 1100px)");
    const change = () => {
      if (media.matches) dialog.current?.close();
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return (
    <div className="mobile-navigation">
      <button
        ref={trigger}
        type="button"
        className="secondary"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        Menú
      </button>
      <dialog
        ref={dialog}
        className="navigation-dialog"
        aria-labelledby="mobile-menu-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
            ),
          ].filter((node) => node.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first && last) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === last &&
            first
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
        onClose={() => trigger.current?.focus()}
      >
        <div className="dialog-heading">
          <h2 id="mobile-menu-title">Tu espacio de trabajo</h2>
          <button
            type="button"
            className="ghost"
            onClick={() => dialog.current?.close()}
          >
            Cerrar menú
          </button>
        </div>
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) dialog.current?.close();
          }}
        >
          {children}
        </div>
      </dialog>
    </div>
  );
}
