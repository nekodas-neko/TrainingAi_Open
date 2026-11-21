import { ApiError } from '../api/client.ts';

/**
 * Change password (#3882). The server route is `PATCH /api/user/password` with
 * `{ currentPassword, newPassword }` (`app/api/user/password/route.ts`); it owns every rule, and
 * these checks only save a round trip. A new password is 8 to 200 characters and at most 72 UTF-8
 * bytes (bcrypt reads no more than that).
 */
export const PASSWORD_PATH = '/api/user/password';
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const MAX_PASSWORD_BYTES = 72;

export type PasswordForm = { current: string; next: string; confirm: string };
export const emptyPasswordForm: PasswordForm = { current: '', next: '', confirm: '' };

const bytes = (value: string) => new TextEncoder().encode(value).length;

/** What is wrong with the form before it is sent, or null. Never repeats a password back. */
export function passwordFormProblem(form: PasswordForm): string | null {
  if (!form.current) return 'Enter your current password.';
  if (form.next.length < MIN_PASSWORD) return `The new password must be at least ${MIN_PASSWORD} characters.`;
  if (form.next.length > MAX_PASSWORD || bytes(form.next) > MAX_PASSWORD_BYTES)
    return `The new password must be at most ${MAX_PASSWORD} characters and ${MAX_PASSWORD_BYTES} bytes.`;
  if (form.next !== form.confirm) return 'The new passwords do not match.';
  if (form.next === form.current) return 'The new password must differ from the current one.';
  return null;
}

/** The body the route reads, and nothing else. */
export function passwordBody(form: PasswordForm) {
  return { currentPassword: form.current, newPassword: form.next };
}

/**
 * What to tell the person when the server refused. Its own sentence for a refusal it explained (a
 * wrong current password, a rule), a fixed line for a limit or an outage. Never the password.
 */
export function passwordFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 429) return 'Too many attempts. Wait an hour and try again.';
    if (failure.serverMessage && failure.status >= 400 && failure.status < 500)
      return failure.serverMessage;
  }
  return 'Could not change the password. Check your connection and try again.';
}

export const PASSWORD_CHANGED =
  'Password changed. Your other sign-ins have ended, and this phone may ask you to sign in again.';
