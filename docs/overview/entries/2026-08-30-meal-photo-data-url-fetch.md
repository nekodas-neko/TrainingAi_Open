# The meal photo was blocked by the app's own CSP (BF-46 ①b)

**Branch:** `feat/meal-photo-and-quantity-editor` · **Lane B**

Three reports across five days, all the same sentence: *"the photo still doesnt get added from this
screen at the top. not saving."* · *"Meal photo tile shows; but its always the default cant add a
custom picture."* The entry called it a save failure that *"does not reproduce in source"*. It does
reproduce in source — just not on any path a test in this repo can run.

## What it was

`MealPhotoTile.handlePick`, native branch only:

```ts
const photo = await CapCamera.getPhoto({ resultType: CameraResultType.DataUrl, … })
const blob = await (await fetch(photo.dataUrl)).blob()   // ← rejects
```

**A `fetch()` of a `data:` URL is governed by `connect-src`, not `img-src`.** This app's CSP
(`lib/security/csp.ts`) lists nine hosts and `wss:`/`ws:` there and no `data:`, so Chrome refuses
the call with a bare `TypeError`. It landed in:

```ts
} catch {
  // Cancelling the picker throws, and a cancel is not an error worth a toast.
}
```

So the picker opened, the user chose a picture, and the app did nothing and said nothing.

## Why three reports and a held rebuild did not find it

**The web branch never fetches.** `Capacitor.isNativePlatform()` is false in a browser, so the tile
clicks a hidden `<input type=file>` and hands the resulting `File` straight to the downscaler.
`e2e/meal-photo-picker.spec.ts` drives exactly that, asserts the stored bytes in Postgres, and
passes — it has passed on every run since Q-327. The one line that fails is on the branch no harness
in this repo executes.

That also explains the shape of the previous session's investigation, which instrumented the *web*
path, found the file arriving correctly, and concluded the component never received it. It was
looking at the half that works.

## The fix

`CameraResultType.Base64` and `dataUrlToBlob` — no fetch. `capture-actions.tsx`, the food scanner
the owner uses daily on the same device, already asks for `Base64`; the two paths now agree, and
the one that worked is the one that was copied.

**The catch is the other half, and arguably the more important one.** It swallowed every failure,
not just cancels. A picker cancellation is now matched on the plugin's message and everything else
toasts. If this fix is wrong, the next report will at least say *what* went wrong.

`lib/media/__tests__/no-data-url-fetch.test.ts` is a source scan: it asserts the CSP still has no
`data:` in `connect-src` — the fact that makes the rule necessary — and that no file under `app/`,
`components/` or `lib/` fetches a data URL. Comment lines are skipped, or the rule would flag its
own explanation. Proved both ways: reinstating the old line fails it, naming the file and the line.

## Verification

Full unit suite **5,633 passed** / 672 files (14 in `lib/media`, 8 of them new).
`pnpm check:rules` — **Ran 62 of 62**. Typecheck and lint clean. `meal-photo-picker.spec.ts` still
passes, which matters as a *non*-regression: the web path is unchanged and it is what proves the
downscale, the cap and the round-trip.

## Not exercised — and this one cannot be, here

**The device, which is the only place the fixed line runs.** The diagnosis is checkable from source
(the CSP has no `data:`; a data-URL `fetch` is a `connect-src` request; the replacement is the shape
that already works on the same device), and the outcome is not. **On the S25: Edit Meal → pick a
photo → save → reopen.** BF-46's `Keep:` carries it.

Also untouched: **(a), the placement** — one picker, at the top, at hero scale, and the removal of
the meal detail sheet's *Add a photo*, which calls `onEdit` and picks nothing. That is a layout
change with a held rebuild behind it and it is not what the three reports were about.
