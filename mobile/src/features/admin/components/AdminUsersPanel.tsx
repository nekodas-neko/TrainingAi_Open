import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Avatar, Badge, Card, IconButton, Notice, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
import {
  actionFailure,
  adminPendingPath,
  adminUsersSpec,
  partitionUsers,
  userActionConfirm,
  userActionDone,
  userActions,
  userLabel,
  type AdminUser,
  type UserAction,
} from '../data/admin-users';
import { ConfirmSheet } from './ConfirmSheet';

const icons: Record<UserAction, { icon: 'check' | 'close' | 'delete' | 'shield' | 'shieldPlain'; label: string }> = {
  activate: { icon: 'check', label: 'Activate' },
  deactivate: { icon: 'close', label: 'Deactivate' },
  delete: { icon: 'delete', label: 'Delete user' },
  'grant-admin': { icon: 'shield', label: 'Make admin' },
  'revoke-admin': { icon: 'shieldPlain', label: 'Remove admin' },
};

export function AdminUsersPanel({
  users,
  currentUserId,
}: {
  users: readonly AdminUser[];
  currentUserId: string | null;
}) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ action: UserAction; user: AdminUser } | null>(null);
  const { pending, deactivated, active } = partitionUsers(users);

  async function run(action: UserAction, user: AdminUser) {
    if (!resources || busy) return;
    setBusy(`${action}:${user.id}`);
    setNotice(null);
    try {
      const invalidate = [adminUsersSpec.path, adminPendingPath];
      if (action === 'delete')
        await resources.write('DELETE', '/api/admin/users', { userId: user.id }, invalidate);
      else await resources.write('PATCH', '/api/admin/users', { userId: user.id, action }, invalidate);
      setNotice({ text: userActionDone[action], error: false });
    } catch (failure) {
      setNotice({ text: failureNotice(actionFailure(action, failure), failure), error: true });
    } finally {
      setBusy(null);
    }
  }
  function ask(action: UserAction, user: AdminUser) {
    if (userActionConfirm(action, user)) setConfirm({ action, user });
    else void run(action, user);
  }

  const group = (title: string, rows: readonly AdminUser[]) =>
    rows.length === 0 ? null : (
      <Stack gap="sm" key={title}>
        <AppText variant="caption" tone="muted">
          {title.toUpperCase()}
        </AppText>
        {rows.map((user) => (
          <Card key={user.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={userLabel(user)} uri={user.avatar} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label" numberOfLines={1}>
                  {user.displayName || user.name || '—'}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {user.email}
                </AppText>
              </View>
              {user.isAdmin && <Badge label="Admin" tone="brand" />}
              <Badge
                label={user.isActive ? 'Active' : user.hasData === false ? 'Pending' : 'Deactivated'}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
              {userActions(user, user.id === currentUserId).map((action) => (
                <IconButton
                  key={action}
                  icon={icons[action].icon}
                  label={`${icons[action].label}: ${userLabel(user)}`}
                  tone={action === 'delete' || action === 'deactivate' ? 'danger' : 'brand'}
                  busy={busy === `${action}:${user.id}`}
                  disabled={!!busy}
                  onPress={() => ask(action, user)}
                />
              ))}
            </View>
          </Card>
        ))}
      </Stack>
    );

  const sheet = confirm && userActionConfirm(confirm.action, confirm.user);
  return (
    <Stack>
      {notice && <Notice title={notice.error ? 'Could not do that' : 'Done'} message={notice.text} error={notice.error} />}
      {group('Pending approval', pending)}
      {group('Deactivated', deactivated)}
      {group('Active', active)}
      {users.length === 0 && (
        <AppText tone="muted" style={{ textAlign: 'center' }}>
          No users yet.
        </AppText>
      )}
      {confirm && sheet && (
        <ConfirmSheet
          {...sheet}
          danger={confirm.action !== 'grant-admin'}
          onClose={() => setConfirm(null)}
          onConfirm={() => void run(confirm.action, confirm.user)}
        />
      )}
    </Stack>
  );
}
