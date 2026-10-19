import { useEffect } from 'react';
import { Linking } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Icon,
  ListRow,
  Notice,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useStrap, useStrapHold } from '../strap/StrapProvider';
import { strapBlocker, strapLinkLabel } from '../strap/labels';

// The current app's "Heart-rate strap" card (components/settings/chest-strap-pairing.tsx): pair,
// see the link and battery, connect or forget. Opening this screen holds the link so the readout
// is live; leaving it lets go unless a workout is running.
export function ChestStrapCard() {
  const { state, session } = useStrap();
  useStrapHold('settings');
  useEffect(() => () => session.endScan(), [session]);
  const blocker = state.ready ? strapBlocker(state) : null;
  const paired = state.paired;
  const connected = state.link === 'connected';
  const noneFound = !state.scanning && state.found.length === 0 && state.scanError === null;
  return (
    <Card>
      <Stack direction="row" align="center">
        <Icon name="health" tone="danger" />
        <AppText variant="heading" style={{ flex: 1 }}>
          Heart-rate strap
        </AppText>
        {paired && (
          <Badge
            label={connected ? 'Connected' : 'Not connected'}
            tone={connected ? 'brand' : 'neutral'}
          />
        )}
      </Stack>
      {paired ? (
        <Stack>
          <AppText>{paired.name}</AppText>
          <AppText variant="caption" tone="muted">
            {strapLinkLabel(state)}
            {paired.battery !== null ? ` · Battery ${paired.battery}%` : ''}
          </AppText>
          {connected && state.bpm !== null && state.worn && (
            <AppText variant="caption" tone="brand">
              {state.bpm} bpm
            </AppText>
          )}
          <Stack direction="row">
            {!connected && !blocker && (
              <AppButton
                title={state.link === 'connecting' ? 'Connecting…' : 'Connect'}
                variant="secondary"
                disabled={state.link === 'connecting'}
                onPress={() => void session.retry()}
              />
            )}
            <AppButton title="Forget" variant="secondary" onPress={() => void session.forget()} />
          </Stack>
        </Stack>
      ) : (
        <Stack>
          <AppButton
            title={state.scanning ? 'Scanning…' : 'Pair a heart-rate strap'}
            variant="secondary"
            busy={state.scanning}
            disabled={!state.ready || !state.available || state.scanning}
            onPress={() => void session.scan()}
          />
          {state.found.map((device, index) => (
            <ListRow
              key={device.id}
              title={device.name ?? 'Heart-rate strap'}
              subtitle={device.rssi === null ? undefined : `Signal ${device.rssi} dBm`}
              leading={<Icon name="health" />}
              trailing={
                <AppText variant="caption" tone="brand">
                  Pair
                </AppText>
              }
              divider={index < state.found.length - 1}
              onPress={() => void session.pair(device)}
            />
          ))}
          {state.scanError && (
            <StatusIndicator
              label="Scan"
              error={state.scanError}
              onRetry={() => void session.scan()}
            />
          )}
          {noneFound && state.permission === 'granted' && state.radio === 'on' && state.ready && (
            <AppText variant="caption" tone="muted">
              {state.scanned
                ? 'No strap found. Wet the electrodes, put the strap on and keep the phone close, then scan again.'
                : 'Put the strap on first: it only advertises while it touches skin.'}
            </AppText>
          )}
        </Stack>
      )}
      {blocker && (
        <Stack>
          <Notice title={blocker.title} message={blocker.message} error />
          {state.permission === 'denied' && (
            <AppButton
              title="Allow Bluetooth"
              variant="secondary"
              onPress={() => void session.allowAccess()}
            />
          )}
          {state.permission === 'blocked' && (
            <AppButton
              title="Open settings"
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          )}
        </Stack>
      )}
      <AppText variant="caption" tone="muted">
        During a workout TrainingAi connects to the strap, shows your live heart rate and saves it
        to the workout. Never pair it in Android’s Bluetooth settings; pair it here.
      </AppText>
    </Card>
  );
}
