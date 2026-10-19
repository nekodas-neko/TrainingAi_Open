import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { CATEGORICAL_PALETTE, categoricalColor } from '@trainingai/shared/chart-colors';
import { AppText, nativeColor } from '../../../shared/ui';
import { formatDuration } from '../../../shared/hooks/useClock';
import { usePipNow } from './usePictureInPicture';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { pipClock, pipViewFor, type PipView } from './pip';

// The current app's PiP window (components/workout/pip-view.tsx), drawn over the whole app while
// it is a picture-in-picture window. Its sizes and colours are the current app's, not theme
// tokens: the window is always black, whatever the app's theme.
const REST_COLOR = '#94a3b8';
const OVER_COLOR = '#f87171';
const D = 144;
const R = 56;
const CIRC = 2 * Math.PI * R;
const faint = 'rgba(255,255,255,0.35)';

export function WorkoutPipOverlay() {
  const { data } = useWorkoutJournal();
  const workout = data.workouts.find((x) => x.status === 'active') ?? null;
  const view = pipViewFor(workout);
  return (
    <View style={[StyleSheet.absoluteFill, styles.window]} accessibilityLabel="Workout">
      {view?.kind === 'timer' ? (
        <TimerView view={view} />
      ) : view ? (
        <>
          <AppText variant="pipDone" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Done
          </AppText>
          <AppText variant="pipName" style={[styles.centred, { color: 'white' }]}>
            {view.exerciseName}
          </AppText>
          <AppText variant="pipHint" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Tap Next to continue
          </AppText>
        </>
      ) : null}
    </View>
  );
}

function setColor(index: number) {
  return (
    nativeColor(categoricalColor(index)) ?? CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length]
  );
}

function TimerView({ view }: { view: Extract<PipView, { kind: 'timer' }> }) {
  const now = usePipNow();
  const clock = pipClock(view, now);
  const arcColor =
    view.phase === 'rest' ? (clock.overTime ? OVER_COLOR : REST_COLOR) : setColor(view.currentSet);
  const arcLen = clock.fraction * CIRC;
  // The set arc pulses, as the current app's <animate> on stroke-opacity does. On the native
  // driver, since JS frames stop while the activity is paused in the window.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (view.phase !== 'set') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [view.phase, pulse]);
  return (
    <>
      <AppText numberOfLines={1} variant="pipCaption" style={[styles.centred, { color: faint }]}>
        {view.exerciseName}
      </AppText>
      <View style={{ width: D, height: D }}>
        <Svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={StyleSheet.absoluteFill}>
          <Circle
            cx={D / 2}
            cy={D / 2}
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={9}
          />
        </Svg>
        {arcLen > 0 && (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: pulse }]}>
            <Svg width={D} height={D} viewBox={`0 0 ${D} ${D}`}>
              <G rotation={-90} origin={`${D / 2}, ${D / 2}`}>
                <Circle
                  cx={D / 2}
                  cy={D / 2}
                  r={R}
                  fill="none"
                  stroke={arcColor}
                  strokeWidth={9}
                  strokeLinecap="round"
                  strokeDasharray={`${arcLen} ${CIRC - arcLen}`}
                />
              </G>
            </Svg>
          </Animated.View>
        )}
        <View style={[StyleSheet.absoluteFill, styles.centre]}>
          <AppText
            variant="pipClock"
            style={{ color: clock.overTime ? OVER_COLOR : 'white' }}
            accessibilityLabel={`${formatDuration(clock.seconds)} elapsed`}
          >
            {formatDuration(clock.seconds)}
          </AppText>
          {view.phase === 'rest' && view.restTargetSec > 0 && (
            <AppText
              variant="pipCaption"
              style={{ color: clock.overTime ? OVER_COLOR : 'rgba(255,255,255,0.4)' }}
            >
              {clock.overTime
                ? `+${formatDuration(clock.over)}`
                : `/ ${formatDuration(view.restTargetSec)}`}
            </AppText>
          )}
          <AppText variant="pipCaption" style={{ color: faint }}>
            {clock.label}
          </AppText>
        </View>
      </View>
      {view.load && (
        <AppText variant="pipLoad" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {view.load}
        </AppText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  window: {
    backgroundColor: 'black',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    zIndex: 1000,
    elevation: 1000,
  },
  centred: { textAlign: 'center', paddingHorizontal: 12 },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
