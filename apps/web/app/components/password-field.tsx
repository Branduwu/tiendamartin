"use client";
import { useState } from "react";
export default function PasswordField({
  name,
  label,
  current = false,
  invalid = false,
}: {
  name: string;
  label: string;
  current?: boolean;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="stack">
      <label>
        {label}
        <input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={current ? "current-password" : "new-password"}
          minLength={current ? undefined : 8}
          maxLength={current ? 1024 : 128}
          required
          aria-describedby={
            invalid
              ? "password-requirements confirmation-error"
              : current
                ? undefined
                : "password-requirements"
          }
          aria-invalid={invalid || undefined}
        />
      </label>
      <button
        type="button"
        className="ghost"
        aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? "Ocultar" : "Mostrar"} contraseña
      </button>
    </div>
  );
}
