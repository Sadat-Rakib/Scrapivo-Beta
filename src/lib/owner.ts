/**
 * Owner allowlist: unlimited searches, never quota-gated.
 * Configurable via OWNER_EMAILS env (comma-separated); confirmed owner by default.
 */
export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? "mirsadatbinrakib01@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && ownerEmails().includes(email.toLowerCase());
}
