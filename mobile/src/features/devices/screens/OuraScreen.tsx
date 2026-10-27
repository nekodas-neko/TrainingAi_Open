import { useCallback, useEffect, useState } from 'react';
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
import { useHealthData } from '../../health/data/HealthDataProvider';
import { ouraFeedStatus } from '@trainingai/shared/health/oura-freshness';
import { authPlatform } from '../../../integrations/auth/platform';
import {
  openOuraApp,
  openOuraConsent,
  openOuraSettings,
  ouraSettingsAvailable,
  type OuraSettingsPage,
} from '../../../integrations/oura/platform';
import {
  CONNECT_STARTED_KEY,
  OuraReturns,
  connectOura,
  connectStartedRecently,
  disconnectOura,
  ouraMessage,
  parseOuraCallback,
  readOuraStatus,
  type OuraResult,
  type OuraStatus,
} from '../data/oura';
import { ChestStrapCard } from '../components/ChestStrapCard';
import { RingBatteryCard } from '../components/RingBatteryCard';
import { ScaleCard } from '../components/ScaleCard';

const CHECKLIST: { title: string; steps: string; page: OuraSettingsPage; button: string }[] = [
  {
    title: 'Battery: Unrestricted',
    steps: 'Oura’s App info → Battery → Unrestricted, so Android never pauses its sync.',
    page: 'oura-app-info',
    button: 'App info',
  },
  {
    title: 'Never sleeping apps',
    steps: 'Battery → Background usage limits → Never sleeping apps → add Oura.',
    page: 'device-care',
    button: 'Open battery',
  },
  {
    title: 'Nearby devices',
    steps: 'Oura’s App info → Permissions → Nearby devices → Allow, so it can reach the ring.',
    page: 'oura-app-info',
    button: 'App info',
  },
];

// One per app process, so a remount or a repeated effect never finishes a return twice.
const returns = new OuraReturns();
let initialReturnTaken = false;
/**
 * The link that launched the app, when it is this build's Oura return: Android killed the app
 * while Oura's page was open, and the return started it again. Given out once per process, since
 * `getInitialURL` keeps answering with the same link for as long as the app runs.
 */
export async function takeInitialOuraReturn(): Promise<string | null> {
  const client = authPlatform.client;
  if (!client || initialReturnTaken) return null;
  initialReturnTaken = true;
  const url = await Linking.getInitialURL().catch(() => null);
  return url && parseOuraCallback(url, client) ? url : null;
}

type ActionError = { title: string; message: string };

