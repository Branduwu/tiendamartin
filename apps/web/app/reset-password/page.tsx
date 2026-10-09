import PasswordForm from "../components/password-form";
export const dynamic = "force-dynamic";
export default function ResetPasswordPage() {
  return (
    <main className="login">
      <p className="brand">SmartRetail</p>
      <h1>Nueva contraseña</h1>
      <p className="muted">
        Guarda una nueva contraseña para recuperar tu cuenta.
      </p>
      <PasswordForm mode="reset" />
    </main>
  );
}
