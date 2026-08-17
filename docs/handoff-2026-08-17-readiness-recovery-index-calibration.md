# Handoff — readiness Recovery Index calibration (first Tuning session)

**Date:** 2026-08-17 · **Domain:** `readiness` · **Branch:** `claude/tuning-agent-role-x9jg4r`
**Type:** docs-only · **Filed:** Q-500 (⛔ owner sign-off), Q-501
**Evidence:** [`docs/reviews/2026-08-17-readiness-calibration.md`](reviews/2026-08-17-readiness-calibration.md)

This is the narrative half. The baton
([`docs/agents/state/tuning.md`](agents/state/tuning.md)) holds current state; the review doc holds
the measurements. This holds the method, the dead ends, and the things a second session would
otherwise pay for again.

---

## What the session was trying to achieve

First session in the standing **Tuning** role. No owner report was in hand, so the target was the
standing calibration question **Q-271** had left open — *"the Recovery Index contributor can never
score above ~50; it only ever subtracts"* — which the 2026-08-15 comprehensive review filed
explicitly as calibration work with the data already stored, and whose own "first action" was to
establish *which* explanation held before touching the constant.

## What actually shipped

Docs only. No code changed and no scoring constant moved — by design, the role proposes and Lane A
implements.

- **Q-500** filed: `RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5, blocked on owner sign-off.
- **Q-501** filed: `oura_daily_summary` rows get recomputed, the `oura_daily_derived` readiness rows
  built from them do not follow, so 5 of 33 persisted contributors disagree with their stored inputs.
- **Q-271 replaced** in the backlog, and its four live cross-references re-pointed.
- `projectOverview.md` Known-Issues row rewritten, plus a new Q-501 row and one stale citation fixed.
- `docs/domains/readiness/README.md` now links the calibration doc and flags that the review's §1.3
  does not hold over the series.

## Decisions, and why — so they are not re-litigated

**The estimator stays.** The obvious hypothesis was that `hoursToSettle` measures the wrong instant:
it is the argmin of the night, while Oura's guidance talks about HR *stabilising*, and a minimum is
necessarily later than the point a series settles — which would make 6 h structurally unreachable. It
was tested by swapping in "first sample within *N* bpm of the night minimum" at six tolerances. **Every
variant correlated worse with Oura's own contributor** (+0.712 shipped, +0.636 best alternative). The
shipped code beat the fix that looked obvious. Q-500 is the anchor only.

**5, not 4.63.** The zero-bias fit is 4.63 h, but RMSE is flat from 4.5 to 5.25 and leave-one-out over
the 15 nights spans 4.40–5.14. Fitting to two decimals would be chasing a 15-night sample. 5 sits on
the floor, is inside the LOO range, and keeps a small *negative* bias so it still errs toward
under-scoring — the safe direction for a recovery signal.

**Q-271 was re-measured rather than built on.** Its numbers reproduce exactly the eight days
immediately before that review ran (2026-08-08 → 08-15 sorted is 13, 18, 20, 21, 22, 28, 43, 48 — the
list it quotes). Over the full 41-day series the contributor exceeds 50 on **13** days, hits 100 on
2026-07-17, and costs **0.55** readiness points/day rather than 2.2.

## Gotchas and dead ends

- **The `/api/admin/db-query` endpoint truncates at 1000 rows** and reports it in a `truncated` flag
  that is easy to miss. Paginate with `LIMIT/OFFSET`. It also returned a **spurious 401 under burst**
  mid-session — the credential was fine seconds later. Retry with backoff rather than concluding the
  secret is wrong.
- **Do not assume the 30-day prune applies to every `claude_ro` view.** It applies to `error_events`.
  `oura_daily_summary`, `oura_daily_derived`, `oura_heartrate` and `sleep_sessions` all held
  2026-06-22 onward. Check the real range — the difference here was 41 usable days against an assumed
  30, and the extra days are what reversed Q-271.
- **The backlog and a code comment both cite `lib/health/recovery-index.ts`, which does not exist.**
  The file is `packages/shared/src/health/recovery-index.ts`. Cosmetic, but it cost a minute and is
  the kind of thing that sends a session looking for a second implementation that isn't there.
- **The pinned Oura spec does not define this metric.** `.claude/skills/oura-api` exposes
  `contributors.recovery_index` as a 1–100 integer with no hours, curve or threshold. The 6 comes from
  Oura's public prose. Do not go looking for it in the OpenAPI file.
- **Pre-re-key overnight HR is tagged `rest`/`awake`, not `sleep`.** A first pass filtering on a
  `sleep` source finds nothing and reads like "no overnight coverage in the Cloud era", which is
  false — there are ~85–115 samples/night at 5-minute resolution.

## The find worth reusing

**2026-06-23 → 2026-07-07 is a privileged calibration window and nothing had used it.** Oura Cloud
data stops at the 07-07 re-key; `oura_heartrate` starts 06-22. Those 15 nights carry **Oura's own
score contributors alongside our raw inputs** — the only external ground truth any Oura-derived score
in this app has. It applies to sleep score and the other readiness contributors too, not just this
one. `oura_daily.readiness_contributors` and `sleep_contributors` are the JSONB columns.

**Build and validate a recompute harness every time.** Porting the TypeScript estimator to Python and
checking it against the stored column *first* — median error 0.08 h over 41 nights, 32/41 within
0.5 h — is what makes every later counterfactual trustworthy. The nine outliers turned out to be the
Q-274 fragment nights, which then got excluded from the fits by a ≥30-samples floor. Skipping the
validation step would have silently mixed those in.

**BLE overnight HR is measurably noisier than the Cloud series it replaced** — median sample-to-sample
|Δbpm| 2.0 vs 1.0 at the same sampling density (median 107 vs 108 samples/night). Any metric derived
from an extremum of the overnight series will drift across the re-key boundary for that reason alone.
Our hours run 0.30–0.66 h lower afterwards depending on smoothing window, and **with 15 pre-re-key
nights the noise and a real physiological change cannot be separated.** That is stated as unresolved
in the review rather than attributed.

## Deliberately not done

- **Not implemented.** The constant is untouched on `main` and must stay that way until the owner
  signs off.
- **Nothing on-device.** No APK, native path, safe-area or WebView surface was exercised — this is a
  data analysis over production rows.
- **The fragment nights** (2026-07-10, 08-11, 08-13) were excluded from the fits, not investigated.
  They belong to Q-274. **08-13 then resolved itself mid-session** on a re-rollup (6.08 → 8.17 h of
  sleep, recovery index 1.20 → 5.78) — so those nights are not necessarily permanent, and re-checking
  before treating one as a defect is worth the query. The other two were not re-checked.
- **Oura's hours→score curve is still unrecovered.** The fit is against Oura's *outputs*, so if their
  curve is non-linear a linear anchor fitted to it is right on average and wrong at the tails —
  consistent with RMSE sitting at ~21 points at every anchor.
- **The other calibration items were not touched**: Q-272 (Body Battery charge/drain asymmetry) and
  Q-277 (Activity Score range) are the natural next targets.

## Blocked on the owner

**Q-500 only.** The owner's answer on 2026-08-17 was *"keep working and leave that as a question for
me. I dont understand the consequences of changing that yet"* — which is a finding in its own right:
the proposal quantified the change in readiness points, and points are not the unit a decision gets
made in. **§5.2 of the review was written in response and answers it**: 4 of 26 days cross a decision
threshold (three tip rest-day guidance to "train hard", one moves Moderate → High), and nothing
crosses the early-deload gate, the Low/Moderate line or the AI low-readiness line. Point them there
rather than restating the points figure.

One sentence: *the Recovery Index term in readiness is scored against a 6-hour target
about an hour too high; fitting it against Oura's own version of the same contributor puts the target
at 4.63 h, and moving it to 5 lifts 40 of the last 41 days by at most 1.4 readiness points and lowers
none.*

Q-501 needs no sign-off — it is a data-integrity fix, not a scoring change.

## Pickup prompt

> You are the Tuning agent on the TrainingAI repo. Check out `main` (fresh:
> `git fetch origin main && git checkout -B <your-branch> origin/main`).
>
> Read in this order: `docs/agents/state/tuning.md` (your baton) → `docs/agents/README.md` §1–§3 (the
> role and the lane contract) → `CLAUDE.md` (One Formula One Place, and the `claude_ro` constraints) →
> `docs/domains/readiness/README.md` → this handoff →
> `docs/reviews/2026-08-17-readiness-calibration.md`.
>
> Your Q band is 500–529; next free is **502**. Take numbers straight from the band — do not read or
> write the backlog's next-free pointer, and take no migration numbers. You propose; you do not ship.
> Your PRs are docs-only: open and merge them without asking, and the scoring change never rides in
> your PR.
>
> **First action:** if the owner has given you an observation about a score that did not match how they
> felt, measure that. If they have not, ask whether **Q-500** is approved — it is written, measured and
> waiting on a yes/no, and until it is answered it is the only thing outstanding from the last session.
> If they want work regardless, take **Q-272** (Body Battery drains 5× faster than it charges and ends
> at its daily low on 10 of 12 days) — it is filed as calibration work with the data already stored.
>
> Constraints you would otherwise rediscover: production reads go through
> `POST /api/admin/db-query` with `$CLAUDE_DB_QUERY_SECRET`, which **truncates at 1000 rows** and can
> return a spurious 401 under burst — paginate and retry. `claude_ro` views are **row-scoped to one
> user**, so every count is "the owner's", never "the system's"; the 30-day prune applies to
> `error_events`, not to the Oura tables, so check each view's real date range. Before attributing any
> shift to inputs, check `model_versions` — **readiness does not stamp one**, so readiness before/after
> comparisons are not attributable until Q-273 lands. And the 2026-06-23 → 07-07 window is the only
> place Oura's own contributors sit alongside our raw inputs; reach for it on any Oura-derived score.
