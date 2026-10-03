const labels = {
  normal: "Normal",
  low: "Stock bajo",
  out: "Agotado",
  unconfigured: "Sin mínimo",
};

export default function InventoryStateBadge({
  state,
}: {
  state?: keyof typeof labels | undefined;
}) {
  return (
    <span className={`badge${state === "normal" ? " active" : ""}`}>
      {labels[state ?? "unconfigured"]}
    </span>
  );
}
