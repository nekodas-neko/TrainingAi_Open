# 2026-08-19 — Q-400: the label can leave the app now (and prints at 50 mm)

**Branch:** `fix/label-save-to-gallery` · Implementation Lane A · **needs a new APK** — the Kotlin
half does not reach the device through a Railway deploy.

## What was wrong

`meal-label-sheet.tsx` had one button, "Share or save", with two paths and both missed on the
canonical runtime. `navigator.canShare?.({ files })` is narrower than share-with-text and is not
reliably available in the Samsung WebView, so the guard correctly returned false — and the
`<a download>` fallback behind it is a silent no-op there: no file, no error, no toast. The feature
had only ever worked in `pnpm dev`.

A second defect sat on the same button and was invisible everywhere: `canvas.toBlob` writes a PNG
with **no `pHYs` chunk**, because the canvas API cannot set one. A PNG that declares no physical
size prints at the viewer's default, 96 dpi almost everywhere — so the 1,179 px label drawn to be
50 mm arrived at **312 mm**. That survived the deliberate 300 → 600 dpi change, because raising the
resolution was never the problem.

## What shipped

- **`android/…/media/MediaSavePlugin.kt`** + registration in `MainActivity`. Writing the file is not
  the hard part; being *visible* is — a file in app storage, or even in `Pictures/`, does not appear
  in the Photos app until it is registered with MediaStore, which is why this is a bridge and not a
  `@capacitor/filesystem` call. On API 29+ the insert creates the file inside the collection, so it
  needs no storage permission at all; `IS_PENDING` hides the half-written row until the stream
  closes, and a failed write deletes the pending row rather than leaving one the gallery cannot show
  and the user cannot delete.
- **`lib/media/save-to-gallery.ts`** — `saveImageToGallery(blob, filename)`. Never throws; the
  failure reason comes back as a value, because every caller ends in a toast.
- **`packages/shared/src/nutrition/png-density.ts`** — `withPngDensity` / `readPngDensity`. Splices
  a 21-byte `pHYs` chunk after `IHDR` with its own CRC. Idempotent, and a no-op on non-PNG input, so
  it is safe on every path without tracking whether it has already run. Both the save and the share
  path go through it — two copies of this would drift and only one would be easy to notice.
- **Two buttons, not one.** Putting a file in the Photos app and handing it to a print app are
  different intents, and one button doing whichever happened to be available is what produced this
  bug. Save to gallery is primary; Share is secondary.
- **Every branch ends in a toast** — saved, downloaded, shared, or the reason it failed.
- **The style persists**, in one `localStorage` key. The owner's own framing was *"Happy for it to
  persist if its easy"*, so: no column, no settings surface, no migration. Seeded in an effect, never
  a `useState` initializer.

## The decision worth not re-litigating: the native path never falls through to the download

The obvious shape is "try native, else download". That is wrong here, and dangerously so: inside the
WebView `<a download>` does nothing, so a fall-through would toast **success** and produce no file —
strictly worse than the dead button it replaced. So on the device, a missing plugin (an APK older
than this change) and an unsupported Android version each return a stated failure. The download
branch is reachable from a browser only.

Below API 29 this reports unavailable rather than falling back. The legacy route needs
`WRITE_EXTERNAL_STORAGE`, a runtime grant and a prompt written for a device tier that does not exist
here — the supported device is API 35 — and an untestable code path plus an unrequested manifest
permission is worse than a stated gap. **Known limitation, recorded rather than hidden.**

## The `canShare` guard stays

Removing it is the tempting "fix" and it is explicitly wrong: `navigator.share` with files where it
is unsupported rejects, and the catch swallows `AbortError`, so removing the guard turns a dead
button into a dead button that also lies in the log. What changed is that declining now *says so*
and points at Save.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite
against the local DB **512 files / 4,197 tests passed**.

- **12 unit tests on the chunk**, which read it back out of the bytes rather than trusting the
  writer. One of them encodes a *real* PNG (deflated `IDAT`, correct CRCs) and re-walks every chunk
  after the splice. The written file was then parsed by an independent decoder: `file(1)` still
  reads it as a valid PNG, and the chunk reads **23622 px/m, unit 1 → 600.0 dpi**, i.e. a 1,179 px
  label measures **49.9 mm** where an unstamped one measures **311.9 mm**.
- **Two new E2E tests** (`e2e/meal-label.spec.ts`) driving the real button: Save to gallery produces
  a download whose bytes carry a `pHYs` chunk above 560 dpi and whose toast appears, and the chosen
  style survives a reload. Both pass.
- The existing "renders a printable label in every style" test **times out locally at 180 s**, and
  it does so on unmodified `main` too — checked by stashing this work and re-running. It is the
  sandbox's dev-server compile cost, not a regression here; CI is green on it.

## Not exercised

**The gallery write itself.** It goes through the Capacitor bridge, which does not exist in a
browser, so nothing in the sandbox reaches it — the E2E proves the blob and its metadata, not the
delivery. Verification is: install the new APK, tap Save, open the Samsung Gallery, find the file.

**The print.** The `pHYs` figure is verified in the bytes and the arithmetic is exact, but whether a
label printer honours it is a physical measurement. `metrics.codeMm` in the sheet says what the code
should measure, so the check is a ruler and not a judgement call.

**This unblocks Q-411.** The owner said *"I can only do a print once the option to save to gallery
exists"* — three questions now come from one print: does the file reach the gallery, does it print at
50 mm rather than 312, and does the circle template crop the corners or scale the square inside the
circle.
