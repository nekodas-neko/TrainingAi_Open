# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-25 · **By:** the eleventh Lane B run · **Next ID:** `LB-12`

## Now
**Nothing open.** This run merged #406/#410/#412 (Q-477 slices 2–4), #416 (Q-318), #418 (Q-317),
#419 (Q-316), and Q-544 in the PR carrying this baton. The run before it merged #391/#392/#394/#395/#397/#398/#400. Every one
has a journal entry in `docs/overview/entries/` dated 2026-08-24 — read those, not this file.

**The BLE admin console was the theme of the back half.** Q-318 gave the redecode a poller, Q-317
gave the re-key declaration a button, Q-316 gave the frame packer one, and Q-544 moved
`DbFootprintCard` + `DeviceMetricsPanel` out from behind `OuraBleDebug`'s native early-return so
they render on a desktop at all.

## Next
`node scripts/next-item.js --lane B`, and **re-verify the premise first** — that check is still the
highest-value thing this role does. **The tool no longer buries the startable work** (LB-11): a
shipped-with-a-`Keep:` entry now prints under KEEP rather than at the top of READY, so row 1 is a
real item. It leads with **Q-477's remainder** (`lib/stores/workout-store.ts`, a design call — see
below), then **Q-467**, **Q-403**.

- **BF-11 is NOT startable by Lane B.** Its own text says it is "not an implementation plan" and that
  a planning session must turn it into one first; no plan exists under `docs/superpowers/plans/` and
  one item needs a migration Lane A numbers. It will keep sitting at position 1 until someone plans it.
- **Q-403's `Lane: B` is wrong — it's Lane A's** (`app/api/coach/route.ts`). Still un-corrected.
- **`lib/stores/workout-store.ts`'s 3 timezone calls are the whole Q-477 remainder, and they are a
  design decision, not a conversion.** A Zustand store has no hook, and `onRehydrateStorage` runs
  before any provider mounts; a wrong-zone stamp makes `rolloverDay()` clear the day's completed
  sets. Full analysis is on the Q-477 entry. Do not convert it mechanically.
- **✅ Q-395's drawings ARE in the repo now** — `docs/design/2026-08-18-nutrition-rework-mockups.html`,
  landed by #428. Q-395a/b and Q-406's diary row all shipped this run; Q-406's last call site is
  `Gate: owner` on a design answer the twelve artboards do not contain.

## Do not re-litigate
- **Q-359's remaining 12 sites, Q-555's `next/link`-can't-work fix shape, `lib/coach/**` = Lane A,
  `floor(pct/10)` RPE prefill** — settled in prior runs, unchanged.
- **Radix `Collapsible`/`CollapsibleTrigger` already supplies `aria-expanded`/`aria-controls`**
  (confirmed against source, `asChild` included) — never a Q-491-class violator regardless of a
  chevron-grep's opinion.
- **`weekly-stats-hub`'s `todayKey` needs `.replace(/-/g,"/")`** — `/api/weekly-stats` emits
  `yyyy/MM/dd`. A plain `todayInTz(tz)` there silently kills the today-highlight.

## Owed (device / physical)
This run: Q-318's Redecode button, Q-317's card layout, Q-316's pack button, Q-544's page reorder —
all `Gate: device`, all APK-unchecked. Carried: BF-10, LB-5, Q-328/Q-321/Q-486 (`getLocalStore` null
in sandbox), the Q-389 print/scan/share checks, a TalkBack pass (incl. the two Q-491 fixes), Home's
"Accent ring" style, Q-450/Q-418 (needs a Polar H10).

## Claimed paths
**`scripts/next-item.js` + `scripts/lib/keep.js`** — claimed for LB-11, released when that PR merges.
`scripts/` is in neither lane's path list in `docs/agents/README.md` §3 and the ownership rule does
not decide it, so this is the ambiguous-path claim the rule asks for. It does not reserve `scripts/`
for Lane B generally.

## Gotchas worth carrying
- **Shallow clone: `git fetch --unshallow origin` before every merge**, or `git fetch origin main`
  re-shallows and the merge dies with "refusing to merge unrelated histories."
- **A backlog conflict is almost always TWO DELETIONS** — read headings, keep neither side.
- **`git ls-remote origin 'refs/heads/<name>*'` before pushing** — several suggested branch names are
  already taken by merged branches (`fix/redecode-job-id` was; `fix/redecode-job-polling` was free).
- **`open('f','w').write(open('f').read()…)` TRUNCATES BEFORE IT READS.** This wiped `package.json`
  to 0 bytes during a version bump this run; every tool then failed with `ERR_INVALID_PACKAGE_CONFIG`,
  which looks nothing like the cause. Always read into a variable first.
- **A file that "looks like a violator" from a text grep often isn't** — read the actual file.
- **Verifying anything inside `OuraBleDebug` needs a scratch route.** It early-returns the
  native-unavailable banner in the sandbox, so its whole tail is unreachable. Mount the child
  component directly at `app/scratch-*/page.tsx`, drive it, then delete the route — and
  **`rm -rf .next` afterwards**, or `tsc` fails on a stale `.next/types` entry for the deleted page.
- **Playwright here:** `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` (the
  pinned headless shell is absent), the login page is `/sign-in` and its FIRST submit button is
  "Sign in with Google" — click **"Sign in with email"** by name or the run dies on a
  `ClientFetchError`. Use `serviceWorkers:'block'` or the SW serves `/offline`, and
  `waitUntil:'domcontentloaded'` on `/admin/oura-ble` — its consoles poll, so `networkidle` never fires.
- **StrictMode's dev double effect-invoke can mask or reproduce a real cache-layer race.**
- **`projectOverview.md` sits ON its ratchet almost every PR** — re-measure with
  `check-doc-index-size.js`, compact an older paragraph rather than raising the baseline.
- **`get_check_runs` lags 30+ min; attempting the merge is the reliable check.**
- **`pkill -f "next dev"` exits 144 and kills the rest of a compound command** — put it last, and
  re-check anything chained after it actually ran.
- **Check `node_modules` matches the lockfile before diagnosing a build error.**
