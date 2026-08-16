// One-time token store for the Capacitor mobile OAuth flow.
// Tokens are short-lived (5 min) and consumed on first use.
// In-memory is fine — tokens only need to survive the seconds between
// the OAuth callback landing on the bridge page and the deep link firing.
//
// PKCE-style binding: the token also carries the SHA-256 challenge the
// WebView generated before opening the OAuth flow. exchange-mobile-token
// requires the caller to present the matching verifier, so an app that
// intercepts the trainingai:// deep link (and the token inside it) still
// can't redeem a session without the verifier, which never leaves the
// WebView's own localStorage.

interface TokenEntry {
  sessionCookieValue: string;
  challenge: string;
  expiresAt: number;
}

const tokens = new Map<string, TokenEntry>();

function pruneExpired() {
  const now = Date.now()
  for (const [k, v] of tokens) {
    if (v.expiresAt < now) tokens.delete(k)
  }
}

export function createMobileAuthToken(sessionCookieValue: string, challenge: string): string {
  pruneExpired()
  const token = crypto.randomUUID();
  tokens.set(token, { sessionCookieValue, challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

export function consumeMobileAuthToken(token: string): { sessionCookieValue: string; challenge: string } | null {
  pruneExpired()
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  if (Date.now() > entry.expiresAt) return null;
  return { sessionCookieValue: entry.sessionCookieValue, challenge: entry.challenge };
}
