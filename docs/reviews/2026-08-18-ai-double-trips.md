# Review — 2026-08-18 · the AI usage screen's double-trips, traced to cause

_Source: three screenshots of **More → Developer → AI usage** from the owner's device, 2026-08-18.
Real production telemetry, not a local measurement — the first time in this run of sweeps that
production data drove a finding._

_Findings: **Q-469, Q-470, Q-471**. The headline correction is that **the screen's most alarming row
is a measurement artefact**, and the two smaller rows are the real defects._

## What the screenshots say

**30-day window:** 268 calls · 651,639 tokens · **$0.09** · 2 failed calls.

Double-trips ("same call fired again within 120s"):

| Section | Redundant | Distinct |
|---|---|---|
| meal-plan-generate-meal | **32** | 4 |
| running-plan-explain | **31** | 9 |
| prescription | **14** | 8 |
| meal-plan-top-up | 9 | 3 |
| meal-plan-generate | 3 | 1 |

That is **89 redundant calls out of 268 — 33% of all AI traffic.** At $0.09 per 30 days the money is
irrelevant, and `CLAUDE.md` already records a decision not to optimise AI spend. What makes it worth
tracing is latency and correctness: these are 1.2–3.2 s calls, and three of the five sections are
**generative**, so a repeat returns *different* content rather than the same answer twice.

## Method

`lib/data/postgres/adapter.ts:4489` defines redundancy as consecutive rows sharing
`(user_id, section, fingerprint)` within 120 s. So every number above depends entirely on what each
route passes as its fingerprint — `lib/ai/instrument.ts` hashes whatever the caller hands it, and its
own comment says *"Pass ids/dates/keys only"*. I read the fingerprint for each of the five sections
and the client call site behind it.

**What this does not establish.** The screenshots are the owner's own account over 30 days — one user,
and the `ai_call_log` window shown. Nothing here was reproduced locally; the call sites were read, not
driven. I did not measure how often each client actually mounts.

---

## Q-471 — the double-trip metric counts deliberate rerolls as redundant, and that is the screen's top row

**Severity: medium — it is a measurement defect, and it is actively misleading where it matters most.**
`[platform][nutrition]`

Three of the five sections fingerprint on a **calorie target alone**:

```
meal-plan-generate-meal   fingerprint: String(Math.round(input.targetCalories))
meal-plan-top-up          fingerprint: String(Math.round(targets.calories))
meal-plan-generate        fingerprint: `${mealCount}:${dayTypes.join('/')}`
```

Rerolling a meal is the feature working: the user taps the reroll icon, dislikes the suggestion, taps
again. Every one of those calls carries the same rounded calorie target, so **every deliberate reroll
after the first is counted as redundant**. "32 redundant · 4 distinct" most plausibly reads as *four
meal slots, rerolled about eight times each* — not a client firing twice.

**And the reroll path is already correctly guarded.** `meal-plan-review-step.tsx` sets
`rerolling` before the fetch and every control carries `disabled={rerolling != null}` — the reroll
icon, the instruction submit, both reorder arrows. There is no tap-spam to fix. An implementer sent to
this row by the screen would go looking for an in-flight guard that is already there.

So **44 of the 89 redundant calls (32 + 9 + 3) are artefact**, and the remaining 45 are real.

**Fix shape:** fingerprint on what actually distinguishes one request from another. For
`generate-meal` that is at least the meal `position` plus `avoidNames`, which already changes on every
successful reroll; for `meal-plan-generate`, the excluded foods and stores. The instrument's rule
("ids/dates/keys only, never raw prompt text or health data") still holds — these are all ids and
keys. Alternatively distinguish *user-initiated repeats* from *client-fired repeats* at the call site,
which is the distinction the screen is really trying to draw. **Lane A.**

---

## Q-470 — the background prescription regeneration has a rate limit but no in-flight guard, so a second page-load fires it again

**Severity: medium. A real duplicate LLM generation for the same session-day.** `[workouts][platform]`

`prescription` fingerprints on `{ programSessionId, today }`
(`packages/shared/src/ai-periodization/generate-prescription.ts:295`) — genuinely stable for one
session on one day. **14 redundant across 8 distinct is therefore a real double-fire**: the same
logical prescription generated twice within 120 s.

