import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Card, IconButton, Notice, Stack, TextField } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
import { adminInvitesSpec, inviteEmail, removeInviteConfirm } from '../data/admin-users';
import { ConfirmSheet } from './ConfirmSheet';

export function AdminInvitesPanel({ emails }: { emails: readonly string[] }) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const email = inviteEmail(input);

  async function change(
    key: string,
    method: 'POST' | 'DELETE',
    target: string,
    done: string,
    failed: string,
  ) {
    if (!resources || busy) return;
    setBusy(key);
    setNotice(null);
    try {
      await resources.write(method, '/api/admin/invites', { email: target }, [adminInvitesSpec.path]);
      if (method === 'POST') setInput('');
      setNotice({ text: done, error: false });
    } catch (failure) {
      setNotice({ text: failureNotice(failed, failure), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
        <TextField
          label="Invite email"
          hideLabel
          value={input}
          onChangeText={setInput}
          placeholder="email@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() =>
            email && void change('add', 'POST', email, `${email} added to invite list`, 'Failed to add invite')
          }
        />
        <AppButton
          title="Add"
          icon="plus"
          busy={busy === 'add'}
          disabled={!email || !!busy}
          onPress={() =>
            void change('add', 'POST', email, `${email} added to invite list`, 'Failed to add invite')
          }
        />
      </View>
      {notice && <Notice title={notice.error ? 'Could not do that' : 'Done'} message={notice.text} error={notice.error} />}
      {emails.map((address) => (
        <Card key={address}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <AppText style={{ flex: 1 }} numberOfLines={1}>
              {address}
            </AppText>
            <IconButton
              icon="delete"
              label={`Remove ${address}`}
              tone="danger"
              busy={busy === `remove:${address}`}
              disabled={!!busy}
              onPress={() => setRemoving(address)}
            />
          </View>
        </Card>
      ))}
      {emails.length === 0 && (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          No invites yet. Add an email above to pre-approve a user.
        </AppText>
      )}
      {removing && (
        <ConfirmSheet
          {...removeInviteConfirm(removing)}
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            void change(
              `remove:${removing}`,
              'DELETE',
              removing,
              'Removed from invite list',
              'Failed to remove invite',
            )
          }
        />
      )}
    </Stack>
  );
}
