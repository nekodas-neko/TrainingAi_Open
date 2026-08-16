# 2026-08-08 — Bundle sizes measured for the first time, and they are not the navigation lever

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domain:** `app-shell`, `platform`

## Why

Bundle size and cold-start weight had never been measured — 25 review documents, no numbers, no
analyzer configured. For an app whose canonical runtime is a **WebView loading from Railway**, that
looked like a real gap worth closing.

## The numbers (production build, `main` @ v1.270.18)

**Shared by every route: 105 kB First Load JS** — `chunks/9bc990c0` 54.2 kB + `chunks/1003` 46.6 kB
+ 4.24 kB other. Middleware 87.1 kB.

The 46 real pages (API routes excluded — they all sit at the 106 kB floor), heaviest first:

| route | own page JS | First Load JS |
|---|---|---|
| `/workout` | 37.8 kB | **361 kB** |
| `/` · `/health` · `/nutrition` · `/more` | 235 B each | **316 kB** each |
| `/admin/data-capture` | 120 kB | 313 kB |
| `/admin` | 26.4 kB | 265 kB |
| `/activity` | 14.7 kB | 262 kB |
| `/chat` | 89.7 kB | 259 kB |
| `/overview` | 14.3 kB | 255 kB |
| `/activity/guided-walk` | 15.7 kB | 248 kB |
| `/workout-select` | 8.73 kB | 240 kB |

The shape worth noticing: **the four main tab screens carry 235 B of their own code and 316 kB of
First Load.** Essentially all of their weight is shared-layer, not screen-specific — so screen-level
splitting would move almost none of it.

## The conclusion: this is not where navigation cost lives

The on-device capture of 2026-08-05 (22 navigations, owner's S25) settles it: **warm 22 · cold 0 —
not one navigation fetched an RSC payload**, and the worst sample (1348.7 ms, ~9× median) also had
`rscCount: 0`, i.e. entirely client-side render and mount. Transfer size cannot explain a cost that
involves no transfer.

So the measured evidence continues to point at **rendering**, which is Q-51's file-splitting item —
not at bundle weight. Recording this as a **negative result**, deliberately: the point is to close
the line of inquiry rather than leave a plausible-sounding thread for a future session to re-open
and re-measure.

This is the same discipline the Q-127 entry earned the hard way the same day — a real static import
chain whose claimed consequence did not reproduce under measurement. A bundle number that *looks*
heavy is not a finding until something is shown to be slower because of it.

## What is genuinely still unmeasured

In-app navigation was measured; **cold app start was not**. Those are different costs — the 105 kB
shared baseline and a screen's 316 kB First Load are paid once when the WebView boots, which no
capture has covered. That needs the device, so it is filed as **Q-147** for the owner checklist
rather than guessed at here.

## Method, so this is repeatable

`pnpm build` and read the route table; no analyzer package was added. Two sandbox gotchas cost time
and are worth writing down:

- The sandbox's `node_modules` was missing `@capacitor-community/speech-recognition` even though it
  is in `package.json`, which fails `pnpm build` and `pnpm typecheck` on
  `components/workout/voice-log-button.tsx`. `pnpm install --frozen-lockfile` fixes it and touches
  neither `package.json` nor the lockfile. **An earlier note in this session called that error
  "pre-existing" — it was a stale sandbox install, not a repo defect.**
- A build started while a merge conflict was unresolved fails inside webpack with an opaque
  `Import trace: ./packages/shared/src/changelog.ts` stack. That is the conflict markers, not a
  code problem.
