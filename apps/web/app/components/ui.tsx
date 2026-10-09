import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({
  variant = "primary",
  busy = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={variant === "primary" ? undefined : variant}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
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
