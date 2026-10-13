import { useMemo } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Avatar,
  Card,
  IconButton,
  ListRow,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { SocialActions } from '../data/SocialActions';
import { friendName, pendingRequests, type Friendship } from '../data/models';
export function ManageFriendsSheet({
  visible,
  onClose,
  rows,
  openProfile,
}: {
  visible: boolean;
  onClose: () => void;
  rows: Friendship[];
  openProfile: (id: string) => void;
}) {
  const draft = useWorkoutDraft('friend-request', z.object({ value: z.string().max(320) }), {
      value: '',
    }),
    action = useWorkoutAction(),
    { theme } = useTheme();
  const service = useMemo(
    () => (draft.resources ? new SocialActions(draft.resources) : null),
    [draft.resources],
  );
  const { incoming, outgoing } = pendingRequests(rows),
    accepted = rows.filter((row) => row.status === 'accepted');
  async function change(
    kind: 'add' | 'accept' | 'decline' | 'remove',
    value: string,
    row?: Friendship,
  ) {
    if (!service) {
      return;
    }
    if (
      await action.run(
        async () => {
          await service.change(kind, value, row);
          if (kind === 'add') {
            draft.setValue({ value: '' });
          }
        },
        kind === 'add'
          ? 'Friend request sent.'
          : kind === 'accept'
            ? 'Friend request accepted.'
            : kind === 'decline'
              ? 'Request declined.'
              : 'Friendship updated.',
      )
    ) {
      return;
    }
  }
  return (
    <>
      <Sheet fullHeight visible={visible} title="Manage Friends" onClose={onClose}>
        <Stack direction="row" align="center">
          <AppText variant="label" style={{ flex: 1 }}>
            Add friend
          </AppText>
          <StatusIndicator
            label="Friend requests"
            error={action.error ?? draft.error}
            message={action.message}
            busy={action.busy}
          />
        </Stack>
        <TextField
          label="Email or friend code"
          value={draft.value.value}
          onChangeText={(value) => draft.setValue({ value })}
          maxLength={320}
          autoCapitalize="none"
          autoCorrect={false}
          editable={draft.ready && !action.busy}
        />
        <AppButton
          title="Send request"
          disabled={!draft.ready || !draft.value.value.trim()}
          busy={action.busy}
          onPress={() => void change('add', draft.value.value)}
        />
        {!!incoming.length && (
          <>
            <AppText variant="eyebrow" tone="muted">
              Requests ({incoming.length})
            </AppText>
            {incoming.map((row) => (
              <Card key={row.id}>
                <Stack direction="row" align="center">
                  <Avatar
                    name={friendName(row)}
                    uri={row.otherUser.avatar}
                    size={theme.sizes.touchTarget}
                  />
                  <Stack style={{ flex: 1 }} gap="xxs">
                    <AppText variant="label">{friendName(row)}</AppText>
                    {row.otherUser.friendCode && (
                      <AppText variant="micro" tone="muted">
                        {row.otherUser.friendCode}
                      </AppText>
                    )}
                  </Stack>
                  <IconButton
                    icon="check"
                    label={`Accept ${friendName(row)}`}
                    disabled={action.busy}
                    onPress={() => void change('accept', row.id, row)}
                  />
                  <IconButton
                    icon="close"
                    label={`Decline ${friendName(row)}`}
                    disabled={action.busy}
                    onPress={() => void change('decline', row.id, row)}
                  />
                </Stack>
              </Card>
            ))}
          </>
        )}
        {!!outgoing.length && (
          <>
            <AppText variant="eyebrow" tone="muted">
              Sent
            </AppText>
            {outgoing.map((row) => (
              <Card key={row.id}>
                <Stack direction="row" align="center">
                  <Avatar name="?" size={theme.sizes.touchTarget} />
                  <Stack style={{ flex: 1 }} gap="xxs">
                    <AppText variant="label">Request sent</AppText>
                    <AppText variant="caption" tone="muted">
                      {row.otherUser.displayName ?? 'Waiting for them to accept'}
                    </AppText>
                  </Stack>
                  <IconButton
                    icon="close"
                    label="Cancel request"
                    disabled={action.busy}
                    onPress={() => void change('remove', row.id, row)}
                  />
                </Stack>
              </Card>
            ))}
          </>
        )}
        <AppText variant="eyebrow" tone="muted">
          Friends ({accepted.length})
        </AppText>
        {!accepted.length && (
          <AppText variant="caption" tone="muted">
            No friends yet
          </AppText>
        )}
        {accepted.map((row) => (
          <Card key={row.id}>
            <Stack direction="row" align="center">
              <ListRow
                title={friendName(row)}
                subtitle={row.otherUser.friendCode ?? undefined}
                leading={
                  <Avatar
                    name={friendName(row)}
                    uri={row.otherUser.avatar}
                    size={theme.sizes.touchTarget}
                  />
                }
                onPress={() => {
                  onClose();
                  openProfile(row.otherUser.id);
                }}
              />
              <IconButton
                icon="delete"
                label={`Remove ${friendName(row)}`}
                disabled={action.busy}
                onPress={() => void change('remove', row.id, row)}
              />
            </Stack>
          </Card>
        ))}
      </Sheet>
    </>
  );
}
