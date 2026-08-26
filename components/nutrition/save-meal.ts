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
  /**
   * Which meal slots a plan may use this meal in (BF-11f).
   *
   * `[]` means "clear them" and `undefined` means "leave the stored tags alone" — the distinction
   * that BF-11e built into the route, the outbox replay and the local table, and it is load-bearing
   * here. Send the array whenever the builder actually **showed** this meal's tags, so an untick is
   * saveable. Send `undefined` when it did not: overwriting a meal found by duplicate detection
   * writes over a meal the user never opened, and `[]` there would silently wipe its tags.
   */
  mealTypeIds: string[] | undefined
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
  const { mealId, name, items, servings, imageDataUri, mealTypeIds, createdAt, isUpdate, userId, tz } = input
  const body = { id: mealId, name, items, servings, imageDataUri, mealTypeIds }
  const store = userId ? getLocalStore(userId) : null
  const now = new Date().toISOString()

  if (store) {
    try {
      // Local-first: write to the on-device store + queue the outbox mutation, then let the caller
      // paint synchronously — no waiting on the network, and it works offline.
      await store.upsertSavedMeal(
        { id: mealId, name, servings, imageDataUri, createdAt, updatedAt: now, deletedAt: null, syncStatus: 'pending' },
        items.map(it => ({ id: crypto.randomUUID(), savedMealId: mealId, foodItemId: it.foodItemId, quantityMultiplier: it.quantityMultiplier })),
        mealTypeIds,
      )
      // BF-11e shipped the storage and transport and deliberately stopped short of sending tags;
      // BF-11f is the picker, so the payload and the local upsert above now both carry them. They
      // travel TOGETHER by construction — the same `mealTypeIds` reaches `upsertSavedMeal` and the
      // outbox body from one destructure, which is what stops tags saving on the web and stranding
      // offline. The route, the outbox replay and the local table all read absent as "leave the
      // stored tags alone"; this path is never absent, because the builder always knows the answer.
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
