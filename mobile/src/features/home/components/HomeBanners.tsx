import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { useUndo } from '../../../shared/ui/undo/UndoProvider';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { formatTimeOfDay, shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
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
  bannerTone,
  type BannerType,
  goalsReviewDue,
  localHour,
  recapHasData,
  shouldOfferMorning,
} from '../data/banner-data';
import { useActivities } from '../../activities/data/ActivityProvider';
import { DetectedWalkSheet } from './DetectedWalkSheet';
import {
  recordedSpans,
  visibleWalks,
  walkCandidatesSpec,
  type DetectedWalk,
} from '../data/detected-walks';
import { GoalRecommendation } from '../../nutrition/components/GoalRecommendation';
import { failureNotice, reportError } from '../../../core/reporting/index.ts';

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
  // The walk the sheet was opened on, held so a newer detection arriving mid-edit can't replace it.
  const [reviewing, setReviewing] = useState<DetectedWalk | null>(null);
  const activity = useActivities();
  const candidates = useWorkoutResource(walkCandidatesSpec(health.today));
  const session = activity.session;
  // Offered walks minus the answered ones and any overlapping an activity this phone holds or is
  // recording, so a walk saved here never comes back from a cached answer (#3625).
  const detected = useMemo(
    () =>
      visibleWalks(candidates.data?.walks, home.answeredWalks, [
        ...recordedSpans(activity.rows, health.timezone),
        ...(session?.startMs != null
          ? [{ startMs: session.startMs, endMs: session.endMs ?? Date.now() }]
          : []),
      ]),
    [candidates.data, home.answeredWalks, activity.rows, health.timezone, session],
  );
  const newest = detected[0];
  const [expanded, setExpanded] = useState(false);
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
      } catch (failure) {
        reportError(failure);
      }
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
    } catch (failure) {
      setError(failureNotice('Could not save your dismissal on this phone.', failure));
    }
  }
  const showDay = localHour(health.timezone) >= 17 && !home.markers[`day:${health.today}`];
  const showGoals =
    goalsReviewDue(profile.data?.user) && !home.markers[`goals:${health.today}`];
  const weekReady = !!recap.data?.digest && recapHasData(recap.data.metrics);
  const showWeek = !home.markers[`week:${week}`] && (weekReady || !!recap.error);
  const entries: {
    key: string;
    type: BannerType;
    icon: 'legs' | 'target' | 'nutrition' | 'upper';
    label: string;
    subtitle: string;
    open: () => void;
    dismiss?: () => void;
  }[] = [
    ...(newest
      ? [
          {
            key: `walk:${newest.startMs}`,
            type: 'walk' as const,
            icon: 'legs' as const,
            label: 'Walk detected',
            subtitle: `Looks like you walked ${formatTimeOfDay(newest.startMs, health.timezone)}–${formatTimeOfDay(newest.endMs, health.timezone)}. Save it?${detected.length > 1 ? ` +${detected.length - 1} more` : ''}`,
            open: () => setReviewing(newest),
            dismiss: () => dismissWalks(),
          },
        ]
      : []),
    ...(showGoals
      ? [
          {
            key: `goals:${health.today}`,
            type: 'goals' as const,
            icon: 'target' as const,
            label: 'Goals check-in',
            subtitle: 'Review your nutrition and activity goals',
            open: () => setGoals(true),
            // The current app's "Remind later": the server's review date moves, so the 14-day gate
            // closes on every device, not only today's marker on this phone (#3669 item 1).
            dismiss: () => postponeGoals(),
          },
        ]
      : []),
    ...(showDay
      ? [
          {
            key: `day:${health.today}`,
            type: 'day' as const,
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
            type: 'week' as const,
            icon: 'upper' as const,
            label: weekReady ? 'Week in review ready' : 'Week in review couldn’t load',
            subtitle: weekReady ? 'Training, recovery & records' : 'Tap to retry',
            open: weekReady ? () => openWeek(week) : recap.refresh,
          },
        ]
      : []),
  ];
  function dismissWalks() {
    const store = home.store;
    if (!store) return;
    const starts = detected.map((walk) => walk.startMs);
    void undo.perform({
      key: 'walk-detected',
      label: 'Walk dismissed',
      apply: async () => {
        layoutMotion(reduced);
        for (const start of starts) await store.answerWalk(start);
      },
      revert: async () => {
        layoutMotion(reduced);
        for (const start of starts) await store.answerWalk(start, false);
      },
    });
  }
  function postponeGoals() {
    const store = home.store;
    if (!store) return;
    const date = health.today;
    void undo.perform({
      key: `goals:${date}`,
      label: 'Goals check-in postponed for 14 days',
      apply: async () => {
        layoutMotion(reduced);
        await store.postponeGoals(date);
      },
      revert: async () => {
        layoutMotion(reduced);
        await store.cancelGoalsPostpone(date);
      },
    });
  }
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
        '/api/collection',
      ]);
      await mark(`deload:${health.today}`);
    } catch (failure) {
      setError(failureNotice(
        'Could not start the deload week. Check your connection and retry.',
        failure,
      ));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {readiness.data?.earlyDeloadRecommended && !home.markers[`deload:${health.today}`] && (
        <Card tone="checkin">
          <Stack direction="row" align="center" justify="space-between">
            <AppText variant="subheading">Fatigue detected</AppText>
            <StatusIndicator label="Fatigue advice" error={error} />
          </Stack>
          <AppText variant="caption" tone="muted">
            Your readiness is low and training load is elevated. Consider taking a deload week now.
          </AppText>
          {readiness.data.earlyDeload && (
            <Disclosure title="Why this recommendation?">
              <AppText variant="caption">Both of these had to be true at once.</AppText>
              <AppText variant="caption" tone="muted">
                Readiness {Math.round(readiness.data.earlyDeload.score)} — under{' '}
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
          <Stack direction="row" align="center" gap="none">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${expanded ? 'Hide' : 'Show'} updates: ${entries.map((entry) => entry.label).join(', ')}`}
              onPress={() => {
                layoutMotion(reduced);
                setExpanded((value) => !value);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: theme.sizes.touchTarget,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                padding: theme.spacing.md,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              {entries.map((entry) => (
                <Icon
                  key={entry.key}
                  name={entry.icon}
                  color={theme.tones[bannerTone[entry.type]].foreground}
                />
              ))}
              <AppText variant="label" style={{ flex: 1 }}>
                {entries.length} ready
              </AppText>
              <Icon
                name={expanded ? 'expand' : 'forward'}
                tone="muted"
                size={theme.sizes.iconSmall}
              />
            </Pressable>
            {/* A sibling of the toggle, and only while there is something to say: inside it the
                indicator's own button nests a button in a button, and its 44 px box was reserved
                beside the count even when idle. */}
            {error && <StatusIndicator label="Home reminders" error={error} />}
          </Stack>
          {expanded &&
            entries.map((entry) => (
              <Stack
                key={entry.key}
                direction="row"
                align="center"
                gap="none"
                style={{
                  paddingHorizontal: theme.spacing.sm,
                  borderTopWidth: 1,
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
                  <Icon name={entry.icon} color={theme.tones[bannerTone[entry.type]].foreground} />
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
                  onPress={() =>
                    entry.dismiss ? entry.dismiss() : dismissReminder(entry.key, entry.label)
                  }
                />
              </Stack>
            ))}
        </Card>
      )}
      {reviewing && (
        <DetectedWalkSheet
          key={reviewing.startMs}
          walk={reviewing}
          timezone={health.timezone}
          onClose={() => setReviewing(null)}
        />
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
