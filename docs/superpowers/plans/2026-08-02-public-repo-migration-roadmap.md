# Plan — Public repo migration: the delivery mechanism, the cut, and where it sits

_2026-08-02 · Domain: `platform` · Owner-directed. Re-sequences backlog **Q-32** (and releases the
Q-1/Q-30 gates on it). Implements the **delivery half** that
[`2026-08-02-oura-ip-triage.md`](2026-08-02-oura-ip-triage.md) (#999) deliberately left open._

> **Read the triage plan first.** #999 already decided *what* happens to each vendored module —
> seven live imports, one dead, a replace/gitignore/delete verdict per row. **This plan does not
> redo that.** It answers the question that plan's gitignore verdict leaves standing: *once those
> assets are out of git, how do they reach the running server?* Then it sequences the cut itself.

**Inputs:** [`2026-08-02-oura-ip-triage.md`](2026-08-02-oura-ip-triage.md) ·
[`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](../../reviews/2026-08-02-native-convergence-roadmap-review.md) (F2, F6)
· backlog Q-31 / Q-32 · [`2026-08-02-native-convergence-goal-layout.md`](2026-08-02-native-convergence-goal-layout.md) Stage 4

---

## 1. Why this moved to the front of the queue

Private-repo friction has a running cost the roadmap never weighed:

- **The APK release URL does not work unauthenticated.** `CLAUDE.md` calls
  `releases/download/apk-latest/app-debug.apk` *"non-expiring, no login required"* and also says
  `GITHUB_RELEASES_TOKEN` is *"Required while the repo is private — an unauthenticated call 404s."*
  Both cannot be true; the second is. Distribution runs entirely through `/api/download-apk`, which
  needs a logged-in session **and** a PAT to keep alive.
- **A second user cannot install the app** except through that proxy.
- **Actions minutes are metered** on private repos and unmetered on public ones.

Q-32 currently gates on Q-1 + Q-30. Neither is a technical dependency — Q-1 (Phase 3) is deferred by
the owner, and Q-30's remainder is two Railway-console actions. **This plan releases both gates**
and replaces them with the one real dependency in §2.

### Owner decisions, 2026-08-02

| Decision | Choice |
|---|---|
| Model delivery | **Build-time fetch now, WASM later.** Unblock with a fetch from private storage; D2 Task 6 continues on the Stage 3 track. |
| Prune scope | **Snapshot minus the model tree.** No dead-code sweep in the same cut. |
| Railway | **Repoint the existing service.** Keeps the domain, which `capacitor.config.ts` hardcodes. |
| Repo home | **Same account, new public repo.** Name chosen at Phase B. |
| Fresh repo vs history | **Fresh `git init`** — already answered in #999 Task 1. This is what makes `.gitignore` a real strategy rather than false comfort. |

**One repo, not two.** A separate repo for a native APK would force the clean-slate rewrite the goal
layout §2 rejected on measured grounds. Stages 6–7 ship Compose screens and WebView screens in the
*same* APK — they cannot live in different repositories.

---

## 2. The gap this plan fills

#999's gitignore verdict (rows 4, 5, 6 — `steps-motion-decoder`, SleepNet, `step_counter`) says to
*"exclude the asset files from the public repo, and load them from the owner's private build
machine."* That is correct about **what** to exclude and silent about **how the deployed server gets
them**. Verified this session:

- `lib/oura-models/inference/*.ts` load via `await import('onnxruntime-node')` and are marked
  **"Server-only"** in their own headers.
- `sleepNetStages5Min` is called from `lib/data/postgres/adapter.ts:5006`, inside the server-side
  `aggregateOuraRawSamples` rollup — i.e. **on Railway**, which deploys from git.
- Phase 3 does **not** change this. It splits `api/` onto its own Railway service; that service
  still deploys from git and still runs the rollup.
- Every loader is **deliberately infallible** — `getSession()` returns `null` on any failure. So a
  missing asset degrades the hypnogram and daily steps *silently*, with a `console.warn`.

#999 does flag that a gitignored model *"must fail loudly, not silently"* and proposes the Health
Connect fallback as the product answer. That is the right answer **if** the models are meant to be
absent in production. The owner's choice is that they are not: the ring path keeps working.

**So there are exactly two coherent positions, and picking one is this plan's first job:**

| | Models absent in prod | Models delivered to prod (**chosen**) |
|---|---|---|
| Mechanism | none — publish and accept it | build-time fetch from private storage |
| Owner's hypnogram | falls back to Health Connect | unchanged |
| Ring step count | falls back to Health Connect | unchanged |
| Cost | zero | ~1 session + a bucket + one build secret |

### What makes the mechanism cheap

- **One choke point.** `lib/oura-models/inference/session.ts:12` —
  `const ONNX_DIR = path.join(process.cwd(), 'lib', 'oura-models', 'onnx')`. Everything else calls
  `getSession(fileName)`. Redirecting the whole server-side model layer is one line.
- **The WASM sibling already exists.** `session-web.ts` is built and byte-parity-proven against the
  node path (`wasm-parity.test.ts`: SleepNet stage argmax exact, continuous heads to ~1e-6). It has
  **zero callers** and no asset-serving route — that is what D2 Task 6 adds. Its own header says the
  bytes are *"fetched from Railway-served assets"*, so **the same fetched directory feeds it.**

> **Therefore the fetch is permanent infrastructure, not a stopgap.** Finishing the WASM port does
> not remove it: the server stops *running* the models but still *serves* their bytes to the device.
> That is a point in the mechanism's favour — it is built once and both consumers use it.

### Measured surface (tracked files, 2026-08-02)

| Path | Tracked size | Fate |
|---|---|---|
| `lib/oura-models/onnx/*.onnx` (10 files) | **23 MB** | → private assets, build-fetched |
| `lib/oura-models/constants/` | **12 MB** | → private assets (data), or replaced per #999 |
| `lib/oura-models/onnx/__fixtures__/*.golden.json` | 3.9 MB | **stays** — our own test vectors, CI needs them |
| `lib/oura-models/` tracked total | 87 MB | shrinks to code + goldens |

---

## 3. The reframe that makes the whole thing tractable

Separate **code** from **payload**.

- The TypeScript in `lib/oura-models/` is a *port of an algorithm*. Publishable (subject to #999's
  open ported-logic question, which this plan does not resolve either).
- What is not publishable is the **extracted numeric payload**: the `.onnx` weights, and the constant
  tables that sit inline in `.ts` or as JSON under `constants/`.

So: **move every non-publishable payload into one gitignored directory, fetch that directory at
build time, and publish all the code.** This matters beyond tidiness — Q-32's original instruction
was to *"exclude `lib/oura-models/` wholesale"*, and #999's audit proves that cannot work, because
seven modules import from it. A directory live code imports cannot be excluded and still compile.

---

## 4. Phase A — clear the blocker

Everything here lands in the **current private repo**. Nothing is published yet.

### A0 — #999 Task 0: dormancy sweep · branch `chore/oura-models-dormancy-sweep`

Already specified in the triage plan; it belongs first here too because it is pure subtraction and
shrinks everything downstream. Script an importer check over `lib/oura-models/`, delete the
unreferenced files (including `inference/dhrv` + its 19 KB ONNX), and assert the sweep in a test so
the tree cannot silently re-accumulate dead vendored files.

### A1 — Private-asset delivery · branch `feat/private-model-assets`

**This is the task that only exists in this plan.**

1. Create `lib/oura-models/private/` as the single home for non-publishable payload. `.gitignore` it
   — the existing `.gitignore:45` covers only `pt/*.pt`.
2. Move the `.onnx` files (and, per #999's verdicts, the constants that stay rather than get
   replaced) into it. Update `ONNX_DIR` in `session.ts` — one line. **Leave
   `onnx/__fixtures__/*.golden.json` where they are**: goldens are ours and CI needs them.
3. Upload the directory to private storage — Cloudflare R2, or a private GitHub release on the
   archived repo. R2 is less coupled to a repo that is about to be archived.
4. Add `scripts/fetch-private-assets.js`, wired into `nixpacks.toml`'s `[phases.build]` and
   authenticated by a Railway build secret, running before `next build`.
5. **Make the failure loud.** The real deliverable. Add a startup assertion in the API service that
   every expected model file is present and non-empty, failing the boot rather than letting the
   infallible loaders degrade quietly. This is also what satisfies #999's *"must fail loudly"*
   requirement for the gitignore rows — implemented as a deploy-time gate rather than a per-request
   product fallback.
6. CI does not fetch and holds no storage credential; weight-dependent tests skip cleanly (the
   `describe.skipIf` pattern is already established in this repo).

**Verify:** `pnpm dev` with the directory present → hypnogram and steps render as today. Remove it →
boot fails with a named error, not a null.

### A2 — #999 Tasks 2, 3, 5, 6: the replacements

Not re-specified here — take them from the triage plan in its order (MET table from the public
Compendium → training stress → resilience → cumulative stress with its migration story). They are
**independent of A1 and of the cut**: A1 makes the gitignore rows deployable, so the replacements no
longer block the repo cut and can land before or after it, in the public repo, at whatever pace.

This is the sequencing change worth noticing — the triage plan says its implementation *"stays
blocked behind Q-1 and Q-30"*. With A1 in place there is nothing to block: a gitignored asset that
still reaches production is a shippable state.

### A3 — Publish dry-run · branch `chore/public-tree-dry-run`

`git archive` the working tree into a scratch directory with the private paths excluded, then
`pnpm install && pnpm build && pnpm test` in it. This is what catches "an excluded file is still
imported" **before** it becomes a broken public repo. Keep the script; run it again after B2.

---

## 5. Phase B — cut the repo

### B1 — Pre-cut hygiene (still in the private repo)

- **`lib/data/postgres/migrations/006_admin_flag.sql` hardcodes the owner's real email.** Replace
  with an env-driven grant. **Prod is unaffected** — `schema_migrations` tracks by filename and 006
  is long applied, so the edit only changes fresh-DB behaviour. Document that a new database now
  needs that env var, or admin bootstrapping silently does nothing.
- **Delete the two orphan remote branches** holding raw decrypted originals and goldens:
  `docs/preserve-pt-originals-and-goldens` (52 MB) and `docs/unblock-cumulative-stress-golden`.
- **Rotate every credential ever committed and pushed.** A history-free cut does not un-compromise a
  leaked secret.
- **Rewrite the BLE-protocol docs in our own words** (`docs/oura-ble-*.md`, `lib/oura-ble/`,
  `android/.../oura/*.kt` comments) and strip model-provenance comments — *including for files that
  are gitignored*. *"Extracted from Oura's decrypted `.pt`, sha256 X"* is not publishable even when
  the file it describes is absent. **Note:** #999 explicitly leaves the broader ported-logic question
  open (`decode.ts` is the whole BLE protocol). This step is the documentation half only; it does not
  settle that question, and the owner should read #999's closing section before B2.

### B2 — Create the repo and snapshot

Fresh `git init`, no history — per #999 Task 1. Not `git filter-repo`: 43 MB of weights and constants
sit across ~900 commits and missing one trace is the failure mode. Copy the working tree, one initial
commit, push.

### B3 — Green CI in the new repo, before anything points at it

Only `secrets.GITHUB_TOKEN` is referenced by `ci.yml` and `android.yml`, so **there is no secret
migration** — both workflows should run as-is. Re-establish branch protection on `main` with the same
five required checks (Lint, Tests, Build, Custom Rules, Migration Check). Confirm `android.yml`
publishes `apk-latest`, then **download the release URL in a logged-out browser.** That single check
is the whole point of the exercise.

### B4 — Repoint Railway

Change the existing app service's GitHub source to the new repo, and add the A1 build secret.
Everything else — `DATABASE_URL`, the Postgres service, every env var, and the domain — stays. The
domain is load-bearing: `capacitor.config.ts` hardcodes it, so keeping it means installed APKs keep
working with no rebuild.

Deploy, then verify against production: a rendered hypnogram (proves the fetch ran), daily steps, and
a workout write round-tripping.

### B5 — Archive the old repo private, do not delete

The docs cite PR and session numbers throughout — `CLAUDE.md` alone references #952, #962, sessions
104/165/271. Deleting the origin turns hundreds of those into dead links. Add one note to
`projectOverview.md`'s document map: PR numbers below ~#1010 refer to the archived repo.

### B6 — Collect the winnings

- Delete `GITHUB_RELEASES_TOKEN` from Railway; drop the header from `app/api/download-apk/route.ts`.
- Fix the `CLAUDE.md` contradiction in §1 — the "no login required" claim becomes true.
- Decide whether `/api/download-apk` stays session-gated. Keeping it is fine; it is no longer the
  only path.

---

## 6. Where this sits in the native roadmap

| | Goal-layout stage | Revised |
|---|---|---|
| Public repo | Stage 4, behind Q-1 + Q-30 — effectively parked | **Phase A→B, next** |
| Real blocker | Q-1 (Phase 3) | server-side model **delivery** (§2) |
| Stage 3 — device-primary data | active | **unchanged, runs in parallel** — it is what actually makes the app feel fast |
| Stage 1 — schema matrix | "startable now", unqueued | planning pass, parallel, independent |
| Stage 2 — Phase 3 | gates everything | **after the cut**, when Gate A suits you — the workspace split then happens once, in the repo you keep |
| Stages 5–7 — native | after Stage 4 | unchanged, and now lands in the public repo by construction |

The ordering argument: **the big native work should happen in the repository you are going to keep.**
Cutting after Stage 6 means migrating mid-flight; cutting now means it never has to move.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Silent model degradation** — every loader returns `null` by design | A1 step 5's boot assertion. Non-negotiable: without it this plan's main failure mode is invisible. |
| **Railway repoint takes production down** | B3 before B4; B5 last. The old repo stays a working rollback target until production is verified on the new one. |
| **An excluded path is still imported** | A3's dry-run, run before B2 and again after. #999's audit proves this is a live risk, not theoretical. |
| **A replaced constant changes a user-visible number** | #999 already requires a before/after on the owner's real history via the D6 harness for training stress. Expected; must not be silent. |
| **The ported-logic question is larger than the constants question** | #999 flags it and does not resolve it. B1 surfaces it to the owner *before* B2, which is the last reversible moment. |

---

## 8. Not in scope

- **Dead-code sweep** beyond A0's dormancy sweep — owner decision. The cut copies what works.
- **The ported-logic / BLE-protocol legal question** — #999's open item, owner's call.
- **Schema and table renames** (Q-44 Phase 3) — sequence against Stage 1, not this.
- **D2 Task 6 (neural WASM)** — stays on the Stage 3 track. A1 makes it independent of the cut.
- **Play Store** — a public repo is not a step toward a listing. Separate question; review F3.
- **Phase 3 / Gate A** — unchanged, and no longer in front of this.

---

## 9. Sizing

| Task | Sessions | Owner action |
|---|---|---|
| A0 dormancy sweep | 1 | — |
| A1 private-asset delivery | 1 | storage bucket + one Railway build secret |
| A2 replacements (#999 Tasks 2/3/5/6) | 3–4, parallelisable, not blocking | — |
| A3 publish dry-run | shares A1 | — |
| B1 hygiene | 1 | credential rotation; read #999's ported-logic section |
| B2–B3 snapshot + CI | 1 | create and name the repo, branch protection |
| B4–B6 Railway + cleanup | 1 | the repoint |

**Critical path to a working public repo: ~5 sessions and three short owner actions** (A0 → A1 → A3 →
B1 → B2–B6). A2 is not on it.
