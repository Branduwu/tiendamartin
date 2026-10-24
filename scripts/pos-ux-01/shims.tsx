import React from "react";
const router = { replace() {}, refresh() {} };
export const useRouter = () => router;
export const companyLabel = () => "Empresa ficticia";
export const useProductPhotos = () => ({});
export const ProductThumbnail = () => null;
export function ContextHelp({ children }: { children?: React.ReactNode }) {
  return <small>{children}</small>;
}
type StubProps = {
  children?: React.ReactNode;
  href?: string;
  className?: string;
};
export default function Stub(props: StubProps | (() => unknown)) {
  if (typeof props === "function") return () => null;
  if (props.href)
    return (
      <a href={props.href} className={props.className}>
        {props.children}
      </a>
    );
  return <>{props.children}</>;
}
