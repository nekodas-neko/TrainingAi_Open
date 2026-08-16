# App-responsiveness + AI-optimization — closeout

**Status: COMPLETE.** All buildable work is shipped to `main` and auto-deploying. Current version
**v1.208.6**. The only remaining items are owner on-device confirmations (below) — no code work left.

Two linked workstreams, run **measure-first, then fix from the data**:
- **A** — make the app feel instant (kill micro-loading / skeleton flashes / slow transitions)
- **B** — AI-usage observability, then cut the redundant calls the data reveals

Reference: audit `docs/reviews/2026-07-21-ui-responsiveness-audit.md`; per-PR journal entries in
`docs/overview/entries/2026-07-21-ui-responsiveness-fixes-a2.md`,
`…-ai-usage-observability.md`, `2026-07-23-b3-prescription-dedup.md`.

---

## What's done

| # | Deliverable | PR | Version | State |
|---|-------------|----|---------|-------|
| **A1** | UI responsiveness audit (doc) | #739 | — | ✅ merged |
| **B1** | AI instrumentation chokepoint + `ai_call_log` | #741 | v1.197.0 | ✅ merged |
| **B2** | Admin → AI Usage panel | #741 | v1.197.0 | ✅ merged |
| **A2** | Health-screen render fixes | #744 | v1.197.1 | ✅ merged |
| **B3** | Prescription generation dedup + chart fix | #782 | v1.208.6 | ✅ merged |

### A1 — Audit (measure)
Walked all five nav tabs at the S25 viewport and classified every remaining loading state into the
three root causes: (1) cold-cache flash, (2) embedded server-only aggregate blocking paint, (3)
bundle/render latency. Key finding: the earlier 2026-07-20 W1–W7 batch had already cleared the
cache-staleness and render-rerender classes, so only **four Category-2/3 offenders** survived, ranked
by owner-hit frequency.

### B1 — Instrumentation (measure)
Went from **zero** AI-call visibility to a single chokepoint. All **15** `@ai-sdk/google` call sites
(14 files) route through `lib/ai/instrument.ts` (`loggedGenerateText` / `loggedGenerateObject` /
`loggedStreamText`), which wrap the existing retry policy and log one row per call to `ai_call_log`
(migration 136): **section, model, input/output/total tokens (from the SDK usage), latency, ok/error,
a sha256 fingerprint of the call's key inputs, user_id, created_at.** Metadata only — never prompt
bodies or health data. Best-effort, fire-and-forget, try/catch — it can never fail or slow the AI
call. Pruned at 30 days via the existing retention-throttle (no cron layer). The model id, previously
inlined 14×, is now centralised as `AI_MODEL_ID`.

### B2 — Admin panel (measure)
New **Admin → AI Usage** tab: calls by section (count + tokens + est. cost, worst-first), calls over
time, and **double-trip detection** (a window function over `(user, section, fingerprint)` flags the
same logical call firing again within a window). isAdmin-gated (DB-authoritative), Zod + rate-limited,
cache-seeded for instant paint.

### A2 — UI fixes (fix)
The three Category-2/3 offenders from A1:
- **A1-1** `AiInsightCard` seeded from an *async* cache read, so a full-card spinner flashed on every
  Health detail open — now seeds synchronously from `readCacheSync` and drops the spinner.
- **A1-2** `TimeInZoneCard` was the one health chart statically imported, dragging chart.js into the
  Health screen's initial bundle — now lazy-loaded via `next/dynamic` like its siblings.
- **A1-3** `TrendChart` flashed an animated skeleton over already-seeded data — swapped for a static
  placeholder.
- **A1-4** (`LatestBaselineCard`) left as opportunistic — APK-mitigated, web-only surface.

### B3 — Double-trip reduction (fix, driven by real panel data)
The panel immediately paid for itself. Over 7 days it showed **`prescription`** as both the **#1
token spender** and the **worst double-trip**:

| Section | Calls | Tokens | Est. cost | Avg ms | Double-trips |
|---|---|---|---|---|---|
| **prescription** | 10 | **34,330 (56%)** | $0.0052 | 2,600 | **4 redundant · 2 distinct** |
| ai-chat | 2 | 24,024 | $0.0025 | 3,999 | — |
| health-insight | 9 | 1,972 | $0.0004 | 1,287 | — |
| running-plan-explain | 5 | 669 | $0.0001 | 1,202 | 1 redundant · 1 distinct |
| workout-recap | 1 | 215 | $0.0000 | 1,539 | — |
| **Total (7d)** | **27** | **61,210** | **$0.0082** | | |

**Root cause:** opening a workout fires `/prescribe` from two paths within ~1s (the client in
`workout-screen.tsx` **and** `workout-data`'s server-side fire-and-forget), and each generation takes
~2.6s — so the same prescription was generated 2–3× per open. **Fix:** a generic in-flight +
30s-cooldown dedup (`lib/ai-periodization/generation-dedup.ts`) wraps `generatePrescriptionForSession`,
keyed by `user:session:day:excludeSessionId` (so completion-path results aren't reused for open-path
calls; the completion path always regenerates the next prescription). Deterministic — it never changes
what a prescription contains, only whether an identical generation re-runs. Also fixed the empty
"Calls over time" chart (bars had no definite-height parent, so percentage heights collapsed to 0px).

---

## What's left

**No code work remains in this initiative.** Everything below is owner on-device verification — the
listed items shipped but couldn't be exercised in the web sandbox (no browser, no native SQLite, and
the local seed is a `manual` program with no live AI/`ai_dynamic` path). Run
`docs/device-smoke-checklist.md` on the S25.

| Item | What to check on the S25 | Ships via |
|---|---|---|
| **B3 payoff** | After deploy, open/reopen a workout a few times → **Admin → AI Usage**: the `prescription` **double-trip count should drop toward zero**. | Railway (no APK rebuild) |
| **B2 chart** | The **"Calls over time" bars now render** (were blank before v1.208.6). | Railway |
| **B2 panel look** | Panel renders cleanly (tiles, section table, double-trips, bars) in both light + dark. | Railway |
| **A2 no-flash** | Reopen a Health detail screen (Readiness/Sleep/Heart rate/Activity) twice → the AI insight card should **not** flash a spinner the second time; the Health tab opens without a chart hitch. | Railway |

### Optional follow-up (B3 round 2) — only if the data still shows waste
Re-check the panel after v1.208.6 has been in use. Candidates, none urgent:
- `running-plan-explain` had a minor double-trip (1 redundant) — dedup it the same way if it persists.
- `ai-chat` is the slowest section (~4s avg) but is user-driven, not redundant — likely leave it.

If the panel shows genuine new double-trips, name the sections and they can be deduped with the same
`createDedupCache` helper. Backlog entry: `docs/implementation-backlog.md` (initiative batch, B3 marked
shipped with a round-2 note).

---

## Guardrails honoured
- No already-local domain "moved local" — the remaining loading was cold-cache/aggregate/bundle, not locality.
- No cache-invalidation weakened; no `loading:` skeleton added to a cache-seeded card.
- No change to what any AI route returns — instrumentation and dedup only.
- No secrets/PII/raw-health in logs (fingerprints are hashes; tokens are counts).
- Admin panels isAdmin-gated (DB-authoritative). Double-trip counts are deterministic and diagnostic —
  no logged number gates behaviour.
- The Oura on-device initiative was not collided with (its biometric screens are legitimate
  A-offenders, but these fixes are disjoint).
