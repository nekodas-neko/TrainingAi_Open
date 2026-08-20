## 2026-08-20 — the RPE prefill is already the modal rating at every percentage (Q-423 refuted)

**Branch:** `docs/refute-rpe-prefill-mapping` · docs-only, no code change, no version bump.

Q-423 said the per-set RPE prefill is measurably low — the owner raising it 233 times against 32
lowerings, a +0.41 mean shift over 625 rated sets — and asked for the mapping to be **bracketed
against those 625 ratings** rather than picked by inspection. Bracketed. The change is not supported
and the measurement does not hold on the input the prefill actually reads.
Full working: [`docs/reviews/2026-08-20-rpe-prefill-mapping-fit.md`](../../reviews/2026-08-20-rpe-prefill-mapping-fit.md).

**The 625-set table is on the wrong basis.** `defaultRpeFromPct(style?.[i]?.pct)` is called with the
progression style's **planned** percentage, and the column mirroring it is `set_logs.planned_pct` —
which has only been written since **July 2026**. Of 625 rated sets, **312 have no `planned_pct` at
all**. Reproducing the entry's table with `COALESCE(planned_pct, intensity_pct)` returns n=625, mean
shift +0.419, mean-where-unchanged 7.109 — matching its +0.41 and 7.11 to the digit. So the missing
312 were scored against `intensity_pct`, the **achieved** intensity, not the number the prefill was
computed from.

**On the 313 sets that do carry one, the asymmetry is a tenth of what was reported.**

| | Q-423 (625, mixed) | measured (313) | August only (166) |
|---|---|---|---|
| left at the prefill | 360 (57.6%) | **288 (92.0%)** | 153 (92.2%) |
| raised | 233 | **25** | 13 |
| lowered | 32 | **0** | 0 |
| mean shift | +0.41 | **+0.125** | +0.133 |

**And the current mapping is already the modal rating at all sixteen observed percentages**, 313 of
313 sets. `round` — the entry's tempting one-liner — misses five of them (66, 68, 75, 76, 77.5,
covering 89 sets) and does not narrow the asymmetry but **inverts and widens** it: 19 raises against
**82 lowers**. The entry's `round(8.5) = 9` worry is moot for a third reason — no set in the data has
a planned percentage above **84**.

**Q-423's own acceptance criterion picks the wrong answer, and that is the part worth carrying.** It
said to minimise the raise/lower asymmetry, which selects `floor(p/10 + 0.25)` at |raise−lower| = 5
— reached by trading 25 under-prefills for 27 over-prefills while breaking the modal match where the
owner rated 7 on 56 of 58 sets. **The statistic is confounded by the thing being measured**: 92% of
these ratings were never touched, so they *are* the prefill, and agreement with it is largely the
prefill agreeing with itself. The unanchored signal is the 25 changed sets, and 12 of them sit at one
percentage (70.5%) where 49 of 61 were left at 7 — a percentage-only function cannot separate a hard
set from a mis-prefill. What would settle it is ratings collected with no default, which do not
exist.

**Also corrected, because the same table is live in two other places.** Q-420 carries a copy of it
and additionally proposes recovering "which sets were touched" by recomputing
`defaultRpeFromPct(planned_pct)` at read time — that works for 313 of 625 sets and silently returns
nothing for the rest, so its touched-vs-untouched weighting cannot be evaluated on anything logged
before July. The entry is annotated rather than rewritten, since it is Lane A's. The 2026-08-20
workouts handoff told a successor Q-423 was "the safest starting point" because it re-scores nothing;
it is struck, and the note now says the cluster no longer has a no-blast-radius entry.

**Left alone deliberately:** `docs/agents/state/bugfix.md` line 132 still carries the 233-vs-32
figure. A baton is its own agent's to rewrite and this lane does not touch another's.

**Verification.** `pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.
`check-backlog-pointers` OK. `check-doc-index-size` OK; the backlog shrank by 52 lines.

**Not exercised:** nothing runtime, and no code changed. The measurement is production data read
through `POST /api/admin/db-query`, which is **row-scoped to the owner** — it says nothing about any
other account's ratings.
