import { ApiError, backendOrigin, createApiClient } from './api/client.ts';
import type { AccountProfile, SessionToken } from './api/client.ts';

export const AUTH_CALLBACK = 'com.fitnessai.training:/auth/callback';
const SESSION_KEY = 'fitnessai.session.v1';
const PENDING_KEY = 'fitnessai.pending.v1';
const TRANSACTION_AGE = 10 * 60 * 1000;
const RANDOM_RE = /^[A-Za-z0-9_-]{43}$/;
type SavedSession = SessionToken & { origin: string; userId: string | null; timezone?: string | null };
export type AccountReader = {
  origin: string;
  userId: string;
  get(path: string, query?: Record<string, string>): Promise<unknown>;
};
export type AccountConnection = AccountReader & {
  readonly timezone: string | null;
  post(path: string, body: unknown): Promise<unknown>;
  put?(path: string, body: unknown): Promise<unknown>;
  patch?(path: string, body: unknown): Promise<unknown>;
  delete?(path: string, body: unknown): Promise<unknown>;
  media?(source: string): Promise<string>;
};
type Pending = { origin: string; verifier: string; state: string; createdAt: number };
export type AccountState = {
  status: 'loading' | 'signedOut' | 'signingIn' | 'checking' | 'signedIn' | 'storageError';
  profile: AccountProfile | null; hasSession: boolean; expiresAt: number | null; message: string | null;
};
export type AuthPlatform = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  random(): Promise<string>;
  challenge(verifier: string): Promise<string>;
  open(url: string): Promise<{ type: string; url?: string }>;
  appleSignIn?(nonce: string, state: string): Promise<{ identityToken: string; state: string | null; name?: string }>;
  dismiss(): void;
};

export function parseAuthCallback(raw: string, pending: Pending): { token: string } | { error: string } {
  const url = new URL(raw);
  if (`${url.protocol}${url.pathname}` !== AUTH_CALLBACK || url.host || url.username || url.password || url.hash
    || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== pending.state
    || [...url.searchParams.keys()].some(key => !['state', 'token', 'error'].includes(key))) {
    throw new Error('Invalid sign-in return.');
  }
  const token = url.searchParams.get('token');
  const error = url.searchParams.get('error');
  if (token && !error && url.searchParams.getAll('token').length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) { return { token }; }
  if (error && !token && url.searchParams.getAll('error').length === 1 && ['account_pending', 'authentication_failed'].includes(error)) { return { error }; }
  throw new Error('Invalid sign-in return.');
}

