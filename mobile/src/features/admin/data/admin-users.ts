import { z } from 'zod';
import { OUTSIDE_SOURCES_NOTICE } from '@trainingai/shared/admin-wipe-copy';

/** The admin console's reads. `cache` is off: other people's emails and screenshots stay off the phone's disk. */
const noDiskCache = () => false;

const userSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullish(),
    displayName: z.string().nullish(),
    avatar: z.string().nullish(),
    isActive: z.boolean(),
    isAdmin: z.boolean().optional(),
    hasData: z.boolean().optional(),
  })
  .passthrough();
export type AdminUser = z.infer<typeof userSchema>;

export const adminUsersSpec = {
  path: '/api/admin/users',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z.object({ users: z.array(userSchema) }).passthrough(),
};
export const adminInvitesSpec = {
  path: '/api/admin/invites',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z.object({ emails: z.array(z.string()) }).passthrough(),
};
const feedbackSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    description: z.string().nullish(),
    screenshotData: z.string().nullish(),
    createdAt: z.string(),
    userEmail: z.string(),
    userName: z.string().nullish(),
  })
  .passthrough();
export type AdminFeedback = z.infer<typeof feedbackSchema>;
export const adminFeedbackSpec = {
  path: '/api/admin/feedback',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z.array(feedbackSchema),
};

/** What the Home badge and More dot read; a console write refreshes them. */
export const adminPendingPath = '/api/admin/pending-count';

/** How a confirm names a user, so it says exactly what the admin tapped on. */
export function userLabel(u: Pick<AdminUser, 'displayName' | 'name' | 'email'>): string {
  return u.displayName || u.name || u.email;
}

/**
 * An inactive user with no data under the account is a signup that never got in (Pending: Activate
 * or Delete); one with data was in and was deactivated (Deactivated: Activate only). `hasData`
 * missing is read as "has data", so an unknown never offers the trash.
 */
export function partitionUsers(users: readonly AdminUser[]) {
  const inactive = users.filter((u) => !u.isActive);
  return {
    pending: inactive.filter((u) => u.hasData === false),
    deactivated: inactive.filter((u) => u.hasData !== false),
    active: users.filter((u) => u.isActive),
  };
}

export type UserAction = 'activate' | 'deactivate' | 'delete' | 'grant-admin' | 'revoke-admin';

/** Which actions a row offers. The server refuses the self ones too; this only hides them. */
export function userActions(user: AdminUser, isSelf: boolean): UserAction[] {
  const actions: UserAction[] = [];
  if (user.isActive) {
    if (!isSelf) actions.push('deactivate');
    if (user.isAdmin) {
      if (!isSelf) actions.push('revoke-admin');
    } else actions.push('grant-admin');
  } else {
    actions.push('activate');
    if (user.hasData === false && !isSelf) actions.push('delete');
  }
  return actions;
}

/** Activation asks nothing, as in the current app; every other action is confirmed first. */
export function userActionConfirm(
  action: UserAction,
  user: AdminUser,
): { title: string; message: string; confirmLabel: string } | null {
  const who = userLabel(user);
  switch (action) {
    case 'activate':
      return null;
    case 'deactivate':
      return {
        title: 'Deactivate user?',
        message: `${who} will be signed out to the pending screen until you activate them again.`,
        confirmLabel: 'Deactivate',
      };
    case 'delete':
      return {
        title: 'Delete user?',
        message: `Delete ${who}? This permanently deletes their account and everything under it. It cannot be undone.`,
        confirmLabel: 'Delete',
      };
    case 'grant-admin':
      return {
        title: 'Make admin?',
        message: `${who} will be able to manage users, invites and data from the admin console.`,
        confirmLabel: 'Make admin',
      };
    case 'revoke-admin':
      return {
        title: 'Remove admin?',
        message: `${who} will lose access to the admin console.`,
        confirmLabel: 'Remove admin',
      };
  }
}

export const removeInviteConfirm = (email: string) => ({
  title: 'Remove invite?',
  message: `${email} will no longer be pre-approved. If they sign up afterwards they wait for approval.`,
  confirmLabel: 'Remove',
});

export const userActionDone: Record<UserAction, string> = {
  activate: 'User activated',
  deactivate: 'User deactivated',
  delete: 'User deleted',
  'grant-admin': 'Admin granted',
  'revoke-admin': 'Admin removed',
};

/** The request client keeps only the status, so the plain-words reason is chosen from it here. */
export function actionFailure(action: UserAction, failure: unknown): string {
  const status = (failure as { status?: unknown } | null)?.status;
  if (status === 409 && action === 'delete')
    return 'This account has data under it, so it cannot be deleted.';
  if (status === 404) return 'User not found';
  if (status === 400 && action === 'revoke-admin') return 'You cannot remove your own admin.';
  if (status === 403) return 'You are not an admin.';
  return 'Action failed';
}

/** The email an invite is stored under: trimmed and lower-cased, as the current app sends it. */
export const inviteEmail = (input: string) => input.trim().toLowerCase();

/** Reset data and Delete account (#3369): both ask for the user's email, and both go to the server with it. */
export type WipeKind = 'reset' | 'erase';

