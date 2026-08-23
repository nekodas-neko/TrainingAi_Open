## 2026-08-23 — the food-scan photo is bounded before it is uploaded (BF-4, Lane B half)

**Branch:** `fix/bounded-scan-photo-payload` · **v1.333.4** · user-visible.

The owner reported *"the nutrition scan for images is alot slower than it used to be — from taking
the photo to getting the result is much longer than before."* BF-4's investigation had already
established the shape of the answer, including what it is **not**.

**Measured, in a real browser, on a 4000 × 3000 capture:**

```
4000x3000 -> 1024x768 | base64 2,266,776 -> 302,944 chars (-86.6%)
```

~2.2 MB of upload becomes ~300 KB. **Nothing is lost to accuracy**, and that is the argument that
makes this free rather than a trade-off: every image scan in a month of production reports
1,275–1,298 input tokens *regardless of the photo's size*, because Gemini normalises an image to a
fixed tile budget before the model sees it. Bytes above that budget do no model work — they are pure
upload latency, on the one leg nothing in the app times.

**1024 is chosen from that token budget**, not from taste, and the constant says so where it is
defined.

**Both client paths, because they were both unbounded.**

- `Camera.getPhoto` gains `width` / `height`. **These are `ImageOptions`' names — `takePhoto` uses
  `targetWidth`/`targetHeight`**, and both pairs are optional, so writing the wrong one type-checks
  and is ignored at runtime: a downscale that silently never happens. Verified against the pinned
  `@capacitor/camera` **8.2.0** source rather than from memory, per CLAUDE.md's external-field-names
  rule. (`getPhoto` also carries `@deprecated` in this version, pointing at `takePhoto` /
  `chooseFromGallery` — noted, not acted on; a migration would change which pair applies.)
- The gallery path `FileReader`'d the raw `File` with no resize. It now goes through the new helper.

**A shared helper, because this would have been the third copy.** `lib/media/downscale-image.ts`.
`more/profile-tab.tsx` (avatar) and `more/feedback-sheet.tsx` (screenshot) each had their own; the
rule is extract before a third. Two things the copies got wrong and the helper does not:

1. **`feedback-sheet` scaled by WIDTH alone** (`MAX_WIDTH / img.width`), so a portrait image — what a
   phone camera and this app's own 412 × 915 screenshots produce — kept its full height and most of
   its bytes. The helper fits the **longest edge**. `feedback-sheet` is converted to it in this PR;
   `profile-tab` is left alone deliberately, since a square centre-crop is a different operation, not
   a caller of this one.
2. Both leaked an object URL per call. The helper revokes on every path, success or failure.

**Tested where it can be tested.** Both vitest projects are `environment: 'node'`, so `Image` and
`canvas` do not exist — which is why the arithmetic is split out as a pure `fitWithin(w, h, maxDim)`
and that is what the eight new cases pin: longest-edge fitting in both orientations, aspect ratio
preserved, **never upscales**, and no zero dimension at an extreme ratio. Mutation-checked —
restoring the width-only divisor reds exactly the portrait case and the upscale guard, and nothing
else.

### What this does NOT do, which matters more than what it does

**It is not shown to be the owner's regression, and BF-4 says so itself** — Correction 2 demoted the
payload from prime suspect to a standing inefficiency, because `Camera.getPhoto`'s options have been
byte-identical since 2026-06-12 and the plugin's integrity hash has never moved. Something that
cannot have changed cannot explain a change. What shipped is a real, measured reduction on the one
leg with no instrumentation; whether it is *the* cause is untested.

**The named dated change is untouched.** #112 (2026-07-03) converted the route from `generateText` +
`JSON.parse` to `generateObject` + a Zod schema, 19 days before instrumentation existed — which is
why `ai_call_log` cannot see it. The schema / `maxOutputTokens` experiment BF-4 prescribes is a
**route** change and is Lane A's.

**"Photo → result" still has no number.** BF-4 asks for the client-side elapsed time to be recorded,
and it is not, because it needs a sink: `reportClientError` writes to `error_events`, which every
session reads at start-up looking for faults — timing rows do not belong there. Left to Lane A with
the server-side payload logging that entry already assigns it. **The entry stays queued**, annotated
with which half shipped.

**Not exercised.** Nothing on the S25 — and this is the one worth repeating, because the failure is
silent: only the gallery path can run in the sandbox, so **the `getPhoto` bound is unverified**. If
the field pair were wrong the downscale would simply not happen, which looks exactly like "the fix
did not help". Railway cold start on this low-traffic route is still untestable here.

**Verification.** 8/8 new tests, mutation-checked. `pnpm check:rules` — **Ran 51 of 51**, all passed.
`pnpm lint` 0 errors. `tsc --noEmit` clean.
