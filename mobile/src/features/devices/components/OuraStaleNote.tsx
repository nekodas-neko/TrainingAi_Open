import { ouraStaleLine } from '@trainingai/shared/health/oura-freshness';
import { AppText } from '../../../shared/ui';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useOuraFeed } from '../OuraFeedProvider';

/**
 * "Oura · updated 7:05 am", quiet, on the Readiness and Sleep cards (#2861). Drawn only once the
 * latest Oura data is more than three hours old; fresh data, or no Oura connection, draws nothing.
 * The Devices screen carries the permanent status.
 */
export function OuraStaleNote() {
  const { timezone } = useHealthData();
  const { lastDataAt, now } = useOuraFeed();
  const line = now > 0 ? ouraStaleLine(lastDataAt, now, timezone) : null;
  if (!line) return null;
  return (
    <AppText variant="caption" tone="muted">
      {line}
    </AppText>
  );
}
