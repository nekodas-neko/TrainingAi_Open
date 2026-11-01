import { useEffect } from 'react';
import { useStrap } from '../../devices/strap/StrapProvider';
import { liveHrView } from '../../devices/strap/labels';
import type { createPipReporter } from '../pip/usePictureInPicture';

/**
 * Feeds the strap's reading to the picture-in-picture window. It renders nothing and sits on its
 * own so a reading a second re-renders this, not the workout screen. The window shows "—" once
 * the reading is older than the strap's stale limit; it keeps its own clock for that (#3266).
 */
export function PipHeartRate({
  reporter,
  profile,
}: {
  reporter: ReturnType<typeof createPipReporter>;
  profile: { maxHr: number; restingHr: number } | null;
}) {
  const { state } = useStrap();
  useEffect(() => {
    if (!state.paired || state.bpmAt === null) {
      reporter.heartRate(null);
      return;
    }
    const view = liveHrView(state, state.bpmAt, null, profile);
    reporter.heartRate(
      view.bpm === null || !view.live
        ? null
        : {
            bpm: view.bpm,
            zoneName: view.zone?.name ?? null,
            zoneColor: view.zone?.color ?? null,
            at: state.bpmAt,
          },
    );
  }, [reporter, state, profile]);
  return null;
}
