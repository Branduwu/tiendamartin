import { verifiedUserId } from "../../lib/auth";
import InviteForm from "./invite-form";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };
export default async function InvitePage() {
  return (
    <main className="login" style={{ overflowWrap: "anywhere" }}>
      <p className="brand">SmartRetail</p>
      <h1>Únete a tu empresa</h1>
      <p className="muted">
        Acepta con la cuenta del correo que recibió la invitación.
      </p>
      <InviteForm authenticated={!!(await verifiedUserId())} />
    </main>
  );
}
