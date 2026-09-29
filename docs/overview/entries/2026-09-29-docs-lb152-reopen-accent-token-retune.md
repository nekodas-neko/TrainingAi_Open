# LB-152 — the answered question rests on a false premise, so it goes back

**Branch:** `docs/lb152-reopen-accent-token-retune` · docs-only, no version bump

LB-152 was Lane B's queue head with its gate cleared: the owner answered on 2026-09-26 with option
**(b)** — retune `--accent-green` / `--destructive` to today's `#22c55e` / `#ef4444`, then migrate the
literal sites onto them — and set the test as *"the app's appearance must not change at any point."*

**Measuring before building is what stopped it.**

## The entry counted one side of the change

It counted the **literal** sites and never counted the sites already on the token. The app is
dark-only (`forcedTheme="dark"` in `app/layout.tsx`), so the live values are the `.dark` block's:

| token | live value | proposed |
|---|---|---|
| `--accent-green` | `oklch(0.84 0.22 145)` = `rgb(86,238,102)` | `#22c55e` = `rgb(34,197,94)` |
| `--destructive` | `oklch(0.704 0.191 22.216)` = `rgb(255,100,103)` | `#ef4444` = `rgb(239,68,68)` |

The oklch→sRGB conversions were computed rather than taken from the entry, and they match it, so the
entry's colour facts are right. What is wrong is the blast radius:

- **62** uses of `var(--accent-green)` across **30** files — Home, Health, Nutrition, Workout, Cardio,
  Coach, More.
- **10** uses of `var(--destructive)` plus **140** `bg-/text-/border-destructive` classes across **58**
  files — every destructive button, error line and delete affordance in the app.

So **(b) repaints about 212 readings and (a) repaints 14.** Option (b) is the larger visual change by
an order of magnitude, and it was put to the owner as the no-op.

## What shipped

No code. The entry is amended with the measurement, **re-laned `Lane: O`, ungated**, and moved to
rank 3 of the Orchestrator queue — per CLAUDE.md, an owner question is a task, `Gate:` would park it,
and getting the answer is the Orchestrator's work. The decision brief is written into the entry
rather than into a chat reply, so it outlives this session.

A decision page is committed at
[`docs/design/2026-09-29-accent-token-retune.html`](../../design/2026-09-29-accent-token-retune.html)
([hosted](https://claude.ai/artifact/YHV4gt6F5Lxut3q8cp4zKp)) — both candidates on the app's real dark
surfaces at 384 px, using the actual `--background` / `--card` / `--muted` tokens, with the counts
beside them. Reversal here can only be judged by looking at a screen, which is the argument for a
picture rather than a paragraph.

**Recommendation recorded: (a), migrate to the token** — same one-source benefit for a fifteenth of
the change, it keeps the design system's own values instead of the drifted copies, and every
component written in recent months already renders the bright token. **(b) remains right if he
actively prefers the mid green and red**; that is a real preference and only he can hold it.

## Verified

- `check-backlog-pointers` **530 entries**, no duplicates, all tagged — and the count was compared
  against the pre-change tree, because a move that silently drops an entry looks identical to a
  clean one. `next-item.js` puts LB-152 at **O rank 3** and off Lane B's list.
- `check-doc-links` OK.

## Not exercised

- **Nothing was built,** so there is no runtime claim to make. The counts come from `grep` over
  `app/**` and `components/**` excluding the `globals.css` definitions; a site that composes the
  token name dynamically would not be caught, and none was found.
- **The device.** The decision page is a sandbox render at 384 px, not the S25. The colours are the
  app's own token values, but a judgement about how they read on his screen is his to make there.