Cause: `regeneratePrescriptionInBackground` (`app/api/workout-data/route.ts:50-59`) is fire-and-forget
and called from **two** sites in the same `GET` handler (`:541` when `reevalResult.needsRegenerate`,
`:561` when `aiPrescriptionPending && !isPoll`). It carries a rate limit —
`rateLimit('prescribe:${userId}', 20, 60*60*1000)` — which caps a runaway loop but **does not dedupe**:

- `/api/workout-data` is fetched via `cachedFetch`, which paints from cache and **then always
  revalidates over the network**, so every open of the workout screen issues a real GET.
- Until the first background generation *lands*, `needsRegenerate` / `aiPrescriptionPending` are still
  true — so the second GET starts a second generation for the same session-day.

The rate limit is doing the job it was written for (the comment says so: stopping "an unattended poll
loop" minting unlimited Gemini calls) and is simply not an idempotency mechanism. Note `:561` already
excludes polls with `!isPoll`; `:541` has no such guard.

**Fix shape:** an in-flight marker keyed on `(userId, programSessionId, today)` — the same key the
fingerprint already uses — checked before spawning, and cleared when the generation settles. A
process-local `Set` would cover the common case; a short-lived DB/row marker survives multiple
replicas, which matters because Railway can run more than one.

---

## Q-469 — `running-plan-explain` re-asks the model for the same sentence on every card mount

**Severity: low-medium. The most redundant genuine section, on a call that is explicitly not
load-bearing.** `[cardio][platform]`

`running-plan-explain` fingerprints on `{ type, durationMin }` — stable for a given day's prescribed
run. **31 redundant across 9 distinct**: on average the same run was explained about seven times.

`components/running/prescribed-run-card.tsx:41-53` fires it from a bare `useEffect` with no cache:

```ts
useEffect(() => {
  fetch('/api/running-plan/explain', { method: 'POST', … })
  …
}, [type, durationMin, rationale, gateKey])
```

The author was already alert to the re-fire risk — the comment above it explains that `gateReasons` is
joined into a stable string *"so a new array ref each render doesn't re-fire the fetch"*. That fixed
re-renders. **Mount is the remaining trigger**: every navigation back to the running screen, and every
remount from a parent, asks the model to rewrite the same sentence.

**Two things keep this at low-medium rather than higher.** It is explicitly *"never load-bearing"* —
the deterministic `rationale` renders immediately and the AI copy only swaps in if it arrives — so a
failure costs nothing. And the section is cheap: 62 calls for 6,864 tokens total. The reason to fix it
is that the wording **changes between mounts**, so the same prescribed run can be described
differently each time the user opens the screen, for no reason they can perceive.

**Fix shape:** cache the response on the fingerprint inputs (`type`, `durationMin`, `rationale`,
`gateKey`) — the app already has a client cache layer, and `CLAUDE.md`'s instant-paint rule points the
same way. A day-scoped key is enough; the prescription does not change within a day.

---

## Clean — three prior findings corroborated by production, and one decision reaffirmed

**1. Q-295 still holds exactly.** It recorded *"Coach is 8% of AI calls, 52% of tokens, and the
slowest surface in the app."* The 30-day screenshot: coach is **17 of 268 calls (6.3%)** and
**330,221 of 651,639 tokens (50.7%)** — ~19,400 tokens per call, an order of magnitude above every
other section. The entry needs no revision.

**2. Q-170's Coach latency fix is holding.** That entry recorded Coach latency dropping 10.0 s → 3.5 s
once reasoning tokens were addressed. The 30-day average reads **5,840 ms**, which looks like a
regression — but the 7-day window reads **2,307 ms**. The 30-day figure is inflated by older calls;
recent Coach latency is better than the 3.5 s the fix claimed. **Do not reopen Q-170 on the 30-day
number.**

**3. The decision not to optimise AI cost remains correct.** 30 days of *all* AI usage cost **$0.09**.
Even eliminating every one of the 89 redundant calls would save a fraction of a cent. Q-469/Q-470 are
filed for latency and content-consistency reasons, and any implementer should ignore cost entirely
when judging them.

**4. The error rate is low and unremarkable.** 2 failures in 268 calls (0.7%) — one `coach`, one
`workout-recap`. Not worth a finding on this evidence; worth watching if it climbs.
