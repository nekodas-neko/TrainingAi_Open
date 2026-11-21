import { useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../../shared/ui/Pressable';
import { slopTo } from '../../../shared/ui/touchSlop';
import {
  AppButton,
  AppText,
  Card,
  Icon,
  Skeleton,
  Stack,
  StatusIndicator,
  SwipeReveal,
  EnergyBattery,
  ENERGY_LEVELS,
} from '../../../shared/ui';
import { readinessSpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import {
  deloadWhy,
  recommendationControls,
  recommendationStrip,
  restDayCardModel,
} from '../data/recommendation-reasons';
import { DeloadStrip } from './DeloadStrip';
import { useHome } from '../data/HomeProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { SessionPreview } from '../../workouts/catalog';
import { soreChipColor } from '../data/recommendation-presentation';
import { homeRecommendationModel } from '../data/recommendation-model';
import { SessionGlyph } from '../../workouts/components/SessionGlyph';
import { failureNotice } from '../../../core/reporting/index.ts';

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
  const [whyOpen, setWhyOpen] = useState(false);
  const readiness = useWorkoutResource(readinessSpec(today));
  const rec = catalog?.recommendation;
  const model = homeRecommendationModel({
    catalog,
    catalogLoading: status === 'loading',
    trained,
    active: journal.data.workouts.find((workout) => workout.status === 'active'),
    restChoice: home.restDays[today],
    mood: home.mood,
    moodFailed: !!home.errors[`mood:${today}`],
    today,
  });
  const strip = recommendationStrip(rec, model);
  const withStrip = (card: React.ReactElement) =>
    strip ? (
      <Stack gap="sm">
        <DeloadStrip strip={strip} />
        {card}
      </Stack>
    ) : (
      card
    );
  async function rest(value: boolean) {
    try {
      await home.store?.chooseRestDay(today, value);
      setError(null);
    } catch (failure) {
      setError(failureNotice('Could not save your rest-day choice. Try again.', failure));
    }
  }
  if (model.kind === 'loading') {
    return (
      <Card style={{ minHeight: theme.sizes.recommendationCard }}>
        <Skeleton style={{ height: theme.spacing.lg, width: '40%' }} />
        <Skeleton style={{ flex: 1 }} />
      </Card>
    );
  }
  if (model.kind === 'checkin' || !home.mood) {
    const session = model.kind === 'checkin' ? model.session : undefined;
    return withStrip(
      <Card tone="checkin">
        <AppText variant="eyebrow" style={{ color: theme.tones.checkin.foreground }}>
          Exercise Readiness
        </AppText>
        <Stack direction="row" align="center">
          <Icon name="mind" size={theme.sizes.avatar} color={theme.tones.checkin.foreground} />
          <Stack style={{ flex: 1 }} gap="xs">
            <AppText variant="hero">How are you feeling?</AppText>
            <AppText variant="caption" tone="muted">
              Log soreness & energy — the app lightens loads on sore muscles and can flag a deload
              or rest day. It tunes today’s session, not your whole plan.
            </AppText>
          </Stack>
        </Stack>
        <AppButton title="Log Readiness · ~15 sec" onPress={() => onReadiness(session)} />
      </Card>,
    );
  }
  if (model.kind === 'rest') {
    // #3644: the current app's rest-day guidance, from the same shared `restDayGuidance`.
    const guidance = restDayCardModel({
      readiness: readiness.data,
      soreMuscles: home.mood.soreMuscles,
      consecutiveRestDays: rec?.consecutiveRestDays,
      today,
    });
    return (
      <Card tone="sleep">
        <Stack direction="row" align="center">
          <Icon name="moon" color={theme.tones.sleep.foreground} />
          <AppText variant="heading">Rest Day</AppText>
        </Stack>
        <AppText variant="eyebrow" style={{ color: theme.tones.sleep.foreground }}>
          {guidance.title}
        </AppText>
        <AppText variant="caption" tone="muted">
          {guidance.body}
        </AppText>
        {guidance.suggestions.length > 0 && (
          <Stack gap="xs">
            {guidance.suggestions.map((suggestion) => (
              <Stack key={suggestion} direction="row" align="flex-start" gap="xs">
                <AppText variant="caption" tone="muted">
                  •
                </AppText>
                <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
                  {suggestion}
                </AppText>
              </Stack>
            ))}
          </Stack>
        )}
        {guidance.bedtime && (
          <AppText variant="caption" style={{ fontWeight: '600' }}>
            Recommended bedtime: {guidance.bedtime}
          </AppText>
        )}
        {guidance.lowConfidence && (
          <AppText variant="micro" tone="muted">
            Based on limited data today.
          </AppText>
        )}
        <AppButton title="Train instead" variant="ghost" onPress={() => void rest(false)} />
        <StatusIndicator label="Rest day" error={error} />
      </Card>
    );
  }
  if (model.kind === 'none') {
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
  const { session } = model;
  const done = model.state === 'done';
  const accent = home.preferences.cardColors?.recommendedToday ?? theme.homeCards.recommendedToday;
  const soreColor = soreChipColor(theme.mode, theme.status.warning);
  const eyebrowColor = done ? theme.status.success : accent;
  const controls = recommendationControls(model.action);
  const why = rec && controls === 'rest-and-full' ? deloadWhy(rec) : null;
  return withStrip(
    <Card tone="neutral" accent={done ? theme.status.success : accent} faint={!!done}>
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" style={{ color: eyebrowColor, fontWeight: '700' }}>
          {model.eyebrow}
        </AppText>
        <StatusIndicator label="Workout recommendation" error={error} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit exercise readiness"
          onPress={() => onReadiness(session)}
          style={{
            minHeight: theme.sizes.touchTarget,
            flexShrink: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: theme.spacing.xs,
          }}
        >
          <View accessible accessibilityLabel={`Energy: ${home.mood.energyLevel}`}>
            <EnergyBattery
              level={ENERGY_LEVELS[home.mood.energyLevel]}
              color={theme.colors.brandText}
            />
          </View>
          {home.mood.soreMuscles.length > 0 && (
            <View
              style={{
                flexShrink: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                borderRadius: theme.radii.pill,
                backgroundColor: `${soreColor}2e`,
                paddingHorizontal: theme.spacing.sm - theme.spacing.xxs,
                paddingVertical: theme.spacing.xxs,
              }}
            >
              <Icon name="alert" size={theme.spacing.sm + theme.spacing.xxs} color={soreColor} />
              <AppText variant="chipLabel" style={{ color: soreColor, flexShrink: 1 }}>
                {home.mood.soreMuscles.join(', ')}
              </AppText>
            </View>
          )}
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
          <AppText variant="hero">{model.name}</AppText>
          {!done && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Why this session?"
              // One 20 dp line. The reach goes over the session name above and the gap below;
              // neither is tappable (#3759).
              hitSlop={{
                top: slopTo(theme.sizes.touchTarget, theme.sizes.iconSmall),
                bottom: slopTo(theme.sizes.touchTarget, theme.sizes.iconSmall),
                left: theme.spacing.sm,
                right: theme.spacing.sm,
              }}
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
      <Stack direction="row" wrap gap="md" align="center">
        {model.facts.map((fact) => (
          <Stack key={fact.icon} direction="row" align="center" gap="xs">
            <Icon
              name={fact.icon}
              size={theme.sizes.iconCompact - theme.spacing.xs}
              color={theme.colors.muted}
            />
            <AppText variant="caption" tone="muted">
              {fact.text}
            </AppText>
          </Stack>
        ))}
      </Stack>
      {session.phaseDetail && (
        <AppText variant="caption" tone="muted">
          {session.phaseDetail}
        </AppText>
      )}
      {model.action === 'resume' && model.activeId ? (
        <AppButton title="Resume Workout" onPress={() => onResume(model.activeId!)} />
      ) : model.action === 'completed' ? (
        <Stack
          direction="row"
          align="center"
          gap="sm"
          style={{
            borderRadius: theme.radii.control,
            borderWidth: 1,
            borderColor: `${theme.status.success}66`,
            backgroundColor: `${theme.status.success}1a`,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.snug,
          }}
        >
          <Icon name="circleCheck" size={theme.sizes.iconCompact} color={theme.status.success} />
          <AppText variant="subheading" style={{ color: theme.status.success }}>
            Completed Today
          </AppText>
        </Stack>
      ) : controls === 'rest-and-full' && why ? (
        <>
          <AppText variant="caption" tone="muted">
            {why.cause ?? rec?.reason}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Why this recommendation?"
            accessibilityState={{ expanded: whyOpen }}
            onPress={() => setWhyOpen(!whyOpen)}
            style={{ minHeight: theme.sizes.touchTarget, justifyContent: 'center' }}
          >
            <Stack direction="row" align="center" gap="xs">
              <AppText variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                Why this recommendation?
              </AppText>
              <Icon
                name="expand"
                size={theme.sizes.iconSmall}
                tone="brand"
                style={whyOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
              />
            </Stack>
          </Pressable>
          {whyOpen && (
            <Stack gap="xs">
              <AppText variant="caption" style={{ fontWeight: '600' }}>
                {why.headline}
              </AppText>
              {why.reasons.map((reason) => (
                <AppText key={reason.kind} variant="caption" tone="muted">
                  {reason.text}
                </AppText>
              ))}
            </Stack>
          )}
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
        // #2204: Start is the one control; a swipe left reveals Rest, which a second tap takes.
        <SwipeReveal
          radius={theme.radii.control}
          rowBackground={theme.colors.brand}
          actionWidth={theme.sizes.touchTarget * 2.5}
          actions={[
            {
              key: 'rest',
              label: 'Rest Day',
              accessibilityLabel: 'Rest today instead',
              icon: 'moon',
              foreground: theme.tones.sleep.foreground,
              background: theme.tones.sleep.background,
              onPress: () => void rest(true),
            },
          ]}
        >
          <AppButton
            title="Start Workout"
            icon="swipeLeft"
            accessibilityHint="Swipe left to rest today instead"
            // The tray is hidden from a screen reader while closed, so Rest is also an action here.
            accessibilityActions={[{ name: 'rest', label: 'Rest today instead' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'rest') void rest(true);
            }}
            onPress={() => onStart(session.id)}
          />
        </SwipeReveal>
      )}
    </Card>,
  );
}
