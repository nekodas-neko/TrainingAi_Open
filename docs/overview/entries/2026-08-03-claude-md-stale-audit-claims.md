# 2026-08-03 — two of CLAUDE.md's worked examples had gone stale

_Branch `docs/claude-md-stale-audit-claims` · docs-only · domain `platform`_

`CLAUDE.md` is the first thing every session reads, and several of its rules are anchored to a
concrete violation found in a dated audit. Two of those anchors no longer describe the codebase.
Both were sending sessions to fix something already fixed.

## 1. The one-canonical-TTL rule cited a violation that has been repaired

The rule read: *"`readiness-score` is fetched with SHORT, MEDIUM and LONG today — audit 2026-07-02."*

Measured: `READINESS_SCORE_TTL` is defined once in `packages/shared/src/cache-ttl.ts:10`, and **all
four sites use it** — `overview-screen.tsx`, `session-select-content.tsx`, `health-content.tsx`, and
the `sync-provider.tsx` warm list. There is no divergence left.

That mattered more than a stale number usually does: a session checking the rule's own example would
find the rule already satisfied and might conclude the rule itself was obsolete. It is now written
as the **reference** for the rule rather than the counter-example.

## 2. The no-emoji rule pointed at emoji that are gone, and implied a sweep that would be wrong

The rule read: *"Violations still live in nutrition/workout-select/health chrome (🌙 📅 ⚖️ ✅ etc.,
audit 2026-07-02) — replace on touch."*

Scanned all four named areas. **The named emoji are gone.** `app/nutrition` and
`components/workout-select` are clean outright.

What remains is not chrome, and a sweep would have damaged it:

- **Mood faces** (😴 😑 😐 😊 ⚡) in `recommendation-card.tsx` and `mood-checkin-sheet.tsx` are
  *content* — the mood model has its own `emoji` field, and the picker is those faces.
- **The meal-type 🍽️** in `meal-type-manager.tsx` is the default value of a **user-editable** emoji
  field.
- **`✓` / `✗` / `↓`** in the health and injury sheets are typographic marks, not emoji icons — and
  pairing a state with a symbol is what the colour-only-state rule explicitly asks for.
- Emoji in `chat.tsx`'s greeting and `done-screen.tsx`'s share string are message copy.

So the rule is now stated as binding new **icons**, with the content cases named as deliberate. A
future session reading "violations still live in X" would have replaced user-visible mood faces with
Lucide glyphs and called it hygiene.

## Checked and still accurate — left alone

- **~455 hex literals** bypassing theme tokens: measured 445 today. Unchanged in substance.
- **The six >800-line hotspots** named in the file are exactly the six that exceed it today.
- **The five inline `<polyline>` sparklines** bypassing `components/ui/sparkline.tsx`, and the three
  deliberate exemptions (the primitive itself, `detail-hero.tsx`'s decorative art, `live-hr-chart.tsx`)
  — the file's list matches the tree exactly, including its warning that a bare grep over-counts at
  eight.

## Method

`grep`/AST-free scans over `components/` and `app/`, plus reading each remaining emoji in context to
decide chrome vs content. No code changed, no version bump.

An audit number in a standing-instructions file has a short shelf life. Re-checking one before acting
on it costs a minute; acting on a stale one costs a session — and, in the emoji case, would have
shipped a regression dressed as cleanup.
