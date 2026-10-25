import { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AppText, Badge, Card, ListRow, Stack, TextField, Thumbnail } from '../../../shared/ui';
import { portionKcalLine } from '../data/display';
import type { SavedMeal } from '../data/models';
import { filterMeals, mealCountLine, mealTags, MEAL_LIST_FOOTNOTE } from '../data/saved-meal-list';
import { useNutrition } from '../data/NutritionProvider';

/**
 * The current app's My Foods list: a filter box, the item count, one grouped card with each
 * meal's meal-time tags, and the per-portion footnote. Shared by the Log Food sheet's My Foods tab
 * and the My Foods sheet.
 */
export function SavedMealList({
  date,
  onOpen,
}: {
  date: string;
  onOpen: (meal: SavedMeal) => void;
}) {
  const n = useNutrition(date);
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const all = n.view.meals;
  const meals = filterMeals(all, query);
  if (!all.length) return null;
  return (
    <>
      <TextField
        label="Filter your meals"
        hideLabel
        placeholder="Filter your meals"
        leadingIcon="search"
        value={query}
        onChangeText={setQuery}
      />
      {meals.length > 0 ? (
        <AppText variant="listCount" tone="muted">
          {mealCountLine(meals.length)}
        </AppText>
      ) : (
        <AppText tone="muted">Nothing matches “{query.trim()}”.</AppText>
      )}
      {meals.length > 0 && (
        <Card padded={false}>
          {meals.map((meal, index) => {
            const { shown, extra } = mealTags(n.view.mealTypes, meal.mealTypeIds);
            return (
              <View
                key={meal.id}
                style={{
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.colors.border,
                }}
              >
                <ListRow
                  leading={<Thumbnail uri={meal.imageDataUri} label={meal.name} />}
                  density="compact"
                  title={meal.name}
                  subtitle={portionKcalLine(meal.servings, meal.totals.calories)}
                  onPress={() => onOpen(meal)}
                />
                {shown.length > 0 && (
                  <Stack
                    direction="row"
                    wrap
                    gap="xs"
                    style={{
                      paddingHorizontal: theme.spacing.lg,
                      paddingBottom: theme.spacing.sm,
                    }}
                  >
                    {shown.map((mt) => (
                      <Badge key={mt.id} label={mt.name} />
                    ))}
                    {extra > 0 && <Badge label={`+${extra}`} />}
                  </Stack>
                )}
              </View>
            );
          })}
        </Card>
      )}
      <AppText variant="caption" tone="muted">
        {MEAL_LIST_FOOTNOTE}
      </AppText>
    </>
  );
}
