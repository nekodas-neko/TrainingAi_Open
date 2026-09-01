import type { NextSessionRecommendation } from "@trainingai/shared/types/program";
import { todayInTz } from "@trainingai/shared/date-utils";
import { getLocalStore } from "@/lib/local-store";
import { pushMutations } from "@/lib/local-store/sync-engine";
import { invalidateRestDayChoice } from "@/lib/cache-groups";

/**
 * Choosing a rest day — BF-84.
 *
 * **This file's comment used to be the finding.** It read: *"/api/log-rest-day persists nothing
 * (rest days are inferred from gaps in workout history), so refetching /api/next-session after
 * choosing rest just recomputes the prompt and reverts the selection."* All three consequences
 * followed from that — the second device never saw the choice, it died on a reinstall, and any
 * refetch undid it.
 *
 * The choice is now a stored row (`rest_days`, migration 247), written through the outbox so it
 * survives being made offline, and `getNextSession` prefers it over inferring rest from a gap.
 *
 * **The `localStorage` marker stays, and its job has changed.** It is no longer the record — it is
 * the optimistic echo that keeps the card showing rest between the tap and the next successful
 * fetch, and while the device is offline. That is a legitimate client cache; what it could never
 * be was the only copy.
 */
export const REST_DAY_KEY = "ta_rest_day";

/**
 * `tz` is threaded through every function here rather than left to `todayInTz`'s default.
 * The default is the owner's zone, which is right for him and wrong for everyone else — and the
 * seed path that consumes this already stamps its cache with `todayInTz(tz)`, so a user in another
 * zone had the marker and the seed disagreeing about which day it was for ten hours out of every
 * twenty-four. Passing it is what makes the two agree.
 */
export function isRestDayChosen(tz?: string): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(REST_DAY_KEY) === todayInTz(tz); } catch { return false; }
}

function setMarker(chosen: boolean, tz?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (chosen) localStorage.setItem(REST_DAY_KEY, todayInTz(tz));
    else localStorage.removeItem(REST_DAY_KEY);
  } catch { /* ignore */ }
}

/**
 * The one write, for both surfaces. `session-select`'s existing control and anything added later
 * call this rather than posting on their own, so there is one path to keep correct.
 *
 * Feedback-first, like every other save path here: the marker is set synchronously so the caller
 * can flip the card in the same turn, and the durable write happens behind it. Offline, the outbox
 * mutation is what carries the choice to the server later; on the web (no local store) the direct
 * POST is the fallback, and its failure leaves the marker in place — the same behaviour as before,
 * now with a server row wherever one can be written.
 */
export function chooseRestDay(userId: string | undefined, opts: { tz?: string; resting?: boolean } = {}): void {
  const { tz, resting = true } = opts;
  setMarker(resting, tz);
  const date = todayInTz(tz);
  void (async () => {
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      try {
        await store.queueMutation({ userId: userId!, domain: 'rest_days', date, payload: { resting } });
        pushMutations(userId!).catch(() => {});
        await invalidateRestDayChoice();
        return;
      } catch (err) {
        console.error('Rest-day outbox write failed, falling back to API:', err);
      }
    }
    try {
      await fetch('/api/log-rest-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, resting }),
      });
    } catch { /* the marker still holds the choice for today */ }
    await invalidateRestDayChoice();
  })();
}

/**
 * Applies today's marker over a recommendation the server has not caught up with yet.
 *
 * Still needed after BF-84, for two cases the stored row cannot cover on its own: the moment
 * between the tap and the next fetch, and a cached recommendation read while offline. Once the
 * row has been pushed, `getNextSession` returns `isRestDay: true` on its own and this agrees with
 * it rather than overriding it.
 */
export function withRestDayOverride(rec: NextSessionRecommendation | null, tz?: string): NextSessionRecommendation | null {
  if (!rec || !isRestDayChosen(tz)) return rec;
  return { ...rec, isRestDay: true, deloadOrRestRecommended: false };
}
