import PasswordForm from "../../components/password-form";
import styles from "./profile-panel.module.css";

export default function AccountSecurity() {
  return (
    <section
      id="account-security"
      className={`panel ${styles.security}`}
      aria-labelledby="security-title"
    >
      <div className={styles.securityHeading}>
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6z" />
          <path d="m8 12 3 3 5-6" />
        </svg>
        <div>
          <h2 id="security-title">Seguridad</h2>
          <p className="muted">Administra la protección de tu acceso.</p>
        </div>
      </div>
      <details className={styles.passwordChange}>
        <summary>Cambiar contraseña</summary>
        <div className={styles.passwordBody}>
          <p className="muted">
            Al guardar tendrás que iniciar sesión de nuevo. Tus permisos se
            conservan.
          </p>
          <PasswordForm mode="change" />
        </div>
      </details>
      <div className={styles.future}>
        <div>
          <h3>Verificación en dos pasos</h3>
          <p className="muted">Esta opción aún no está disponible.</p>
        </div>
        <span className="badge">Próximamente</span>
      </div>
    </section>
  );
}
