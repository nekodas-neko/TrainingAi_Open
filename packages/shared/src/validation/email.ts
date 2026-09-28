/**
 * The one normal form for an email address, applied on the way IN to storage and to every lookup
 * (LA-61, owner-approved 2026-09-28). Registration already wrote this form, but the Google path
 * looked up and upserted the provider's raw value, so a case difference could create a second
 * account or miss an invite. Google lowercases in practice, which is why it never fired; that is a
 * property of someone else's service, not of this code.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
