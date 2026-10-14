import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Icon,
  ListRow,
  Notice,
  PageLayout,
  Section,
  Stack,
  StatusIndicator,
  TabPanel,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useAccountContext } from '../../account/AccountProvider';
import { authPlatform } from '../../../integrations/auth/platform';
import {
  openOuraApp,
  openOuraConsent,
  openOuraSettings,
  ouraSettingsAvailable,
  type OuraSettingsPage,
} from '../../../integrations/oura/platform';
import {
  connectOura,
  disconnectOura,
  finishOuraCallback,
  ouraMessage,
  parseOuraCallback,
  readOuraStatus,
  type OuraStatus,
} from '../data/oura';

const CHECKLIST: { title: string; steps: string; page: OuraSettingsPage; button: string }[] = [
  {
    title: 'Battery: Unrestricted',
    steps: 'Apps → Oura → Battery → Unrestricted, so Android never pauses its sync.',
    page: 'apps',
    button: 'Open apps',
  },
  {
    title: 'Never sleeping apps',
    steps: 'Battery → Background usage limits → Never sleeping apps → add Oura.',
    page: 'device-care',
    button: 'Open battery',
  },
  {
    title: 'Nearby devices',
    steps: 'Apps → Oura → Permissions → Nearby devices → Allow, so it can reach the ring.',
    page: 'apps',
    button: 'Open apps',
  },
];

export function OuraScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const account = useAccountContext();
  const connection = account.dataReader;
  const client = authPlatform.client;
  const [status, setStatus] = useState<OuraStatus | null>(null);
  const [busy, setBusy] = useState<'status' | 'connect' | 'disconnect' | null>('status');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const handled = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!connection) return;
    setBusy('status');
    try {
      setStatus(await readOuraStatus(connection));
      setError(null);
    } catch (cause) {
      setError(ouraMessage(cause));
    } finally {
      setBusy(null);
    }
  }, [connection]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A return that reaches the app as a link (the browser was closed, or the app restarted).
  useEffect(() => {
    if (!connection || !client) return;
    const listener = Linking.addEventListener('url', ({ url }) => {
      const result = parseOuraCallback(url, client);
      if (!result || handled.current.has(url)) return;
      handled.current.add(url);
      setBusy('connect');
      void finishOuraCallback(connection, result).then(async (done) => {
        setError(done.ok ? null : done.message);
        await refresh();
      });
    });
    return () => listener.remove();
  }, [client, connection, refresh]);

  async function connect() {
    if (!connection || !client) return;
    setBusy('connect');
    setError(null);
    const done = await connectOura(connection, client, async (url, redirect) => {
      const opened = await openOuraConsent(url, redirect);
      if (opened.type === 'success' && opened.url) handled.current.add(opened.url);
      return opened;
    });
    if (!done.ok && !done.cancelled) setError(done.message);
    await refresh();
  }
  async function disconnect() {
    if (!connection) return;
    setConfirm(false);
    setBusy('disconnect');
    const done = await disconnectOura(connection);
    setError(done.ok ? null : done.message);
    await refresh();
  }

  const connected = status?.connected === true;
  return (
    <PageLayout title="Oura" onBack={onBack}>
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <Stack direction="row" align="center">
              <Icon name="activity" tone="brand" />
              <AppText variant="heading" style={{ flex: 1 }}>
                Oura account
              </AppText>
              {status && (
                <Badge
                  label={connected ? 'Connected' : 'Not connected'}
                  tone={connected ? 'brand' : 'neutral'}
                />
              )}
            </Stack>
            <AppText tone="muted">
              {connected
                ? 'Your ring’s sleep, readiness and activity reach TrainingAi from Oura after each sync.'
                : 'Connect your Oura account so your ring’s data reaches TrainingAi. You approve it on Oura’s page and come straight back.'}
            </AppText>
            <StatusIndicator
              label={
                busy === 'disconnect'
                  ? 'Disconnecting'
                  : busy === 'connect'
                    ? 'Connecting'
                    : 'Oura status'
              }
              busy={busy !== null}
              error={error}
            />
            {!connection ? (
              <AppText tone="muted">Sign in to connect Oura.</AppText>
            ) : !client ? (
              <AppText tone="muted">
                Connecting Oura needs the TrainingAi app on your phone.
              </AppText>
            ) : connected ? (
              <AppButton
                title="Disconnect"
                variant="secondary"
                disabled={busy !== null}
                onPress={() => setConfirm(true)}
              />
            ) : (
              <AppButton
                title="Connect Oura"
                busy={busy === 'connect'}
                disabled={busy !== null || status === null}
                onPress={() => void connect()}
              />
            )}
          </Card>
          {confirm && (
            <ConfirmationCard
              title="Disconnect Oura?"
              message="TrainingAi stops receiving new Oura data and asks Oura to revoke its access. What is already saved stays."
              confirmLabel="Disconnect"
              cancelLabel="Keep connected"
              danger
              onConfirm={() => void disconnect()}
              onCancel={() => setConfirm(false)}
            />
          )}
          <Card padded={false}>
            <ListRow
              title="Sync now"
              subtitle="Opens the Oura app, which sends its latest data to TrainingAi"
              leading={<Icon name="refresh" />}
              onPress={() => {
                void openOuraApp().then((opened) => {
                  if (!opened) setError('Open the Oura app to sync.');
                });
              }}
              divider={false}
            />
          </Card>
          {ouraSettingsAvailable && (
            <Section title="Keep Oura syncing in the background">
              <AppText
                variant="caption"
                tone="muted"
                style={{ paddingHorizontal: theme.spacing.lg }}
              >
                Samsung phones pause apps they think are idle. These three settings keep the Oura
                app syncing on its own.
              </AppText>
              {CHECKLIST.map((item, index) => (
                <ListRow
                  key={item.title}
                  title={item.title}
                  subtitle={item.steps}
                  leading={<Icon name="settings" />}
                  trailing={
                    <AppText variant="caption" tone="brand">
                      {item.button}
                    </AppText>
                  }
                  divider={index < CHECKLIST.length - 1}
                  onPress={() => {
                    void openOuraSettings(item.page).then((opened) => {
                      if (!opened) setError('Open Settings on your phone to change this.');
                    });
                  }}
                />
              ))}
            </Section>
          )}
          {error && status === null && busy === null && (
            <Notice title="Oura status unavailable" message={error} error />
          )}
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
