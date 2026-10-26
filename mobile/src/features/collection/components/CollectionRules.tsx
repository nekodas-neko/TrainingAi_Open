import type { ReactNode } from 'react';
import { View } from 'react-native';
import { V2_LADDERS } from '@trainingai/shared/collection/ladder';
import { collectionRuleCaptions } from '@trainingai/shared/collection/rules';
import { AppText, Card } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { scaleAlpha } from '../../../shared/theme/alpha';
import { CatSprite } from './CatSprite';

// The rest-day strip: a week of the Tank row, worked days then days the plan gave off.
const WEEK = [true, false, true, false, true, false, false];

/**
 * "How this works" as four small diagrams, each with its sentence as the caption. A decay nobody
 * explained reads as a bug, so the page still explains itself; it just draws it. The captions come
 * from `collectionRuleCaptions()` in the shared package, and the diagrams' counts from the engine's
 * own ladders, so neither can drift from the rules.
 */
export function CollectionRules() {
  const { theme } = useTheme();
  const { steps } = V2_LADDERS;
  const captions = collectionRuleCaptions();
  const cost = steps.tiers[1].mergeCost;
  const small = theme.sizes.ruleSprite - theme.spacing.xs * 2;
  const arrow = (text: string) => (
    <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
      {text}
    </AppText>
  );
  const diagrams: ReactNode[] = [
    (
      <>
        {[0, 1, 2].map((i) => (
          <CatSprite key={i} faucet="workout" tier={0} size={theme.sizes.ruleSprite} />
        ))}
      </>
    ),
    (
      <>
        {Array.from({ length: cost }, (_, i) => (
          <CatSprite key={i} faucet="steps" tier={0} size={small} />
        ))}
        {arrow('→')}
        <CatSprite faucet="steps" tier={1} size={theme.sizes.ruleSprite + theme.spacing.xs / 2} />
      </>
    ),
    (
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
    (
      <>
        {WEEK.map((worked, i) => (
          <View
            key={i}
            style={{
              width: theme.sizes.legendSwatch,
              height: theme.sizes.iconSmall - theme.spacing.xs - theme.spacing.xxs,
              borderRadius: theme.radii.swatch + 1,
              marginRight: theme.spacing.xxs,
              backgroundColor: worked ? theme.colors.brand : scaleAlpha(theme.colors.muted, 0.35),
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
  ];
  return (
    <Card>
      <AppText variant="subheading">How this works</AppText>
      {diagrams.map((diagram, i) => (
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
              // Wraps instead of spilling into the caption when the labels grow with the font.
              flexWrap: 'wrap',
              rowGap: theme.spacing.xxs,
            }}
          >
            {diagram}
          </View>
          <AppText variant="caption" tone="muted" style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              {captions[i].lead}
            </AppText>
            {captions[i].text}
          </AppText>
        </View>
      ))}
    </Card>
  );
}
