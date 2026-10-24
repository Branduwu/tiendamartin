import React from "react";
export default function Link({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
const router = { push: () => {}, replace: () => {}, refresh: () => {} };
export const useRouter = () => router;
export const companyLabel = () => "Empresa ficticia";
export function Navigation({ blocked }: { blocked: boolean }) {
  return (
    <nav aria-label="Navegación">
      {blocked ? (
        <span aria-disabled="true">Navegación bloqueada durante edición</span>
      ) : (
        <a href="/inventory">Inventario</a>
      )}
    </nav>
  );
}
export function Image({
  src,
  alt,
  width,
  height,
  onError,
  className,
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      onError={onError}
      className={className}
    />
  );
}
export const browserAuth = () => ({
  auth: { signOut: async () => ({ error: null }) },
});
export const dynamic = () => () => null;
