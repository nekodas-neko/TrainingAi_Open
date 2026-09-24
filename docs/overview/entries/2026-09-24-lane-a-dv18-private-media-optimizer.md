# DV-18 — private media cannot go through Next's image optimizer

**Branch:** `lane-a/dv18-reference-figure-content-type` · **Lane A** · 2026-09-24

The device reported one broken admin image. It was six call sites, and the cause was not the one
that was filed.

## The filed mechanism was wrong

DV-18 diagnosed a HEIC or JPEG stored under the `.png` key with a hard-coded `image/png`, served as
PNG, undecodable. It flagged itself *"high confidence, NOT proven"* and said settling it needed
production storage the sandbox cannot reach.

It needed no storage. Measured against `pnpm dev`:

```
GET /exercise-media/reference-figure.png              -> 307 /sign-in
GET /_next/image?url=%2Fexercise-media%2F…&w=96&q=75  -> 400 "isn't a valid image"
```

`middleware.ts` gates every non-`/api` path on a session. Next's image optimizer fetches its source
**server-side, without the viewer's cookie** — so it is redirected to the sign-in page, receives
HTML where an image should be, and answers 400. The browser draws the broken-image icon and the alt
text, which is exactly what the device saw. It fails before storage is consulted, so what is stored
under the key never mattered.

The device supplied the half a dev server cannot: the admin page itself rendered, so the browser
*did* have a session, and the image still failed. That is only possible if the optimizer's own
fetch lacks the cookie.

## It was never one image

Six `<Image>` call sites carried `unoptimized={src.endsWith('.gif')}`. GIFs were excluded because
the optimizer serves a still frame of an animation — so GIFs worked **by accident** and every other
private-media URL broke.

That matters because `mediaKey` writes start/end frames as `.png`, and
`exercise-media-panel.tsx` falls back to the still frame when an exercise has no animation
(`media.gifUrl ?? media.imageUrl`). So this was user-facing in the workout screen, not an admin-only
cosmetic defect. The comment already sitting on that call site — *"Mandatory on a GIF, and silent
when forgotten"* — had the right instinct about silence and the wrong scope.

`mustBypassImageOptimizer` in `packages/shared/src/media/private-media.ts` now answers it once, for
both reasons, at all six sites.

## The content-type half shipped too, as what it actually is

The upload really did store every file as `image/png` whatever the bytes were. That is a latent
defect regardless, so it is fixed: `sniffImageMime` reads the magic bytes, the route rejects what it
cannot serve rather than transcoding, and the proxy serves the **stored** Content-Type with the
extension guess kept only as a fallback for objects written before anything set one.

`ALLOWED_IMAGE_MIME` and `isAllowedImageMime` already existed in `request-guards.ts` with **zero
callers anywhere**. The sniffer is tied to that list rather than to three string literals, so it
finally has a reader and the two cannot drift apart.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | revert to the old gif-only rule | killed |
| 2 | WebP accepts any RIFF container | killed |
| 3 | PNG length guard `>= 8` → `>= 4` | survived — **equivalent**, see below |
| C | `startsWith` written as `indexOf(…) === 0` | survived (intended control) |

Mutation 3 is not a test gap. The `at()` helper compares `bytes[i + k]` against the wanted byte, and
past the end of the array that is `undefined`, which never matches — so the explicit length guards
are redundant with the signature check itself. The suite demonstrated this rather than my asserting
it: the `PNG.slice(0, 7) → null` case still passed under the mutation, because the behaviour genuinely
did not change. The guards stay as a statement of intent; they are not load-bearing.

## One test fixture was wrong and had been passing

`admin-media-tool-routes.test.ts` uploaded `[137, 80, 78, 71]` and asserted a PNG was stored. Four
bytes is the front of a PNG signature, not a PNG signature — it passed only because the route
declared the type instead of reading it. Corrected to the full eight, with a JPEG-named-`.png` case
and a HEIC rejection beside it.

## Failure surfaces not exercised

**No device**, which is the whole of what DV-18 still owes. **No production storage**: the upload
and proxy paths could not be driven end to end here, because S3 is unreachable from the sandbox
(`SignatureDoesNotMatch`), so the server half rests on unit tests and on the route reading the bytes
it is given. The optimizer half is measured, not inferred.
