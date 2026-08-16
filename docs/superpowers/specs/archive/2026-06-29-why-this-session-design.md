# "Why This Session?" — Design Spec

**Date:** 2026-06-29  
**Branch:** `claude/training-schedule-logic-vwst0l`

---

## Summary

Two related improvements shipped together:

1. **Extended scoring signals** — Oura readiness and sleep trend now modulate the recovery/balance weights inside `computeAiDynamicNextSession`, so the recommendation itself changes based on readiness state.
2. **"Why this?" detail page** — A dedicated full-screen page (mirroring the Oura readiness/sleep detail pages) that shows the composite score, contributor bars, individual signal cards, ranked alternatives, and a background Gemini AI insight paragraph.

---

## Part 1 — Scoring Changes

### Current formula

```
overallScore = recovery × 0.40 + balance × 0.35 + freshness × 0.25
```

### Extended `AiDynamicInput` fields

Add to the interface in `lib/ai-periodization/ai-dynamic.ts`:

```ts
readinessScore: number | null    // already exists
sleepTrend: number | null        // ratio: recent 3 nights / older baseline
energyLevel: string | null       // from mood log: 'energised' | 'normal' | 'tired' | 'exhausted'
```

`sleepTrend` and `energyLevel` are already computed in `getNextSession()` via `signals.ts` helpers; they just need to be passed into `AiDynamicInput`.

### Weight shifts

| Condition | Recovery weight | Balance weight | Freshness weight |
|---|---|---|---|
| Default | 0.40 | 0.35 | 0.25 |
| Readiness < 60 OR sleepTrend < 0.85 | 0.55 | 0.25 | 0.20 |

Only one weight shift rule — when the body needs more recovery, favour the session whose muscles are most recovered over the one that's most "overdue."

### Deload signal extensions

- `energyLevel === 'low'` → `deloadStrength` bumps one level (soft → recommended, recommended → strong)
- `energyLevel === 'drained'` → `deloadStrength` forced to `'strong'`
- HRV trend below 85% of baseline → adds a `hrvWarning: boolean` flag on `NextSessionRecommendation` (display-only, does not shift weights — HRV is too noisy day-to-day to move weights on its own)

### `NextSessionRecommendation` additions

```ts
weightedComponents: {
  recovery: { score: number; weight: number }
  balance: { score: number; weight: number }
  freshness: { score: number; weight: number }
}
scoredSessions: Array<{
  session: ProgramSession
  overallScore: number
  recoveryScore: number
  balanceScore: number
  freshnessScore: number
}>
hrvWarning: boolean
```

These are computed inside `computeAiDynamicNextSession` and returned alongside the existing fields. The adapter passes them through; no additional DB queries needed.

---

## Part 2 — "Why This?" Page

### Route

`/session-explain?sessionId={id}` — a client component page.

Navigated to from the `RecommendationCard` via a "Why this?" button (small secondary button, below the session name).

### API

**`GET /api/session-explain?sessionId={id}`**

Returns the extended `NextSessionRecommendation` (already contains `scoredSessions`, `weightedComponents`, signals). No new DB queries — calls `getNextSession()` which already computes everything, then returns the enriched recommendation.

Response shape:
```ts
{
  session: { id: string; name: string }
  overallScore: number
  weightedComponents: {
    recovery: { score: number; weight: number }
    balance: { score: number; weight: number }
    freshness: { score: number; weight: number }
  }
  signals: {
    muscleRecovery: MuscleRecovery[]
    ouraReadiness: number | null
    sleepTrend: number | null
    hrvTrend: number | null
    hrvWarning: boolean
    energyLevel: string | null
    soreMuscles: string[]
    consecutiveTrainingDays: number
    deloadRecommended: boolean
    deloadStrength: 'soft' | 'recommended' | 'strong' | null
  }
  alternatives: Array<{
    session: { id: string; name: string }
    overallScore: number
    primaryReason: string   // e.g. "muscles not fully recovered"
  }>
}
```

**`GET /api/session-explain/insight?sessionId={id}`** — streaming endpoint.

Uses Gemini to generate a 2–3 sentence natural-language explanation of why this session was chosen. Input: the `signals` object above. Streamed via `streamText` from the Vercel AI SDK (same pattern as `app/api/ai-chat/route.ts`). Called client-side after the main data renders.

### Page layout (top → bottom)

1. **Header** — back arrow + title "Why [Session Name]?"

2. **Overall score ring** — large SVG ring (0–100), same visual style as the ring inside `components/readiness-card.tsx`. Label: "Overall readiness for this session". Colour: green ≥70, amber 40–69, red <40.

3. **Contributor bars card** — card with three horizontal bars:
   - Muscle recovery · e.g. 78%
   - Session balance · e.g. 91% (how overdue)
   - Freshness · e.g. 65% (time since last)
   Each bar shows the raw score and the effective weight (e.g. "×0.40").

4. **Signal cards** — individual cards in a vertical list:
   - Oura readiness (numeric score + label Good/Fair/Low; null = "No data")
   - Sleep trend (ratio with ↑/↓ arrow vs baseline; null = "No data")
   - HRV trend (same; includes warning chip if `hrvWarning` is true)
   - Energy level (mood emoji + label from `EnergyLevel`: drained/low/ok/good/pumped; null = "Not logged today")
   - Sore muscles (comma list or "None"; highlights muscles that are in this session)
   - Consecutive training days (number + amber chip "Consider a rest day" if ≥ 4)

5. **Ranked alternatives card** — compact list of the other sessions with their overall score and the primary reason they ranked lower. "Primary reason" is derived from whichever component has the biggest deficit vs the recommended session.

6. **AI INSIGHT card** — amber/gold accent card at the bottom, same style as existing AI cards in the app. Shows "Analysing signals…" skeleton (animated pulse) while loading, then the streamed Gemini text. No refresh button in v1.

### Component files

| File | Purpose |
|---|---|
| `app/session-explain/page.tsx` | Route page — fetches data, passes to content component |
| `app/session-explain/session-explain-content.tsx` | Main content component (score ring, bars, signal cards) |
| `app/session-explain/components/score-ring.tsx` | SVG ring — adapts the ring pattern from `readiness-card.tsx` |
| `app/session-explain/components/contributor-bars.tsx` | Three bars with weight labels |
| `app/session-explain/components/signal-card.tsx` | Generic signal card (icon + label + value + optional chip) |
| `app/session-explain/components/alternatives-card.tsx` | Ranked list of other sessions |
| `app/session-explain/components/ai-insight-card.tsx` | Streaming AI text card |
| `app/api/session-explain/route.ts` | GET — returns enriched recommendation |
| `app/api/session-explain/insight/route.ts` | GET — streaming Gemini insight |

### "Why this?" entry point on RecommendationCard

Add a small "Why this?" text button below the session name in `app/session-select/components/recommendation-card.tsx`. Tapping it navigates to `/session-explain?sessionId={id}`. Only shown when a specific session is recommended (not on rest day recommendations).

### Caching

`/api/session-explain` uses the same cache key as `/api/next-session` (both call `getNextSession`). Cached for 5 minutes, invalidated when program structure or a workout session changes — same invalidation groups already set up in `lib/cache-groups.ts`.

---

## What's not in scope

- Refresh button on the AI insight card (v1 just loads once per page open)
- Per-session "Why not?" deep-dive for alternatives (the ranked card is a summary only)
- Push notifications based on signals
- Historical "why" for past recommendations
