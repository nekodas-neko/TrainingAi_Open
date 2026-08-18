# 2026-08-18 — Review sweep 29: every count in `CLAUDE.md`, verified mechanically

**Agent:** Review 📖 · **Branch:** `review/claude-md-prose-counts` · **Docs-only.**

Three sweeps this week each found a stale `CLAUDE.md` number *by accident*, while looking at
something else — Q-480, Q-490, Q-491. This sweep did it on purpose: enumerate every checkable count
in the file and re-derive it against `main` at `63fb89c`.

**Script-backed counts: 3 of 3 current.** Sparkline (3 inline / 6 exempt), `Ran 40 of 40` custom
rules, the rollup vitest glob against its own test list.

**Hand-typed prose counts: 7 of 9 stale.** Hex literals **471 → 428** (the ratchet has clawed back
43, so the prose overstates the problem); the >800-line hotspot list still names
`more/profile-tab.tsx`, now **476 lines**; `health-sections.tsx` 795 → **777**; the script-glob split
"22 of 33 today" → **29 of 40**; `READINESS_SCORE_TTL` "four fetch/warm sites" → **6**; the suite
"448 files" → **504** test files on disk; plus the nine chevron paths already filed as Q-491.

Two prose counts are still right — score-band's 17 call sites, and "the 11 inline grep rules". The
correlation is strong but not absolute, and the write-up says so rather than rounding it up.

**Two findings are more than drift.** `more/profile-tab.tsx` **should already have been struck**: the
same paragraph mandates removing a hotspot that drops under the line and cites `health-sections.tsx`
being removed on 2026-08-09 for exactly that — the procedure was followed once, then not again. And
the rollup-glob maintenance command at `CLAUDE.md:976` is scoped to
`lib/data/postgres/__tests__/` — the very directory the glob covers — so it **can only confirm the
glob against itself**, while the warning it serves is about a rollup test written *outside* it.
Both defects are **latent**: checked repo-wide, no test outside the glob actually calls
`aggregateOuraRawSamples`. Nothing is mis-timed today.

Also noted: `check-component-size.js` is shrink-only, and four of its five baselines are exact, but
`components/workout-screen.tsx` is pinned at 1850 against an actual 1831 — 19 lines of regrowth that
would pass silently.

The recommendation is deliberately **not** "correct the seven numbers", which buys about a week. For
each count: cite the command, or delete the number and keep the rule. The file already contains the
model to copy, in its own sparkline paragraph.

Filed **Q-492**; review at
[`docs/reviews/2026-08-18-claude-md-prose-counts.md`](../../reviews/2026-08-18-claude-md-prose-counts.md).

**Not exercised:** static verification only — no runtime, no device.
