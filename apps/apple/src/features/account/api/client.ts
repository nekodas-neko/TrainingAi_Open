export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string) {
    super(`TrainingAi request failed (${status}).`);
    this.status = status; this.code = code;
  }
}
export function backendOrigin(baseUrl: string): string {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('Configure an HTTPS backend origin without credentials, paths, queries or fragments.');
  }
  return base.origin;
}

export type AccountProfile = { id: string; email: string; name: string | null; timezone: string | null; signInProviders: ('apple' | 'google')[] };
export type SessionToken = { accessToken: string; expiresAt: number };

export function createApiClient(baseUrl: string, getToken: () => Promise<string | null>) {
  const base = backendOrigin(baseUrl);
  async function request(path: string, method: 'GET' | 'POST', body?: unknown, authenticated = method === 'GET'): Promise<unknown> {
    if (!/^\/api\/[a-zA-Z0-9/_-]+$/.test(path)) {
      throw new Error('Expected a relative /api/ path.');
    }
    const token = authenticated ? await getToken() : null;
    if (authenticated && !token) { throw new Error('Sign in before contacting TrainingAi.'); }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(new URL(path, base), {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      if (!response.ok) {
        let code: string | undefined;
        if (response.headers.get('content-type')?.includes('application/json')) {
          const value = await response.json().catch(() => null) as { error?: unknown } | null;
          if (typeof value?.error === 'string' && /^[a-z_]{1,64}$/.test(value.error)) { code = value.error; }
        }
        throw new ApiError(response.status, code);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Expected JSON from TrainingAi.');
      }
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  return {
    get(path: string) { return request(path, 'GET'); },
    async exchange(token: string, verifier: string): Promise<SessionToken> {
      const value = await request('/api/auth/exchange-mobile-token', 'POST', { token, verifier, responseType: 'token' }) as Record<string, unknown> | null;
      return sessionResponse(value);
    },
    async beginApple(link = false) {
      const value = await request('/api/auth/apple/begin', 'POST', { link }, link) as { attemptId?: unknown; nonce?: unknown } | null;
      if (typeof value?.attemptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.attemptId)
        || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce)) {
        throw new Error('Invalid Apple sign-in attempt.');
      }
      return { attemptId: value.attemptId, nonce: value.nonce };
    },
    async completeApple(attemptId: string, identityToken: string, name?: string, link = false): Promise<SessionToken> {
      const value = await request('/api/auth/apple/complete', 'POST', { attemptId, identityToken, ...(name ? { name } : {}) }, link) as Record<string, unknown> | null;
      return sessionResponse(value);
    },
    async profile(): Promise<AccountProfile> {
      const value = await request('/api/user/profile', 'GET') as { user?: Record<string, unknown>; signInProviders?: unknown } | null;
      const user = value?.user;
      if (!user || typeof user.id !== 'string' || !user.id || typeof user.email !== 'string' || !user.email
        || (user.name !== null && typeof user.name !== 'string')
        || (user.timezone !== null && typeof user.timezone !== 'string')) {
        throw new Error('Invalid account response.');
      }
      if (user.isActive === false) { throw new ApiError(403); }
      const signInProviders = Array.isArray(value?.signInProviders) ? value.signInProviders.filter((x): x is 'apple' | 'google' => x === 'apple' || x === 'google') : [];
      return { id: user.id, email: user.email, name: user.name, timezone: user.timezone, signInProviders };
    },
  };
}

function sessionResponse(value: Record<string, unknown> | null): SessionToken {
  if (!value || value.ok !== true || value.tokenType !== 'Bearer' || typeof value.accessToken !== 'string'
    || !value.accessToken || value.accessToken.length > 16_384 || typeof value.expiresAt !== 'number'
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() / 1000) {
    throw new Error('Invalid session response.');
  }
  return { accessToken: value.accessToken, expiresAt: value.expiresAt };
}
