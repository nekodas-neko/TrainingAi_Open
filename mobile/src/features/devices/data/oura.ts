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
  if (typeof error === 'string') return REASONS[error] ?? REASONS.failed;
  if (error instanceof ApiError) return STATUSES[error.status] ?? REASONS.failed;
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
export async function connectOura(
  connection: AccountConnection,
  client: MobileClient,
  open: (url: string, redirect: string) => Promise<{ type: string; url?: string }>,
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
  const opened = await open(url, ouraCallback(client)).catch(() => null);
  const result =
    opened?.type === 'success' && opened.url ? parseOuraCallback(opened.url, client) : null;
  if (!result)
    return {
      ok: false,
      cancelled: true,
      message: 'Oura was closed before the connection finished.',
    };
  return finishOuraCallback(connection, result);
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
