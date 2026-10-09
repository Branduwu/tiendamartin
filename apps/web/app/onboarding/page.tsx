import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import OnboardingForm from "./onboarding-form";
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const actor = await verifiedUserId();
  if (!actor) redirect("/login");
  return (
    <main
      className="workspace"
      style={{ maxWidth: "46rem", overflowWrap: "anywhere" }}
    >
      <p className="brand">SmartRetail</p>
      <h1>Preparemos tu empresa</h1>
      <p className="muted">
        Cuatro pasos breves. Tus productos y ventas empezarán en blanco.
      </p>
      <OnboardingForm actor={actor} />
    </main>
  );
}
