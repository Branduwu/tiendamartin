"use client";
export default function PrintButton() {
  return (
    <button className="no-print" onClick={() => window.print()}>
      Imprimir ticket
    </button>
  );
}
