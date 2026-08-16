# Exercise Readiness Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rename the existing mood check-in sheet's user-visible copy from "Daily Check-in"/"Today's Mood" to "Exercise Readiness" (scoped to energy level + muscle soreness) and lightly restyle it, changing display strings only — no data-model, store, route, or identifier changes.

**Architecture:** This is a pure copy/labels change (finding U11 in `docs/reviews/2026-07-04-user-review-round-2.md` §U11). The sheet `MoodCheckInSheet` (`components/mood-checkin-sheet.tsx`) keeps writing to the `mood_logs` local table + `POST /api/mood` via the `mood_logs` sync domain, keyed by cache `mood:${date}`. Only user-facing display strings across the sheet, the Home mood card, the Home recommendation-gate card, the recommendation card's aria-label, and the widget-picker labels change. **All internal identifiers stay exactly as-is** — the `mood_logs` table/sync-domain, `/api/mood` route, `card_moodWidget` switch case, `moodWidget` widget key, `moodLog`/`setMoodSheetOpen` state, the `MoodCheckInSheet` component name, `cardColors['moodWidget']`, and the `mood:${date}` cache key — so there is no migration, sync, or cache-invalidation impact.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Radix/shadcn `Sheet`/`Collapsible`, `sonner` toasts, Lucide icons. Tests: vitest via `pnpm test`; `pnpm tsc --noEmit`; `pnpm lint`; `pnpm build`.

**Design decisions (already taken with the user — do not revisit):**
- The mood sheet stays **separate** from the morning check-in (`components/morning-checkin-sheet.tsx`). Do **not** merge the two surfaces. The morning check-in file is out of scope and must be left untouched.
- Scope of the sheet is **energy level + muscle soreness** as the readiness inputs. The store, fields, and payload do not change.

**Scope guardrails (strict — no scope creep):**
- Do **not** add, remove, or rename any captured field. The existing "Issues" collapsible (Stiff/Tight, Heavy Legs, Joint Pain, Sick, Low Motivation) stays exactly as-is — it feeds `bodyState`/`sore_muscles` into AI periodization. Removing it would change captured data; that is out of scope. Energy + soreness are simply presented first/prominently (they already are).
- Do **not** touch `lib/changelog.ts` historical entries (they are an immutable log).
- Do **not** rename the `mood_logs: 'Mood check-in'` label in `components/more/sync-health-card.tsx:13` — it names the **sync domain** in a technical sync-status list, not the readiness surface. Leave it.
- No new fields, no store change, no route change, no cache-key change, no migration.

**Copy decisions (final wording may want a user tweak — see final task):**
- Primary title: **"Exercise Readiness"**
- Save button: **"Save Readiness"**
- Success toast: **"Readiness saved"**
- Home card eyebrow: **"Exercise Readiness"** (replaces "Today's Mood")
- Home gate-card eyebrow: **"Exercise Readiness"** (replaces "Daily Check-in")
- Widget-picker label: **"Readiness"** (replaces "Mood")

---

### Task 1: Rename copy inside the readiness sheet + light restyle

**Files:**
- Modify: `components/mood-checkin-sheet.tsx:156` (toast), `:190` (title), `:199-206` (energy section header — add a one-line subtitle), `:327` (save button)
- Test: none — pure copy change with no logic/pure-function surface, so no vitest test is added (see final task).

Rationale: These are the sheet's own strings. The energy + soreness sections are already the first two blocks; a short subtitle under the title makes explicit that this surface captures readiness inputs (light copy-only restyle, no new fields).

- [ ] In `components/mood-checkin-sheet.tsx`, change the success toast. Replace:
  ```tsx
      toast.success("Check-in saved")
  ```
  with:
  ```tsx
      toast.success("Readiness saved")
  ```
- [ ] Change the sheet title and add a one-line subtitle. Replace the whole `SheetHeader` block:
  ```tsx
        <SheetHeader className="mb-5">
          <SheetTitle className="text-left">
            Daily Check-in
            {sessionName && <span className="text-sm font-normal text-muted-foreground ml-2">Before {sessionName}</span>}
          </SheetTitle>
        </SheetHeader>
  ```
  with:
  ```tsx
        <SheetHeader className="mb-5">
          <SheetTitle className="text-left">
            Exercise Readiness
            {sessionName && <span className="text-sm font-normal text-muted-foreground ml-2">Before {sessionName}</span>}
          </SheetTitle>
          <p className="text-left text-sm text-muted-foreground">
            Log today&apos;s energy and any muscle soreness so the AI can calibrate your session.
          </p>
        </SheetHeader>
  ```
- [ ] Change the save-button label. Replace:
  ```tsx
            {saving ? "Saving…" : "Save Check-in"}
  ```
  with:
  ```tsx
            {saving ? "Saving…" : "Save Readiness"}
  ```
