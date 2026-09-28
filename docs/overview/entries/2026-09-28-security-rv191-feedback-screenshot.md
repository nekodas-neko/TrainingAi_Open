# 2026-09-28 — RV-191: a feedback screenshot must be an image, and the admin panel no longer opens the stored string

**Lane A · auth/security · held for the owner's merge-time yes (RV-221).**

- **Route (`POST /api/feedback`):** `screenshotData` must now parse with the new
  `parseImageDataUrl` in `packages/shared/src/http/request-guards.ts`. Three things have to agree:
  - the declared type is PNG, JPEG or WebP;
  - the payload is strict base64 with nothing after it;
  - the decoded bytes sniff (`sniffImageMime`) as that same type.

  Anything else, including `data:text/html`, SVG, or a declared PNG carrying HTML, is a 400. The
  client always sends a JPEG from `downscaleToJpegDataUrl`, so real reports are unaffected.
- **Admin (`components/admin/feedback-screenshot.tsx`):** the value is parsed again at render time,
  because rows stored before this fix are unchecked and the `claude_ro` view omits
  `screenshot_data`, so they could not be inspected.
  - A value that does not parse renders as a note, never as a `src`.
  - A click opens a blob built from the decoded bytes, with `noopener`, so it never navigates to the
    stored value.
- **Tests:** the parser cases in `sniff-image-mime.test.ts`. The route test's "just under the cap"
  fixture is now a real JPEG-headed payload; its old `'d'.repeat(400_000)` was exactly the hole.
- **Not exercised:** an authenticated `pnpm dev` pass of the admin panel. No local session helper
  exists, so this is owed before merge. Existing production rows were not inspected, and deleting
  any is the owner's call.
