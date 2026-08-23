## 2026-08-23 — nothing in the app can edit or delete a logged workout, exercise or activity (LB-1)

**Branch:** `chore/retire-day-overlay-sheet` → docs-only. No code change; the branch name is the one
LB-1 was filed under and is now wrong, which is the point of the entry.

LB-1 was mine, filed one PR earlier as *"`DayOverlaySheet` is unreachable — delete ~300 lines"*. It
carried its own precondition: check whether `/health/day` still lacks the affordances the sheet had
**before** deleting, because *"if it does, this is a feature gap, not dead code"*. Checked. It does.

**`/health/day` has no edit or delete controls at all.** `day-sections.tsx` contains zero `onClick`,
zero `<button>`, zero `role="button"`; `TrainingSection` takes `data` and `kcalBySession` and no
callbacks. The only labelled control on that screen is **Back**.

**So the capability is gone app-wide, not merely relocated.** Measured repo-wide:

| capability | only control in the app | only client caller of |
|---|---|---|
| edit a logged exercise | `day-overlay-sheet.tsx:184` | — |
| delete a logged exercise | `:187` | `DELETE /api/workout-entry` |
| edit a session | `:134` | — |
| delete a session | `:147` | `DELETE /api/workout-sessions` |
| delete an activity | the sheet's activity row | `DELETE /api/activity-logs` |

The other three `/api/activity-logs` call sites are all POST. The one other trash icon in this area,
`workout-review-sheet.tsx`, is a **drop-set indicator** — worth naming, because it is what a quick
grep for a delete affordance finds and mistakes for one. Three server routes therefore have no
reachable caller, and a mis-logged set, a duplicate session or a wrong activity cannot be corrected.

**Why it went unnoticed for so long.** Q-110 repointed Health's calendar day-tap at `/health/day` and
left a note saying *"the same overlay is still opened from other surfaces"* — false when written, and
it is what kept the sheet looking alive. Two sessions have since fixed bugs **inside** the
unreachable file, the second being this lane one PR ago (Q-362b, v1.333.2). The comment was corrected
there; this entry is the capability.

**Not fixed here, and the reason is the safety rule rather than effort.** The obvious move — lift the
four handlers out of `health-content.tsx` and render `day-overlay-dialogs.tsx` from the day screen —
is not a code move. `/health/day` **swipes between days**, while the handlers are written against a
single overlay date and call `refreshDayOverlay(date)` from closure. Getting that wrong on a screen
whose whole purpose is changing dates deletes the wrong day's data, which is the one class of change
`CLAUDE.md` requires confirmation for. LB-1 is rewritten with the inventory, gated on the owner, and
carries a recommendation with two alternatives and their costs rather than a bare question.

### Two check hardenings, both from mistakes made writing this entry

**An unknown `[domain]` tag beside a valid one passed silently.** Fixed in the Q-362b PR after I
tagged LB-1 `[app-shell][health]` — there is no `health` pillar.

**A `Gate:`/`Needs:` field written INLINE is ignored, and the entry stays READY.** Both matchers
anchor at the start of a bullet. I wrote `- **Added:** … · **Gate: owner**` on this entry and it sat
at the top of READY looking startable — the exact opposite of what writing the field was for. **I
made the same mistake with `Needs:` three days ago**, the same way, by appending to the `Added:`
line. `check-backlog-pointers.js` now fails on a **bolded** `Gate:`/`Needs:` that is not a field, so
prose mentioning the words is untouched. Mutation-checked: reinstating the inline form fires it.

**Verification.** `pnpm check:rules` — **Ran 51 of 51**, all passed. `check-backlog-pointers` OK, 203
entries, and LB-1 now reports as PARKED behind `Gate: owner` rather than READY.
`projectOverview.md`'s baseline raised 7889 → 7916 for the Known-Issues row, attributed to this
branch by the new base-tree ratchet and noted in the history file.

**Not exercised:** nothing runtime — this PR contains no code. The unreachability is established from
source and from the absence of any other caller, not from a device.