/** The web console's rule for who is offered which: never an admin but yourself, never a signup that never got in. */
export function wipeActions(user: AdminUser, isSelf: boolean): WipeKind[] {
  const neverGotIn = !user.isActive && user.hasData === false;
  if (neverGotIn) return [];
  const kinds: WipeKind[] = [];
  if (!user.isAdmin || isSelf) kinds.push('reset');
  if (!user.isAdmin && !isSelf) kinds.push('erase');
  return kinds;
}

export function wipeConfirm(
  kind: WipeKind,
  user: AdminUser,
  isSelf: boolean,
): { title: string; message: string; confirmLabel: string } {
  const who = userLabel(user);
  if (kind === 'reset')
    return {
      title: 'Reset data?',
      message: `This permanently deletes everything ${who} has recorded: workouts, food, sleep, body metrics, goals, settings, friendships and connected devices, and their Oura connection is revoked. Their account, email, sign-in and ${user.isAdmin ? 'admin and ' : ''}active status stay. Every device they use is signed out and wiped, and they sign in again to start fresh.${isSelf ? ' This is your own account, so you will be signed out now.' : ''} It cannot be undone. ${OUTSIDE_SOURCES_NOTICE}`,
      confirmLabel: 'Reset data',
    };
  return {
    title: 'Delete account and data?',
    message: `This permanently deletes ${who}'s account and everything under it, and revokes their Oura connection. Their friendships are removed too. Their invite is removed as well, so they will need a new invite to sign up again. It cannot be undone. ${OUTSIDE_SOURCES_NOTICE}`,
    confirmLabel: 'Delete account',
  };
}

/** The confirm unlocks when the typed email is the row's, ignoring case and surrounding spaces, as the server compares. */
export const emailMatches = (typed: string, email: string) =>
  typed.trim().toLowerCase() === email.trim().toLowerCase() && email.trim() !== '';

/** The route and body for a wipe. The typed email is sent, not the row's, so the server's check is the real one. */
export function wipeRequest(kind: WipeKind, user: AdminUser, typedEmail: string) {
  return {
    method: kind === 'reset' ? ('POST' as const) : ('DELETE' as const),
    path: kind === 'reset' ? '/api/admin/users/reset-data' : '/api/admin/users',
    body: { userId: user.id, confirmEmail: typedEmail },
  };
}

/** Plain sentences chosen from the status alone; the response's own text is never shown. */
export function wipeFailure(kind: WipeKind, failure: unknown): string {
  const status = (failure as { status?: unknown } | null)?.status;
  const nothing = 'Nothing was removed.';
  if (status === 403)
    return "This account can't be reset or deleted from here: it is another admin's or the owner's, or the server's owner setting is missing. Nothing was removed.";
  if (status === 409) return `The account changed while you were confirming. Refresh and try again. ${nothing}`;
  if (status === 429) return `Too many resets and deletions this hour. Try again later. ${nothing}`;
  if (status === 404) return `That user no longer exists. ${nothing}`;
  if (status === 400) return `That email does not match this account. ${nothing}`;
  // No answer (a timeout, a dropped connection) or a gateway error: the server may still have
  // committed, so don't say nothing was removed.
  if (typeof status !== 'number' || status >= 502)
    return 'The request did not finish, so it is not known whether anything was removed. Refresh the list before trying again.';
  return kind === 'reset'
    ? `The data could not be reset. ${nothing}`
    : `The account could not be deleted. ${nothing}`;
}

export const wipeDone = (kind: WipeKind, user: AdminUser, defaultsSeeded: boolean) =>
  kind === 'erase'
    ? `${userLabel(user)} and their data were deleted.`
    : defaultsSeeded
      ? `${userLabel(user)}'s data was reset. They are signed out on every device.`
      : `${userLabel(user)}'s data was reset, but the built-in styles could not be put back. Reset again to add them.`;

/**
 * Sends the wipe, then refreshes the console's lists. Resetting your own account ends your session
 * on the server, so the app signs out here, as the web console goes to its sign-in page; this phone's
 * old rows are wiped by the data-epoch check on the next sign-in.
 */
export async function performWipe(
  kind: WipeKind,
  user: AdminUser,
  typedEmail: string,
  io: {
    write: (
      method: 'POST' | 'DELETE',
      path: string,
      body: unknown,
      invalidate: string[],
    ) => Promise<unknown>;
    signOut: () => void | Promise<void>;
  },
): Promise<{ text: string; error: boolean }> {
  const req = wipeRequest(kind, user, typedEmail);
  let response: unknown;
  try {
    response = await io.write(req.method, req.path, req.body, [adminUsersSpec.path, adminPendingPath]);
  } catch (failure) {
    return { text: wipeFailure(kind, failure), error: true };
  }
  const reply = (response ?? {}) as { signedOut?: unknown; defaultsSeeded?: unknown };
  if (kind === 'reset' && reply.signedOut === true) {
    await io.signOut();
    return { text: 'Your data was reset. Sign in again to start fresh.', error: false };
  }
  return { text: wipeDone(kind, user, reply.defaultsSeeded !== false), error: false };
}
