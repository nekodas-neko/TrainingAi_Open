# 2026-09-26 — `lane-b/rv207-design-quick-wins` (RV-207) — five of seven were quick wins; two were not

**Lane B · v1.465.67 · one entry shipped in part, two filed (LB-162, LB-163).**

RV-207 is Review sweep 63's design pass: seven small defects, filed as one PR "because every item
is small and code-certain". Five were. **Two were not, and saying so is most of what this entry
adds** — the sweep read them at source, which is enough to find a defect and not enough to see what
fixing it would look like.

## Shipped

**① Initials took the first two letters.** "Test User" rendered **TE** and "Zero Data" **ZE**.
One `initialsOf()` in `lib/initials.ts`, used by all three sites — first letter of the
first and last words, falling back to two letters for a single word, which is the only case the old
code got right. Twelve cases, including the email fallback two of the three sites use.

**② "3 sets · 1 exercises".** Pluralised — **and `sets` too**, one line above, which the entry did
not name and has the identical defect.

**③ A second supplement tick was silently dropped.** `toggleLog` opened with `if (toggling) return`
against a `string | null`, so a guard written to stop a double-tap on ONE row applied to the whole
screen: ticking B while A's write was in flight did nothing, with no error and no visual change.
Now a `Set` of in-flight ids, guarded per id in all four places that state is read or written.
Mutation-tested three ways.

**④ Press feedback on the daily controls** — the tab bar (both shapes), More rows, Nutrition's date
chevrons and settings, pre-workout back, the Home avatar, Health's three Log pills, the supplement
row. Matched to `components/ui/button.tsx`'s existing pattern rather than inventing one, **including
its `motion-reduce:` guards**, which my first pass omitted. `hover:` is removed where it was the
defect: on the WebView it sticks after a tap, which is what the entry reported.

**⑤ (part) Three of six `width` bars** → the existing `ProgressFill` (scaleX): `goal-progress-bar`,
`metric-tiles-card`, Health's water bar.

**⑦ "13.0T" read as thirteen trillion.** Uppercase `T` is the SI symbol for the **tesla**; `kT` was
a kilotesla. Now `13.0 t` / `13.0 kt` / `250 kg`, with the space that makes it a unit rather than a
suffix. The entry also offered `13,000 kg` to match Health — **not taken**: Health shows a period
total and this is lifetime volume, which reaches seven digits.

## Not shipped, and why — the part worth reading

**⑤'s other three bars are not mechanical, each for a different reason** (LB-162):

| bar | why `ProgressFill` does not fit |
|---|---|
| `warmup-screen` | gradient + a `boxShadow` glow; **`scaleX` scales a box-shadow**, so the glow shrinks with the bar |
| `weekly-muscle-sets-card` | track is `overflow-visible` **on purpose** — an `h-3` target marker deliberately overflows an `h-2` track, and clipping it to stop the fill going oval would clip the marker |
| `body-battery-card` | track is `flex justify-end` so the tank empties from the LEFT; `ProgressFill` is hard-coded `origin-left`, and `className="origin-right"` is a same-specificity collision decided by stylesheet order |

**Two of ⑤'s six paths were wrong** — `goal-progress-bar` and `weekly-muscle-sets-card` are under
`components/health/`. Corrected on LB-162.

**⑥ is an owner decision, not a defect fix** (LB-163). Moving Home's Log label and putting the
tiles on a fixed three-column grid is a visible rearrangement of a daily screen, which CLAUDE.md
gates on a mockup at 384 px and a yes. Three columns fixes the ragged row *and* makes each tile
narrower — a trade, not a strict improvement.

**It is filed `Lane: O` with NO `Gate: owner`, deliberately.** The mockup does not exist yet, so the
next act is to produce one and put it to him — that is work, and work is ungated. A gate would park
the entry and nobody would be tasked with asking. `check-backlog-pointers` caught my first attempt
(the field was inline and would have been ignored), which is what prompted getting this right.

## A guard that broke on a legitimate refactor

`rv68-supplement-tick-paints-first.test.ts` pinned `indexOf('setToggling(null)')` — a **literal**,
not the property. Making the guard per-id broke it while the property it exists for (released in a
`finally`, after the optimistic paint) was true throughout. It now matches any release that is not
the add, and a control run — moving the release out of the `finally` — still fails it, so it was
corrected rather than weakened.

## Gate

Full suite **1,080 files / 10,102 tests passed** · `check:rules` **Ran 80 of 80** · lint **0 errors
/ 817 warnings, equal to the base** (the base is 817 too; that drift arrived with other sessions'
merges, not this branch) · tsc, test-typecheck, build, doc gates clean by exit code.

## Rendered, after this entry first said it had not been

The version of this entry that shipped in #1693 said *"everything visual here is unverified"*. That
was true of the diff and did not have to stay true: the Playwright harness drives the real app at
the 412 px dark viewport, and a design entry is exactly what it is for. Three of four surfaces
captured — Health times out at 45 s in `next dev` and wants a longer budget.

**Seen on screen, not merely asserted:** the avatar reads **TU** on both Home and More, where it
read TE; lifetime volume reads **13.0 t**; Nutrition's date chevrons and settings gear render
unchanged after the className rewrites; the three converted bars draw at the right width.

**It also reproduced RV-207 ⑥,** which was read at source when filed: the word "Log" is drawn
directly over each tile's icon and is barely readable against it, and the three tiles occupy about
**58% of the row**. That is now on LB-163, so the mockup starts from an observation rather than a
description.

## Not exercised

**A screenshot is not a press.** `active:` states need a real touch and the S25's WebView — the
harness cannot show the stuck-`hover:` behaviour that prompted ④, because that is a device
behaviour, and the `motion-reduce:` branches are unexercised. **RV-207's own "done when" —
RV-205's P24 re-run showing a first-frame change under 100 ms on the tab bar and More rows — has
NOT been run**, and needs the device. Nothing here ran on the APK.
