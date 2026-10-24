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
const mock = (operation: string, ...args: unknown[]) =>
  (
    window as typeof window & {
      sdkMock: (
        operation: string,
        args: unknown[],
      ) => Promise<{ data: { session: null }; error: null }>;
    }
  ).sdkMock(operation, args);
export const browserAuth = () => ({
  auth: {
    signInWithPassword: (value: unknown) => mock("login", value),
    resetPasswordForEmail: (email: string, options: unknown) =>
      mock("recover", email, options),
    resend: (value: unknown) => mock("resend", value),
    signUp: (value: unknown) => mock("signup", value),
    signOut: (options: unknown) => mock("logout", options),
  },
});
