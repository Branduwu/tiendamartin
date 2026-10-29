"use client";
import {
  useSyncExternalStore,
  type FormEventHandler,
  type ReactNode,
} from "react";
import styles from "./credential-form.module.css";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Native fallback must never serialize credentials into a GET URL. */
export default function CredentialForm({
  action,
  onSubmit,
  children,
  busy,
  describedBy,
}: {
  action:
    | "/login"
    | "/register"
    | "/forgot-password"
    | "/reset-password"
    | "/settings/account";
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  busy?: boolean;
  describedBy?: string | undefined;
}) {
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  return (
    <form
      method="post"
      action={action}
      className="stack"
      aria-busy={busy}
      aria-describedby={describedBy}
      onSubmit={(event) => {
        event.preventDefault();
        if (hydrated) onSubmit(event);
      }}
    >
      <fieldset disabled={!hydrated} className={`stack ${styles.fields}`}>
        {children}
      </fieldset>
      <noscript>
        <p role="status">
          Activa JavaScript y vuelve a cargar la página para continuar de forma
          segura.
        </p>
      </noscript>
    </form>
  );
}
