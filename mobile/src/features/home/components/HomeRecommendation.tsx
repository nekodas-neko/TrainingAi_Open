import { useState } from 'react';
import { Pressable } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Icon,
  Skeleton,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useHome } from '../data/HomeProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { SessionPreview } from '../../workouts/catalog';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { SessionGlyph } from '../../workouts/components/SessionGlyph';
import { healthCopy } from '../../health/data/display-copy';

export function HomeRecommendation({
  trained,
  onReadiness,
  onStart,
  onResume,
  openPrograms,
  openExplanation,
}: {
  trained: string[];
  onReadiness: (session?: SessionPreview) => void;
  onStart: (id: string, fullOverride?: boolean) => void;
  onResume: (id: string) => void;
  openPrograms: () => void;
  openExplanation: (id: string) => void;
}) {
  const home = useHome();
  const { catalog, status, notice } = useWorkoutContext();
  const { today } = useHealthData();
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const sessions = catalog?.program?.sessions ?? [];
  const active = journal.data.workouts.find((workout) => workout.status === 'active');
  const done = sessions.find((session) => trained.includes(session.name));
  const rec = catalog?.recommendation;
  const session = done ?? sessions.find((value) => value.id === rec?.sessionId);
  const resting = home.restDays[today] ?? rec?.isRestDay ?? false;
  async function rest(value: boolean) {
    try {
      await home.store?.chooseRestDay(today, value);
      setError(null);
    } catch {
      setError('Could not save your rest-day choice. Try again.');
    }
  }
  if (
    (home.mood === undefined && !home.errors[`mood:${today}`]) ||
    (!catalog && status === 'loading')
  ) {
    return (
      <Card style={{ minHeight: theme.sizes.recommendationCard }}>
        <Skeleton style={{ height: theme.spacing.lg, width: '40%' }} />
        <Skeleton style={{ flex: 1 }} />
      </Card>
    );
  }
  if (!home.mood) {
    return (
      <Card tone="checkin">
        <AppText variant="eyebrow" style={{ color: theme.tones.checkin.foreground }}>
          Exercise Energy
        </AppText>
        <Stack direction="row" align="center">
          <Icon name="mind" size={theme.sizes.avatar} color={theme.tones.checkin.foreground} />
          <Stack style={{ flex: 1 }} gap="xs">
            <AppText variant="hero">How are you feeling?</AppText>
            <AppText variant="caption" tone="muted">
              Log energy and soreness to tailor today’s workout.
            </AppText>
          </Stack>
        </Stack>
        <AppButton title="Log Energy · ~15 sec" onPress={() => onReadiness(session)} />
      </Card>
    );
  }
  if (resting && !done && !active) {
    return (
      <Card tone="sleep">
        <Stack direction="row" align="center">
          <Icon name="moon" color={theme.tones.sleep.foreground} />
          <AppText variant="heading">Rest Day</AppText>
        </Stack>
        <AppText variant="caption" tone="muted">
          {healthCopy(rec?.reason ?? 'A day to recover.')}
        </AppText>
        <AppButton title="Train instead" variant="ghost" onPress={() => void rest(false)} />
        <StatusIndicator label="Rest day" error={error} />
      </Card>
    );
  }
  if (!session) {
    return (
      <Card>
        <AppText variant="heading">Your next session</AppText>
        <AppText tone="muted">
          {notice ?? 'Choose a program to get a workout recommendation.'}
        </AppText>
        <AppButton title="Your programs" onPress={openPrograms} />
      </Card>
    );
  }
  return (
    <Card
      tone={done ? 'activity' : 'brand'}
      accent={home.preferences.cardColors?.recommendedToday ?? theme.homeCards.recommendedToday}
    >
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          {active ? 'Workout in progress' : done ? 'Trained Today' : 'Recommended Today'}
        </AppText>
        <StatusIndicator label="Workout recommendation" error={error} />
        {home.mood.soreMuscles.length > 0 && (
          <Badge
            label={`${home.mood.soreMuscles.length} sore`}
            style={{ alignSelf: 'center' }}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit exercise energy"
          onPress={() => onReadiness(session)}
          style={{
            minWidth: theme.sizes.touchTarget,
            minHeight: theme.sizes.touchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText variant="hero">
            {
              { drained: '😴', low: '😑', ok: '😐', good: '😊', pumped: '⚡' }[
                home.mood.energyLevel
              ]
            }
          </AppText>
        </Pressable>
      </Stack>
      <Stack direction="row" align="center">
        <SessionGlyph
          icon={session.icon}
          position={session.position}
          size={theme.sizes.avatar}
          color={theme.colors.brand}
        />
        <Stack style={{ flex: 1 }}>
          <AppText variant="hero">{active?.sessionName ?? session.name}</AppText>
          {!done && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Why this session?"
              hitSlop={theme.spacing.sm}
              onPress={() => openExplanation(session.id)}
              style={{ alignSelf: 'flex-start' }}
            >
              <Stack direction="row" align="center" gap="xs">
                <AppText variant="caption" tone="muted">
                  Why this?
                </AppText>
                <Icon name="forward" size={theme.sizes.iconSmall} tone="muted" />
              </Stack>
            </Pressable>
          )}
        </Stack>
      </Stack>
      <Stack direction="row" wrap>
        {session.durationMinutes !== null && (
          <AppText variant="caption" tone="muted">
            ~{Math.round(session.durationMinutes)} min
          </AppText>
        )}
        <AppText variant="caption" tone="muted">
          {session.exercises.length} exercises
        </AppText>
        <AppText variant="caption" tone="muted">
          Last:{' '}
          {session.lastTrained
            ? session.lastTrained === today
              ? 'Today'
              : formatDateDisplay(session.lastTrained, 'short')
            : '—'}
        </AppText>
      </Stack>
      {session.phaseDetail && (
        <AppText variant="caption" tone="muted">
          {session.phaseDetail}
        </AppText>
      )}
      {active ? (
        <AppButton title="Resume Workout" onPress={() => onResume(active.id)} />
      ) : done ? (
        <Badge label="Completed Today" tone="brand" />
      ) : rec?.deloadOrRestRecommended ? (
        <>
          <AppText variant="caption" tone="muted">
            {healthCopy(rec.reason)}
          </AppText>
          <Stack direction="row">
            <AppButton
              title="Rest Day"
              variant="secondary"
              onPress={() => void rest(true)}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Full Session"
              onPress={() => onStart(session.id, true)}
              style={{ flex: 1 }}
            />
          </Stack>
        </>
      ) : (
        <AppButton title="Start Workout" onPress={() => onStart(session.id)} />
      )}
    </Card>
  );
}
