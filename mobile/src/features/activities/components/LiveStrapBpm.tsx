import { useEffect, useRef } from 'react';
import { AppText, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useClock } from '../../../shared/hooks/useClock';
import { useStrap } from '../../devices/strap/StrapProvider';
import { liveBpmWaitingText, liveHrView } from '../../devices/strap/labels';
import { useStrapSession } from '../../devices/strap/StrapProvider';
import { CadenceMeter } from '../data/walk-pace';
import { cadenceReadout } from '../data/live-cadence';

/**
 * The strap's live step rate while `enabled`. It holds the accelerometer stream for as long as it
 * is enabled (the session counts holders, so the guided walk's pacer can hold it too) and reads it
 * with the same `CadenceMeter` the pacer does.
 */
function useLiveCadence(enabled: boolean, now: number): number | null {
  const session = useStrapSession();
  const meter = useRef(new CadenceMeter());
  useEffect(() => {
    if (!session || !enabled) return;
    meter.current.reset();
    const release = session.holdAccelerometer();
    const stop = session.onAccelerometer((batch) => meter.current.push(batch));
    return () => {
      stop();
      release();
    };
  }, [session, enabled]);
  return enabled ? meter.current.live(now) : null;
}

/**
 * The strap's heart rate while a walk, run or guided walk is recording (#3527). Shown only with a
 * strap paired; the same smoothed reading the workout's Live HR card uses, dimmed when it is held
 * rather than live.
 */
export function LiveStrapBpm({ cadence = false }: { cadence?: boolean }) {
  const { theme } = useTheme();
  const { state } = useStrap();
  const now = useClock(!!state.paired);
  const spm = useLiveCadence(cadence && !!state.paired, now);
  if (!state.paired) return null;
  const view = liveHrView(state, now, null, null);
  const readout = cadence ? cadenceReadout(state, spm) : null;
  const bpmRow = (
    <Stack direction="row" align="center" gap="xs" style={{ opacity: view.stale ? 0.7 : 1 }}>
      <Icon name="health" color={theme.colors.brand} />
      {view.bpm === null ? (
        <AppText variant="caption" tone="muted">
          {liveBpmWaitingText(state)}
        </AppText>
      ) : (
        <>
          <AppText
            variant="metric"
            accessibilityLabel={`${view.bpm} bpm${view.live ? '' : ', last reading'}`}
          >
            {view.bpm}
          </AppText>
          <AppText variant="micro" tone="muted">
            bpm{view.live ? '' : ' · last reading'}
          </AppText>
        </>
      )}
    </Stack>
  );
  if (!readout) return bpmRow;
  return (
    <Stack align="center" gap="xs">
      {bpmRow}
      <Stack direction="row" align="center" gap="xs">
        <Icon name="legs" color={theme.colors.brand} />
        {'spm' in readout ? (
          <>
            <AppText variant="metric" accessibilityLabel={`${readout.spm} steps per minute`}>
              {readout.spm}
            </AppText>
            <AppText variant="micro" tone="muted">
              spm
            </AppText>
          </>
        ) : (
          <AppText variant="caption" tone="muted">
            {readout.waiting}
          </AppText>
        )}
      </Stack>
    </Stack>
  );
}
