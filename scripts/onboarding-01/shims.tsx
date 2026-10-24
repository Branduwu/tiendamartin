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
const router = {
  replace: (url: string) =>
    window.dispatchEvent(new CustomEvent("test-navigation", { detail: url })),
  refresh: () => {},
};
export const useRouter = () => router;
