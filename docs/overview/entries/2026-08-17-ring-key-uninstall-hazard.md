## 2026-08-17 — an uninstall took the ring offline, and nothing warned about it

**Branch:** `claude/docs-review-agent-setup-3ocl7m` · **Domain:** `devices`, `platform` ·
Docs + three backlog entries, no code.

### What happened

Moving to a stably-signed APK (#19) required one final uninstall. The "what you lose" list given
beforehand covered the JS local store, the 14-day raw window and the outbox — and never looked at
the native side. **The uninstall also destroyed the Oura ring key**, and the BLE service came back
logging `no key stored` and refusing to start.

`OuraBlePlugin.kt` keeps the key in Android SharedPreferences under `key_hex`, and its own comment
states the intent: *"the key never leaves SharedPreferences; never logged"*. That is the right
design for a credential — it is not on the server, not in this repository, and not in any log or
crash report. It also means the key had **exactly one copy**, and an uninstall removes it.

The failure presents badly. `/admin/oura-ble` shows `Stopped` and a one-line log, while the Devices
screen still shows the ring at 99% and "Live", because that card reads server data rather than the
BLE link. Nothing on the screen the owner would naturally look at indicates the key is gone.

Recovered from the `key.hex` the original `open_oura` re-key produced, still present on the owner's
machine. There was no other copy anywhere.

### The part that made it dangerous rather than annoying

The intuitive recovery for a lost ring key is to re-onboard the official Oura app. That re-keys the
ring **and can force a firmware update that changes the BLE event encoding** — the exact thing the
frozen firmware exists to prevent. Every decoder in the pipeline is pinned to that encoding. So a
lost credential does not degrade to "pair it again"; it degrades to a full protocol re-validation
with no guarantee the reverse-engineered decoders survive.

That is why this is now documented in three places rather than one.

### What shipped

- **`CLAUDE.md`**, in the APK section immediately above the download instructions — a blocking
  warning to confirm `key.hex` is in hand *before* recommending an uninstall, and not to re-onboard
  the Oura app to recover. It sits there because that is the section a session reads when it is
  about to tell someone to install an APK.
- **`docs/oura-ble-operations.md` §0**, a new section ahead of the failure matrix: the key's single
  storage location, why it is correct, what destroys it, how to recover, and what not to try.
- **A `projectOverview.md` Known-Issues row**, open — because the mitigation so far is prose. The
  app still has no backup, no export, and no warning.
- **Q-530** — give the key an export affordance and a confirm-with-warning on `clearKey`, plus a
  key-present indicator on the Devices card so a keyless state is visible where the ring is managed.
  Explicitly **not** by syncing the key to the server: it is device-only on purpose, and this is a
  backup-and-visibility problem rather than a storage-location one.

### Two more findings from the same session, both owner-reported

- **Q-531 — Q-234's relocation of the device consoles made them worse in use.** Q-234 shipped
  2026-08-15 (v1.313.0), moving diagnostics out of `/admin` to Settings → Developer, and its journal
  records that as correct. The owner, running the re-sync runbook against it for the first time,
  reports the opposite. The useful part is *why*: Q-234's reasoning was taxonomic — diagnostics are
  not user administration — which is sound on paper and appears wrong in practice, because the
  operations these screens support are one task now split across two locations. The entry says to
  re-litigate that premise before re-arranging anything, since a second reorganisation chosen the
  same way lands in the same place.
- **Q-532 — the BLE screen re-centres itself while a scan runs**, so a control moves out from under
  the tap. It matters more than it sounds: this screen is only used during a live drain, which is
  the one time a mistimed tap can hit **Clear key**.

### A process note worth keeping

Q-530 was first filed as **Q-314**, from Implementation Lane A's band — and Lane A's baton showed a
session had already started under that name. Taking a number from a live lane's block is precisely
the collision the bands exist to prevent, so it was renumbered to Q-530 from the unallocated
pointer and Lane A's baton was left untouched. The bands worked; what nearly broke them was reaching
for the "obviously relevant" lane instead of the one this session actually belonged to.

### Not exercised

Nothing here is code. The three backlog entries are all device-only to verify, and none of the
recovery path was tested beyond the one live recovery that prompted it — in particular, **no one has
confirmed what happens on a device change** (new phone, factory reset) as opposed to an uninstall,
though there is no reason to expect it differs.
