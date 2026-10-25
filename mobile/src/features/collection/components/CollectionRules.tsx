import type { ReactNode } from 'react';
import { View } from 'react-native';
import { V2_LADDERS } from '@trainingai/shared/collection/ladder';
import { AppText, Card } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { CatSprite } from './CatSprite';

// "Ranger I" -> "Ranger": a row is named by its bottom tier.
const rowName = (faucet: keyof typeof V2_LADDERS) =>
  V2_LADDERS[faucet].tiers[0].name.replace(/ I$/, '');

// "A, B and C".
const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// The rest-day strip: a week of the Tank row, worked days then days the plan gave off.
const WEEK = [true, false, true, false, true, false, false];

/**
 * "How this works" as four small diagrams, each with its sentence as the caption. A decay nobody
 * explained reads as a bug, so the page still explains itself; it just draws it. Every number is read
 * from the engine's own ladders, as the paragraphs in `collectionRules()` are, so it cannot drift.
 */
export function CollectionRules() {
  const { theme } = useTheme();
  const { workout, steps } = V2_LADDERS;
  const banks = list((['steps', 'health', 'cardio'] as const).map(rowName));
  const cost = steps.tiers[1].mergeCost;
  const small = theme.sizes.ruleSprite - theme.spacing.xs * 2;
  const arrow = (text: string) => (
    <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
      {text}
    </AppText>
  );
  const rules: { diagram: ReactNode; lead: string; text: string }[] = [
    {
      diagram: [0, 1, 2].map((i) => (
        <CatSprite key={i} faucet="workout" tier={0} size={theme.sizes.ruleSprite} />
      )),
      lead: 'One a day.',
      text: ` Each workout gives the ${rowName('workout')} row a ${workout.tiers[0].name}. Steps, health logging and cardio fill a bank that turns into ${banks} cats.`,
    },
    {
      diagram: (
        <>
          {Array.from({ length: cost }, (_, i) => (
            <CatSprite key={i} faucet="steps" tier={0} size={small} />
          ))}
          {arrow('→')}
          <CatSprite faucet="steps" tier={1} size={theme.sizes.ruleSprite + theme.spacing.xs / 2} />
        </>
      ),
      lead: `${cost} make one.`,
      text: ` On the ${banks} rows, ${cost} of a tier make 1 of the next. The ${rowName('workout')} row costs ${workout.tiers.slice(1).map((t) => t.mergeCost).join(' · ')}.`,
    },
    {
      diagram: (
        <>
          <CatSprite faucet="steps" tier={1} size={theme.sizes.ruleSprite} />
          {arrow('gap')}
          {[0, 1, 2].map((i) => (
            <CatSprite key={i} faucet="steps" tier={0} size={small} />
          ))}
          <AppText
            variant="caption"
            style={{ color: theme.colors.danger, fontWeight: '700', paddingLeft: theme.spacing.xs }}
          >
            −1
          </AppText>
        </>
      ),
      lead: 'A gap costs the smallest one.',
      text: ' When a bank runs down the row loses its smallest cat, and a big one breaks back into its parts rather than vanishing.',
    },
    {
      diagram: (
        <>
          {WEEK.map((worked, i) => (
            <View
              key={i}
              style={{
                width: theme.sizes.legendSwatch,
                height: theme.sizes.iconSmall - theme.spacing.xs - theme.spacing.xxs,
                borderRadius: theme.radii.swatch + 1,
                marginRight: theme.spacing.xxs,
                backgroundColor: worked ? theme.colors.brand : theme.colors.track,
              }}
            />
          ))}
          <AppText
            variant="micro"
            style={{ color: theme.colors.brand, marginLeft: theme.spacing.xs }}
          >
            no cost
          </AppText>
        </>
      ),
      lead: 'Your own rest days are free.',
      text: ` The ${rowName('workout')} row's allowance comes from your schedule, and a rest or deload day the app asked for never counts against it.`,
    },
  ];
  return (
    <Card>
      <AppText variant="subheading">How this works</AppText>
      {rules.map((rule, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.snug,
            paddingTop: theme.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{
              width: theme.sizes.ruleDiagram,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {rule.diagram}
          </View>
          <AppText variant="caption" tone="muted" style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              {rule.lead}
            </AppText>
            {rule.text}
          </AppText>
        </View>
      ))}
    </Card>
  );
}