export class AccountSession {
  private origin: string;
  private session: SavedSession | null = null;
  private pending: Pending | null = null;
  private generation = 0;
  private browserTimeout: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(state: AccountState) => void>();
  private current: AccountState = { status: 'loading', profile: null, hasSession: false, expiresAt: null, message: null };
  private api: ReturnType<typeof createApiClient>;
  private platform: AuthPlatform;
  private events: { at: string; event: string; httpStatus?: number }[] = [];
  private reader: AccountConnection | null = null;
  constructor(origin: string, platform: AuthPlatform) {
    this.platform = platform;
    this.origin = backendOrigin(origin);
    this.api = createApiClient(this.origin, async () => this.session && this.session.expiresAt > Date.now() / 1000 ? this.session.accessToken : null);
  }
  get state() { return this.current; }
  get dataReader(): AccountConnection | null {
    const userId = this.session?.userId;
    if (!userId || !this.session || this.session.expiresAt <= Date.now() / 1000) { return null; }
    if (this.reader?.userId === userId) { return this.reader; }
    const api = createApiClient(this.origin, async () => this.session?.userId === userId
      && this.session.expiresAt > Date.now() / 1000 ? this.session.accessToken : null);
    const controller = this;
    this.reader = {
      origin: this.origin, userId,
      get timezone() { return controller.session?.timezone ?? null; },
      get: async (path, query) => {
        const value = await api.get(path, query);
        if (this.session?.userId !== userId) { throw new Error('The account changed during the request.'); }
        return value;
      },
      post: async (path, body) => {
        const value = await api.post(path, body);
        if (this.session?.userId !== userId) { throw new Error('The account changed during the request.'); }
        return value;
      },
      put: async (path, body) => {
        const value = await api.put(path, body);
        if (this.session?.userId !== userId) { throw new Error('The account changed during the request.'); }
        return value;
      },
      patch: async (path, body) => {
        const value = await api.patch(path, body);
        if (this.session?.userId !== userId) { throw new Error('The account changed during the request.'); }
        return value;
      },
      delete: async (path, body) => {
        const value = await api.delete(path, body);
        if (this.session?.userId !== userId) { throw new Error('The account changed during the request.'); }
        return value;
      },
      media: async source => {
        const value = await api.media(source);
        if (this.session?.userId !== userId) { throw new Error('The account changed during the request.'); }
        return value;
      },
    };
    return this.reader;
  }
  get diagnostics() {
    return { status: this.current.status, hasSession: this.session !== null, hasProfile: this.current.profile !== null,
      hasPending: this.pending !== null, events: [...this.events] };
  }
  private record(event: string, error?: unknown) {
    this.events.push({ at: new Date().toISOString(), event, ...(error instanceof ApiError ? { httpStatus: error.status } : {}) });
    this.events = this.events.slice(-40);
  }
  subscribe(listener: (state: AccountState) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish(status: AccountState['status'], message: string | null = null, profile: AccountProfile | null = null) {
    this.record(`state_${status}`);
    this.current = { status, message, profile, hasSession: this.session !== null, expiresAt: this.session?.expiresAt ?? null };
    this.listeners.forEach(listener => listener(this.current));
  }
  private write(operation: () => Promise<unknown>) {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => undefined);
    return result;
  }
  private validPending(value: unknown): value is Pending {
    const pending = value as Partial<Pending> | null;
    return !!pending && pending.origin === this.origin && typeof pending.verifier === 'string' && RANDOM_RE.test(pending.verifier)
      && typeof pending.state === 'string' && RANDOM_RE.test(pending.state) && typeof pending.createdAt === 'number'
      && pending.createdAt <= Date.now() && pending.createdAt > Date.now() - TRANSACTION_AGE;
  }
  async initialize(initialUrl: string | null) {
    this.record(initialUrl?.startsWith('com.fitnessai.training:') ? 'initialize_callback' : 'initialize');
    const generation = ++this.generation;
    try {
      const stored = await this.platform.get(SESSION_KEY);
      const raw = stored ? JSON.parse(stored) as Partial<SavedSession> : null;
      if (generation !== this.generation) { return; }
      if (raw && raw.origin === this.origin && typeof raw.accessToken === 'string' && raw.accessToken.length > 0
        && raw.accessToken.length <= 16_384 && typeof raw.expiresAt === 'number' && Number.isSafeInteger(raw.expiresAt)
        && raw.expiresAt > Date.now() / 1000 && (raw.userId === null || typeof raw.userId === 'string')
        && (raw.timezone == null || typeof raw.timezone === 'string')) {
        this.session = raw as SavedSession;
      } else {
        await this.write(() => this.platform.remove(SESSION_KEY));
      }
      const savedPending = await this.platform.get(PENDING_KEY);
      const pending: unknown = savedPending ? JSON.parse(savedPending) : null;
      if (generation !== this.generation) { return; }
      this.pending = this.validPending(pending) ? pending : null;
      if (initialUrl?.startsWith('com.fitnessai.training:') && this.pending) {
        await this.complete(initialUrl);
      } else {
        this.pending = null;
        await this.write(() => this.platform.remove(PENDING_KEY));
        if (generation !== this.generation) { return; }
        if (this.session) { await this.refresh(); }
        else { this.publish('signedOut', savedPending ? 'The previous sign-in was interrupted. Start again.' : null); }
      }
    } catch {
      if (generation !== this.generation) { return; }
      this.session = null; this.pending = null;
      this.publish('signedOut', 'Could not read secure sign-in storage. Try again on an unlocked iPhone with the latest development build.');
    }
  }
  private async saveSession(token: SessionToken, generation: number, userId: string | null = null) {
    const session: SavedSession = { ...token, origin: this.origin, userId };
    await this.write(() => this.platform.set(SESSION_KEY, JSON.stringify(session)));
    if (generation !== this.generation) { return; }
    this.session = session;
    this.record('session_saved');
    await this.refresh();
  }
  async signInWithApple() {
    this.record('apple_requested');
    const link = this.session !== null;
    if (!this.platform.appleSignIn || !['signedOut', 'signedIn'].includes(this.current.status)) { return; }
    if (link && this.session!.expiresAt <= Date.now() / 1000) { await this.signOut('Your session expired. Sign in again.'); return; }
    const generation = ++this.generation;
    const previousProfile = this.current.profile;
    const previousUserId = this.session?.userId ?? null;
    this.publish('signingIn', null, previousProfile);
    try {
      const state = await this.platform.random();
      const attempt = await this.api.beginApple(link);
      if (generation !== this.generation) { return; }
      const credential = await this.platform.appleSignIn(attempt.nonce, state);
      if (generation !== this.generation) { return; }
      if (credential.state !== state || !credential.identityToken) { throw new Error('Invalid Apple response.'); }
      this.publish('checking', null, previousProfile);
      const token = await this.api.completeApple(attempt.attemptId, credential.identityToken, credential.name, link);
      if (generation !== this.generation) { return; }
      await this.saveSession(token, generation, previousUserId);
    } catch (error) {
      this.record('apple_failed', error);
      if (generation !== this.generation) { return; }
      const cancelled = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
      const message = cancelled ? 'Apple sign-in cancelled.'
        : error instanceof ApiError && error.code === 'account_pending' ? 'Your account is awaiting approval.'
        : error instanceof ApiError && error.status === 409 ? 'Sign in with the account you already use, then connect Apple from Settings.'
        : error instanceof ApiError && error.status === 429 ? 'Too many sign-in attempts. Wait a few minutes and try again.'
        : 'Could not complete Apple sign-in. Try again.';
      this.publish(link && this.session ? 'signedIn' : 'signedOut', message, previousProfile);
    }
  }
  async signIn() {
    this.record('browser_requested');
    if (this.current.status !== 'signedOut' || this.session) { return; }
    const generation = ++this.generation;
    this.publish('signingIn');
    try {
      const verifier = await this.platform.random();
      const state = await this.platform.random();
      const challenge = await this.platform.challenge(verifier);
      if (generation !== this.generation) { return; }
      const pending = { origin: this.origin, verifier, state, createdAt: Date.now() };
      if (!this.validPending(pending) || !RANDOM_RE.test(challenge)) { throw new Error('Invalid randomness.'); }
      await this.write(() => this.platform.set(PENDING_KEY, JSON.stringify(pending)));
      if (generation !== this.generation) { return; }
      this.pending = pending;
      this.browserTimeout = setTimeout(() => { void this.cancel('Sign-in expired. Start again.'); }, TRANSACTION_AGE);
      const url = new URL('/mobile-signin/begin', this.origin);
      url.search = new URLSearchParams({ client: 'ios', challenge, state }).toString();
      const result = await this.platform.open(url.toString());
      this.record(result.type === 'success' ? 'browser_success' : result.type === 'cancel' ? 'browser_cancelled' : 'browser_dismissed');
      if (generation !== this.generation || this.pending !== pending) { return; }
      if (result.type === 'success' && result.url) { await this.complete(result.url); }
      else { await this.cancel('Sign-in cancelled.'); }
    } catch (error) {
      this.record('browser_failed', error);
      if (generation === this.generation) { await this.cancel('Could not complete sign-in. Start again.'); }
    }
  }
  async complete(rawUrl: string) {
    this.record('callback_received');
    const pending = this.pending;
    if (!pending) { this.record('callback_without_attempt'); return; }
    let result: ReturnType<typeof parseAuthCallback>;
    try {
      if (!this.validPending(pending)) { throw new Error('Expired transaction.'); }
      result = parseAuthCallback(rawUrl, pending);
    } catch {
      this.record('callback_rejected');
      await this.cancel('The sign-in return did not match this attempt. Start again.'); return;
    }
    this.pending = null;
    if (this.browserTimeout) { clearTimeout(this.browserTimeout); this.browserTimeout = null; }
    const generation = ++this.generation;
    this.publish('checking');
    try {
      await this.write(() => this.platform.remove(PENDING_KEY));
      if (generation !== this.generation) { return; }
      if ('error' in result) {
        this.record(`callback_${result.error}`);
        this.publish('signedOut', result.error === 'account_pending' ? 'Your account is awaiting approval.' : 'Authentication failed. Start sign-in again.'); return;
      }
      this.record('exchange_started');
      const token = await this.api.exchange(result.token, pending.verifier);
      this.record('exchange_succeeded');
      if (generation !== this.generation) { return; }
      await this.saveSession(token, generation);
    } catch (error) {
      this.record('exchange_failed', error);
      if (generation !== this.generation) { return; }
      this.publish('signedOut', error instanceof ApiError && error.status === 429
        ? 'Too many sign-in attempts. Wait a few minutes and try again.'
        : 'Could not exchange or save the session. Start sign-in again.');
    }
  }
  async refresh() {
    if (!this.session) { return; }
    if (this.session.expiresAt <= Date.now() / 1000) { await this.signOut('Your session expired. Sign in again.'); return; }
    const generation = ++this.generation;
    this.publish('checking');
    this.record('profile_started');
    try {
      const profile = await this.api.profile();
      if (generation !== this.generation || !this.session) { return; }
      if (this.session.userId && this.session.userId !== profile.id) {
        await this.signOut('The account did not match the saved session. Sign in again.'); return;
      }
      const session = { ...this.session, userId: profile.id, timezone: profile.timezone };
      await this.write(() => this.platform.set(SESSION_KEY, JSON.stringify(session)));
      if (generation !== this.generation) { return; }
      this.session = session;
      this.record('profile_verified');
      this.publish('signedIn', null, profile);
    } catch (error) {
      this.record('profile_failed', error);
      if (generation !== this.generation) { return; }
      if (error instanceof ApiError && error.status === 401) { await this.signOut('Your session ended. Sign in again.'); }
      else { this.publish('signedIn', error instanceof ApiError && error.status === 403
        ? 'Your account cannot access this backend. Contact the account administrator or sign out.'
        : error instanceof ApiError && error.status === 429 ? 'Too many requests. Wait a moment, then retry.'
        : 'Could not verify your account. Check the connection and retry. Your saved session is retained.'); }
    }
  }
  async cancel(message = 'Sign-in cancelled.') {
    const generation = ++this.generation;
    this.pending = null;
    if (this.browserTimeout) { clearTimeout(this.browserTimeout); this.browserTimeout = null; }
    try { this.platform.dismiss(); } catch {}
    try {
      await this.write(() => this.platform.remove(PENDING_KEY));
      if (generation === this.generation) { this.publish(this.session ? 'signedIn' : 'signedOut', message, this.current.profile); }
    } catch {
      if (generation === this.generation) { this.publish('storageError', 'Could not clear the interrupted sign-in. Retry on an unlocked iPhone.'); }
    }
  }
  async signOut(message: string | null = null) {
    const generation = ++this.generation;
    this.session = null; this.pending = null;
    if (this.browserTimeout) { clearTimeout(this.browserTimeout); this.browserTimeout = null; }
    this.publish('checking');
    try { this.platform.dismiss(); } catch {}
    try {
      await this.write(async () => { await this.platform.remove(SESSION_KEY); await this.platform.remove(PENDING_KEY); });
      if (generation === this.generation) { this.publish(this.session ? 'signedIn' : 'signedOut', message, this.current.profile); }
    } catch {
      if (generation === this.generation) { this.publish('storageError', 'Sign-in is cleared in memory, but secure storage could not be cleared. Retry sign-out before closing the app.'); }
    }
  }
}
