import { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
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
  const [expanded, setExpanded] = useState(false);
  const [goals, setGoals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef('');
  useEffect(() => {
    if (
      !home.ready ||
      !health.ready ||
      !health.store ||
      home.markers[`morning-prompt:${health.today}`] ||
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
          openMorning();
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
  }, [home.ready, health.ready, home.store, health.store, health.today]);
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
  const showWeek =
    !home.markers[`week:${week}`] &&
    ((recap.data?.digest && recapHasData(recap.data.metrics)) || recap.error);
  const entries = [
    ...(showGoals ? [{ key: 'goals', icon: 'target' as const, label: 'Goals check-in' }] : []),
    ...(showDay ? [{ key: 'day', icon: 'nutrition' as const, label: 'Day in review' }] : []),
    ...(showWeek ? [{ key: 'week', icon: 'upper' as const, label: 'Week in review' }] : []),
  ];
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
            Your energy is low and training load is elevated. Consider taking a deload week
            now.
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
              onPress={() => void mark(`deload:${health.today}`)}
            />
          </Stack>
        </Card>
      )}
      {entries.length > 0 && (
        <Stack>
          <Pressable
            onPress={() => setExpanded(!expanded)}
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${entries.map((entry) => entry.label).join(', ')}`}
            accessibilityState={{ expanded }}
            style={{
              minHeight: theme.sizes.touchTarget,
              borderRadius: theme.radii.card,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.raised,
              padding: theme.spacing.md,
            }}
          >
            <Stack direction="row" align="center">
              <Stack direction="row" gap="xs">
                {entries.map((entry) => (
                  <Icon
                    key={entry.key}
                    name={entry.icon}
                    size={theme.sizes.iconSmall}
                    tone="brand"
                  />
                ))}
              </Stack>
              <AppText variant="label" style={{ flex: 1 }}>
                {entries.length} ready
              </AppText>
              <Icon name={expanded ? 'down' : 'forward'} tone="muted" />
            </Stack>
          </Pressable>
          {expanded && (
            <Stack>
              {showGoals && (
                <Card>
                  <AppText variant="heading">Time for a goals check-in</AppText>
                  <AppText variant="caption" tone="muted">
                    It’s been a couple of weeks — review your nutrition and activity goals based
                    on your recent trends.
                  </AppText>
                  <Stack direction="row">
                    <AppButton
                      title="Review now"
                      onPress={() => setGoals(true)}
                      style={{ flex: 1 }}
                    />
                    <AppButton
                      title="Remind me later"
                      variant="ghost"
                      onPress={() =>
                        void home.store
                          ?.postponeGoals(health.today)
                          .catch(() => setError('Could not save your reminder choice.'))
                      }
                    />
                  </Stack>
                </Card>
              )}
              {showDay && (
                <Card>
                  <Stack direction="row" align="center">
                    <AppButton
                      title="Your day in review is ready"
                      variant="ghost"
                      onPress={openReview}
                      style={{ flex: 1 }}
                    />
                    <IconButton
                      icon="close"
                      label="Dismiss day review"
                      onPress={() => void mark(`day:${health.today}`)}
                    />
                  </Stack>
                </Card>
              )}
              {showWeek && (
                <Card>
                  <Stack direction="row" align="center">
                    <AppButton
                      title={
                        recap.error
                          ? 'Your week in review didn’t load'
                          : 'Your week in review is ready'
                      }
                      variant="ghost"
                      onPress={recap.error ? recap.refresh : () => openWeek(week)}
                      style={{ flex: 1 }}
                    />
                    <IconButton
                      icon="close"
                      label="Dismiss weekly recap"
                      onPress={() => void mark(`week:${week}`)}
                    />
                  </Stack>
                </Card>
              )}
              <StatusIndicator label="Home reminders" error={error} />
            </Stack>
          )}
        </Stack>
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
