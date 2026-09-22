# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-22 · **By:** the owner-decisions + device-harness session · **Next ID:** `OR-129`
(`grep -rhoE '\bOR-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## Now

**There is a seventh agent and it is not in this container.** 📱 **Device Verification** runs on the
owner's Windows machine with the S25 on USB, driving the real APK over the DevTools protocol
(`scripts/device/**`, shipped unrun). Baton: `docs/agents/state/device.md` — **you seeded its task
list; keep it current.** It answers VERIFIED / FAILED / COULD NOT CHECK and nothing else.
**It observes, you reconcile:** read its outcomes, strike what is settled, re-file what failed, route
it. Do not duplicate its work — you cannot see a phone, and a FAILED is a lane's work, not debt.

## Your list

1. **`OR-126` — the raw-archive brief, and the ball is OURS.** Q-29 Task 5 drops
   `oura_raw_samples.body_hex`. The owner declined to answer a one-line summary of an irreversible
   change and asked for the case, which is correct. State what is dropped, what survives in the
   device's deliberate 14-day window, what becomes permanently unrecoverable (the cursor only moves
   forward, so a later decoder fix back-fills *only* from stored hex), and what keeping it costs —
   measured, against ~227 MB at $0.15/GB/month. **⛔ Not an argument for the drop.** Do not re-ask
   before it exists.
2. **The `.size` tax is measured four times and still unfixed** — LA-122 item 5, Tuning's 2c (five
   of seven PRs), Review's three on #1389, six stale bases on #1408 in one evening. The owner took
   the cheap half (a sweep ships as one PR; in CLAUDE.md). **The durable half is unfiled: stop
   storing the number** — check that a grown doc carries a new note in the append-only history
   instead of matching a stored integer. Same intent, no contended line. Structural, so yours.
3. **Apply the mockup rule retroactively** — *large UI changes are mocked up first* (Review, this
   session). Entries that qualify but predate it need `Gate: owner` naming the mockup.
4. **`OR-115`** — inventory the admin surface before anything is deleted from it.
5. **Finish the `Gate: owner` re-triage.** Most are engineering calls, Tuning's, or an untaken
   measurement; eight are marked NOT OWNER-READY (OR-117).

## Waiting on the owner — re-offer, never re-argue

**BF-111's screenshot** (on the device agent's list too) · **RV-43**, **RV-65** (scoring, Lane A)
and **RV-38** (what the Body Battery card says with no data), all from Review 2026-09-22 ·
**BF-106** (`VACUUM FULL`) and **LB-52** (classic branch protection) — accepted and deferred.

## Do not re-litigate

- **Entry IDs are per-agent prefixes, not bands**; one file, one global order.
- **`Q-1b` is deferred to a v2 milestone** (owner, three times). Bundling buys **~0.44 s, cold open
  only** — 439 ms of a 472 ms paint is the Railway round trip.
- **The calorie anchor is settled** (BF-152), confirmed on the S25 2026-09-15.
- **`PS-4` stays `Lane: ?`** — each role rewrites its own baton; a sweep set `Lane: O` and reverted.
- **No web-UI checks go to the owner** — the APK is the only surface they use.

## Gotchas worth carrying

- **The clone is shallow** (`git fetch --deepen=1000 origin main` first) and **`total_count: 0`
  minutes after a push is a stale base, not slow CI**. The base goes stale *while you work* — six
  times on one PR, 2026-09-22. Attempting the merge is the reliable green check; `get_check_runs`
  lags by up to 35 minutes.
- **The two conflict files resolve in OPPOSITE directions and look identical.** History is
  append-only (keep both, main's first); a backlog conflict is two *deletions*, where keeping both
  resurrects shipped entries. **`.size` files are recomputed after the merge, never spliced.**
  And **`git add -u` after a merge stages the markers** — check before staging, not after pushing.
- **A finished entry that still advertises is as bad as a blocked one mislabelled.** `keepIsSettled`
  checks both — and **a look that came back FAILED counts as settled**, which the first version
  missed, hiding TN-13 and BF-74 as "shipped, a look owed" while they held live work.
- **Confirm a completion claim against a merged diff or a production read**, never the entry's own
  text — ten of seventeen failed that in sweep 1. Same discipline for a *signal*:
  **⛔ never read the route from an inspector's address bar.** DevTools refreshes it on
  `Page.frameNavigated`, which `history.replaceState` does not fire, so it goes stale on this app.
  A shipped fix was nearly recorded as failing on device on the strength of that widget (2026-09-22).
- **Your own prose can defeat `next-item.js`** — a bullet merely *quoting* a `Verify:` field fails
  the parser. (The bare `⛔` no longer parks an entry; it now needs *block* within 40 chars.)
- **A defect can be invisible to every check and still block a human.** `ord.endsWith('ss')||` sat
  on `main` from #1109 and made the repo **un-checkoutable on Windows**. Linux and macOS create it
  happily and CI never tries a Windows checkout, so nothing in the suite could catch it — the owner
  develops on Windows, and it took him hitting it.
- **`check:rules` is the custom-rules gate, NOT the pre-push gate — `pnpm ci:local` is**, run
  unpiped. Running only `check:rules` on a backlog-only PR turned `main` red for every lane (#1247):
  restructuring a `Keep:` removed a gate that `keep-gate-set-off.test.ts` pins **by name**.
  **A queue restructure is a code change to those tests.**
