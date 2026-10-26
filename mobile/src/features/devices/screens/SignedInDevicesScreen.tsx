import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Notice,
  PageLayout,
  Sheet,
  Stack,
  StatusIndicator,
  TabPanel,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useAccountContext } from '../../account/AccountProvider';
import {
  devicesMessage,
  lastUsedLabel,
  readSignedInDevices,
  revokeSignedInDevice,
  signedInLabel,
  type SignedInDevice,
} from '../data/signed-in-devices';

/** More → Devices & connections → Signed-in devices (#3280). */
export function SignedInDevicesScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const connection = useAccountContext().dataReader;
  const tz = connection?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null);
  const [loading, setLoading] = useState(() => !!connection);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<SignedInDevice | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    try {
      setDevices(await readSignedInDevices(connection));
      setLoadError(null);
    } catch (cause) {
      setLoadError(devicesMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [connection]);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke() {
    if (!connection || !target) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeSignedInDevice(connection, target.id);
      setTarget(null);
    } catch (cause) {
      // A 404 means it was already signed out: the list below is the truth, so reload it.
      setRevokeError(devicesMessage(cause));
      setTarget(null);
    } finally {
      setRevoking(false);
    }
    await load();
  }

  const now = new Date();
  const others = devices?.filter((device) => !device.current) ?? [];
  return (
    <PageLayout title="Signed-in devices" onBack={onBack}>
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <AppText variant="caption" tone="muted">
            Revoking a device signs it out the next time it syncs.
          </AppText>
          {!connection && <AppText tone="muted">Sign in to see your devices.</AppText>}
          {connection && (
            <StatusIndicator
              label="Signed-in devices"
              busy={loading}
              error={loadError}
              onRetry={() => void load()}
            />
          )}
          {revokeError && <Notice title="Not signed out" message={revokeError} error />}
          {devices?.map((device) => (
            <Card key={device.id}>
              <Stack direction="row" align="center">
                <AppText variant="heading" style={{ flex: 1 }}>
                  {device.label}
                </AppText>
                {device.current ? (
                  <Badge label="This device" tone="brand" />
                ) : (
                  <AppButton
                    title="Revoke"
                    variant="ghost"
                    textVariant="label"
                    accessibilityLabel={`Revoke ${device.label}`}
                    onPress={() => {
                      setRevokeError(null);
                      setTarget(device);
                    }}
                  />
                )}
              </Stack>
              <AppText variant="caption" tone="muted">
                {signedInLabel(device.signedInAt, tz)} · {lastUsedLabel(device.lastUsedAt, now, tz)}
              </AppText>
            </Card>
          ))}
          {devices && others.length === 0 && (
            <Card tone="neutral">
              <View style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}>
                <AppText variant="heading">No other devices</AppText>
                <AppText tone="muted" style={{ textAlign: 'center' }}>
                  This is the only device signed in to your account.
                </AppText>
              </View>
            </Card>
          )}
        </Stack>
      </TabPanel>
      <Sheet
        visible={target !== null}
        title={target ? `Sign out ${target.label}?` : ''}
        onClose={() => !revoking && setTarget(null)}
      >
        <AppText tone="muted">It will need to sign in again. Your data stays where it is.</AppText>
        <AppButton
          title="Revoke this device"
          variant="danger"
          busy={revoking}
          onPress={() => void revoke()}
        />
        <AppButton
          title="Cancel"
          variant="secondary"
          disabled={revoking}
          onPress={() => setTarget(null)}
        />
      </Sheet>
    </PageLayout>
  );
}
