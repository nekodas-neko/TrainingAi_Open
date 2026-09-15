# 2026-09-15 — BF-74: the comment arguing against a confirm was checkable, and wrong

**Branch:** `fix/bf74-photo-remove-confirm` · **Lane B**

Owner, on the S25, 2026-09-13: *"it gives me an undo option; but no warning before removal"*.

Round one of BF-74 had moved the meal photo's remove control out of the dismiss corner and changed
the ✕ to a bin. Both worked. The control was reachable, read as removal — and still destroyed the
photo on a single tap.

## The component had already argued this out, in writing

`meal-photo-tile.tsx` carried its own reasoning for shipping undo instead of a confirm:

> A confirm dialog is the crude answer; undo is the better one, because re-picking is already one
> tap — the tile is a real picker — so the toast just spares the gallery round-trip.

**That is a claim about the camera, and it is checkable.** The tile calls:

```ts
CapCamera.getPhoto({ resultType: Base64, source: CameraSource.Prompt, quality: 80, … })
```

There is no `saveToGallery`, and the plugin defaults it to **false**. So a photo taken through this
tile is never written to the gallery or anywhere else — it exists only as the base64 string the
component is holding. **There is no gallery round-trip to spare, because there is nothing in the
gallery.** The toast is time-limited; when it passes, the photo is gone.

So the entry's "either confirm first, or make the undo durable" resolves on evidence rather than
taste. The argument *does* hold for a gallery-*sourced* photo, which is why the undo stays as well —
it costs nothing and still helps that case.

## What shipped

`components/ui/confirm-dialog.tsx`, which already exists and backs five other surfaces, in front of
the remove. The undo toast is unchanged behind it.

One non-obvious detail: the dialog is wrapped in a `stopPropagation` div. It renders **inside** the
picker's own `role="button"` wrapper, so a tap on Cancel would otherwise bubble out and open the
camera behind the dialog it had just dismissed.

## The spec was strengthened, not loosened

`meal-photo-picker.spec.ts` already owned this control, and its removal test tapped the bin and
expected the photo gone — so the change broke it, correctly. It now drives **both arms**:

1. **Cancel first**, and assert the photo survives a save.
2. Then confirm, and assert it clears.

The order is deliberate. A confirm dialog that removes anyway passes every happy-path assertion; only
the cancel arm can catch it. Against `main` the test fails on the missing dialog.

## Shipped alone, not with its batch

`nutrition-ui-uplift` holds six entries. Four are shipped with only a device check owed — no code to
write. BF-51 ① is device-blocked. The batch exists to aggregate a *device sitting*, and that is
unaffected: there was nothing else buildable to fold in.

## Not exercised

**No device pass**, and the outstanding half is one a browser structurally cannot judge: whether the
undo toast is still reachable by a thumb before it dismisses. That was already the only protection
the owner had, and it remains the second line behind the confirm. Kept as BF-74's `Keep:`.

**The native picker path is untouched and untested here** — `Capacitor.isNativePlatform()` is false
in a browser, so the harness drives the `<input type=file>` branch. The `saveToGallery` finding above
comes from reading the call, not from running it.
