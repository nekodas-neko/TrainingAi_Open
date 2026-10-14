import { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { useUndo } from '../../../shared/ui/undo/UndoProvider';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Card,
  Icon,
  IconButton,
  Stack,
  StatusIndicator,
  Disclosure,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHome } from '../data/HomeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { digestSpec, readinessSpec, profileSpec } from '../../health/data/models';
import {
  goalsReviewDue,
  localHour,
  recapHasData,
  shouldOfferMorning,
} from '../data/banner-data';
import { GoalRecommendation } from '../../nutrition/components/GoalRecommendation';

export function HomeBanners({
  openWeek,
  openReview,
  openMorning,
}: {
  openWeek: (week: string) => void;
  openReview: () => void;
  openMorning: () => void;
}) {
  const { theme } = useTheme();
  const home = useHome();
  const health = useHealthData();
  const resources = useWorkoutResources();
  const profile = useWorkoutResource(profileSpec);
  const readiness = useWorkoutResource(readinessSpec(health.today));
  const week = shiftDateStr(weekStartForDay(health.today), -7);
  const recap = useWorkoutResource(digestSpec(week), !home.markers[`week:${week}`]);
  const undo = useUndo();
  const reduced = useReducedMotion();
  const [goals, setGoals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef('');
  const morningAction = useRef(openMorning);
  morningAction.current = openMorning;
  const morningDismissed = home.markers[`morning-prompt:${health.today}`];
  useEffect(() => {
    if (
      !home.ready ||
      !health.ready ||
      !health.store ||
      morningDismissed ||
      attempted.current === health.today
    ) {
      return;
    }
    attempted.current = health.today;
    let current = true;
    let settled = false;
    void (async () => {
      try {
        const offer = await shouldOfferMorning(health.store!, health.today);
        if (!current || offer === null) {
          return;
        }
        settled = true;
        if (offer) {
          morningAction.current();
        } else {
          await home.store!.mark(`morning-prompt:${health.today}`);
        }
      } catch {}
    })();
    return () => {
      current = false;
      if (!settled) {
        attempted.current = '';
      }
    };
  }, [home.ready, health.ready, home.store, health.store, health.today, morningDismissed]);
  async function mark(key: string) {
    try {
      await home.store?.mark(key);
      setError(null);
    } catch {
      setError('Could not save your dismissal on this phone.');
    }
  }
  const showDay = localHour(health.timezone) >= 17 && !home.markers[`day:${health.today}`];
  const showGoals =
    goalsReviewDue(profile.data?.user) && !home.markers[`goals:${health.today}`];
  const weekReady = !!recap.data?.digest && recapHasData(recap.data.metrics);
  const showWeek = !home.markers[`week:${week}`] && (weekReady || !!recap.error);
  const entries = [
    ...(showGoals
      ? [
          {
            key: `goals:${health.today}`,
            icon: 'target' as const,
            label: 'Goals check-in',
            subtitle: 'Review your nutrition and activity goals',
            open: () => setGoals(true),
          },
        ]
      : []),
    ...(showDay
      ? [
          {
            key: `day:${health.today}`,
            icon: 'nutrition' as const,
            label: 'Day in review ready',
            subtitle: 'Look back at today’s nutrition',
            open: openReview,
          },
        ]
      : []),
    ...(showWeek
      ? [
          {
            key: `week:${week}`,
            icon: 'upper' as const,
            label: weekReady ? 'Week in review ready' : 'Week in review couldn’t load',
            subtitle: weekReady ? 'Training, recovery & records' : 'Tap to retry',
            open: weekReady ? () => openWeek(week) : recap.refresh,
          },
        ]
      : []),
  ];
  function dismissReminder(key: string, label: string) {
    const store = home.store;
    if (!store) return;
    void undo.perform({
      key,
      label: `${label.replace(' ready', '')} dismissed`,
      apply: async () => {
        layoutMotion(reduced);
        await store.mark(key);
      },
      revert: async () => {
        layoutMotion(reduced);
        await store.mark(key, false);
      },
    });
  }
  async function deload() {
    if (!resources || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resources.write('POST', '/api/confirm-early-deload', {}, [
        '/api/readiness-score',
        '/api/workout-data',
        '/api/ai-periodization',
        '/api/next-session',
      ]);
      await mark(`deload:${health.today}`);
    } catch {
      setError('Could not start the deload week. Check your connection and retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {readiness.data?.earlyDeloadRecommended && !home.markers[`deload:${health.today}`] && (
        <Card tone="checkin">
          <Stack direction="row" align="center" justify="space-between">
            <AppText variant="heading">Fatigue detected</AppText>
            <StatusIndicator label="Fatigue advice" error={error} />
          </Stack>
          <AppText variant="caption" tone="muted">
            Your energy is low and training load is elevated. Consider taking a deload week now.
          </AppText>
          {readiness.data.earlyDeload && (
            <Disclosure title="Why this recommendation?">
              <AppText variant="caption">Both of these had to be true at once.</AppText>
              <AppText variant="caption" tone="muted">
                Energy {Math.round(readiness.data.earlyDeload.score)} — under{' '}
                {readiness.data.earlyDeload.scoreThreshold}, where recovery is not keeping up.
              </AppText>
              <AppText variant="caption" tone="muted">
                Training load {readiness.data.earlyDeload.acwr.toFixed(2)} — above{' '}
                {readiness.data.earlyDeload.acwrThreshold.toFixed(2)}. This week’s load compared
                with your four-week average.
              </AppText>
              <AppText variant="caption" tone="muted">
                A deload starts the lighter phase now; your block resumes afterwards. Dismiss
                keeps the plan as it is, and the card can return tomorrow if both signals still
                apply.
              </AppText>
            </Disclosure>
          )}
          <Stack direction="row">
            <AppButton
              title="Take deload week now"
              busy={busy}
              onPress={() => void deload()}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Dismiss"
              variant="ghost"
              disabled={busy}
              onPress={() => dismissReminder(`deload:${health.today}`, 'Fatigue advice')}
            />
          </Stack>
        </Card>
      )}
      {entries.length > 0 && (
        <Card padded={false}>
          {entries.length > 1 && (
            <Stack
              direction="row"
              align="center"
              style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}
            >
              <AppText variant="heading" style={{ flex: 1 }}>
                Updates
              </AppText>
              <StatusIndicator label="Home reminders" error={error} />
            </Stack>
          )}
          {entries.map((entry, index) => (
            <Stack
              key={entry.key}
              direction="row"
              align="center"
              gap="none"
              style={{
                paddingHorizontal: theme.spacing.sm,
                borderTopWidth: index > 0 ? 1 : 0,
                borderColor: theme.colors.border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                onPress={entry.open}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: theme.sizes.touchTarget,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Icon name={entry.icon} tone="brand" />
                <Stack gap="xxs" style={{ flex: 1 }}>
                  <AppText variant="label">{entry.label}</AppText>
                  <AppText variant="caption" tone="muted">
                    {entry.subtitle}
                  </AppText>
                </Stack>
                <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />
              </Pressable>
              <IconButton
                icon="close"
                label={`Dismiss ${entry.label}`}
                onPress={() => dismissReminder(entry.key, entry.label)}
              />
            </Stack>
          ))}
        </Card>
      )}
      {goals && (
        <GoalRecommendation
          source="scheduled"
          onGenerated={() => {
            void mark(`goals:${health.today}`);
            profile.refresh();
          }}
          onClose={() => setGoals(false)}
          onApplied={() => {
            setGoals(false);
            void mark(`goals:${health.today}`);
            profile.refresh();
          }}
        />
      )}
    </>
  );
}
