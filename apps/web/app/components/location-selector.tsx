"use client";
import { useId, useState } from "react";
import type { InventoryLocationDto } from "@smartretail/contracts";
import styles from "./settings-ux.module.css";
export default function LocationSelector({
  locations,
  selected,
  onChange,
  disabled = false,
}: {
  locations: InventoryLocationDto[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const visible = locations.filter((l) =>
    l.name
      .toLocaleLowerCase("es-MX")
      .includes(search.trim().toLocaleLowerCase("es-MX")),
  );
  return (
    <details className={styles.selector}>
      <summary
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (disabled && ["Enter", " "].includes(e.key)) e.preventDefault();
        }}
      >
        {selected.length} seleccionadas · Elegir sucursales
      </summary>
      <label htmlFor={searchId}>
        Buscar sucursal
        <input
          id={searchId}
          type="search"
          value={search}
          maxLength={100}
          disabled={disabled}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className={styles.choices}>
        {!locations.length ? (
          <p>No hay sucursales disponibles.</p>
        ) : !visible.length ? (
          <p role="status">
            No hay coincidencias. Prueba otro nombre o borra la búsqueda.
          </p>
        ) : (
          visible.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(l.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, l.id]
                      : selected.filter((id) => id !== l.id),
                  )
                }
              />
              <span>
                {l.name}
                {l.status === "inactive" ? " · Inactiva" : ""}
              </span>
            </label>
          ))
        )}
      </div>
      <p className="muted" role="status">
        {selected.length} de {locations.length} seleccionadas. La búsqueda no
        cambia tu selección.
      </p>
    </details>
  );
}
