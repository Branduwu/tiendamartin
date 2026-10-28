"use client";
import { useRef } from "react";
import styles from "./settings-ux.module.css";
export default function SettingsSections({
  id,
  label,
  items,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  items: readonly { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className={styles.sections}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          className="secondary"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-selected={value === item.id}
          aria-controls={`${id}-panel-${item.id}`}
          tabIndex={value === item.id ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => {
            if (
              disabled ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
            )
              return;
            e.preventDefault();
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowRight" ? 1 : -1) + items.length) %
                    items.length;
            onChange(items[next]!.id);
            refs.current[next]?.focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
