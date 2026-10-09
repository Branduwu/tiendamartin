"use client";
import {
  useEffect,
  useId,
  useRef,
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
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <details
      className="context-help"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.open = false;
          e.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={`Ayuda: ${label}`} aria-describedby={id}>
        ?
      </summary>
      <span id={id} className="context-help-content">
        {children}
      </span>
    </details>
  );
}
export function PageHeader({ children }: { children: ReactNode }) {
  return <div className="heading">{children}</div>;
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
