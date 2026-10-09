interface TokenEntry {
  sessionCookieValue: string;
  challenge: string;
  expiresAt: number;
}

const processStore = globalThis as typeof globalThis & { trainingAiMobileAuthTokens?: Map<string, TokenEntry> };
const tokens = processStore.trainingAiMobileAuthTokens ??= new Map<string, TokenEntry>();
const TOKEN_LIFETIME_MS = 5 * 60 * 1000;

function pruneExpired() {
  const now = Date.now()
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) {
      tokens.delete(token);
    }
  }
}

export function createMobileAuthToken(sessionCookieValue: string, challenge: string): string {
  pruneExpired()
  const token = crypto.randomUUID();
  tokens.set(token, { sessionCookieValue, challenge, expiresAt: Date.now() + TOKEN_LIFETIME_MS });
  return token;
}

export function consumeMobileAuthToken(token: string): { sessionCookieValue: string; challenge: string } | null {
  pruneExpired()
  const entry = tokens.get(token);
  if (!entry) {
    return null;
  }
  tokens.delete(token);
  if (Date.now() > entry.expiresAt) {
    return null;
  }
  return { sessionCookieValue: entry.sessionCookieValue, challenge: entry.challenge };
}
