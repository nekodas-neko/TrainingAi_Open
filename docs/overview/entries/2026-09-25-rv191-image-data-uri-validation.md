# RV-191 — the screenshot is validated by its bytes, and the exploit it was filed for does not reproduce

**Branch:** `fix/rv191-feedback-screenshot-validation` · **Lane A + B** · `[platform][app-shell]`

## The severity was wrong, and executing it is what showed that

RV-191 is filed as **SECURITY, HIGH**, ahead of RV-190, on the grounds that an admin who clicks a
feedback thumbnail "runs code with the admin's session in the app's origin" — and it says outright
that this was **"reasoned from source and not executed"**.

It has now been executed, on the Chromium in this container:

| leg of the stated path | measured |
|---|---|
| `window.open('data:text/html,<script>…')` | **did not navigate** — the opened window stayed `about:blank`, and the script never ran |
| SVG inside `<img src="data:image/svg+xml;base64,…">` | **script did not run** — `<img>` renders SVG script-inert |

Both legs are blocked by the browser, so the admin-RCE does not reproduce and this is **not** the
"script-execution precondition for RV-193 and RV-196" that its priority line claims. The entry has
been amended rather than deleted, because the *validation gap* it describes is real.

**Not measured on the Samsung WebView**, which is the canonical runtime. It follows the same Blink
policy, but that is inference; nothing here ran on the device.

## What was actually wrong, and the fix the entry did not ask for

`POST /api/feedback` checked `typeof screenshotData === 'string'` and a 500 KB cap. Any 500 KB
string reached a column the admin panel renders as an image.

The entry says to fix it by reusing the avatar route's MIME check. **That check was weaker than what
this codebase already knew.** `/api/user/avatar` validated the **declared** type — the one whoever
sends the data URI writes — so `data:image/png;base64,<SVG>` passed it. `sniffImageMime` has existed
since DV-18 for exactly this reason, and its own docstring says so: *"the bytes are the only thing
worth asking"*.

So the shared `parseImageDataUri` (`packages/shared/src/http/request-guards.ts`) decodes the payload,
sniffs the leading bytes, and requires the bytes and the declaration to **agree** — a real JPEG
labelled `image/png` is still a lie, and the admin UI renders the label. **`/api/user/avatar` was
fixed in the same PR**, under the sibling-surface rule: it had the weakness the entry proposed
copying.

`app/admin/admin-content.tsx` no longer calls `window.open(storedValue)`. The thumbnail zooms in
place, behind a real `<button>` with `aria-pressed`, so nothing navigates to a user-supplied value
and the control is reachable from the keyboard.

**The size rule is deliberately unchanged**: still measured on the stored string, not the decoded
bytes, because the string is what goes in the column and what `MAX_BODY_BYTES` keeps headroom over.
Moving it to decoded bytes would have quietly raised the allowance by 1.33×.

## Verification

Two existing suites had to change, and both changes are the point rather than collateral:

- `user-account-routes.test.ts` drove the avatar route with `data:image/png;base64,AAAA` under every
  declared type. That fixture only ever passed **because** the route trusted the declaration. It
  carries real PNG/JPEG/WebP headers now, plus two new cases: SVG labelled PNG, and a real JPEG
  labelled PNG.
- `feedback-calendar-scale-routes.test.ts` used `'d'.repeat(400_000)` as a screenshot. Its
  **oversize half passed unchanged**, which is the evidence that the size semantics really were left
  alone; only the "and it is stored" half needed a real image.

Gates (real exit codes): `lint` 0 · `tsc` 0 · full suite green.

## Not exercised

- **The existing production rows.** There is no `claude_ro.feedback` view **at all** — the entry says
  the view "omits `screenshot_data`", but the whole table is default-denied, checked against
  `information_schema` on 2026-09-25. Nothing in this container can read them, so whether any
  stored row is a non-image is unknown and stays owed. No stored row is touched by this diff, and
  any delete is the owner's call.
- **The admin screen was not rendered.** The zoom change is reasoned from the diff and typechecked,
  not opened in a browser or on the device.
- **The Samsung WebView**, as above.
