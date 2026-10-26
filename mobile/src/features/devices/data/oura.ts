import { z } from 'zod';
import { ApiError } from '../../account/api/client';
import { MOBILE_CALLBACKS, type AccountConnection, type MobileClient } from '../../account/session';

// Connecting an Oura account (#2894). The server holds the grant; the app only starts the
// connection, finishes it with its own bearer, and shows the status.
export const OURA_PACKAGE = 'com.ouraring.oura';
const statusSchema = z.object({
  connected: z.boolean(),
  scope: z.string().nullable(),
  expiresAt: z.string().nullable(),
  // #2861: when the feed last spoke. Absent from a server that predates the stamps.
  lastDataAt: z.string().nullish(),
  lastWebhookAt: z.string().nullish(),
});
export type OuraStatus = z.infer<typeof statusSchema>;
export type OuraCallback =
  | { kind: 'connected' }
  | { kind: 'pending'; handle: string }
  | { kind: 'error'; reason: string };
export type OuraResult = { ok: true } | { ok: false; cancelled?: boolean; message: string };

export function ouraCallback(client: MobileClient) {
  return `${MOBILE_CALLBACKS[client].split(':')[0]}:/oura/callback`;
}
/** Null unless `url` is this build's Oura return. */
export function parseOuraCallback(url: string, client: MobileClient): OuraCallback | null {
  const base = ouraCallback(client);
  if (url !== base && !url.startsWith(`${base}?`)) return null;
  const params = new URLSearchParams(url.slice(base.length + 1));
  const status = params.get('oura');
  const handle = params.get('handle');
  if (status === 'connected') return { kind: 'connected' };
  if (status === 'pending' && handle) return { kind: 'pending', handle };
  return { kind: 'error', reason: params.get('reason') ?? 'failed' };
}

const REASONS: Record<string, string> = {
  denied: 'Access was not allowed on Oura’s page, so nothing was connected.',
  expired: 'The connection timed out. Connect again.',
  in_use:
    'This Oura account is already connected to another TrainingAi account. Disconnect it there first.',
  signed_out: 'Sign in again, then connect Oura.',
  failed: 'Oura could not finish connecting. Try again.',
};
const STATUSES: Record<number, string> = {
  401: REASONS.signed_out,
  403: 'This connection was started from a different account. Connect again from this one.',
  409: REASONS.in_use,
  410: 'The connection expired before it finished. Connect again.',
  429: 'Too many attempts. Wait a few minutes and try again.',
  503: 'Oura connection is not set up on the server yet. Try again later.',
};
export function ouraMessage(error: unknown) {
  // The reason comes from a URL, so `__proto__` or `constructor` must never reach the prototype.
  if (typeof error === 'string')
    return Object.hasOwn(REASONS, error) ? REASONS[error] : REASONS.failed;
  if (error instanceof ApiError)
    return Object.hasOwn(STATUSES, error.status) ? STATUSES[error.status] : REASONS.failed;
  return 'TrainingAi could not be reached. Check your connection and try again.';
}

export async function readOuraStatus(connection: AccountConnection): Promise<OuraStatus> {
  return statusSchema.parse(await connection.get('/api/oura/connection'));
}
/** Finishes a return URL: a native connection comes back pending and needs this app's bearer. */
export async function finishOuraCallback(
  connection: AccountConnection,
  result: OuraCallback,
): Promise<OuraResult> {
  if (result.kind === 'error') return { ok: false, message: ouraMessage(result.reason) };
  if (result.kind === 'connected') return { ok: true };
  try {
    await connection.post('/api/oura/connect/complete', { handle: result.handle });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: ouraMessage(error) };
  }
}
/** How long after the consent browser closes a late return link is still accepted. On Android
 *  the browser can report "closed" a moment before the link that closed it arrives. */
export const RETURN_GRACE_MS = 15_000;
/** A cold start may finish a connect only this soon after the phone started it: the server's
 *  connect ticket and pending handle each last ten minutes. */
export const COLD_START_MAX_AGE_MS = 20 * 60 * 1000;

/**
 * Finishes each Oura return URL exactly once. On Android the consent browser
 * (`openAuthSessionAsync`) and the screen's own `Linking` listener both receive the same return,
 * and the listener receives it first; both ask here and share one `/complete` call.
 *
 * A return is accepted only while a connect started on this phone is open (or just closed), so a
 * link fired at the app by anything else is ignored. The one exception is a cold start: Android
 * killed the app while Oura's page was open and the return relaunched it. The caller passes
 * `coldStart` only after checking this phone recorded starting a connect within
 * `COLD_START_MAX_AGE_MS`.
 */
export class OuraReturns {
  private readonly finishing = new Map<string, Promise<OuraResult>>();
  private open = 0;
  private graceUntil = 0;
  constructor(private readonly now: () => number = Date.now) {}
  begin() {
    this.open += 1;
  }
  end() {
    this.open = Math.max(0, this.open - 1);
    this.graceUntil = this.now() + RETURN_GRACE_MS;
  }
  /** A connect is waiting on the consent browser; it reports its own result. */
  get connecting() {
    return this.open > 0;
  }
  get expecting() {
    return this.open > 0 || this.now() <= this.graceUntil;
  }
  /** The one shared result for `url`, or null when it is not an Oura return this phone is waiting for. */
  finish(
    url: string,
    client: MobileClient,
    connection: AccountConnection,
    options: { coldStart?: boolean } = {},
  ): Promise<OuraResult> | null {
    const started = this.finishing.get(url);
    if (started) return started;
    const result = parseOuraCallback(url, client);
    if (!result || !(this.expecting || options.coldStart)) return null;
    const finishing = finishOuraCallback(connection, result);
    this.finishing.set(url, finishing);
    return finishing;
  }
}

export async function connectOura(
  connection: AccountConnection,
  client: MobileClient,
  open: (url: string, redirect: string) => Promise<{ type: string; url?: string }>,
  returns: OuraReturns = new OuraReturns(),
): Promise<OuraResult> {
  let url: string;
  try {
    const value = z
      .object({ url: z.string().url() })
      .parse(await connection.post('/api/oura/connect', { client }));
    url = value.url;
  } catch (error) {
    return { ok: false, message: ouraMessage(error) };
  }
  returns.begin();
  try {
    const opened = await open(url, ouraCallback(client)).catch(() => null);
    const finishing =
      opened?.type === 'success' && opened.url
        ? returns.finish(opened.url, client, connection)
        : null;
    if (!finishing)
      return {
        ok: false,
        cancelled: true,
        message: 'Oura was closed before the connection finished.',
      };
    return await finishing;
  } finally {
    returns.end();
  }
}

/** A connect this phone started, saved so a cold-start return can tell it apart from a stray link. */
export const CONNECT_STARTED_KEY = 'trainingai.oura.connect_started';
export function connectStartedRecently(saved: string | null, now = Date.now()) {
  const at = saved === null ? NaN : Number(saved);
  return Number.isSafeInteger(at) && at <= now && now - at <= COLD_START_MAX_AGE_MS;
}
export async function disconnectOura(connection: AccountConnection): Promise<OuraResult> {
  if (!connection.delete) return { ok: false, message: REASONS.failed };
  try {
    await connection.delete('/api/oura/connection', undefined);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: ouraMessage(error) };
  }
}