export function OuraScreen({
  onBack,
  initialReturn = null,
  openSignedInDevices,
}: {
  onBack: () => void;
  initialReturn?: string | null;
  openSignedInDevices?: () => void;
}) {
  const { theme } = useTheme();
  const account = useAccountContext();
  const health = useHealthData();
  const connection = account.dataReader;
  const client = authPlatform.client;
  const [status, setStatus] = useState<OuraStatus | null>(null);
  const [busy, setBusy] = useState<'status' | 'connect' | 'disconnect' | null>(() =>
    connection ? 'status' : null,
  );
  // Loading the status and the last action fail separately: a status reload must never wipe
  // the reason a connect or disconnect was refused.
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [confirm, setConfirm] = useState(false);

  const refresh = useCallback(async () => {
    if (!connection) {
      setBusy(null);
      return;
    }
    setBusy('status');
    try {
      setStatus(await readOuraStatus(connection));
      setStatusError(null);
    } catch (cause) {
      setStatusError(ouraMessage(cause));
    } finally {
      setBusy(null);
    }
  }, [connection]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reportConnect = useCallback((done: OuraResult) => {
    if (!done.ok && !done.cancelled)
      setActionError({ title: 'Oura was not connected', message: done.message });
  }, []);

  // A return that reaches the app as a link while it is running. During connect() the consent
  // browser hands back the same link and connect() reports it; `returns` makes both share one
  // `/complete` call. A link that arrives just after the browser reported "closed" lands here.
  useEffect(() => {
    if (!connection || !client) return;
    const listener = Linking.addEventListener('url', ({ url }) => {
      const connecting = returns.connecting;
      const finishing = returns.finish(url, client, connection);
      if (!finishing || connecting) return;
      setBusy('connect');
      void finishing.then(async (done) => {
        reportConnect(done);
        await refresh();
      });
    });
    return () => listener.remove();
  }, [client, connection, refresh, reportConnect]);

  // A return that cold-started the app. It is the one return accepted without a connect open in
  // this process, and only when this phone saved that it started a connect within the lifetime
  // of the server's pending handle; anything else is a stray link and is ignored. The server
  // still refuses a handle that another account started.
  useEffect(() => {
    if (!initialReturn || !connection || !client) return;
    let active = true;
    void (async () => {
      const saved = await authPlatform.get(CONNECT_STARTED_KEY).catch(() => null);
      if (!connectStartedRecently(saved)) return;
      const finishing = returns.finish(initialReturn, client, connection, { coldStart: true });
      await authPlatform.remove(CONNECT_STARTED_KEY).catch(() => undefined);
      if (!finishing) return;
      if (active) setBusy('connect');
      const done = await finishing;
      if (!active) return;
      reportConnect(done);
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, [client, connection, initialReturn, refresh, reportConnect]);

  async function connect() {
    if (!connection || !client) return;
    setActionError(null);
    setBusy('connect');
    await authPlatform.set(CONNECT_STARTED_KEY, String(Date.now())).catch(() => undefined);
    const done = await connectOura(connection, client, openOuraConsent, returns);
    await authPlatform.remove(CONNECT_STARTED_KEY).catch(() => undefined);
    reportConnect(done);
    await refresh();
  }
  async function disconnect() {
    if (!connection) return;
    setConfirm(false);
    setActionError(null);
    setBusy('disconnect');
    const done = await disconnectOura(connection);
    if (!done.ok) setActionError({ title: 'Oura is still connected', message: done.message });
    await refresh();
  }

  const connected = status?.connected === true;
  return (
    <PageLayout title="Devices" onBack={onBack}>
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
            {connected && status && (
              <AppText variant="caption" tone="muted">
                {ouraFeedStatus(status, Date.now(), health.timezone)}
              </AppText>
            )}
            <StatusIndicator
              label={
                busy === 'disconnect'
                  ? 'Disconnecting'
                  : busy === 'connect'
                    ? 'Connecting'
                    : 'Oura status'
              }
              busy={busy !== null}
              error={statusError}
              onRetry={() => void refresh()}
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
            ) : status === null && busy === null ? (
              <AppButton title="Try again" variant="secondary" onPress={() => void refresh()} />
            ) : (
              <AppButton
                title="Connect Oura"
                busy={busy === 'connect'}
                disabled={busy !== null || status === null}
                onPress={() => void connect()}
              />
            )}
          </Card>
          {actionError && <Notice title={actionError.title} message={actionError.message} error />}
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
                  if (!opened)
                    setActionError({
                      title: 'Oura did not open',
                      message: 'Open the Oura app to sync.',
                    });
                });
              }}
              divider={false}
            />
          </Card>
          {connected && <RingBatteryCard />}
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
                      if (!opened)
                        setActionError({
                          title: 'Settings did not open',
                          message: 'Open Settings on your phone to change this.',
                        });
                    });
                  }}
                />
              ))}
            </Section>
          )}
          {statusError && status === null && busy === null && (
            <Notice title="Oura status unavailable" message={statusError} error />
          )}
          <ChestStrapCard />
          <ScaleCard />
          {openSignedInDevices && connection && (
            <Card padded={false}>
              <ListRow
                title="Signed-in devices"
                subtitle="See where you are signed in, and sign other devices out"
                leading={<Icon name="lock" />}
                onPress={openSignedInDevices}
                divider={false}
              />
            </Card>
          )}
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
