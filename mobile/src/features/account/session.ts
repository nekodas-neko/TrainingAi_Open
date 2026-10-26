import { ApiError, backendOrigin, createApiClient, REFRESH_TOKEN_RE } from './api/client.ts';
import type { AccountProfile, SessionToken } from './api/client.ts';
import { failureNotice } from '../../core/reporting/index.ts';
import {
  DEVICE_RECORD_KEY,
  epochHeader,
  parseDeviceRecord,
  reconcileDevice,
  type DeviceRecord,
} from './device-record.ts';

export const AUTH_CALLBACK = 'com.fitnessai.training:/auth/callback';
export const MOBILE_CALLBACKS = {
  ios: AUTH_CALLBACK,
  android: 'com.trainingai.app:/auth/callback',
  'android-dev': 'com.trainingai.app.dev:/auth/callback',
  'android-preview': 'com.trainingai.app.preview:/auth/callback',
} as const;
export type MobileClient = keyof typeof MOBILE_CALLBACKS;
const SESSION_KEY = 'fitnessai.session.v1';
const PENDING_KEY = 'fitnessai.pending.v1';
const TRANSACTION_AGE = 10 * 60 * 1000;
/** How long a browser sign-in may sit without a callback before a new tap replaces it. */
export const STUCK_ATTEMPT_GRACE = 90 * 1000;
/** How long to wait for the callback after the app returns to the foreground mid sign-in. */
export const FOREGROUND_CALLBACK_WAIT = 2 * 1000;
const RANDOM_RE = /^[A-Za-z0-9_-]{43}$/;
/** Renew this long before the one-day access token runs out (#2076). */
const RENEW_BEFORE_SECONDS = 5 * 60;
/** After a renewal that could not reach the server, wait this long before renewing early again. */
const RENEW_BACKOFF_MS = 30_000;
/** How a renewal ended. `transient` holds the error when the server could not be reached or was
 *  busy; the session is kept and a caller that needed the new token sees that error. */
type Renewal = { transient?: unknown };
const nowSeconds = () => Date.now() / 1000;
type SavedSession = SessionToken & {
  origin: string;
  userId: string | null;
  timezone?: string | null;
};
export type AccountReader = {
  origin: string;
  userId: string;
  get(path: string, query?: Record<string, string>): Promise<unknown>;
};
export type AccountConnection = AccountReader & {
  coachStream?(body: unknown, signal?: AbortSignal | null): Promise<Response>;
  streamExport?(write: (bytes: Uint8Array) => Promise<void>): Promise<void>;
  readonly timezone: string | null;
  post(path: string, body: unknown): Promise<unknown>;
  put?(path: string, body: unknown): Promise<unknown>;
  patch?(path: string, body: unknown): Promise<unknown>;
  delete?(path: string, body: unknown, query?: Record<string, string>): Promise<unknown>;
  media?(source: string): Promise<string>;
};
type Pending = { origin: string; verifier: string; state: string; createdAt: number };
export type AccountState = {
  status: 'loading' | 'signedOut' | 'signingIn' | 'checking' | 'signedIn' | 'storageError';
  profile: AccountProfile | null;
  hasSession: boolean;
  expiresAt: number | null;
  message: string | null;
  /** A browser sign-in has waited past the grace period, so the sign-in button may replace it. */
  attemptStale: boolean;
};
/**
 * "Retry account check" is for a saved session whose account could not be read: no profile yet, or
 * a check that failed and left a message. A signed-in account with its profile and no problem has
 * nothing to retry, so the button would only be noise.
 */
