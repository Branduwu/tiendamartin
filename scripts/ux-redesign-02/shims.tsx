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
export const redirect = () => {
  throw new Error("Unexpected redirect in authenticated fixture");
};
export const browserAuth = () => ({
  auth: { signOut: async () => ({ error: null }) },
});
