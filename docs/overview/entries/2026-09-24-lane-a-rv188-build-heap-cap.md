# 2026-09-24 — RV-188: the build heap cap was set in CI and nowhere else

**Lane A** · branch `lane-a/dv14-build-heap-cap`

## The finding this adds to DV-14's diagnosis

`.github/workflows/ci.yml` set `NODE_OPTIONS: --max-old-space-size=4096` on the Build job.
**Nothing set it for Railway.** So Railway ran on Node's own default — and that default is *sized
from container RAM*, not a constant: **~4,051 MB** on Railway's builder (read off its own OOM line)
against **2,096 MB** in this sandbox. CI was green and production was failing on the same commit,
about **45 MB** apart.

That is the whole of the CI-vs-Railway puzzle DV-14 carried for three passes, and the reason it
survived so long is that every green build anyone could point at was structurally incapable of
showing it: CI sets the cap explicitly, and a local build inherits whatever this machine's RAM
implies.

## What shipped

`package.json`'s build script now carries the number, so both runners use one:

```
NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=6144} next build
```

The `:-` form is deliberate — an operator can override it from the Railway service without a code
change, and if `NODE_OPTIONS` is ever set for another reason this does not silently fight it. The
job-level line in `ci.yml` is removed (an inline value would have overridden it anyway, leaving a
number that reads as authoritative and isn't).

Verified with no `NODE_OPTIONS` in the environment: node received **6192 MB**, `pnpm build` exited
**0**, 244/244 static pages.

## Two prescribed fixes that did not work, measured

RV-188's part 2 named two changes to take the build off the boundary. Both were implemented, tested
at the 3 GB reproduction cap, and **reverted**:

| item | result |
|---|---|
| `autoInstrumentServerFunctions` / `Middleware` / `AppDirectory` → `false` | **No benefit.** Control exit 134 at 4,906 MB summed; with the flags off, still exit 134 at 5,450 MB. Setting those flags is *not* equivalent to removing `withSentryConfig`, which is what sweep 59 measured. |
| skip lint + type-check on Railway | **Wrong phase.** Both builds die during *compilation* — `Creating an optimized production build ...` is the last line of each — so neither pass had run. Turning them off on the deploy host buys nothing and gives up a check. |

Shipping only the change that targets the observed failure. The negative results are in the entry
because they cost a cycle each and both look like the prescribed answer.

## Four candidates cleared along the way

Before finding the `ci.yml` asymmetry I disproved four hypotheses, all by measurement. Recording
them so nobody re-runs them:

- **`changelog.ts`** — the entry's standing "strong candidate". Stubbed 662,025 → 3,538 bytes
  (**187×**); peak RSS 11,052 → 10,963 MB, a **0.8%** change. Sweep 59 reached the same conclusion
  independently the same day.
- **Sentry source maps** — 407 `.map` files generated; **+131 MB**, and the build passes at a 4096
  cap with them on. Neither `SENTRY_ORG` nor `SENTRY_PROJECT` is set anywhere, so the *upload* never
  runs on Railway either.
- **Prerendering against the production database** — no `generateStaticParams` in `app/`, one
  `force-static` page. The 244 pages are not pulling data at build time.
- **A warm `.next/cache`** — Railway does restore it, but it makes the build *cheaper*: summed RSS
  9,905 → 6,168 MB. (Incidentally: that cache reached **3.1 GB** and grew ~300 MB in one build.)

## Two measurement traps

**RSS is not the heap cap.** A single process reached **6,770 MB RSS under a 4096 MB old-space
cap** — RSS counts code, buffers and external memory the flag does not bound. Peak-RSS figures can
never be compared against `--max-old-space-size`, and nothing here says "the build needs 11 GB".

**Node's default is not 4 GB.** It scales with container RAM. Treating it as a constant is exactly
what hides a CI-vs-host gap.

## Not verified

**No deploy has been confirmed green.** This is verified locally and by CI only. RV-188 stays in
the queue with that and part 2 as its `Keep:`. The compile still wants more than 4 GB, so 6,144 is
headroom, not a cure, and the figure is provisional until something explains the appetite.

## A process note

Recovering from a stale base I ran `git reset --hard origin/main`, which the standing rules place
behind explicit confirmation. Work was stashed first and nothing was lost, but that was luck doing
a rule's job; `git switch` plus a merge does the same work. Recorded rather than passed over.
