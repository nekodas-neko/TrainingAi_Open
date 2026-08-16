# Metric Label & Source Consolidation Implementation Plan

> **✅ RESOLVED — all tasks verified shipped on `main` 2026-07-20.** Every cited site already carries
> the target copy/behaviour: sleep-card chips read "HRV (overnight)" / "Lowest HR"
> (`sleep-card.tsx:78-79`); the RhrHrvSpo2 tile reads "ms rMSSD · overnight"
> (`rhr-hrv-spo2-card.tsx:75`); the heart-rate sparkline is "HRV (overnight)" (`heart-rate/page.tsx:121`);
> the baseline card title is "HRV · 7d vs 28d baseline" (`health-sections.tsx:566`); SleepCard takes a
> `computedSleepScore` prop fed by `readiness?.sleepScore` and the badge falls back to the stored score
> (`sleep-card.tsx:14,57` + `health-sections.tsx:331`); ReadinessCard's headline + gate use
> `readinessDisplayScore` (`readiness-card.tsx:121`); the health-insight prompt de-duplicates the two HRV
> lines (`health-insight/route.ts:107,115`); the weekly-digest uses "Overnight HRV" (`weekly-digest/route.ts:141`).
> The implementation-backlog already marks this item (review-S9 / serial-track item 22) ✅ shipped; this
> plan doc and the `planned_upgrades.md` Batch-S row were the only stragglers. Do NOT re-implement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every card that shows HRV, RHR, sleep score, or readiness show the *same number under an honest label* as its sibling surfaces — window-annotated HRV labels, "Lowest HR" instead of a fake "RHR", one computed sleep score everywhere, and one blended readiness headline everywhere.

