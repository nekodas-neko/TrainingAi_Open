import { useMemo, useRef, useState } from 'react';
import type Svg from 'react-native-svg';
import { SvgXml } from 'react-native-svg';
import { z } from 'zod';
import { exportMealLabel, shareLabelImage } from '../../../integrations/nutrition/labels';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Card,
  Picker,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { mealLabelArtwork } from '../data/meal-label';
import { MEAL_LABEL_STYLES } from '../data/meal-label-geometry';
import type { SavedMeal } from '../data/models';
const styles = MEAL_LABEL_STYLES;
export function MealLabelSheet({ meal, onClose }: { meal: SavedMeal; onClose: () => void }) {
  const draft = useWorkoutDraft('meal-label-style', z.object({ style: z.string() }), {
    style: 'inlineCentred',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svg = useRef<Svg | null>(null);
  const { theme } = useTheme();
  const artwork = useMemo(
    () => mealLabelArtwork(meal, draft.value.style),
    [meal, draft.value.style],
  );
  const payload = artwork.payload;
  async function save(print: boolean) {
    setBusy(true);
    try {
      await exportMealLabel(meal, draft.value.style, print);
      setError(null);
    } catch {
      setError(
        'Label sharing and printing need the latest development build. The recipe and QR remain available.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function image() {
    if (!svg.current || busy) {
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('The label could not be rendered.')),
          10000,
        );
        svg.current!.toDataURL(
          (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          { width: 1179, height: 1179 },
        );
      });
      await shareLabelImage(data, meal.name);
      setError(null);
    } catch {
      setError(
        'Could not save the label image. Use Print/PDF, or retry in the latest build.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Meal label"
      onClose={onClose}
      actions={<StatusIndicator label="Meal label" error={error} busy={busy} />}
    >
      <Picker
        label="Label style"
        value={draft.value.style}
        options={styles}
        onChange={(style) => draft.setValue({ style })}
      />
      <Card>
        <Stack align="center">
          <SvgXml
            xml={artwork.svg}
            override={{
              ref: svg,
              accessibilityLabel: meal.name + ' printable label',
              width: theme.sizes.mealLabel,
              height: theme.sizes.mealLabel,
            }}
          />
          <AppText variant="micro" tone="muted">
            Per portion · 50 × 50 mm printed label
          </AppText>
        </Stack>
      </Card>
      <AppText variant="caption" tone="muted">
        {artwork.shared
          ? 'This share code carries the recipe, so someone else can save it.'
          : 'This label opens your saved meal. Use Share code to include the recipe for another person.'}{' '}
        · {artwork.metrics.mmPerModule.toFixed(2)} mm per QR module
      </AppText>
      {payload.rolled > 0 && (
        <AppText tone="muted">
          {payload.rolled} ingredients are combined in the code to keep it scannable. The totals
          are preserved.
        </AppText>
      )}
      <AppButton title="Save / share label image" busy={busy} onPress={() => void image()} />
      <AppButton
        title="Share PDF label"
        variant="secondary"
        busy={busy}
        onPress={() => void save(false)}
      />
      <AppButton
        title="Print label"
        variant="secondary"
        busy={busy}
        onPress={() => void save(true)}
      />
    </Sheet>
  );
}
