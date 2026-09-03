# Q-516 — the HR Recovery Profile now says how much of it is signal

**Branch:** `fix/q516-hr-recovery-honesty` · **Lane:** B · **Domain:** `[heart-rate]`

Found by auditing the queue for Lane B work rather than by picking the next READY item, because it
was not in READY — or in any other lane's list.

## It was unreachable from either queue

Q-516 carried two bare lane mentions that disagreed. Its `Keep:` said *"the honesty half, and it is
now **Lane B's**"*; eleven lines below, a line left over from when the re-banding was a Tuning
proposal still read *"Lane A implements; Tuning proposes only"*.

`laneFromLines` refuses to guess between conflicting bare mentions and returns `?` — deliberately,
because a wrong lane sends work to the wrong agent silently. So `next-item.js` filed the entry under
UNCLASSIFIED, where neither lane's list shows it. **That is the exact failure the lane module's own
comment documents**, and it had left real work invisible for a day.

The stale line is struck and the lane is a field now.

## What was actually missing

`aggregateHrRecoveryProfile` has returned `informativeShare` since the re-banding shipped — the
fraction of banded episodes whose peak clears the low-signal threshold. Its own doc comment says why
it exists: *"the honest version of Q-516 is not the re-banding: it is saying out loud that HR
recovery informs a MINORITY of lifting sets… a caller that renders them without this number is the
failure mode the entry named."*

Nothing rendered it. Verified before building, rather than taken from the entry: computed at
`hr-recovery-profile.ts:178`, returned by the route (`NextResponse.json({ ...profile, trend })`),
typed into the card's own response at `hr-recovery-profile-card.tsx:24`, and read by no component.

The card already carried a dimmed-band note — *"HR barely elevated — recovery there is mostly noise"*
— but that says **which rows** are noise, not **how much of your training** lands in them. Four
populated buckets read as a working feature either way.

## What shipped

The share, stated under the table, and **emphasised once the informative rests are a minority**:
below half it stops being a footnote about the dimmed rows and becomes the headline about the whole
table, so it takes the amber treatment and says to read the table as a partial picture.

**A share of 1 renders nothing.** A "100% of your rests are informative" line on a table that is
entirely fine is noise, and noise is what trains a reader to skip the line that matters. A null share
means no banded episodes, where the card already renders nothing at all.

`components/health/hr-recovery-honesty.ts` holds the threshold and that silence rule — a `.ts`
beside the component, matching `score-qualifier.ts` and `sparkline-geometry.ts`, because the card is
`.tsx` and both vitest projects run `environment: 'node'`.

## The mutation that survived, and what it was hiding

Six mutations were run and five killed tests. `Math.round` → `Math.floor` passed, and it was a real
defect rather than a gap in coverage: `informativeShare` is stored to two decimal places, and
`0.29 * 100` is `28.999999999999996` in binary floating point. Truncating renders **28% for a share
of 29%** — off by one, silently, and only on some values. A case pinning 0.29 and 0.58 was added and
the mutation now fails.

That is the argument for running the sweep rather than trusting a green suite: the test that caught
it did not exist until the mutation showed nothing was watching.

## Two queue corrections in the same PR

- **Q-516** — the stale lane line struck, the honesty half recorded as shipped, and `Gate: owner`
  left on the one thing still open: whether the feature is targeted correctly at all, given the
  range it wants lives in cardio rather than strength sets.
- **BF-94** — its `Needs: BF-84` is **discharged**. The stated reason was that BF-84 rewrites what
  `onRestDay` does, so rebuilding how it is invoked would touch the same call site twice; that
  rewrite shipped 2026-09-01 with migration 247. What still blocks BF-94 was written only in prose —
  *"do not ship this until BF-61's fast-tap check has been done on the device"* — so the queue could
  see an expired blocker and not the live one. It is a `Gate: device` field now.

## Verification

12 unit tests, the threshold driven directly **and through the real `aggregateHrRecoveryProfile`**,
so a change to the low-signal threshold moves this test rather than slipping past it. Six mutations
kill them: a note on a clean 100% table, silence on the zero case, the boundary flipped to
inclusive, truncation instead of rounding, the card never reading the field, and the card rendering
with no note.

Full unit suite green; `pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint
clean.

## Not exercised

**A real profile with a minority share.** The seed database has no `set_hr_stats` history, so the
card renders nothing there and the amber branch has never been on a screen — it is proven by the
aggregate and by source, not by pixels. The owner's own profile sat at **39%** when Q-516 was
written, so the emphasised branch is the one they will actually see; whether amber at that size is
legible on the S25 is a device question. Also unexercised: whether the copy reads as useful rather
than as the app apologising for itself, which is a judgement only the owner can make.