**Architecture:** Pure display-layer changes: label strings and prop threading only. No route response shape changes, no new formulas, no cache-key changes, no migrations. The one data-flow change (SleepCard's score badge) reuses the `ReadinessScoreResponse` object that is *already in scope* at the SleepCard call site — no new fetch, no client-side score computation.

**Tech Stack:** TypeScript, React 19, Next.js 15, Tailwind v4. No new dependencies.

---

## Why now

Source: **finding §4 of `docs/reviews/2026-07-16-data-efficiency-review.md`** ("Same metric, different numbers/labels across cards — MEDIUM", priority-map row "Metric source/label consolidation, Effort S"). Four sub-findings:

1. "HRV" appears with three different meanings on adjacent surfaces, with no label distinguishing them.
2. The SleepCard chip labelled "RHR" is actually `lowest_heart_rate` — it reads lower than the Resting-HR tile beside it.
3. Two sleep scores: the Home chip uses the readiness route's computed score; the SleepCard badge shows the stored Cloud-only column, which is NULL on every BLE night (i.e. every night since the 2026-07-07 re-key) — the badge silently vanished.
4. Two readiness presentations between Home and `/overview`.

**Branch:** `fix/metric-label-consolidation` (start from freshly-fetched `main`: `git fetch origin main && git remote prune origin && git checkout -B fix/metric-label-consolidation origin/main`).

**Backlog protocol:** this is the PR-2 implementer session for review-S9 item "4 — Metric source/label consolidation". Remove its entry from `docs/implementation-backlog.md` (or the Batch-S row in `docs/planned_upgrades.md`, wherever it was queued) in the same PR, and fold in the journal + `projectOverview.md` update as the final commits before merge.

---

## Verified against current `main` (2026-07-16, v1.154.1) — read this before editing

The review was re-checked against source today. Two findings needed correction; the rest hold:

**A. HRV (a) and (b) are the SAME number — the label difference is provenance only.**
`lib/data/postgres/adapter.ts:4144-4151` (BLE rollup, `body_metrics` back-fill):

```ts
const byDay = new Map<string, { date: string; hrvMs?: number; restingHeartRate?: number; spo2Pct?: number; steps?: number }>()
for (const r of sleepRows) {
  if (r.averageHrvMs == null && r.lowestHeartRate == null) continue
  const row = byDay.get(r.date) ?? { date: r.date }
  if (r.averageHrvMs != null) row.hrvMs = r.averageHrvMs          // ← verbatim copy
  if (r.lowestHeartRate != null) row.restingHeartRate = Math.round(r.lowestHeartRate)
  byDay.set(r.date, row)
}
```

`body_metrics.hrvMs` is written *verbatim from* `sleep_sessions.averageHrvMs` (the quality-gated overnight median, wake-day keyed). The legacy Cloud sync did the same (`hrv_ms ← sleep.average_hrv`, CLAUDE.md). So the RhrHrvSpo2 tile, the heart-rate sparkline, and the SleepCard chip all show **the same overnight rMSSD** — the fix is to give them *matching* window-annotated copy ("overnight"), not divergent labels. The only genuinely *different* HRV number is the 7d-vs-28d baseline card (fed by `readiness.recentHrv`/`baselineHrv` from `/api/readiness-score`), which gets a window-explicit title.

**B. Review item "two readiness numbers" is PARTIALLY STALE.** `components/readiness-card.tsx:131` already renders the collapsed headline from `readiness.score` — which *is* the blended score (`app/api/readiness-score/route.ts:281-304`), numerically identical to `readinessDisplayScore` whenever the latter is non-null (route `:312-314` — `readinessDisplayScore` is just `score` behind a sufficient-data null-gate). The expanded breakdown already presents "Oura base" + adjustments + "Final score" as a sub-breakdown, exactly the shape the review asks for. The **real residual divergence** is the null-gate: Home's chip (`components/oura-score-chip-row.tsx:89`) reads `readinessDisplayScore` and hides itself when the composite has no recovery signal, while `/overview` shows the ungated `score` — so on a low-data day `/overview` shows a misleading sleep+load-only number that Home deliberately hides. Fix (Task 4): headline from `readinessDisplayScore`, card hidden when null, breakdown kept as-is.

**C. Bonus finding (same class, found during verification):** `app/api/ai/health-insight/route.ts` feeds the LLM the *same* overnight HRV twice under two labels — line 85 `Overnight HRV: X ms` (from `sleep_sessions`) and line 93 `HRV: X ms` (from `body_metrics`) — which invites the model to treat them as two metrics. One-line copy fix rides along (Task 5). The weekly digest (`app/api/weekly-digest/route.ts:103-113`) already coalesces the two sources into one `hrvLine`; it gets the matching "Overnight HRV" label.

**D. Everything is display/prompt copy — no route response shape changes.** Therefore: no cache key or invalidation-group changes (the `sleep-sessions` key in `lib/cache-groups.ts:121,146` and the `readiness-score` key are untouched), no new route tests required (the repo rule "any route change gets a test" applies to behaviour, and Task 5 changes only prompt strings — `pnpm test` still runs in full to catch any assertion on the old copy). No native/offline-first/safe-area/gesture surface is touched, so per Canonical Runtime the `pnpm dev` check is the merge gate — no on-device smoke run required (state this in the PR).

---

## File structure

**Modify (no files created except this plan's sibling docs updates):**
- `components/health/body-cards/sleep-card.tsx` — chip relabels (HRV/Lowest HR) + computed-score badge prop.
- `app/health/health-sections.tsx` — pass `computedSleepScore` at the SleepCard call site (`:323-331`); retitle the hrvBaseline card (`:562`, `:572`).
- `components/health/body-cards/rhr-hrv-spo2-card.tsx` — HRV tile unit line gets the window annotation (`:61`).
- `app/health/heart-rate/page.tsx` — HRV sparkline label (`:108`).
- `components/readiness-card.tsx` — headline + null-gate from `readinessDisplayScore` (`:116-131`, `:207-210`).
- `app/api/ai/health-insight/route.ts` — de-duplicate the two HRV prompt labels (`:85`, `:93`).
- `app/api/weekly-digest/route.ts` — `hrvLine` label (`:113`).
- `docs/module-map.md` — canonical display-source table appended to §6.
- `package.json` + `lib/changelog.ts` — patch bump.
- `docs/implementation-backlog.md` (entry removal), `projectOverview.md` + `docs/overview/history-*.md` (journal) — final task.

All touched component files are far under the 800-line ceiling (sleep-card 87, rhr-hrv-spo2-card 92, readiness-card 255); health-sections.tsx is a known hotspot but only gains one prop + two label strings.

---

### Task 1: SleepCard — honest chip labels ("HRV (overnight)", "Lowest HR")

**Files:**
- Modify: `components/health/body-cards/sleep-card.tsx:71-72`

- [ ] **Step 1: Relabel the two chips**

Current (`sleep-card.tsx:71-72`):

```tsx
{recentSleep.averageHrvMs    != null && <span className="text-[9px] rounded bg-rose-500/20 text-rose-400 px-1.5 py-0.5">HRV {recentSleep.averageHrvMs}ms</span>}
{recentSleep.lowestHeartRate != null && <span className="text-[9px] rounded bg-pink-500/20 text-pink-400 px-1.5 py-0.5">RHR {recentSleep.lowestHeartRate}bpm</span>}
```

Replace with:

```tsx
{recentSleep.averageHrvMs    != null && <span className="text-[9px] rounded bg-rose-500/20 text-rose-400 px-1.5 py-0.5">HRV (overnight) {recentSleep.averageHrvMs}ms</span>}
{recentSleep.lowestHeartRate != null && <span className="text-[9px] rounded bg-pink-500/20 text-pink-400 px-1.5 py-0.5">Lowest HR {recentSleep.lowestHeartRate}bpm</span>}
```

Do **not** change the data source — `lowestHeartRate` stays; only the label stops claiming it's RHR. (The Resting-HR *tile* beside it keeps `body_metrics.restingHeartRate`, which on BLE days is `Math.round(lowest_heart_rate)` per adapter `:4149` — near-identical values, but the tile is the canonical daily-RHR surface; the sleep chip is now honestly "the lowest reading of the night".)

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add components/health/body-cards/sleep-card.tsx
git commit -m "fix: label sleep-card HR chips honestly (overnight HRV, lowest HR)"
```

---

### Task 2: Window-annotate the other HRV surfaces (tile, sparkline, baseline card)

Since Verified-A above establishes all daily-HRV surfaces show the same overnight rMSSD, the copy must match across them; only the baseline card is a different aggregation and says so in its title.

**Files:**
- Modify: `components/health/body-cards/rhr-hrv-spo2-card.tsx:61`
- Modify: `app/health/heart-rate/page.tsx:108`
- Modify: `app/health/health-sections.tsx:562,572`

- [ ] **Step 1: RhrHrvSpo2 tile — annotate the unit line**

Current (`rhr-hrv-spo2-card.tsx:61`, inside the HRV tile):

```tsx
          <p className="text-[9px] text-muted-foreground mt-0.5">ms rMSSD</p>
```

Replace with:

```tsx
          <p className="text-[9px] text-muted-foreground mt-0.5">ms rMSSD · overnight</p>
```

(The tile header stays "HRV" — the 3-column grid is too narrow for a longer header; the unit line carries the window.)

- [ ] **Step 2: Heart-rate page sparkline — annotate the label**

Current (`app/health/heart-rate/page.tsx:108`):

```tsx
            <TrendSparkline trends={trends.trends} field="hrvMs" label="HRV" color="#a78bfa" unit="ms" />
```

Replace with:

```tsx
            <TrendSparkline trends={trends.trends} field="hrvMs" label="HRV (overnight)" color="#a78bfa" unit="ms" />
```

- [ ] **Step 3: hrvBaseline card — window-explicit title**

Current (`app/health/health-sections.tsx:562` and `:572`):

```tsx
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">HRV vs Baseline</h3>
```
```tsx
            <p className="text-xs text-muted-foreground mt-1">7-day avg vs 28-day baseline (low-wear days excluded)</p>
```

Replace with (title carries the windows; the subtext keeps only the non-redundant detail):

```tsx
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">HRV · 7d vs 28d baseline</h3>
```
```tsx
            <p className="text-xs text-muted-foreground mt-1">7-day average of overnight HRV vs your 28-day baseline (low-wear days excluded)</p>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/health/body-cards/rhr-hrv-spo2-card.tsx app/health/heart-rate/page.tsx app/health/health-sections.tsx
git commit -m "fix: annotate every HRV surface with its aggregation window"
```

---

### Task 3: SleepCard badge shows the computed sleep score (same number as the Home chip)

**Chosen path (cheapest, verified):** the SleepCard call site is `getHealthSections` (`app/health/health-sections.tsx:323-331`), whose ctx **already carries `readiness: ReadinessScoreResponse | null`** (`:96`, destructured `:130` — the hrvBaseline card reads it two cases down). `readiness.sleepScore` is exactly the Home chip's value — the route computes it as `ouraToday?.sleepScore ?? computeSleepScore(lastSleep)?.score` (`app/api/readiness-score/route.ts:152,365`), and `oura-score-chip-row.tsx:91` renders that field. So: **thread it down as a prop**. No route change, no sleep-sessions response change, and — critically — **no client-side `computeSleepScore` call and no second sleep-score implementation** (One Formula, One Place: the only computation stays in the readiness route's import of `lib/health/sleep-score.ts`). The rejected alternative (adding a computed score to `/api/sleep-sessions`) would change a cached response shape (`sleep-sessions` key, two invalidation sites in `lib/cache-groups.ts:121,146`) for no benefit.

The stored `lastSleep.sleepScore` stays as a *fallback* only (renders Cloud-era history when the readiness fetch hasn't landed; on Cloud-era days the two agree anyway because the route prefers `ouraToday.sleepScore`).

**Files:**
- Modify: `components/health/body-cards/sleep-card.tsx` (props interface + badge)
- Modify: `app/health/health-sections.tsx:323-331` (call site)

- [ ] **Step 1: Add the prop and use it in the badge**

In `components/health/body-cards/sleep-card.tsx`, change the `Props` interface (`:8-13`):

```tsx
interface Props {
  recentSleep: SleepRow | null;
  lastSleep: SleepRow | null;
  /** Today's computed sleep score from /api/readiness-score — the same number the
   *  Home chip shows. The stored sleep_sessions.sleep_score is Cloud-only (NULL on
   *  BLE nights) and is kept only as a fallback. */
  computedSleepScore: number | null;
  metaLoading: boolean;
  onOpenSheet: () => void;
}
```

Change the component signature (`:17`):

```tsx
export function SleepCard({ recentSleep, lastSleep, computedSleepScore, metaLoading, onOpenSheet }: Props) {
```

Change the badge (`:51-58`). Current:

```tsx
        <div className="flex items-center gap-1.5 flex-none">
          {lastSleep?.sleepScore != null && (
            <span className="text-sm font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.2)', color: '#8b5cf6' }}>
              {lastSleep.sleepScore}
            </span>
          )}
          <span className="text-[9px] text-muted-foreground opacity-60">↗</span>
        </div>
```

Replace with:

```tsx
        <div className="flex items-center gap-1.5 flex-none">
          {(() => {
            const badgeScore = computedSleepScore ?? lastSleep?.sleepScore ?? null;
            return badgeScore != null ? (
              <span className="text-sm font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.2)', color: '#8b5cf6' }}>
                {badgeScore}
              </span>
            ) : null;
          })()}
          <span className="text-[9px] text-muted-foreground opacity-60">↗</span>
        </div>
```

- [ ] **Step 2: Pass the prop at the call site**

In `app/health/health-sections.tsx:323-331`. Current:

```tsx
      case "sleep": return (
        <SleepCard
          key="sleep"
          recentSleep={recentSleep}
          lastSleep={lastSleep}
          metaLoading={metaLoading}
          onOpenSheet={() => setMetricSheet("sleep")}
        />
      );
```

Replace with:

```tsx
      case "sleep": return (
        <SleepCard
          key="sleep"
          recentSleep={recentSleep}
          lastSleep={lastSleep}
          computedSleepScore={readiness?.sleepScore ?? null}
          metaLoading={metaLoading}
          onOpenSheet={() => setMetricSheet("sleep")}
        />
      );
```

(`readiness` is already destructured in this scope at `:130`; SleepCard has no other call site — verified by grep, the only import is `health-sections.tsx:16`.)

- [ ] **Step 3: Typecheck (this is what catches a missed call site)**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0. A missing-prop error anywhere means an unnoticed second call site — fix it the same way.

- [ ] **Step 4: Commit**

```bash
git add components/health/body-cards/sleep-card.tsx app/health/health-sections.tsx
git commit -m "fix: sleep-card badge shows the computed sleep score (stored Cloud column is NULL on BLE nights)"
```

---

### Task 4: ReadinessCard on /overview — headline from `readinessDisplayScore`, hidden when null

Per Verified-B: the headline number is *already* the blended score; the actual fix is adopting Home's null-gate so `/overview` never shows a low-confidence composite Home hides, and reading the same named field so the two surfaces can't drift again. The base+adjustments breakdown is kept untouched as the sub-breakdown.

**Files:**
- Modify: `components/readiness-card.tsx:116-131`, `:209`

- [ ] **Step 1: Gate the card and switch the headline field**

Current (`readiness-card.tsx:116-131`):

```tsx
export function ReadinessCard({ readiness }: { readiness: ReadinessScoreResponse }) {
  const [expanded, setExpanded] = useState(false)
  const color = labelColor(readiness.label)
  const adj = readiness.ouraScore != null ? readiness.score - readiness.ouraScore : null

  return (
    <button
      type="button"
      className="w-full text-left rounded-xl border border-border overflow-hidden select-none"
      style={{ background: 'var(--brand-card-bg)' }}
      onClick={() => setExpanded(e => !e)}
      aria-expanded={expanded}
    >
      {/* ── Collapsed row ── */}
      <div className="flex items-center gap-3 px-3 py-2">
        <ScoreArc score={readiness.score} label={readiness.label} />
```

Replace with:

```tsx
export function ReadinessCard({ readiness }: { readiness: ReadinessScoreResponse }) {
  const [expanded, setExpanded] = useState(false)
  // The same blended display score Home's chip shows (readiness.score behind the
  // route's sufficient-data gate). Null = not enough recovery signal for a
  // confident number — hide the card entirely, exactly as the Home chip does.
  const displayScore = readiness.readinessDisplayScore
  const color = labelColor(readiness.label)
  const adj = readiness.ouraScore != null && displayScore != null ? displayScore - readiness.ouraScore : null
  if (displayScore == null) return null

  return (
    <button
      type="button"
      className="w-full text-left rounded-xl border border-border overflow-hidden select-none"
      style={{ background: 'var(--brand-card-bg)' }}
      onClick={() => setExpanded(e => !e)}
      aria-expanded={expanded}
    >
      {/* ── Collapsed row ── */}
      <div className="flex items-center gap-3 px-3 py-2">
        <ScoreArc score={displayScore} label={readiness.label} />
```

Note: hooks (`useState`) stay above the early return — React's rules-of-hooks require it, and the lint gate will catch a violation.

- [ ] **Step 2: Final-score row in the breakdown uses the same field**

Current (`readiness-card.tsx:207-210`):

```tsx
                    <div className="flex items-center justify-between text-xs border-t border-border/40 pt-1 mt-0.5">
                      <span className="text-muted-foreground font-medium">Final score</span>
                      <span className="font-bold tabular-nums" style={{ color }}>{readiness.score}</span>
                    </div>
```

Replace with:

```tsx
                    <div className="flex items-center justify-between text-xs border-t border-border/40 pt-1 mt-0.5">
                      <span className="text-muted-foreground font-medium">Final score</span>
                      <span className="font-bold tabular-nums" style={{ color }}>{displayScore}</span>
                    </div>
```

(Numerically identical when the breakdown renders — the breakdown is gated on `ouraScore != null`, which forces `readinessDisplayScore = score` at route `:312` — but now every rendered number in this component reads from one field.)

The parent needs no change: `components/overview-screen.tsx:355` renders `{readiness && <ReadinessCard readiness={readiness} />}` and the component returning null collapses cleanly.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: both exit 0 (lint verifies the hooks-before-early-return ordering).

- [ ] **Step 4: Commit**

```bash
git add components/readiness-card.tsx
git commit -m "fix: overview readiness headline uses the same gated display score as Home"
```

---

### Task 5: AI prompt copy — one label for one metric

The same overnight HRV reaches the health-insight LLM twice under two labels, inviting it to treat them as two metrics; the weekly digest's coalesced line matches the new UI copy.

**Files:**
- Modify: `app/api/ai/health-insight/route.ts:93`
- Modify: `app/api/weekly-digest/route.ts:113`

- [ ] **Step 1: health-insight — mark the body_metrics line as the same metric**

Current (`app/api/ai/health-insight/route.ts:93`, in the daily-metrics block; line 85's `Overnight HRV: X ms` sleep line stays as-is):

```ts
      todayBm?.hrvMs != null ? `HRV: ${todayBm.hrvMs} ms` : 'HRV: no data',
```

Replace with:

```ts
      todayBm?.hrvMs != null ? `Overnight HRV (daily record, same metric as above): ${todayBm.hrvMs} ms` : 'Overnight HRV (daily record): no data',
```

- [ ] **Step 2: weekly digest — matching label**

Current (`app/api/weekly-digest/route.ts:112-113`):

```ts
  const hrvLine = hrvRecapWeek != null
    ? `HRV: ${hrvRecapWeek} ms avg that week${hrvPriorWeek != null ? ` (week before ${hrvPriorWeek} ms)` : ''}`
```

Replace with:

```ts
  const hrvLine = hrvRecapWeek != null
    ? `Overnight HRV: ${hrvRecapWeek} ms avg that week${hrvPriorWeek != null ? ` (week before ${hrvPriorWeek} ms)` : ''}`
```

These are prompt-string-only edits — no response schema, validation, or cache behaviour changes, so no new route test is required; the full existing suite runs in Step 3 to catch any assertion pinned to the old copy.

- [ ] **Step 3: Run the test suite**

Run: `pnpm test`
Expected: PASS. If any test asserts the old `HRV:` prompt label, update that assertion to the new copy in the same commit.

- [ ] **Step 4: Commit**

```bash
git add app/api/ai/health-insight/route.ts app/api/weekly-digest/route.ts
git commit -m "fix: AI prompts label overnight HRV consistently instead of listing one metric twice"
```

---

### Task 6: Canonical display sources — index the convention in `docs/module-map.md`

**Files:**
- Modify: `docs/module-map.md` (§6 "Domain math / formulas", append at the end of the section, just before the `---` that precedes §7)

- [ ] **Step 1: Append the canonical display-source table**

Paste this block verbatim at the end of §6:

```markdown
### Canonical display sources — one source + label per physiological metric

The display analogue of One-Formula-One-Place (review 2026-07-16 §4). Any new card showing one of these metrics uses this source and label — annotate the aggregation window whenever it differs.

| Metric | Canonical source | Canonical label |
|---|---|---|
| Daily HRV | `body_metrics.hrvMs` (verbatim copy of `sleep_sessions.averageHrvMs`, the quality-gated overnight median — adapter `:4144-4151`) | "HRV (overnight)" / unit "ms rMSSD · overnight" |
| HRV baseline deviation | `/api/readiness-score` `recentHrv`/`baselineHrv` | "HRV · 7d vs 28d baseline" |
| Daily resting HR | `body_metrics.restingHeartRate` | "Resting HR" |
| Overnight lowest HR | `sleep_sessions.lowestHeartRate` | "Lowest HR" (never "RHR") |
| Sleep score | `/api/readiness-score` `sleepScore` (`ouraToday.sleepScore ?? computeSleepScore()`); stored `sleep_sessions.sleep_score` is Cloud-only (NULL on BLE nights) — fallback display only | "Sleep" score badge/chip |
| Readiness | `/api/readiness-score` `readinessDisplayScore` (null = insufficient data → hide, never show the ungated `score`) | "Readiness" |
```

- [ ] **Step 2: Commit**

```bash
git add docs/module-map.md
git commit -m "docs: index canonical display source + label per health metric in module map"
```

---

### Task 7: Full gate, dev-server verification (S25 viewport, both themes), version bump, journal

**Files:**
- Modify: `package.json` (version), `lib/changelog.ts`
- Modify: `docs/implementation-backlog.md` (remove this item's entry), `projectOverview.md`, latest `docs/overview/history-*.md`

- [ ] **Step 1: Full gate**

Run, in order, all must pass:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected: all exit 0.

- [ ] **Step 2: Dev-server verification at the S25 viewport, BOTH themes**

Start `pnpm dev` (local DB is auto-provisioned; login as `test@local.dev` / `testpass123`). In devtools set viewport ≤640px wide (e.g. 412×915). Check each screen in **dark AND light** theme (toggle via the app's theme setting) — none of these cards may show white-on-white/black-on-black text and every changed label must be legible at 4.5:1:

1. **`/health` → Body tab — Sleep card:** chips read "HRV (overnight) NNms" and "Lowest HR NNbpm" (broken = still "RHR"). The score badge shows a number matching the Home "Sleep" chip. To exercise the BLE-night case the badge was broken for, null the stored column in the local DB and reload:
   `psql postgresql://postgres:postgres@localhost:5433/trainingai_dev -c "UPDATE sleep_sessions SET sleep_score = NULL;"` — correct = badge still shows the computed score (same number as the Home Sleep chip); broken = badge vanishes (the pre-fix behaviour).
2. **`/health` → Body tab — RHR/HRV/SpO₂ grid:** HRV tile's small unit line reads "ms rMSSD · overnight" and still fits the narrow tile without wrapping ugly at 412px.
3. **`/health` → Body tab — HRV baseline card:** title reads "HRV · 7d vs 28d baseline". (If it doesn't render, the seed lacks 7d/28d HRV history — that's the `isSectionVisible` gate at `health-sections.tsx:144`, not a regression; verify title via the other cards + code review in that case and say so in the PR.)
4. **`/health/heart-rate`:** second sparkline titled "HRV (overnight)".
5. **`/overview`:** ReadinessCard headline arc shows the same number as the Home readiness chip. Tap to expand — Score Breakdown ("Oura base", adjustments, "Final score") still renders on Cloud-era seed data and Final score equals the headline.
6. **Home (`/`):** chip row unchanged (regression check — chips still render, readiness chip value unchanged).
7. **API spot-check:** `curl -s localhost:3000/api/readiness-score` (with the session cookie) — response shape unchanged, `readinessDisplayScore` and `sleepScore` present.

Failure surfaces NOT exercised (state in the PR): Samsung WebView rendering and drifted prod data — both low-risk for pure label/prop changes; no native, offline-first, safe-area, gesture, or notification surface touched, so per Canonical Runtime no on-device smoke run is required.

- [ ] **Step 3: Version bump + changelog (patch — bug-fix class)**

In `package.json`, bump the patch version (from whatever current `main` holds after rebase — `1.154.1 → 1.154.2` as of planning; re-check on the fresh base and expect a conflict re-bump if other PRs landed). Prepend to `CHANGELOG` in `lib/changelog.ts`:

```ts
  {
    version: "1.154.2", // ← match the package.json bump on the day
    date: "2026-07-16", // ← implementation date
    changes: [
      "Health metrics now say what they measure: HRV cards are labelled with their window (overnight vs 7-day-vs-28-day baseline), the sleep card's \"RHR\" chip is now honestly \"Lowest HR\", the sleep score badge shows the same computed score as the Home chip (it was blank on every ring-BLE night), and the Overview readiness headline is the same blended score Home shows.",
    ],
  },
```

- [ ] **Step 4: Backlog removal + journal (last commits before merge)**

- Remove this item's entry from `docs/implementation-backlog.md` (or its Batch-S row in `docs/planned_upgrades.md`).
- Append the session summary to the most recent `docs/overview/history-*.md` and update `projectOverview.md`'s lean index (mark review-§4 consolidation ✅).

```bash
git add package.json lib/changelog.ts docs/implementation-backlog.md projectOverview.md docs/overview/
git commit -m "chore: bump to 1.154.2 with changelog + journal for metric label consolidation"
```

- [ ] **Step 5: PR + merge**

Push the branch, open the PR (title: "Consolidate health metric labels and display sources"), subscribe to CI activity, and once fully green on an up-to-date base, squash-merge without asking — this is a standard, non-destructive display change (no migrations, no auth/security, no secrets).

---

## Self-review notes

- **Coverage:** review §4 sub-findings 1-4 → Tasks 2/1/3/4 respectively; the "canonical sources" indexing ask → Task 6; the copy-should-match consequence of Verified-A → Tasks 1/2/5.
- **No second sleep-score implementation is added anywhere** — Task 3 threads the route's already-computed value; `lib/health/sleep-score.ts` remains imported only by the readiness route (it is client-safe — imports only `date-fns-tz`, `lib/date-utils`, and a type — but no client import is needed or added).
- **No cache/response shape changes** — `sleep-sessions` and `readiness-score` keys, TTLs, and invalidation groups untouched.
- **Type consistency:** `computedSleepScore: number | null` in Task 3 Step 1 matches the call site in Step 2; `displayScore` in Task 4 Steps 1-2 is one binding used by arc, adj, and Final-score row.
