import { AI_PAUSED_CODE, AI_PAUSED_MESSAGE, aiPausedMessage } from '@trainingai/shared/ai-paused-notice';
import { reportError } from '../../../core/reporting/index.ts';
import { REFRESH_TOKEN_RE } from '@trainingai/shared/auth/refresh-token';

export class ApiError extends Error {
  status: number;
  code?: string;
  /** Set only for the AI-paused 503: the fixed sentence a screen may show as it is. */
  notice?: string;
  /** The `/api/` path that failed, when the client made the request. */
  path?: string;
  constructor(status: number, code?: string, notice?: string, path?: string) {
    super(`TrainingAi request failed (${status}).`);
    this.status = status;
    this.code = code;
    this.notice = notice;
    this.path = path;
  }
}
/**
 * The error for a failed response whose body (already parsed, or null) may be the paused notice.
 * Only the fixed sentence is kept, never the body's own text.
 */
function failedRequest(path: string, status: number, body: unknown, code?: string) {
  return aiPausedMessage(status, body) === null
    ? new ApiError(status, code, undefined, path)
    : new ApiError(status, AI_PAUSED_CODE, AI_PAUSED_MESSAGE, path);
}
/** The paused sentence for an AI failure, else the caller's own line. Never any other server text. */
export function aiFailureText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.notice) return error.notice;
  // A Coach reply that fails after the stream opened arrives as an error part holding the sentence.
  if (error instanceof Error && error.message === AI_PAUSED_MESSAGE) return AI_PAUSED_MESSAGE;
  return fallback;
}
export function backendOrigin(baseUrl: string): string {
  const base = new URL(baseUrl);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  ) {
    throw new Error(
      'Configure an HTTPS backend origin without credentials, paths, queries or fragments.',
    );
  }
  return base.origin;
}

export type AccountProfile = {
  id: string;
  email: string;
  name: string | null;
  timezone: string | null;
  signInProviders: ('apple' | 'google')[];
};
export type SessionToken = {
  accessToken: string;
  expiresAt: number;
  /** Absent on sessions saved before #2076; those last until `expiresAt` and cannot renew. */
  refreshToken?: string;
  refreshExpiresAt?: number;
};
export { REFRESH_TOKEN_RE };

/**
 * `renew` is asked for a new access token after a 401 on the token it is given. The request is
 * sent again once with what it returns; null, the same token or a second 401 ends it.
 */