- [ ] Do **not** change: the `Energy Level` / `Sore Muscles` / `Issues` section headers (already accurate), the `mood:${date}` cache write, `invalidateReadinessInputs()`, the `queueMutation({ … domain: 'mood_logs' … })` call, the `/api/mood` fallback POST, or the component/prop names. Confirm none of these were edited.

---

### Task 2: Rename the Home "Today's Mood" card copy

**Files:**
- Modify: `components/home/home-card-widget.tsx:246` (card eyebrow), `:247` (empty-state sub-label), `:240` (color-swatch picker label)
- Test: none (pure copy).

Note: The `case 'card_moodWidget':`, the `moodWidget` key check, `cardColors['moodWidget']`, `CARD_DEFAULT_COLORS.moodWidget`, `setMoodSheetOpen`, and the `moodLog` reads all stay unchanged — only the two literal strings and the swatch label change.

- [ ] In `components/home/home-card-widget.tsx`, change the card eyebrow. Replace:
  ```tsx
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--accent-amber)" }}>Today&apos;s Mood</p>
  ```
  with:
  ```tsx
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--accent-amber)" }}>Exercise Readiness</p>
  ```
- [ ] In the same `card_moodWidget` block, change the empty-state sub-label. Replace:
  ```tsx
<p className="text-[10px] text-muted-foreground mt-0.5">Tap to log your daily check-in</p>
  ```
  with:
  ```tsx
<p className="text-[10px] text-muted-foreground mt-0.5">Tap to log energy &amp; soreness</p>
  ```
- [ ] Change the color-swatch picker label. Replace:
  ```tsx
              <ColorSwatchPicker value={_mColor} label="Mood card" onChange={hex => onColorChange('moodWidget', hex)} />
  ```
  with:
  ```tsx
              <ColorSwatchPicker value={_mColor} label="Readiness card" onChange={hex => onColorChange('moodWidget', hex)} />
  ```
  (The `'moodWidget'` argument to `onColorChange` is an internal key — leave it.)

---

### Task 3: Rename the Home recommendation-gate card copy + recommendation-card aria-label

**Files:**
- Modify: `app/session-select/session-select-content.tsx:1099` (gate-card eyebrow), `:1116` (gate-card CTA), `:1250` (hidden-section label map)
- Modify: `app/session-select/components/recommendation-card.tsx:133` (aria-label)
- Test: none (pure copy).

Note: `setMoodSheetOpen`, `handleOpenMoodSheet`, `onLogMood`, `moodLog`, the `MoodCheckInSheet` render, and the `card_moodWidget` key all stay unchanged.

- [ ] In `app/session-select/session-select-content.tsx`, change the gate-card eyebrow. Replace:
  ```tsx
                            {moodLog === undefined ? "Loading…" : "Daily Check-in"}
  ```
  with:
  ```tsx
                            {moodLog === undefined ? "Loading…" : "Exercise Readiness"}
  ```
- [ ] Change the gate-card CTA pill. Replace:
  ```tsx
                                Log Check-in · ~15 sec
  ```
  with:
  ```tsx
                                Log Readiness · ~15 sec
  ```
- [ ] Change the widget-picker (hidden-section restore) label. In the `label: Record<SectionKey, string>` map, replace:
  ```tsx
                card_moodWidget:         'Mood',
  ```
  with:
  ```tsx
                card_moodWidget:         'Readiness',
  ```
  (Only the display string changes; the `card_moodWidget` key stays.)
- [ ] In `app/session-select/components/recommendation-card.tsx`, change the mood-edit button aria-label. Replace:
  ```tsx
              aria-label="Edit mood check-in"
  ```
  with:
  ```tsx
              aria-label="Edit exercise readiness"
  ```
- [ ] Leave `session-select-content.tsx:1104` (`<span className="text-4xl">🧠</span>`) and `:1106` (`How are you feeling?`) as-is — the emoji is flagged as an optional Lucide swap in Task 5; the "How are you feeling?" prompt is acceptable copy for the empty state.

---

### Task 4: Rename the widget-picker label in the More → Home Widgets settings

**Files:**
- Modify: `components/more/home-widgets-section.tsx:50` (widget def label)
- Test: none (pure copy).

- [ ] In `components/more/home-widgets-section.tsx`, change the widget label. Replace:
  ```tsx
  { key: "moodWidget",         label: "Mood",          icon: MessageCircle },
  ```
  with:
  ```tsx
  { key: "moodWidget",         label: "Readiness",     icon: MessageCircle },
  ```
  (The `"moodWidget"` key and `MessageCircle` icon stay. This keeps the settings toggle label consistent with the renamed card.)

---

### Task 5 (OPTIONAL — do not block the rename): convert emoji to Lucide icons

**Status: OPTIONAL sub-task. Skip it to keep the rename low-risk; it is not required for U11.** CLAUDE.md mandates Lucide icons over emoji ("replace on touch"), and this rename touches these files — but converting the emoji energy scale is a visual redesign with real regression surface (selected/greyscale states, sizing, theme tokens), so it is separated out and explicitly not required. If done, use theme tokens (never hex) and verify on-device.

