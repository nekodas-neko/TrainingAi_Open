import { AppText, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useClock } from '../../../shared/hooks/useClock';
import { useStrap } from '../../devices/strap/StrapProvider';
import { liveBpmWaitingText, liveHrView } from '../../devices/strap/labels';

/**
 * The strap's heart rate while a walk, run or guided walk is recording (#3527). Shown only with a
 * strap paired; the same smoothed reading the workout's Live HR card uses, dimmed when it is held
 * rather than live.
 */
export function LiveStrapBpm() {
  const { theme } = useTheme();
  const { state } = useStrap();
  const now = useClock(!!state.paired);
  if (!state.paired) return null;
  const view = liveHrView(state, now, null, null);
  return (
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
}
