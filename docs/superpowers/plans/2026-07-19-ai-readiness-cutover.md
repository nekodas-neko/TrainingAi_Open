# Fix: cut every AI read surface over from frozen Cloud readiness to the live composite (F8 merged)

**Source:** deep review `docs/reviews/2026-07-18-deep-app-review.md` §F/§E2 (F8 = E2-1 + E2-12,
adversarially verified REAL/high, merged; plus F9, E2-8, E2-11). Serial-track item — touches the
god-files (`signals.ts`, readiness route consumers, `ai-chat`, digests).
Branch: `fix/ai-readiness-cutover`.

## Problem

Since the 2026-07-07 ring re-key, `oura_daily.readiness_score` is frozen, and the app's own live
composite is persisted to `oura_daily_derived` — but **five AI read surfaces still read the frozen
column** (verified not covered by items 3a/20/22, which fixed display read-paths and labels only):

1. `lib/ai-periodization/signals.ts:460-462` — `externalReadiness` permanently null/stale; the
   prescribe prompt's `external_readiness < 40` rest-day arm can never fire (other rest-day arms
   partially compensate — see verdict F8 caveat).
2. `lib/ai-chat/context.ts:96-102` + `lib/ai-chat/tools.ts:53-79` — chat tells the user "no Oura
   data" daily.
3. `app/api/weekly-digest` (:137-145) — digest readiness line silently vanished.
4. `app/api/ai/health-insight` (:70-92) — insight computes without readiness.
5. `app/api/next-session` deload recommender (E2-12) — readiness/temp-graded deloads unreachable;
   the fallback path marks every 3rd consecutive training day a "soft deload".

## Tasks

1. One canonical accessor: extend the existing derived-read helper (item 3a shipped one for
   display paths) or add `getLiveReadiness(userId, day)` reading `oura_daily_derived`
   (fallback: pre-re-key `oura_daily` via `isPreRekey`) — One Formula, One Place.
2. Cut all five surfaces over to it; delete the dead `oura_daily` readiness reads.
3. **E2-8 (low):** missing today's summary row currently triggers the running gate's
   "provisional readiness" soften (and persists the softened type) — make absent data degrade to
   neutral per the route's own contract.
4. **E2-11 (medium):** the failed-generation retry + "preparing" gate key on a
   `'consumed' + null` signature a normal completion never produces — one Gemini outage costs two
   sessions of prescriptions. Re-key the retry trigger on the actual failure state.
5. **F9 (medium, scope-check):** resilience, BDI, daytime stress, zone minutes, training stress
   are one-way pipes (computed, persisted, invisible to chat tools/digest/insight/prescribe).
   Wire at minimum: resilience level + daytime-stress summary + OTS into the chat tools and the
   prescribe signal block (zone minutes/OTS depend on P2 landing first). Anything larger returns
   to the backlog as its own item.
6. Dev-server verification: chat tool answers include readiness on a seeded derived row; digest +
   insight include it; prescribe signals JSON carries live readiness; `pnpm test` green.

## Out of scope

Display-layer honesty (item 21/S8, tracked), Body Battery calibration (data-eff 2.3, tracked).
