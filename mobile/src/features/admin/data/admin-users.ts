import { z } from 'zod';

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
