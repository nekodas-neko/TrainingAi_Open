# 2026-09-03 — plan the ring's background sync, and decide not to port the decoders

Branch `plan/colmi-background-service` · docs only · PR 1 of 2 (planning)

## Why now

In-app auto-sync shipped in v1.395.1 and closed the evening gap that had cost two days of stress
data. It is still not enough, and the measurement is unambiguous: on 2026-09-02 the last reading was
**11:45** and the owner checked at **17:59**. Six hours missing, because the app had not been opened.
HRV, stress, SpO₂ and temperature are offered by the ring for the **current day only**, so those six
hours would have gone at midnight rather than back-filling.

A second wearer will not open the app on our schedule, which is what actually blocks handing the
ring over — more than any unvalidated metric.

## The decision the plan exists to record

`OuraRingService` is 2,208 lines of Kotlin, and most of that is protocol and decoders. Copying its
shape is the obvious build and it is the wrong one.

**Three of this week's Colmi defects were decoder defects** — the ten-hour heart-rate anchor, the
dropped continuation packets, the sleep frame's junk tail. Each was fixed **once**, in TypeScript,
and applied **retroactively** by re-reading `colmi_raw_frames`. A Kotlin copy makes every one of
those a double fix, gated on an APK install, with the phone's copy silently older than the server's
in between.

So: Kotlin carries bytes, the server reads them. Kotlin gets the ~10 command builders — small,
already written, each pinned to the same test vector as its TypeScript twin — and nothing else.
~400 lines against ~1,500.

## Three stages, and the first needs no Android

**A** moves decode server-side. `/api/colmi/samples` already accepts and stores `rawFrames`; it
gains the decode, proven by replaying the ~90 archived frames and asserting the readings match what
the client produced for those same syncs. JS only, reversible, and a mistake is repairable by
re-decoding rather than by re-wearing the ring.

**B** is the Kotlin transport service. Auth reuses the WebView cookie exactly as `OuraRingService`
does — no new secret, and it fails closed when logged out.

**C** is cadence: periodic ~2 h plus one guaranteed evening sync, because midnight is when the
current-day metrics are discarded.

## Two hazards written into the plan rather than rediscovered

A BLE peripheral takes one connection, so the service must share a lock with the in-app sync rather
than fight it — the owner already hit this with the scale, and it presents as *ring not found*
rather than *busy*. And Samsung does not honour `autoConnect = true`, proven on the Oura at
v1.116.4.

## Scope held deliberately narrow

The plan does not put the ring's data on any screen. Learning-mode isolation stands, and wiring the
ring into scoring waits on the H10 session — daytime heart rate still correlates at r = 0.08.
