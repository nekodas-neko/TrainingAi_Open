import { plural } from '@trainingai/shared/format/plural';
import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { feedback } from '../../../integrations/feedback/haptics';
import {
  AppButton,
  AppText,
  Card,
  PageLayout,
  StableContent,
  StateCard,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { sharedMealCopy } from '../../nutrition/data/shared-meal-copy';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { FriendMealRow } from '../components/FriendMealRow';
import {
  addAllLabel,
  addAllResult,
  friendshipWith,
  haveByName,
  newMeals,
  ownedNames,
  type FriendMeal,
} from '../data/friend-meals';
import { friendName, friendsSpec } from '../data/models';
import { useFriendMeals } from '../data/useFriendMeals';

export function FriendMealsScreen({ userId, onBack }: { userId: string; onBack: () => void }) {
  const valid = z.uuid().safeParse(userId);
  return valid.success ? (
    <Meals userId={valid.data} onBack={onBack} />
  ) : (
    <PageLayout title="Meals" onBack={onBack}>
      <StateCard title="Meals unavailable" message="This profile address is invalid." />
    </PageLayout>
  );
}

/**
 * A friend's meal library (#2218), opened from a Meals row on their profile. Read-only: it lists the
 * meals, and each copy is written into the viewer's own meals through `NutritionStore.saveMeals`, a
 * local write that queues for upload, so a copy made here works with no connection.
 */
function Meals({ userId, onBack }: { userId: string; onBack: () => void }) {
  const friends = useWorkoutResource(friendsSpec);
  const friendship = friendshipWith(friends.data?.friendships, userId);
  const library = useFriendMeals(friendship?.id ?? null);
  const n = useNutrition();
  const name = friendship ? friendName(friendship) : 'Friend';
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The viewer's own meals and foods, so "in your meals" and the food match are read from the saved
  // lists, not guessed. Until the meals are loaded nothing can be added.
  useEffect(() => {
    void n.store?.refresh('meals', n.today);
    void n.store?.refresh('foods', n.today);
  }, [n.store, n.today]);
  const mineKnown = n.loaded.includes('meals');
  const owned = ownedNames(n.view.meals);
  const meals = library.meals ?? [];
  const fresh = newMeals(meals, owned);
  const haveCount = meals.length - fresh.length;
  async function copy(entries: FriendMeal[], key: string) {
    if (!n.store || busy) {
      return;
    }
    setBusy(key);
    setError(null);
    try {
      const copies = entries.flatMap((entry) => sharedMealCopy(entry.meal, randomUUID) ?? []);
      if (copies.length) {
        await n.store.saveMeals(copies, n.today);
        feedback('success');
      }
      const unusable = entries.length - copies.length;
      if (key === 'all') {
        setResult(addAllResult(copies.length, meals.length - entries.length, unusable));
      } else if (unusable) {
        setError('This meal could not be copied.');
      }
    } catch {
      setError('Could not save to your meals. Nothing was added. Try again.');
    } finally {
      setBusy(null);
    }
  }
  const unavailable = !!friendship && library.unavailable;
  // The friend is not in the friends list: it loaded and they are not there (or it could not load).
  const unknown = !friendship && !friends.loading;
  return (
    <PageLayout
      title={`${name}'s meals`}
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Friend meals"
          error={library.error}
          busy={library.loading}
          onRetry={() => void library.refresh()}
        />
      }
    >
      <StableContent
        minHeight={400}
        loading={!library.meals && !unavailable && !unknown && !library.error}
      >
        {unknown && friends.error ? (
          <StateCard
            title="Could not load meals"
            message="Could not load your friends. Check your connection and retry."
            action="Retry"
            onAction={friends.refresh}
          />
        ) : unknown || unavailable ? (
          <StateCard
            title="Meals unavailable"
            message={`${name} is not sharing meals with you right now.`}
          />
        ) : !library.meals ? (
          <StateCard
            title="Could not load meals"
            message={library.error ?? 'Could not load these meals.'}
            action="Retry"
            onAction={() => void library.refresh()}
          />
        ) : (
          <>
            <Card tone="brand">
              <Stack gap="sm">
                <AppText variant="label">
                  {plural(meals.length, 'meal', 'meals')}
                  {haveCount > 0 ? ` · you have ${haveCount} of them` : ''}
                </AppText>
                <AppText variant="caption" tone="muted">
                  Copies are yours. If {name} edits a meal later, yours does not change.
                </AppText>
                <AppButton
                  title={result ?? addAllLabel(fresh.length)}
                  icon={result || fresh.length === 0 ? 'check' : 'plus'}
                  variant="primary"
                  busy={busy === 'all'}
                  onPress={
                    result || fresh.length === 0 || !mineKnown || busy
                      ? undefined
                      : () => void copy(fresh, 'all')
                  }
                />
                {!mineKnown && (
                  <AppText variant="caption" tone="muted">
                    Checking which of these you already have…
                  </AppText>
                )}
                {library.error && (
                  <AppText variant="caption" tone="muted">
                    Could not refresh. Showing the list from earlier.
                  </AppText>
                )}
                {error && (
                  <AppText variant="caption" tone="danger" accessibilityRole="alert">
                    {error}
                  </AppText>
                )}
              </Stack>
            </Card>
            <Card padded={false}>
              {meals.map((entry) => (
                <FriendMealRow
                  key={entry.mealId}
                  entry={entry}
                  open={open === entry.mealId}
                  have={haveByName(entry.meal, owned)}
                  busy={busy === entry.mealId}
                  disabled={!mineKnown || !!busy}
                  onToggle={() => setOpen(open === entry.mealId ? null : entry.mealId)}
                  onAdd={() => void copy([entry], entry.mealId)}
                />
              ))}
            </Card>
            <AppText variant="caption" tone="muted">
              Shows name, portions, ingredients and macros only. “In your meals” is a name match, a
              hint rather than a link.
            </AppText>
          </>
        )}
      </StableContent>
    </PageLayout>
  );
}
