import React from "react";
export default function Link({
  href,
  children,
  prefetch: _prefetch,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
const router = { replace: () => {}, refresh: () => {} };
export const useRouter = () => router;
export const usePathname = () => location.pathname;
export function AccountControls() {
  return (
    <details className="pilot-account-menu">
      <summary aria-label="Menú de usuario">
        Cuenta <span aria-hidden="true">⌄</span>
      </summary>
      <div className="shell-account">Propietario</div>
    </details>
  );
}