export function canRetryAccountCheck(
  state: Pick<AccountState, 'hasSession' | 'profile' | 'message'>,
): boolean {
  return state.hasSession && (state.profile === null || state.message !== null);
}
export type AuthPlatform = {
  client?: MobileClient;
  fetch?: typeof fetch;
  revokeSession?(origin: string, accessToken: string, refreshToken?: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  random(): Promise<string>;
  challenge(verifier: string): Promise<string>;
  open(url: string): Promise<{ type: string; url?: string }>;
  appleSignIn?(
    nonce: string,
    state: string,
  ): Promise<{ identityToken: string; state: string | null; name?: string }>;
  dismiss(): void;
  /**
   * Removes what the phone keeps for an account outside the session, such as the home-screen
   * widget snapshot (#3279). Called whenever no account is signed in any more.
   */
  clearAccountData?(): void;
  /**
   * #3369. Wipes what the phone keeps in its local database for an account, queued writes included
   * (a user id), or for every account (null). Without it the phone cannot honour an admin reset, so
   * the session does not try.
   */
  wipeAccountData?(origin: string, userId: string | null): Promise<void>;
  holdsOtherAccountData?(origin: string, userId: string): Promise<boolean>;
};
const RESET_MESSAGE = 'Your account data was reset. Sign in again to start fresh.';

export function parseAuthCallback(
  raw: string,
  pending: Pending,
  callback: string = AUTH_CALLBACK,
): { token: string } | { error: string } {
  const url = new URL(raw);
  if (
    `${url.protocol}${url.pathname}` !== callback ||
    url.host ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll('state').length !== 1 ||
    url.searchParams.get('state') !== pending.state ||
    [...url.searchParams.keys()].some((key) => !['state', 'token', 'error'].includes(key))
  ) {
    throw new Error('Invalid sign-in return.');
  }
  const token = url.searchParams.get('token');
  const error = url.searchParams.get('error');
  if (
    token &&
    !error &&
    url.searchParams.getAll('token').length === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
  ) {
    return { token };
  }
  if (
    error &&
    !token &&
    url.searchParams.getAll('error').length === 1 &&
    ['account_pending', 'authentication_failed'].includes(error)
  ) {
    return { error };
  }
  throw new Error('Invalid sign-in return.');
}

export class AccountSession {
  private origin: string;
  private session: SavedSession | null = null;
  private pending: Pending | null = null;
  private generation = 0;
  private browserTimeout: ReturnType<typeof setTimeout> | null = null;
  private staleTimeout: ReturnType<typeof setTimeout> | null = null;
  private returnTimeout: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(state: AccountState) => void>();
  private current: AccountState = {
    status: 'loading',
    profile: null,
    hasSession: false,
    expiresAt: null,
    message: null,
    attemptStale: false,
  };
  private api: ReturnType<typeof createApiClient>;
  private platform: AuthPlatform;
  readonly callback: string;
  private client: MobileClient;
  private events: { at: string; event: string; httpStatus?: number }[] = [];
  private reader: AccountConnection | null = null;
  private profileRequest: { generation: number; promise: Promise<void> } | null = null;
  private renewal: Promise<Renewal> | null = null;
  private renewBackoffUntil = 0;
  /** #3369: the account this phone's data belongs to and the admin reset it has wiped for. */
  private device: DeviceRecord | null = null;
  private staleRun: Promise<void> | null = null;
  constructor(origin: string, platform: AuthPlatform) {
    this.platform = platform;
    this.client = platform.client ?? 'ios';
    this.callback = MOBILE_CALLBACKS[this.client];
    this.origin = backendOrigin(origin);
    this.api = createApiClient(
      this.origin,
      () => this.accessToken(),
      platform.fetch,
      (stale) => this.renewedToken(stale),
      this.epochOptions(),
    );
  }
  private epochOptions() {
    return {
      dataEpoch: () => epochHeader(this.device, this.origin, this.session?.userId ?? null),
      onDataEpochStale: () => void this.dataEpochStale(),
    };
  }
  private deviceDeps() {
    const wipe = this.platform.wipeAccountData?.bind(this.platform);
    return wipe
      ? {
          read: () => this.platform.get(DEVICE_RECORD_KEY),
          write: (value: string) => this.platform.set(DEVICE_RECORD_KEY, value),
          wipe,
          holdsOtherAccounts: this.platform.holdsOtherAccountData?.bind(this.platform),
        }
      : null;
  }
  /**
   * #3369. Settle this phone against the server's reset moment for the account that is signing in,
   * before any of the account's stores can be opened (its user id is not on the session yet).
   */
  private async settleDevice(userId: string): Promise<'ok' | 'wiped'> {
    const deps = this.deviceDeps();
    if (!deps) return 'ok';
    const result = await reconcileDevice(deps, this.origin, userId, await this.api.dataEpoch());
    this.device = result.record;
    return result.outcome;
  }
  /**
   * The server refused a write because an admin reset this account after the phone last wiped.
   * Ask again, and if the phone is behind, wipe it and sign out so the stores reopen empty. One at
   * a time; a failure leaves the next 409 to try again.
   */
  private dataEpochStale(): Promise<void> {
    if (this.staleRun) return this.staleRun;
    const run = (async () => {
      const userId = this.session?.userId;
      if (!userId || !this.deviceDeps()) return;
      try {
        if ((await this.settleDevice(userId)) === 'wiped') await this.signOut(RESET_MESSAGE);
      } catch (error) {
        this.record('data_epoch_failed', error);
      }
    })().finally(() => {
      this.staleRun = null;
    });
    this.staleRun = run;
    return run;
  }
  /** A session can make requests while its access token is live, or while it can renew one. */
  private usable(session: SavedSession | null): session is SavedSession {
    return !!session && (session.expiresAt > nowSeconds() || !!session.refreshToken);
  }
  /**
   * The access token for a request, renewed first when it is about to run out. Null when there is
   * no session (or it belongs to another user than `userId`). When renewal could not reach the
   * server and the token has already lapsed, the request fails, but the session and everything
   * saved on the phone stay; the next request tries again.
   */
  private async accessToken(userId?: string): Promise<string | null> {
    const current = this.session;
    if (!current || (userId !== undefined && current.userId !== userId)) {
      return null;
    }
    const lapsed = current.expiresAt <= nowSeconds();
    if (
      current.refreshToken &&
      current.expiresAt - nowSeconds() < RENEW_BEFORE_SECONDS &&
      // Early renewal backs off after a failure; a lapsed token always tries.
      (lapsed || Date.now() >= this.renewBackoffUntil)
    ) {
      await this.renew(current.accessToken);
    }
    const session = this.session;
    if (!session || (userId !== undefined && session.userId !== userId)) {
      return null;
    }
    if (session.expiresAt > nowSeconds()) {
      return session.accessToken;
    }
    if (session.refreshToken) {
      throw new Error('Could not renew the session. Check the connection and retry.');
    }
    return null;
  }
  /**
   * After a 401 on `stale`: a different, live token to retry with once, or null. When renewal could
   * not reach the server its error is thrown instead, so the caller reports a connection problem
   * rather than the 401, which would read as a session the server ended.
   */
  private async renewedToken(stale: string, userId?: string): Promise<string | null> {
    const { transient } = await this.renew(stale);
    if (transient !== undefined) {
      throw transient;
    }
    const session = this.session;
    return session &&
      (userId === undefined || session.userId === userId) &&
      session.accessToken !== stale &&
      session.expiresAt > nowSeconds()
      ? session.accessToken
      : null;
  }
  /**
   * Swap the refresh token for a new pair, once for every caller holding `stale`: concurrent
   * requests share one call, because presenting a refresh token twice revokes the device's sign-in.
   */
  private renew(stale: string): Promise<Renewal> {
    const session = this.session;
    if (!session?.refreshToken || session.accessToken !== stale) {
      return this.renewal ?? Promise.resolve({});
    }
    this.renewal ??= this.runRenewal(session).finally(() => {
      this.renewal = null;
    });
    return this.renewal;
  }
  private async runRenewal(session: SavedSession): Promise<Renewal> {
    const presented = session.refreshToken!;
    this.record('renew_started');
    let token: SessionToken;
    try {
      token = await this.api.refreshSession(presented);
    } catch (error) {
      this.record('renew_failed', error);
      // Only the server saying no ends the session. Offline, a timeout, 429 or 5xx keep it.
      if (
        error instanceof ApiError &&
        [400, 401, 403].includes(error.status) &&
        this.session?.refreshToken === presented
      ) {
        await this.signOut('Your session ended. Sign in again.');
        return {};
      }
      this.renewBackoffUntil = Date.now() + RENEW_BACKOFF_MS;
      return { transient: error };
    }
    this.renewBackoffUntil = 0;
    try {
      await this.write(async () => {
        // Signed out, or another sign-in replaced the session, while the call was out.
        if (this.session?.refreshToken !== presented) {
          return;
        }
        const next: SavedSession = { ...this.session, ...token };
        // Memory first: the old refresh token is spent, so the new one must survive a failed write.
        this.session = next;
        await this.platform.set(SESSION_KEY, JSON.stringify(next));
      });
      this.record('renewed');
    } catch (error) {
      this.record('renew_store_failed', error);
    }
    if (this.session?.refreshToken === token.refreshToken) {
      this.publish(this.current.status, this.current.message, this.current.profile);
    }
    return {};
  }
  get state() {
    return this.current;
  }
  get dataReader(): AccountConnection | null {
    const userId = this.session?.userId;
    if (!userId || !this.usable(this.session)) {
      return null;
    }
    if (this.reader?.userId === userId) {
      return this.reader;
    }
    const api = createApiClient(
      this.origin,
      () => this.accessToken(userId),
      this.platform.fetch,
      (stale) => this.renewedToken(stale, userId),
      this.epochOptions(),
    );
    const readTimezone = () => this.session?.timezone ?? null;
    this.reader = {
      origin: this.origin,
      userId,
      get timezone() {
        return readTimezone();
      },
      streamExport: async (write) => {
        await api.streamExport(async (bytes) => {
          if (this.session?.userId !== userId) {
            throw new Error('The account changed during the request.');
          }
          await write(bytes);
        });
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
      },
      coachStream: async (body, signal) => {
        const response = await api.coachStream(body, signal);
        if (this.session?.userId !== userId) {
          await response.body?.cancel();
          throw new Error('The account changed during the request.');
        }
        return response;
      },
      get: async (path, query) => {
        const value = await api.get(path, query);
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
        return value;
      },
      post: async (path, body) => {
        const value = await api.post(path, body);
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
        return value;
      },
      put: async (path, body) => {
        const value = await api.put(path, body);
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
        return value;
      },
      patch: async (path, body) => {
        const value = await api.patch(path, body);
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
        return value;
      },
      delete: async (path, body, query) => {
        const value = await api.delete(path, body, query);
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
        return value;
      },
      media: async (source) => {
        const value = await api.media(source);
        if (this.session?.userId !== userId) {
          throw new Error('The account changed during the request.');
        }
        return value;
      },
    };
    return this.reader;
  }
  get diagnostics() {
    return {
      status: this.current.status,
      hasSession: this.session !== null,
      hasProfile: this.current.profile !== null,
      hasPending: this.pending !== null,
      events: [...this.events],
    };
  }
  private record(event: string, error?: unknown) {
    this.events.push({
      at: new Date().toISOString(),
      event,
      ...(error instanceof ApiError ? { httpStatus: error.status } : {}),
    });
    this.events = this.events.slice(-40);
  }
  subscribe(listener: (state: AccountState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(
    status: AccountState['status'],
    message: string | null = null,
    profile: AccountProfile | null = null,
  ) {
    this.record(`state_${status}`);
    this.current = {
      status,
      message,
      profile,
      hasSession: this.session !== null,
      expiresAt: this.session?.expiresAt ?? null,
      attemptStale: status === 'signingIn' && this.stale,
    };
    this.listeners.forEach((listener) => listener(this.current));
  }
  private get stale() {
    return this.pending !== null && Date.now() - this.pending.createdAt >= STUCK_ATTEMPT_GRACE;
  }
  private clearAttemptTimers() {
    for (const key of ['browserTimeout', 'staleTimeout', 'returnTimeout'] as const) {
      if (this[key]) {
        clearTimeout(this[key]);
        this[key] = null;
      }
    }
  }
  private write(operation: () => Promise<unknown>) {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => undefined);
    return result;
  }
  private validPending(value: unknown): value is Pending {
    const pending = value as Partial<Pending> | null;
    return (
      !!pending &&
      pending.origin === this.origin &&
      typeof pending.verifier === 'string' &&
      RANDOM_RE.test(pending.verifier) &&
      typeof pending.state === 'string' &&
      RANDOM_RE.test(pending.state) &&
      typeof pending.createdAt === 'number' &&
      pending.createdAt <= Date.now() &&
      pending.createdAt > Date.now() - TRANSACTION_AGE
    );
  }
  async initialize(initialUrl: string | null) {
    this.record(
      initialUrl?.startsWith(this.callback.split(':')[0] + ':')
        ? 'initialize_callback'
        : 'initialize',
    );
    const generation = ++this.generation;
    try {
      const [stored, savedPending, savedDevice] = await Promise.all([
        this.platform.get(SESSION_KEY),
        this.platform.get(PENDING_KEY),
        this.platform.get(DEVICE_RECORD_KEY),
      ]);
      this.device = parseDeviceRecord(savedDevice);
      const raw = stored ? (JSON.parse(stored) as Partial<SavedSession>) : null;
      if (generation !== this.generation) {
        return;
      }
      if (
        raw &&
        raw.origin === this.origin &&
        typeof raw.accessToken === 'string' &&
        raw.accessToken.length > 0 &&
        raw.accessToken.length <= 16_384 &&
        typeof raw.expiresAt === 'number' &&
        Number.isSafeInteger(raw.expiresAt) &&
        (raw.refreshToken === undefined ||
          (typeof raw.refreshToken === 'string' &&
            REFRESH_TOKEN_RE.test(raw.refreshToken) &&
            typeof raw.refreshExpiresAt === 'number' &&
            Number.isSafeInteger(raw.refreshExpiresAt))) &&
        (raw.expiresAt > nowSeconds() ||
          (raw.refreshToken !== undefined && raw.refreshExpiresAt! > nowSeconds())) &&
        (raw.userId === null || typeof raw.userId === 'string') &&
        (raw.timezone == null || typeof raw.timezone === 'string')
      ) {
        this.session = raw as SavedSession;
      } else {
        this.clearAccountData();
        await this.write(() => this.platform.remove(SESSION_KEY));
      }
      const pending: unknown = savedPending ? JSON.parse(savedPending) : null;
      if (generation !== this.generation) {
        return;
      }
      this.pending = this.validPending(pending) ? pending : null;
      if (initialUrl?.startsWith(this.callback.split(':')[0] + ':') && this.pending) {
        await this.complete(initialUrl);
      } else {
        this.pending = null;
        if (savedPending) {
          await this.write(() => this.platform.remove(PENDING_KEY));
        }
        if (generation !== this.generation) {
          return;
        }
        if (this.session) {
          await this.refresh();
        } else {
          this.publish(
            'signedOut',
            savedPending ? 'The previous sign-in was interrupted. Start again.' : null,
          );
        }
      }
    } catch (failure) {
      if (generation !== this.generation) {
        return;
      }
      this.session = null;
      this.pending = null;
      this.clearAccountData();
      this.publish(
        'signedOut',
        failureNotice(
          'Could not read secure sign-in storage. Try again on an unlocked phone with the latest development build.',
          failure,
        ),
      );
    }
  }
  private async saveSession(
    token: SessionToken,
    generation: number,
    userId: string | null = null,
  ) {
    const session: SavedSession = { ...token, origin: this.origin, userId };
    await this.write(() => this.platform.set(SESSION_KEY, JSON.stringify(session)));
    if (generation !== this.generation) {
      return;
    }
    this.session = session;
    this.record('session_saved');
    await this.refresh();
  }
  async signInWithApple() {
    this.record('apple_requested');
    const link = this.session !== null;
    if (
      !this.platform.appleSignIn ||
      !['signedOut', 'signedIn'].includes(this.current.status)
    ) {
      return;
    }
    if (link && !this.usable(this.session)) {
      await this.signOut('Your session expired. Sign in again.');
      return;
    }
    const generation = ++this.generation;
    const previousProfile = this.current.profile;
    const previousUserId = this.session?.userId ?? null;
    this.publish('signingIn', null, previousProfile);
    try {
      const state = await this.platform.random();
      const attempt = await this.api.beginApple(link);
      if (generation !== this.generation) {
        return;
      }
      const credential = await this.platform.appleSignIn(attempt.nonce, state);
      if (generation !== this.generation) {
        return;
      }
      if (credential.state !== state || !credential.identityToken) {
        throw new Error('Invalid Apple response.');
      }
      this.publish('checking', null, previousProfile);
      const token = await this.api.completeApple(
        attempt.attemptId,
        credential.identityToken,
        credential.name,
        link,
      );
      if (generation !== this.generation) {
        return;
      }
      await this.saveSession(token, generation, previousUserId);
    } catch (error) {
      this.record('apple_failed', error);
      if (generation !== this.generation) {
        return;
      }
      const cancelled =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ERR_REQUEST_CANCELED';
      const message = cancelled
        ? 'Apple sign-in cancelled.'
        : error instanceof ApiError && error.code === 'account_pending'
          ? 'Your account is awaiting approval.'
          : error instanceof ApiError && error.status === 409
            ? 'Sign in with the account you already use, then connect Apple from Settings.'
            : error instanceof ApiError && error.status === 429
              ? 'Too many sign-in attempts. Wait a few minutes and try again.'
              : 'Could not complete Apple sign-in. Try again.';
      this.publish(link && this.session ? 'signedIn' : 'signedOut', message, previousProfile);
    }
  }
  async signIn() {
    this.record('browser_requested');
    if (this.current.status === 'signingIn' && !this.session && this.stale) {
      // The browser never reported back: drop the old attempt (its verifier and state die with it,
      // so a late callback for it fails the state check) and fall through to a fresh one.
      this.record('attempt_replaced');
      await this.cancel(null);
    }
    if (this.current.status !== 'signedOut' || this.session) {
      return;
    }
    const generation = ++this.generation;
    this.publish('signingIn');
    try {
      const verifier = await this.platform.random();
      const state = await this.platform.random();
      const challenge = await this.platform.challenge(verifier);
      if (generation !== this.generation) {
        return;
      }
      const pending = { origin: this.origin, verifier, state, createdAt: Date.now() };
      if (!this.validPending(pending) || !RANDOM_RE.test(challenge)) {
        throw new Error('Invalid randomness.');
      }
      await this.write(() => this.platform.set(PENDING_KEY, JSON.stringify(pending)));
      if (generation !== this.generation) {
        return;
      }
      this.pending = pending;
      this.browserTimeout = setTimeout(() => {
        void this.cancel('Sign-in expired. Start again.');
      }, TRANSACTION_AGE);
      this.staleTimeout = setTimeout(() => {
        if (this.pending === pending && this.current.status === 'signingIn') {
          this.publish('signingIn');
        }
      }, STUCK_ATTEMPT_GRACE);
      const url = new URL('/mobile-signin/begin', this.origin);
      url.search = new URLSearchParams({ client: this.client, challenge, state }).toString();
      const result = await this.platform.open(url.toString());
      this.record(
        result.type === 'success'
          ? 'browser_success'
          : result.type === 'cancel'
            ? 'browser_cancelled'
            : 'browser_dismissed',
      );
      if (generation !== this.generation || this.pending !== pending) {
        return;
      }
      if (result.type === 'success' && result.url) {
        await this.complete(result.url);
      } else {
        await this.cancel('Sign-in cancelled.');
      }
    } catch (error) {
      this.record('browser_failed', error);
      if (generation === this.generation) {
        await this.cancel('Could not complete sign-in. Start again.');
      }
    }
  }
  async complete(rawUrl: string) {
    this.record('callback_received');
    const pending = this.pending;
    if (!pending) {
      this.record('callback_without_attempt');
      return;
    }
    let result: ReturnType<typeof parseAuthCallback>;
    try {
      if (!this.validPending(pending)) {
        throw new Error('Expired transaction.');
      }
      result = parseAuthCallback(rawUrl, pending, this.callback);
    } catch {
      this.record('callback_rejected');
      await this.cancel('The sign-in return did not match this attempt. Start again.');
      return;
    }
    this.pending = null;
    this.clearAttemptTimers();
    const generation = ++this.generation;
    this.publish('checking');
    try {
      await this.write(() => this.platform.remove(PENDING_KEY));
      if (generation !== this.generation) {
        return;
      }
      if ('error' in result) {
        this.record(`callback_${result.error}`);
        this.publish(
          'signedOut',
          result.error === 'account_pending'
            ? 'Your account is awaiting approval.'
            : 'Authentication failed. Start sign-in again.',
        );
        return;
      }
      this.record('exchange_started');
      const token = await this.api.exchange(result.token, pending.verifier);
      this.record('exchange_succeeded');
      if (generation !== this.generation) {
        return;
      }
      await this.saveSession(token, generation);
    } catch (error) {
      this.record('exchange_failed', error);
      if (generation !== this.generation) {
        return;
      }
      this.publish(
        'signedOut',
        error instanceof ApiError && error.status === 429
          ? 'Too many sign-in attempts. Wait a few minutes and try again.'
          : 'Could not exchange or save the session. Start sign-in again.',
      );
    }
  }
  refresh(): Promise<void> {
    if (!this.session) {
      return Promise.resolve();
    }
    if (!this.usable(this.session)) {
      return this.signOut('Your session expired. Sign in again.');
    }
    if (this.profileRequest?.generation === this.generation) {
      return this.profileRequest.promise;
    }
    const generation = ++this.generation;
    const profile = this.current.profile;
    this.publish('checking', null, profile);
    const promise = this.verifyProfile(generation, profile).finally(() => {
      if (this.profileRequest?.generation === generation) {
        this.profileRequest = null;
      }
    });
    this.profileRequest = { generation, promise };
    return promise;
  }
  private async verifyProfile(generation: number, previousProfile: AccountProfile | null) {
    this.record('profile_started');
    try {
      const profile = await this.api.profile();
      if (generation !== this.generation || !this.session) {
        return;
      }
      if (this.session.userId && this.session.userId !== profile.id) {
        await this.signOut('The account did not match the saved session. Sign in again.');
        return;
      }
      // #3369: before the user id goes on the session, which is what opens the account's stores. A
      // phone behind an admin reset, or last used by another account, is wiped here. If stores were
      // already open (a saved session found at launch) they are not trusted: sign in again.
      const storesOpen = this.session.userId !== null;
      if ((await this.settleDevice(profile.id)) === 'wiped' && storesOpen) {
        if (generation === this.generation) await this.signOut(RESET_MESSAGE);
        return;
      }
      if (generation !== this.generation || !this.session) {
        return;
      }
      // Built inside the write queue from the session as it is then, so a renewal that finished
      // while the profile was loading is kept rather than overwritten with the spent token.
      await this.write(async () => {
        if (!this.session || generation !== this.generation) {
          return;
        }
        const session = { ...this.session, userId: profile.id, timezone: profile.timezone };
        await this.platform.set(SESSION_KEY, JSON.stringify(session));
        if (generation === this.generation) {
          this.session = session;
        }
      });
      if (generation !== this.generation) {
        return;
      }
      this.record('profile_verified');
      this.publish('signedIn', null, profile);
    } catch (error) {
      this.record('profile_failed', error);
      if (generation !== this.generation) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        await this.signOut('Your session ended. Sign in again.');
      } else {
        this.publish(
          'signedIn',
          error instanceof ApiError && error.status === 403
            ? 'Your account cannot access this backend. Contact the account administrator or sign out.'
            : error instanceof ApiError && error.status === 429
              ? 'Too many requests. Wait a moment, then retry.'
              : 'Could not verify your account. Check the connection and retry. Your saved session is retained.',
          previousProfile,
        );
      }
    }
  }
  /** The app came back to the foreground; an attempt still waiting after a short moment is dead. */
  returnedToForeground() {
    const pending = this.pending;
    if (this.current.status !== 'signingIn' || !pending || this.returnTimeout) {
      return;
    }
    this.returnTimeout = setTimeout(() => {
      this.returnTimeout = null;
      if (this.pending === pending && this.current.status === 'signingIn') {
        this.record('attempt_cleared_on_return');
        void this.cancel("Sign-in didn't finish. Try again.");
      }
    }, FOREGROUND_CALLBACK_WAIT);
  }
  async cancel(message: string | null = 'Sign-in cancelled.') {
    const generation = ++this.generation;
    this.pending = null;
    this.clearAttemptTimers();
    try {
      this.platform.dismiss();
    } catch {}
    try {
      await this.write(() => this.platform.remove(PENDING_KEY));
      if (generation === this.generation) {
        this.publish(this.session ? 'signedIn' : 'signedOut', message, this.current.profile);
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish(
          'storageError',
          failureNotice(
            'Could not clear the interrupted sign-in. Retry on an unlocked phone.',
            failure,
          ),
        );
      }
    }
  }
  private clearAccountData() {
    try {
      this.platform.clearAccountData?.();
    } catch {}
  }
  async signOut(message: string | null = null) {
    const previous = this.session;
    const generation = ++this.generation;
    this.session = null;
    this.pending = null;
    this.clearAttemptTimers();
    this.publish('checking');
    try {
      this.platform.dismiss();
    } catch {}
    this.clearAccountData();
    try {
      await this.write(async () => {
        await this.platform.remove(SESSION_KEY);
        await this.platform.remove(PENDING_KEY);
      });
      if (generation === this.generation) {
        this.publish(this.session ? 'signedIn' : 'signedOut', message, this.current.profile);
      }
      if (previous && message === null && this.platform.revokeSession) {
        try {
          await this.platform.revokeSession(
            previous.origin,
            previous.accessToken,
            previous.refreshToken,
          );
        } catch {}
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish(
          'storageError',
          failureNotice(
            'Sign-in is cleared in memory, but secure storage could not be cleared. Retry sign-out before closing the app.',
            failure,
          ),
        );
      }
    }
  }
}
