# 2026-09-02 — the share-code dump was captured, and it refuted my own reading of it (LB-38)

**Lane B · branch `fix/lb-38-torn-canvas` · no version bump · comments and docs only**

LB-38 has been open on one question: capture the pixels ZXing refuses and decode them offline, because
*"if the failing buffer decodes offline, the fault is in how the decode is invoked in-run rather than in
the image or the reader"* — the last mechanism nothing had eliminated. No dump had ever been captured.

## The capture

First run of a fresh batch, on `Ingredients · centred`, in the every-style loop — exactly where the
entry predicted it would be cheapest to catch. Five further runs were green, which fits the recorded
~1-in-19 rate; the first one was luck.

`node e2e/decode-share-code-dump.js` returned **null under all four** binarizer × `TRY_HARDER`
combinations. **So the fault is in the image, not in the decode invocation.** That is the entry's own
criterion, and it closes the mechanism it was opened to test.

## Then I got the next step wrong, and one more measurement caught it

The dump's ink is **0.0807**. The entry records the normal band as **0.172–0.179**, and I read 0.0807
as less than half — a textbook mid-repaint signature — wrote it up as confirming the entry's
mid-repaint hypothesis, and implemented the gate the entry prescribes for that case: settle the canvas
across rAF-separated reads, so a torn canvas is never sampled while a stable-but-unreadable one still
fails.

Before shipping it I logged the ink on a **passing** run, to check the gate was not inert. It is
per-style:

| style | ink, passing run |
|---|---|
| `Ingredients · centred` | **0.0800** |
| `Black band` | 0.1341 |
| `Plaque` | 0.0914 |
| `Big code` | 0.1732 |

**0.0807 is exactly normal for the style it came from.** The 0.172–0.179 band is the share-code test's
own style, and `~0.17` — what `darkFraction`'s comment said a drawn share code reads — is `Big code`'s.
I had compared one style's ink against another style's band. The entry's original finding, that a
failing attempt's ink sits in band and the buffer is not degenerate, was right the whole time.

**So the gate was reverted unshipped.** It costs ~0.5 min on the file and fixes a cause that is not
established, and this entry is explicit that the wrong fix here masks the flake rather than curing it.
Nothing in this PR changes test behaviour.

## What shipped instead

- `darkFraction`'s comment now carries the four measured per-style figures and says outright that
  reading ink as one number is what produced the wrong conclusion. The old `~0.17` is what made the
  mistake easy.
- `decode-share-code-dump.js` no longer prints *"unreadable despite normal ink"* — it cannot know that,
  since it is handed one dump and the band depends on the style, which the filename carries. It now
  says so and lists the figures.
- LB-38 records the capture, the offline result, the correction, and the cumulative list of eliminated
  mechanisms.

## I destroyed the dump

The batch loop `rm -rf`'d `test-results/share-code-dumps` before each run, so the four green runs that
followed deleted the artifact — while the entry's standing instruction was to *keep the dump file before
doing anything else*. Both numbers that mattered were extracted first, so nothing above depends on it,
but a re-analysis needs a fresh capture. The entry's instruction is now literal: copy it somewhere
outside `test-results/` first.

## Where LB-38 stands

**Eliminated:** the `> 0.01` ink floor letting a text-only canvas through; `getImageData` returning a
degenerate buffer; decoder configuration; in-run decode invocation; and low ink as a signature.
**Remaining:** what was drawn — a real defect in the rendered symbol at that moment, cause unknown. The
mid-repaint hypothesis is neither confirmed nor refuted; it lost its only piece of evidence.

**Not exercised:** no fix was made, so there is nothing to verify beyond the file still passing (6 tests,
2.5 min including both setup projects). The device is untouched — this is a test harness and two comments.
