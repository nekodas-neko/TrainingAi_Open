import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { formatKg } from '@trainingai/shared/format/units';
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
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting';
import { useScale, useScaleHold } from '../scale/ScaleProvider';
import { scaleBlocker, scaleLinkLabel, resultText } from '../scale/labels';
import {
  scaleTodaySpec,
  scaleWaitingSpec,
  scaleWritePaths,
  type WaitingWeighIn,
} from '../scale/data';

// The current app's "Body-composition scale" card (components/settings/scale-pairing.tsx): pair,
// see the link, today's weigh-ins, and the pending and declined readings that need an answer. Who
// a weigh-in belongs to is decided by the server; this only shows its verdict and carries the
// answers back. Opening this screen holds the link so a weigh-in is caught while it is open.
export function ScaleCard() {
  const { state, session } = useScale();
  useScaleHold('settings');
  useEffect(() => () => session.endScan(), [session]);
  const { timezone } = useWorkoutContext();
  const waiting = useWorkoutResource(scaleWaitingSpec);
  const today = useWorkoutResource(scaleTodaySpec);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A weigh-in filed by the link changes both lists; the provider invalidates, this re-reads.
  const resources = waiting.resources;
  const blocker = state.ready ? scaleBlocker(state) : null;
  const paired = state.paired;
  const connected = state.phase === 'connected' || state.phase === 'weighing';
  const noneFound =
    !state.scanning && state.found.length === 0 && state.scanError === null;
  const pending = waiting.data?.pending ?? [];
  const declined = waiting.data?.dismissed ?? [];
  const readings = today.data?.readings ?? [];

  async function answer(row: WaitingWeighIn, verb: 'confirm' | 'dismiss' | 'claim') {
    if (!resources) return;
    setBusyId(row.id);
    setError(null);
    try {
      await resources.write(
        'POST',
        `/api/scale-ble/pending/${row.id}/${verb === 'dismiss' ? 'dismiss' : 'confirm'}`,
        {},
        // Confirming files the weight; dismissing only moves the reading off the list.
        verb === 'dismiss' ? ['/api/scale-ble'] : scaleWritePaths,
      );
      void resources.refreshVisible();
    } catch (failure) {
      setError(failureNotice(`Could not ${verb} the reading.`, failure));
    } finally {
      setBusyId(null);
    }
  }

  const result = state.result ? resultText(state.result) : null;
  return (
    <Card>
      <Stack direction="row" align="center">
        <Icon name="scale" />
        <AppText variant="heading" style={{ flex: 1 }}>
          Body-composition scale
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
            {scaleLinkLabel(state)}
            {state.queued > 0 ? ` · ${state.queued} to file` : ''}
          </AppText>
          {result && (
            <Stack>
              <AppText
                variant="label"
                tone={state.result?.kind === 'failed' ? 'danger' : 'brand'}
              >
                {result.title}
              </AppText>
              {result.description && (
                <AppText variant="caption" tone="muted">
                  {result.description}
                </AppText>
              )}
            </Stack>
          )}
          <Stack direction="row">
            {!connected && !blocker && state.phase !== 'connecting' && (
              <AppButton
                title="Look for the scale"
                variant="secondary"
                onPress={() => void session.retry()}
              />
            )}
            <AppButton
              title="Forget"
              variant="secondary"
              onPress={() => void session.forget()}
            />
          </Stack>
        </Stack>
      ) : (
        <Stack>
          <AppButton
            title={state.scanning ? 'Scanning…' : 'Pair a scale'}
            variant="secondary"
            busy={state.scanning}
            disabled={!state.ready || !state.available || state.scanning}
            onPress={() => void session.scan()}
          />
          {state.found.map((device, index) => (
            <ListRow
              key={device.id}
              title={device.name ?? 'Scale'}
              subtitle={device.rssi === null ? undefined : `Signal ${device.rssi} dBm`}
              leading={<Icon name="scale" />}
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
          {noneFound &&
            state.permission === 'granted' &&
            state.radio === 'on' &&
            state.ready && (
              <AppText variant="caption" tone="muted">
                {state.scanned
                  ? 'No scale found. Step on it to wake it, keep the phone close, then scan again.'
                  : 'Step on the scale first: it only advertises for a few seconds after it wakes.'}
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
      {error && (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      )}
      {readings.length > 0 && (
        <Stack>
          <AppText variant="eyebrow" tone="muted">
            Today’s weigh-ins
          </AppText>
          {readings.map((row) => (
            <Stack key={row.id} direction="row" align="center">
              <AppText style={{ flex: 1 }}>
                {formatTimeOfDay(row.measuredAt, timezone)}
                {' — '}
                {row.weightKg !== undefined ? formatKg(row.weightKg) : 'unknown'}
                {row.bodyFatPct !== undefined ? ` · ${row.bodyFatPct}% fat` : ''}
              </AppText>
              {row.isTrend && (
                <AppText variant="eyebrow" tone="muted">
                  Trend
                </AppText>
              )}
            </Stack>
          ))}
        </Stack>
      )}
      {pending.length > 0 && (
        <Stack>
          <AppText variant="eyebrow" tone="muted">
            Pending weigh-ins
          </AppText>
          {pending.map((row) => (
            <Stack key={row.id} direction="row" align="center">
              <AppText style={{ flex: 1 }}>
                {row.weightKg !== null ? formatKg(row.weightKg) : 'Unknown weight'}
              </AppText>
              <AppButton
                title="Not me"
                variant="secondary"
                disabled={busyId === row.id}
                onPress={() => void answer(row, 'dismiss')}
              />
              <AppButton
                title="It’s me"
                disabled={busyId === row.id}
                onPress={() => void answer(row, 'confirm')}
              />
            </Stack>
          ))}
        </Stack>
      )}
      {declined.length > 0 && (
        <Stack>
          <AppText variant="eyebrow" tone="muted">
            Declined weigh-ins
          </AppText>
          <AppText variant="caption" tone="muted">
            Declined by mistake? Claiming one files it and re-anchors your weight range.
          </AppText>
          {declined.map((row) => (
            <Stack key={row.id} direction="row" align="center">
              <AppText style={{ flex: 1 }}>
                {row.weightKg !== null ? formatKg(row.weightKg) : 'Unknown weight'}
                {'  '}
                <AppText variant="caption" tone="muted">
                  {formatTimeOfDay(row.measuredAt, timezone)}
                </AppText>
              </AppText>
              <AppButton
                title="It’s me"
                disabled={busyId === row.id}
                onPress={() => void answer(row, 'claim')}
              />
            </Stack>
          ))}
        </Stack>
      )}
      <AppText variant="caption" tone="muted">
        While this screen is open TrainingAi connects to the scale and files each
        weigh-in; step on it and it is caught here. Never pair it in Android’s Bluetooth
        settings; pair it here.
      </AppText>
    </Card>
  );
}
