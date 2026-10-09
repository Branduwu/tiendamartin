"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from "react";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "compact" | "standard" | "touch" | "pos";
  busy?: boolean;
  busyLabel?: string;
};
export function Button({
  variant = "primary",
  size = "standard",
  busy = false,
  busyLabel = "Procesando…",
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`ui-button ${variant} size-${size} ${className}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      <LoadingLabel busy={busy} label={busyLabel}>
        {children}
      </LoadingLabel>
      {busy && <span className="button-progress" aria-hidden="true" />}
    </button>
  );
}
export function LoadingLabel({
  busy,
  label,
  children,
}: {
  busy: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="stable-button-label">
      <span
        aria-hidden={busy}
        style={{ visibility: busy ? "hidden" : "visible" }}
      >
        {children}
      </span>
      <span
        aria-hidden={!busy}
        style={{ visibility: busy ? "visible" : "hidden" }}
      >
        {label}
      </span>
    </span>
  );
}
export function IconButton({
  label,
  ...props
}: Omit<ButtonProps, "aria-label"> & { label: string }) {
  return (
    <Button
      {...props}
      aria-label={label}
      className={`icon-button ${props.className ?? ""}`}
    />
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} />;
}
export function Field({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        ...(helper || error ? { "aria-describedby": `${id}-help` } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      {(error || helper) && (
        <p
          id={`${id}-help`}
          className={error ? "field-error" : "field-help"}
          role={error ? "alert" : undefined}
        >
          {error || helper}
        </p>
      )}
    </div>
  );
}
export function Card({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={`card ${className}`}>
      {children}
    </section>
  );
}
export const Section = Card;
export function Badge({
  children,
  state = "neutral",
}: {
  children: ReactNode;
  state?: "neutral" | "active" | "warning";
}) {
  return <span className={`badge ${state}`}>{children}</span>;
}
export function Table({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="table-wrap">
      <table aria-label={label}>{children}</table>
    </div>
  );
}
export function List({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <ul className="ui-list" aria-label={label}>
      {children}
    </ul>
  );
}
export function ActionMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details
      className="action-menu"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.open = false;
          e.currentTarget.querySelector("summary")?.focus();
        }
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) {
          e.currentTarget.open = false;
          e.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label}>⋯</summary>
      <div className="action-menu-items">{children}</div>
    </details>
  );
}
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby={id}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <IconButton
          label="Cerrar diálogo"
          variant="ghost"
          onClick={() => ref.current?.close()}
        >
          ×
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Toast({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p className={error ? "error" : "notice"} role={error ? "alert" : "status"}>
      {children}
    </p>
  );
}
export function ContextHelp({
  label,
  children,
  href,
  keepPage = false,
}: {
  label: string;
  children: ReactNode;
  href?: string;
  keepPage?: boolean;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    suppressFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const close = (restore = false) => {
    suppressFocus.current = true;
    dialog.current?.close();
    setOpen(false);
    if (restore) {
      button.current?.focus();
    }
    queueMicrotask(() => {
      suppressFocus.current = false;
    });
  };
  const show = (modal = false) => {
    clearTimeout(timer.current);
    const d = dialog.current,
      b = button.current;
    if (!d || !b || d.open) return;
    if (modal && window.matchMedia("(max-width: 640px)").matches) d.showModal();
    else {
      const r = b.getBoundingClientRect();
      d.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 240)}px`;
      d.style.left = `${Math.max(16, Math.min(r.left, window.innerWidth - 336))}px`;
      // Declarative non-modal opening preserves focus during hover/focus help.
      d.open = true;
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const node = e.target as Node;
      if (!dialog.current?.contains(node) && !button.current?.contains(node))
        close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span
      className="context-help"
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover)").matches) show();
      }}
      onMouseLeave={() => {
        timer.current = setTimeout(() => {
          if (
            !dialog.current?.contains(document.activeElement) &&
            document.activeElement !== button.current
          )
            close();
        }, 180);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={button}
        type="button"
        className="context-help-trigger"
        aria-label={`Ayuda: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onFocus={() => {
          if (
            !suppressFocus.current &&
            window.matchMedia("(hover: hover)").matches
          )
            show();
        }}
        onClick={() => {
          if (
            dialog.current?.open &&
            window.matchMedia("(max-width: 640px)").matches
          )
            close(true);
          else show(true);
        }}
      >
        ?
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="context-help-content"
        aria-labelledby={`${id}-title`}
        onCancel={(e) => {
          e.preventDefault();
          close(true);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <strong id={`${id}-title`}>{label}</strong>
          <button
            type="button"
            className="ghost"
            aria-label="Cerrar ayuda"
            onClick={() => close(true)}
          >
            ×
          </button>
        </div>
        <p>{children}</p>
        {href && (
          <a
            href={href}
            target={keepPage ? "_blank" : undefined}
            rel={keepPage ? "noopener noreferrer" : undefined}
          >
            Más información{keepPage && " (abre otra pestaña)"}
          </a>
        )}
      </dialog>
    </span>
  );
}
export function PageHeader({ children }: { children: ReactNode }) {
  return <div className="heading">{children}</div>;
}
export function EmptyState({
  title,
  children,
  action,
  helpHref,
  keepPage = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  helpHref?: string;
  keepPage?: boolean;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
      {helpHref && (
        <a
          href={helpHref}
          target={keepPage ? "_blank" : undefined}
          rel={keepPage ? "noopener noreferrer" : undefined}
        >
          Cómo hacerlo{keepPage && " (abre otra pestaña)"}
        </a>
      )}
    </div>
  );
}
