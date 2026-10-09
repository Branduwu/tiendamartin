const key = "smartretail.invitation.pending";
// Short-lived browser handoff only; never persisted in a database or URL query.
export function saveInvitationToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new TypeError("Invalid invitation");
  sessionStorage.setItem(
    key,
    JSON.stringify({ token, expiresAt: Date.now() + 30 * 60 * 1000 }),
  );
}
export function clearInvitationToken() {
  sessionStorage.removeItem(key);
}
export function readInvitationToken(): string | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      value !== null &&
      typeof value === "object" &&
      "token" in value &&
      "expiresAt" in value &&
      typeof value.token === "string" &&
      /^[a-f0-9]{64}$/.test(value.token) &&
      typeof value.expiresAt === "number" &&
      value.expiresAt > Date.now() &&
      value.expiresAt <= Date.now() + 30 * 60 * 1000
    )
      return value.token;
  } catch {
    /* Invalid or expired handoffs are discarded. */
  }
  clearInvitationToken();
  return null;
}