export function createApiClient(
  baseUrl: string,
  getToken: () => Promise<string | null>,
  fetcher?: typeof fetch,
  renew?: (stale: string) => Promise<string | null>,
) {
  const base = backendOrigin(baseUrl);
  async function request(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: unknown,
    authenticated = method === 'GET',
    query?: Record<string, string>,
    format: 'json' | 'ndjson' = 'json',
    write?: (bytes: Uint8Array) => Promise<void>,
  ): Promise<unknown> {
    if (!/^\/api\/[a-zA-Z0-9/_-]+$/.test(path)) {
      throw new Error('Expected a relative /api/ path.');
    }
    const token = authenticated ? await getToken() : null;
    if (authenticated && !token) {
      throw new Error('Sign in before contacting TrainingAi.');
    }
    const controller = new AbortController();
    const slow = [
      '/api/nutrition/scan',
      '/api/nutrition/meal-plans/generate',
      '/api/daily-digest',
      '/api/session-explain/insight',
      '/api/nutrition-goals/recommend',
      '/api/generate-program',
      '/api/builder-chat',
      '/api/exercises/generate',
      '/api/workout-review/session/',
      '/api/ai-periodization/session/',
      // The admin data jobs read and rewrite history in one request; a client timeout would read as
      // a failure while the server went on to commit.
      '/api/admin/backfill-',
      '/api/admin/rederive-',
      '/api/admin/reencode-',
      '/api/admin/recompute-',
    ].some((prefix) => path.startsWith(prefix));
    const timeout = setTimeout(
      () => controller.abort(),
      path === '/api/export' ? 120000 : slow ? 65_000 : 15_000,
    );
    try {
      const url = new URL(path, base);
      if (query) {
        url.search = new URLSearchParams(query).toString();
      }
      const send = (bearer: string | null) =>
        (fetcher ?? fetch)(url, {
          method,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          headers: {
            Accept:
              path === '/api/session-explain/insight'
                ? 'text/plain'
                : format === 'ndjson'
                  ? 'application/x-ndjson'
                  : 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      let response = await send(token);
      if (response.status === 401 && token && renew) {
        const fresh = await renew(token);
        if (fresh && fresh !== token) {
          await response.body?.cancel().catch(() => {});
          response = await send(fresh);
        }
      }
      if (!response.ok) {
        let code: string | undefined;
        let value: { error?: unknown } | null = null;
        if (response.headers.get('content-type')?.includes('application/json')) {
          value = (await response.json().catch(() => null)) as { error?: unknown } | null;
          if (typeof value?.error === 'string' && /^[a-z_]{1,64}$/.test(value.error)) {
            code = value.error;
          }
        }
        throw failedRequest(path, response.status, value, code);
      }
      if (path === '/api/session-explain/insight') {
        if (!response.headers.get('content-type')?.includes('text/plain'))
          throw new Error('The workout insight is unavailable.');
        const text = await response.text();
        if (text.includes('[[AI_STREAM_ERROR]]'))
          throw new Error('The workout insight was cut short. Try again.');
        return text;
      }
      if (response.status === 204 && format === 'json') {
        return undefined;
      }
      if (format === 'ndjson') {
        if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
          throw new Error('Expected a data export from TrainingAi.');
        }
        if (!write || !response.body) {
          throw new Error('Streaming export is unavailable.');
        }
        const reader = response.body.getReader();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) {
              break;
            }
            await write(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        return;
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Expected JSON from TrainingAi.');
      }
      return await response.json();
    } catch (error) {
      // Every screen's server faults pass here, so they are reported once, with their path. The
      // reporter skips offline, auth and other expected failures, and its own intake.
      if (path !== '/api/client-error') reportError(error, { apiPath: path });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    async coachStream(body: unknown, signal?: AbortSignal | null): Promise<Response> {
      const token = await getToken();
      if (!token) {
        throw new Error('Sign in before contacting TrainingAi.');
      }
      const send = (bearer: string) =>
        (fetcher ?? fetch)(new URL('/api/coach', base), {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      let response = await send(token);
      if (response.status === 401 && renew) {
        const fresh = await renew(token);
        if (fresh && fresh !== token) {
          await response.body?.cancel().catch(() => {});
          response = await send(fresh);
        }
      }
      if (!response.ok) {
        throw failedRequest('/api/coach', response.status, await response.json().catch(() => null));
      }
      if (
        !response.headers.get('content-type')?.includes('text/event-stream') ||
        !response.body
      ) {
        throw new Error('Coach could not start a reply. Please retry.');
      }
      return response;
    },
    async streamExport(write: (bytes: Uint8Array) => Promise<void>) {
      await request('/api/export', 'GET', undefined, true, undefined, 'ndjson', write);
    },
    get(path: string, query?: Record<string, string>) {
      return request(path, 'GET', undefined, true, query);
    },
    post(path: string, body: unknown, query?: Record<string, string>) {
      return request(path, 'POST', body, true, query);
    },
    put(path: string, body: unknown) {
      return request(path, 'PUT', body, true);
    },
    patch(path: string, body: unknown) {
      return request(path, 'PATCH', body, true);
    },
    delete(path: string, body: unknown, query?: Record<string, string>) {
      return request(path, 'DELETE', body, true, query);
    },
    async media(source: string): Promise<string> {
      const url = new URL(source, base);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Invalid exercise media URL.');
      }
      const own = url.origin === base;
      if (own && url.pathname.startsWith('/exercise-media/')) {
        url.pathname = `/api${url.pathname}`;
      }
      if (own && !url.pathname.startsWith('/api/exercise-media/')) {
        throw new Error('Invalid exercise media path.');
      }
      const token = own ? await getToken() : null;
      if (own && !token) {
        throw new Error('Sign in before loading exercise media.');
      }
      const send = (bearer: string | null) =>
        fetch(url, {
          credentials: 'omit',
          redirect: 'error',
          headers: { Accept: 'image/*', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
          signal: AbortSignal.timeout(20_000),
        });
      let response = await send(token);
      if (response.status === 401 && token && renew) {
        const fresh = await renew(token);
        if (fresh && fresh !== token) {
          await response.body?.cancel().catch(() => {});
          response = await send(fresh);
        }
      }
      if (!response.ok) {
        throw new ApiError(response.status);
      }
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!type || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) {
        throw new Error('Invalid exercise media response.');
      }
      const length = Number(response.headers.get('content-length'));
      if (length > 8 * 1024 * 1024) {
        throw new Error('Exercise media is too large.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) {
        throw new Error('Exercise media is too large.');
      }
      let binary = '';
      for (let index = 0; index < bytes.length; index += 16_384) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 16_384));
      }
      return `data:${type};base64,${btoa(binary)}`;
    },
    async exchange(token: string, verifier: string): Promise<SessionToken> {
      const value = (await request('/api/auth/exchange-mobile-token', 'POST', {
        token,
        verifier,
        responseType: 'token',
      })) as Record<string, unknown> | null;
      return sessionResponse(value);
    },
    /** Unauthenticated: the refresh token is the credential (#2076). */
    async refreshSession(refreshToken: string): Promise<SessionToken> {
      const value = (await request(
        '/api/auth/native-session/refresh',
        'POST',
        { refreshToken },
        false,
      )) as Record<string, unknown> | null;
      const token = sessionResponse(value);
      if (!token.refreshToken) {
        throw new Error('Invalid session response.');
      }
      return token;
    },
    async beginApple(link = false) {
      const value = (await request('/api/auth/apple/begin', 'POST', { link }, link)) as {
        attemptId?: unknown;
        nonce?: unknown;
      } | null;
      if (
        typeof value?.attemptId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.attemptId,
        ) ||
        typeof value.nonce !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.nonce)
      ) {
        throw new Error('Invalid Apple sign-in attempt.');
      }
      return { attemptId: value.attemptId, nonce: value.nonce };
    },
    async completeApple(
      attemptId: string,
      identityToken: string,
      name?: string,
      link = false,
    ): Promise<SessionToken> {
      const value = (await request(
        '/api/auth/apple/complete',
        'POST',
        { attemptId, identityToken, ...(name ? { name } : {}) },
        link,
      )) as Record<string, unknown> | null;
      return sessionResponse(value);
    },
    async profile(): Promise<AccountProfile> {
      const value = (await request('/api/user/profile', 'GET')) as {
        user?: Record<string, unknown>;
        signInProviders?: unknown;
      } | null;
      const user = value?.user;
      if (
        !user ||
        typeof user.id !== 'string' ||
        !user.id ||
        typeof user.email !== 'string' ||
        !user.email ||
        (user.name !== null && typeof user.name !== 'string') ||
        (user.timezone !== null && typeof user.timezone !== 'string')
      ) {
        throw new Error('Invalid account response.');
      }
      if (user.isActive === false) {
        throw new ApiError(403);
      }
      const signInProviders = Array.isArray(value?.signInProviders)
        ? value.signInProviders.filter(
            (x): x is 'apple' | 'google' => x === 'apple' || x === 'google',
          )
        : [];
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
        signInProviders,
      };
    },
  };
}

function sessionResponse(value: Record<string, unknown> | null): SessionToken {
  if (
    !value ||
    value.ok !== true ||
    value.tokenType !== 'Bearer' ||
    typeof value.accessToken !== 'string' ||
    !value.accessToken ||
    value.accessToken.length > 16_384 ||
    typeof value.expiresAt !== 'number' ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() / 1000
  ) {
    throw new Error('Invalid session response.');
  }
  if (value.refreshToken === undefined) {
    return { accessToken: value.accessToken, expiresAt: value.expiresAt };
  }
  if (
    typeof value.refreshToken !== 'string' ||
    !REFRESH_TOKEN_RE.test(value.refreshToken) ||
    typeof value.refreshExpiresAt !== 'number' ||
    !Number.isSafeInteger(value.refreshExpiresAt)
  ) {
    throw new Error('Invalid session response.');
  }
  return {
    accessToken: value.accessToken,
    expiresAt: value.expiresAt,
    refreshToken: value.refreshToken,
    refreshExpiresAt: value.refreshExpiresAt,
  };
}
