import React from "react";
export const useRouter = () => ({ replace() {}, refresh() {} });
export const companyLabel = () => "Empresa ficticia";
export const browserAuth = () => ({
  auth: { signOut: async () => ({ error: null }) },
});
export default function Stub({
  children,
  href,
}: {
  children?: React.ReactNode;
  href?: string;
}) {
  return href ? <a href={href}>{children}</a> : <div>{children}</div>;
}
export const ActionMenu = Stub;
export const ContextHelp = Stub;
