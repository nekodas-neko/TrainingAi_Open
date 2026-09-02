## 2026-09-02 — the meal-label flake was two failures, and the timing evidence was measuring the wrong one (LB-38)

**Branch:** `fix/lb-38-share-code-decode` · **Lane:** B · **No version bump** — a spec change and a
diagnostic script; nothing a user can see.

LB-38's next step was to keep the failing canvas and decode it offline. Reproducing it first turned
up something else.

### `shotOf` was 152 seconds of a 180-second budget

Instrumented per step in *a saved meal renders a printable label in every style*:

| step | cost |
|---|---|
| `selectStyle` × 10 | 0.3–1.8 s each |
| `decodeQr` × 4 | 0.05–0.2 s each |
| **`shotOf` × 4** | **35.0, 40.1, 42.2, 35.0 s** |

It returned `Array.from(imageData.data)` — 1179 × 1179 × 4 ≈ **5.56 million numbers as JSON over
CDP**. The file's own comment already called that transfer pathological when explaining why
`expect.poll` was abandoned; nothing had attributed a test's runtime to it.

**Two consequences, and they are separate failures.**

1. **The every-style test was timing out, not flaking** — 3 of 3 full-file runs, and again in
   isolation, always at the 180 s wall. It was one step short of its clock, so any slowdown tipped it
   over. (The CLI `--timeout` does not help: the file's own `test.setTimeout(180_000)` wins, which
   cost a run to notice.)
2. **LB-38's *"failing runs take ~2.8 min; passing ones ~50 s"* was never a decode signature.** It is
   six `shotOf` calls versus one — the retry loop paying ~35 s per attempt.

### The fix

One luminance byte per pixel, base64, computed in the page. ZXing packs RGB down to luminance anyway
and the ink fraction is a threshold, so nothing is lost. **The file went from 4.7–4.8 min to
1.8–2.0 min**, and the timing-out test from 3.4 min to **~49 s**.

### The null decode is still real, and now reproduces somewhere better

**1 of 10 post-fix runs failed** — in the **every-style loop**, on `Ingredients · centred`, not in the
share-code test this entry was filed against. That loop has **no retry**, which makes it the better
reproduction: first attempt instead of sixth, ~52 s instead of ~4.8 min. The entry is **not closed**.

Both decode sites now keep the pixels ZXing refused. `dumpCanvas` writes the luminance buffer plus
`w`/`h`/ink to `test-results/share-code-dumps/`, and the assertion names the file and the command:
`node e2e/decode-share-code-dump.js <dump.bin>`, which tries Hybrid and GlobalHistogram binarizers ×
with/without `TRY_HARDER`. If the failing buffer decodes offline, the fault is in **how the decode is
invoked in-run** rather than in the image or the reader — the last mechanism nothing has eliminated.

**A hypothesis every measurement fits, offered as a hypothesis:** the canvas is caught **mid-repaint**.
Overall ink stays in band while the symbol is momentarily incomplete — "correct-looking pixels that
will not decode". A 35 s transfer gave a repaint an enormous window; it is now milliseconds, which
fits the drop from roughly half of runs to roughly one in ten. The dump is what would settle it.

### Gotchas worth carrying

- **`test.setTimeout()` in a spec file beats `--timeout` on the CLI.** A run that still dies at
  exactly 180 s after you asked for 600 s is this, not a hang.
- **`require('@zxing/library')` fails from a standalone script.** Only `@zxing/browser` is linked at
  the root; under pnpm the library sits beside it in the store. Resolve through the package that
  depends on it — `createRequire(require.resolve('@zxing/browser'))('@zxing/library')`.
- **`String.fromCharCode.apply` on a 1.4 MB array blows the argument limit.** Chunk it at 0x8000.

### Not exercised

Nothing device-visible changed. The remaining decode flake is unexplained and the entry stays open
with the instrumentation that would explain it.

### The journal directory crossed its ceiling, and this PR paid for it

`docs/overview/entries/` hit **251** against a **250** total ceiling when this entry was added, so
the gate failed here. Three unlinked entries were folded into `docs/overview/history-newest.md` and
`git rm`'d, taking it to 249. They carried **no relative links at all**, so none of the five
link-rewriting hazards the README warns about applied — worth recording, because the README's list
makes a sweep sound heavier than this one was.

**⚠ `history-newest.md` is 328 KB, already past the ~250 KB threshold at which the README says to
start a new `history-*.md`.** Appending here made it larger rather than splitting it. Splitting means
naming a fourth file in a set that is semantic rather than dated (`past` / `recent` / `newest`) and
re-pointing the Document Map, which is Orchestrator-shaped work and not something to do inside a spec
fix. **The next sweep should split it**, and it is recorded here rather than left for someone to
rediscover from the file size.

Also worth noting for whoever meets this next: the **total-ceiling** branch of the check does not do
the BF-36 attribution that the foldable-limit branch does. The limit branch names whoever grew the
directory; the ceiling branch fails whichever PR is open when the count crosses, which is the exact
unfairness BF-36 was filed to remove — one level up.
