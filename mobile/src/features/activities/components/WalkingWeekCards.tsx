import { View } from 'react-native';
import { AppButton, AppText, Badge, Card, Icon, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  walkingTodayModel,
  walkingWeekModel,
  type Bar,
  type WalkDayCircle,
  type WalkingBlock,
} from '../data/cardio-plan-view';

function BarBlock({ bar }: { bar: Bar }) {
  return (
    <Stack gap="xs">
      <Stack direction="row" align="baseline" gap="xs">
        <AppText variant="title">{bar.figure}</AppText>
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
          {bar.caption}
        </AppText>
      </Stack>
      <ProgressBar value={bar.value} complete={bar.complete} />
    </Stack>
  );
}

function DayCircle({ day }: { day: WalkDayCircle }) {
  const { theme } = useTheme();
  const size = theme.sizes.control - theme.spacing.sm;
  const filled = day.state === 'done';
  const ringed = day.state === 'part';
  const label = `${day.letter}${day.today ? ', today' : ''}: ${
    filled ? 'done' : ringed ? 'part way' : day.state === 'left-out' ? 'left out' : 'nothing yet'
  }`;
  return (
    <Stack align="center" gap="xxs" accessible accessibilityLabel={label}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: theme.radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? theme.colors.brand : 'transparent',
          borderWidth: ringed || day.today || !filled ? 2 : 0,
          borderColor: ringed || day.today ? theme.colors.brand : theme.colors.border,
          opacity: day.state === 'left-out' ? 0.5 : 1,
        }}
      >
        {filled && <Icon name="check" size={theme.sizes.iconSmall} color={theme.colors.background} />}
      </View>
      <AppText variant="micro" tone={day.today ? undefined : 'muted'}>
        {day.letter}
      </AppText>
    </Stack>
  );
}

/** Walking plan, card 1: the two bars and the week's days (#3779, 2A). */
export function WalkingWeekCard({ walking }: { walking: WalkingBlock }) {
  const model = walkingWeekModel(walking);
  return (
    <Card>
      <Stack direction="row" align="center" justify="space-between" gap="sm">
        <AppText variant="eyebrow" tone="muted" style={{ flex: 1 }}>
          Walking and heart health · this week
        </AppText>
        {model.status && <Badge label={model.status.label} tone={model.status.tone} />}
      </Stack>
      {model.behindLine && (
        <AppText variant="caption" tone="muted">
          {model.behindLine}
        </AppText>
      )}
      <BarBlock bar={model.steps} />
      <BarBlock bar={model.minutes} />
      <Stack direction="row" justify="space-between">
        {model.days.map((day) => (
          <DayCircle key={day.date} day={day} />
        ))}
      </Stack>
      <AppText variant="micro" tone="muted">
        {model.daysCaption}
      </AppText>
      {model.basisNote && (
        <AppText variant="micro" tone="muted">
          {model.basisNote}
        </AppText>
      )}
    </Card>
  );
}

/** Walking plan, card 2: what finishes today, and the ways to walk it. */
export function WalkingTodayCard({
  walking,
  onGuidedWalk,
  onTreadmill,
  onOther,
  busy,
}: {
  walking: WalkingBlock;
  onGuidedWalk: () => void;
  onTreadmill: () => void;
  onOther: () => void;
  busy: boolean;
}) {
  const model = walkingTodayModel(walking);
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Today
      </AppText>
      <AppText variant="heading">{model.headline}</AppText>
      <AppText variant="caption" tone="muted">
        {model.detail}
      </AppText>
      <AppButton title="Start a guided walk" onPress={onGuidedWalk} />
      <Stack direction="row" gap="sm">
        <AppButton
          style={{ flex: 1 }}
          title="Treadmill walk"
          variant="surface"
          disabled={busy}
          onPress={onTreadmill}
        />
        <AppButton
          style={{ flex: 1 }}
          title="Log another activity"
          variant="surface"
          disabled={busy}
          onPress={onOther}
        />
      </Stack>
    </Card>
  );
}
