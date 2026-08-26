import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { todayInTz } from '@trainingai/shared/date-utils'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateSavedMeals } from '@/lib/cache-groups'

export interface SaveMealInput {
  /** Kept, never re-minted, when re-saving over an existing meal — see `handleSave`'s note. */
  mealId: string
  name: string
  items: { foodItemId: string; quantityMultiplier: number }[]
  servings: number
  imageDataUri: string | null
  /** The meal's own creation date when re-saving over one; now for a new meal. */
  createdAt: string
  /** True when `mealId` names a meal that already exists — decides PUT vs POST on the web path. */
  isUpdate: boolean
  userId?: string
  tz: string
}

/**
 * Writing a saved meal, offline-first.
 *
 * Extracted from `saved-meals-sheet.tsx` when BF-11d took that file past the 800-line ceiling. It is
 * logic rather than markup, so it moves without threading a single prop — and the builder is now on
 * its fourth extraction in two entries, which is the rule working rather than failing.
 *
 * **Returns the refreshed local list, or `null` when the caller must refetch.** The local path
 * already has the new list in hand; the web fallback does not, and pretending otherwise would mean
 * a second read for a value one branch already holds.
 *
 * **The inner catch is load-bearing (Q-216).** A local write that throws must fall through to the
 * server rather than into an error toast — without it, one SQLite failure loses the save entirely.
 */
export async function saveMealToLibrary(input: SaveMealInput): Promise<SavedMeal[] | null> {
  const { mealId, name, items, servings, imageDataUri, createdAt, isUpdate, userId, tz } = input
  const body = { id: mealId, name, items, servings, imageDataUri }
  const store = userId ? getLocalStore(userId) : null
  const now = new Date().toISOString()

  if (store) {
    try {
      // Local-first: write to the on-device store + queue the outbox mutation, then let the caller
      // paint synchronously — no waiting on the network, and it works offline.
      await store.upsertSavedMeal(
        { id: mealId, name, servings, imageDataUri, createdAt, updatedAt: now, deletedAt: null, syncStatus: 'pending' },
        items.map(it => ({ id: crypto.randomUUID(), savedMealId: mealId, foodItemId: it.foodItemId, quantityMultiplier: it.quantityMultiplier })),
      )
      // BF-11e added `mealTypeIds` to the route, the outbox branch and the local table. This payload
      // deliberately does NOT send it yet, and that is the correct no-op rather than an omission:
      // absent means "leave the stored tags alone" on both the local upsert above and the server
      // replay, while sending the currently-loaded tags would REVERT a change made on another device
      // between this sheet loading and this save. There is no asymmetry for the sync rule to catch
      // either — no surface can set a tag today, web or native.
      // **BF-11f adds the picker: it must add `mealTypeIds` HERE and to `upsertSavedMeal` above, in
      // the same PR**, or tags will save on the web and strand offline.
      await store.queueMutation({ userId: userId!, domain: 'saved_meals', date: todayInTz(tz), payload: body })
      await invalidateSavedMeals()
      const fresh = await store.getSavedMeals()
      pushThenRevalidate(userId!, invalidateSavedMeals)
      return fresh
    } catch (e) {
      console.error('Saved-meal SQLite write failed, falling back to API:', e)
    }
  }

  // Web fallback (no local store), and the recovery path when the local write above threw. A pure
  // pass-through: it holds no defaults or derivations the device path lacks, so it cannot drift.
  const res = await fetch(
    isUpdate ? `/api/nutrition/saved-meals/${mealId}` : '/api/nutrition/saved-meals',
    { method: isUpdate ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  if (!res.ok) throw new Error('Could not save that meal')
  await invalidateSavedMeals()
  return null
}