**Files (if attempted):**
- Modify: `components/mood-checkin-sheet.tsx:16-22` (`ENERGY_OPTIONS` emoji), `:214-223` (energy button render), `:274` (`⚠️` in overlap warning)
- Modify: `components/home/home-card-widget.tsx:233,247` (`ENERGY_EMOJI` map + `<span className="text-3xl">` render)
- Modify: `app/session-select/components/recommendation-card.tsx:138,145` (inline energy emoji map + `⚠️`)
- Modify: `app/session-select/session-select-content.tsx:1104` (`🧠`)

- [ ] If attempted: map the five energy levels to Lucide icons (e.g. `BatteryLow` → drained, `BatteryMedium`/`Battery` → low/ok, `BatteryFull` → good, `Zap` → pumped) and replace the emoji renders, driving selected/unselected visual state via theme tokens (`text-muted-foreground` / an `--accent-*` token) instead of the `grayscale(1)`/scale filter. Replace `⚠️` with the Lucide `AlertTriangle` icon and `🧠` with a suitable Lucide icon (e.g. `Brain`). Do this only as a deliberate follow-up — otherwise leave all emoji untouched.
- [ ] If NOT attempted (recommended default): leave every emoji as-is and check this box to record the decision.

---

### Task 6: Verify and confirm acceptance criteria

**Files:** none (verification only).

**Verification is dev-server / Playwright driven — this is a copy change with no unit-testable pure-function surface, so no new vitest test is added.** Run the existing suite to confirm no regression, then exercise the UI.

- [ ] Run `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, and `pnpm build` — all pass.
- [ ] Start the local dev server (`pnpm dev` against the seeded local DB per CLAUDE.md's local-DB notes) and, via Playwright or the browser:
  - [ ] Open the Home mood card: eyebrow reads **"Exercise Readiness"** (not "Today's Mood"); empty state sub-label reads **"Tap to log energy & soreness"**.
  - [ ] Tap it to open the sheet: title reads **"Exercise Readiness"** with the energy/soreness subtitle; the save button reads **"Save Readiness"**; Energy Level and Sore Muscles sections render as the readiness inputs.
  - [ ] Save the sheet: toast reads **"Readiness saved"**; the card updates.
  - [ ] Confirm the store path is unchanged: on save, a row is written to the local `mood_logs` table + a `mood_logs` outbox mutation is queued (and/or `POST /api/mood` fires on the web fallback), and the `mood:${date}` cache is set — i.e. no data/behaviour change, only strings. (In the web sandbox `getLocalStore` returns null, so the `/api/mood` fallback path runs — verify a `mood_logs` row lands in the local dev Postgres.)
  - [ ] When no session has been logged today, the Home recommendation gate card eyebrow reads **"Exercise Readiness"** and its CTA reads **"Log Readiness · ~15 sec"**.
  - [ ] In More → Home Widgets, the widget toggle label reads **"Readiness"**; hiding then restoring it via the home hidden-sections list shows **"Readiness"**.
  - [ ] Open the morning check-in surface and confirm it is **unchanged** (still separate, untouched).

**Acceptance criteria:**
1. Every user-visible "Daily Check-in" / "Today's Mood" / "Mood card" / "Mood" (widget label) / "Save Check-in" / "Check-in saved" / "Log Check-in" / "Edit mood check-in" string is renamed to the Exercise-Readiness wording above.
2. No internal identifier changed: `mood_logs` table + sync domain, `/api/mood` route, `card_moodWidget` case, `moodWidget` key, `moodLog`/`setMoodSheetOpen` state, `MoodCheckInSheet` component name, `cardColors['moodWidget']`, and the `mood:${date}` cache key are all byte-identical to `main`. No migration, no cache-group change.
3. No field added or removed; the store payload (`energyLevel`, `bodyState`, `soreMuscles`, `sleepQuality: 'ok'`) is unchanged; the Issues collapsible still captures its data.
4. The morning check-in sheet (`components/morning-checkin-sheet.tsx`) is untouched — the two surfaces stay separate (user decision).
5. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.
6. `components/mood-checkin-sheet.tsx` stays well under ~800 lines (currently ~333).

**Notes for the implementer / reviewer:**
- Design decision on record: this readiness sheet is deliberately **kept separate** from the morning check-in — do not merge.
- The exact copy wording ("Exercise Readiness", "Save Readiness", "Readiness", the energy/soreness subtitle) may want a final user tweak — surface it for confirmation rather than assuming it is locked.
- The emoji → Lucide conversion (Task 5) is intentionally optional and, if deferred, should be logged in `projectOverview.md` / the backlog as an open "replace on touch" item rather than silently dropped.
</content>
</invoke>
