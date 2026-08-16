## 2026-07-30 — Shorten scale cooldown; add a plain weigh-in-logged notification

Follow-up to the stale-scan-result fix (#929, v1.242.4). The owner rebuilt the APK and confirmed
the big win: the endless "connecting…"/"Retrying…" loop is gone. Every wake now resolves within a
bounded couple of attempts, whether it's a real weigh-in or the scale genuinely (not stale-filtered)
re-advertising for a moment as it settles back to sleep after real use.

### New finding from the same test
That same `chrome://inspect` capture surfaced a smaller, real side effect of the v1.242.0 cooldown
(`GIVE_UP_COOLDOWN_MS`, previously 120s): the owner deliberately stepped on the scale a second time
about 2 minutes after the first weigh-in, to test a genuine back-to-back re-weigh. The first
weigh-in's post-use settling advertisement had already triggered one bounded retry cycle that gave
up and started the 2-minute cooldown — and the owner's second, genuine weigh-in landed inside that
window. Several wake attempts were logged as `cooldown active (Ns left) — ignoring wake`, and even
once the cooldown expired, the resulting cycle logged `weigh-in timeout after 30s — no stable
reading` instead of catching the real reading. The second weigh-in was silently missed.

### Why shortening the cooldown is safe
Asked and answered directly: is there real harm in a shorter cooldown, now that the *actual*
dangerous failure mode (an unbounded, indefinite loop) was independently fixed at the scan-receiver
level in #929? No — the cooldown's only remaining job is avoiding a couple of wasteful, immediate
back-to-back retry cycles while the scale is still naturally settling after real use; each of those
cycles is capped at 2 attempts and self-terminates in well under a minute regardless of the
cooldown length. A too-short cooldown costs at most one or two extra bounded cycles during that
narrow settling window — never an unbounded loop. Cut `GIVE_UP_COOLDOWN_MS` from 120s to 20s.

### Also added: a plain success notification
Separately requested: some confirmation that a weigh-in was actually logged. Previously, a normal
successful reading (valid impedance, no multi-user anomaly) produced no lasting notification at
all — the transient "Weigh-in captured — syncing…" foreground notification just disappeared the
moment the service stopped. Added `notifyWeighInLogged()` (new `scale-ble-logged` channel,
`IMPORTANCE_LOW`, auto-cancel, one-shot) — fires in the `else` branch of the existing
pending/composition-skipped notification dispatch in `postWeighIn()`, so it never double-fires
alongside those. Shows "X.X kg logged", or "— additional reading today" when
`isAdditionalReadingToday` is true (a same-day reading that didn't set the trend).

### Version bump
1.243.2 (patch — bug fix + small notification addition).

### Not yet confirmed
Compile-reviewed only, same as every native change this session — no Android SDK/Bluetooth
hardware in this sandbox. Needs the owner to rebuild and re-run the same back-to-back-weigh-in
test to confirm the second reading is caught this time, and confirm the new "logged" notification
actually appears after a normal weigh-in.
