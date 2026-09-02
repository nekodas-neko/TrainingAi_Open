## 2026-09-02 — the 0x73 frame is a container and byte 4 wraps; the connect hint named the wrong culprit (PS-20)

**Branch:** `claude/la-ps20` · **Lane:** A · **One copy change in `lib/colmi-ble/ble.ts`**; the decode
is analysis only and ships no decoder.

Measurement:
[`docs/reviews/2026-09-02-colmi-0x73-frame-structure.md`](../../reviews/2026-09-02-colmi-0x73-frame-structure.md).

### The sample was 3 frames; it is 45 now, and that changed the answer

**`0x73` is a container, not a record type.** Byte 1 is a sub-type: **18** carries the payload (39
frames), while **1, 4, 12, 43, 44** are entirely zero (6 frames). The three frames PS-20 reasoned
from were all sub-type 18 — which is why they looked like one record type.

**Byte 4 wraps at 256, observed directly**: `… 254 255 1 3 4 6 …` inside the 08-31 burst, with byte 5
not carrying. **That retires the entry's central inference.** It reads *"byte 10 over byte 4 is ~0.77
in all three — so they scale together and are one record type"*. Across all 45 frames the ratio spans
**0.33–0.78**. The constancy came from three frames sitting in one unwrapped run of the counter.

**The real invariant is stronger than the one the entry found:** `u16(6,7)` is *exactly* linear in the
counter — **27** per tick in three bursts, **36** in two, no residual, and it holds across the wrap
(255 → 1 is two ticks, and `u16` advances 54). Byte 9 does not select between 27 and 36; it is 4 for
one burst of each. Bytes 8, 11, 12, 13, 14 are always zero.

### What I did not do

**Name the fields.** The values match nothing in Colmi's own `colmi_readings` for the same days. There
is a tempting hypothesis — 27 and 36 are plausible **centimetres per step**, which would make the
counter steps and `u16` distance — and it is written down *as a hypothesis with its test*: a walk of a
counted number of steps, then a sync. That needs the ring and the owner, not another database read.

Structure without semantics is worth recording. A decoder that names fields on a guess is how a wrong
number reaches a screen, and this project has shipped that before.

### The copy fix, and why the old text missed

The hint named third-party apps only — *"if another app (Gadgetbridge, QRing, a BLE scanner) is
connected to the ring, disconnect it first"*. **The case the owner actually hit was this app**: the
ring read as missing right after weighing, and waiting fixed it. The scale runs its own foreground BLE
scan (`lib/scale-ble/plugin.ts`), so the advice did not apply to the situation that produced the
report — it told the user to close an app they may not have installed.

It now leads with the mechanism and the remedy that works — one connection at a time, wait a few
seconds and retry — and keeps the third-party list as the fallback. I deliberately did not assert
*which* component holds the connection, because a scan and a connection are different things and I
have not proven the mechanism on device.

### Verification

`tsc` clean, `lib/colmi-ble` 75 tests passing, `pnpm check:rules` 67 of 67. **The copy change is not
device-verified** — it renders on a failed ring connect, which the sandbox cannot produce.
