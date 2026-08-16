# Oura Direct-BLE — Phase 0 Runbook (Kali + rooted Android)

> Companion to `2026-07-06-oura-direct-ble-feasibility.md`. This is the **cheap
> laptop-CLI proof** that must pass before any app code is written. It runs
> entirely on the owner's own hardware, next to the ring — **nothing here is
> hosted or run in the cloud; BLE is a local radio link by physics.** Tool:
> [`Th0rgal/open_oura`](https://github.com/Th0rgal/open_oura) (Rust CLI).
>
> **Tailored to (final):** a **Windows desktop with Bluetooth** (build `open_oura`
> natively via WinRT — see Step 0 Route A) using **Option A** for the key (reset the
> ring + `oura pair` to set our own — Step 4). The only rooted phone (a Galaxy S8) is
> **not** usable for key extraction: it isn't the phone the ring is synced with and is
> too old to run the current Oura app. No phone is needed on this path.

**Goal of Phase 0:** on the *actual* Ring 5 + its current firmware, prove that we
can (a) see it, (b) authenticate, (c) read live HR, (d) pull + decode the history
stream. Pass → green-light Phases 2+. Fail → stop, ~a day spent, no app code wasted.

---

## Step 0 — pick a host that can actually do BLE (read first)

**A plain Kali VM does NOT work for BLE** — the guest can't see the host's built-in
Bluetooth adapter, so BlueZ finds nothing. Choose one of these instead, cheapest
first:

| Option | What | When to pick |
|---|---|---|
| **1. Build on the host OS directly** | `open_oura`'s `btleplug` supports **macOS (CoreBluetooth)** and **Windows (WinRT)**, not just Linux. Install Rust on the host, build, use the built-in adapter — no VM at all. | Host is a **Mac** (best-trodden, README-supported) or **Windows** laptop with BT. Simplest path. |
| **2. Kali Live USB, bare-metal** | Boot the same Kali off a USB stick on the physical machine so BlueZ gets the real adapter. | Host is a **Linux/Windows** laptop with BT; you want to stay in Kali; zero extra hardware. |
| **3. VM + USB BLE dongle passthrough** | Buy a ~$10 CSR8510/RTL8761 USB-BT adapter, USB-passthrough it to the Kali guest (VirtualBox needs the Extension Pack). | You want to keep the existing VM. Reliable but needs the dongle. |
| **4. Rooted phone, partial proof** | `nRF Connect` app: scan/connect/inspect the Oura GATT service. Proves proximity + reachability but doesn't run the decoders. | Quick sanity check while sorting a real host; the phone does key extraction anyway. |
| **5. Raspberry Pi** | Built-in BT, native BlueZ; also a good always-on reader later. | You have one spare. |

### Chosen setup: Windows desktop with Bluetooth → two paths, no VM needed

- **Route A — native Windows build (recommended, no reboot).** `btleplug` uses WinRT
  on Windows 10+, so `open_oura` runs directly against the desktop's built-in BT:
  1. Install **Rust** — run `rustup-init.exe` from <https://rustup.rs>; when prompted,
     install the **MSVC C++ build tools** (Visual Studio "Desktop development with C++"
     workload, or the standalone Build Tools) — the Rust compiler needs the MSVC linker.
  2. Install **Git for Windows**.
  3. Ensure Bluetooth is **On** (Settings → Bluetooth & devices). On Windows 11, allow
     desktop apps to use Bluetooth if privacy settings block it.
  4. In PowerShell: `git clone https://github.com/Th0rgal/open_oura; cd open_oura;
     cargo build --release`, then `.\target\release\oura.exe scan`.
  - If scanning is flaky/empty under WinRT, don't fight it — switch to Route B.
- **Route B — Kali Live USB, bare-metal (reliable fallback).** Boot the same Kali off
  a USB stick on this desktop so BlueZ owns the real adapter; then follow the Linux
  steps below exactly. This is the best-tested `open_oura` path.
- **Free the ring first (both routes):** the ring allows one BLE central at a time, so
  **turn off Bluetooth on the phone / force-quit the Oura app** during testing, or the
  desktop won't be able to connect.

On **Route B (Linux)** verify the adapter is alive before anything else:

```bash
bluetoothctl show          # adapter present + Powered: yes
rfkill unblock bluetooth   # if soft-blocked
sudo systemctl status bluetooth
```

If `bluetoothctl show` lists no controller, fix that first — the rest can't work.

---

## Step 1 — system prep on Kali

```bash
sudo apt update
sudo apt install -y bluez libdbus-1-dev pkg-config build-essential git
# Rust toolchain (rustup):
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

`open_oura` uses `btleplug`, which on Linux talks to **BlueZ over DBus**. You may need
your user in the `bluetooth` group (or run the binary with `sudo` if scans return
empty due to permissions):

```bash
sudo usermod -aG bluetooth "$USER"   # re-login after this
```

---

## Step 2 — build the tool

```bash
git clone https://github.com/Th0rgal/open_oura
cd open_oura
cargo build --release
./target/release/oura --help          # confirm the subcommands are present
cat crates/README.md                  # authoritative per-command flags/syntax
```

The full subcommand set: `scan`, `pair`, `info`, `sync`, `latest`, `live-hr`,
`accel`, `viz`, `game`, `features`, `rdata`, `events`, `redecode`, `sleep-analyze`,
`sessions`. Exact flags live in `crates/README.md` and `--help` — trust those over
this doc for syntax, since the README only spells out `scan` and `info` verbatim.

---

## Step 3 — first no-key test: can we even see the ring?

`scan` needs **no auth key** — it just looks for the Oura manufacturer ID (`0x02b2`).
Wear or hold the ring near the machine (wake it — plug it on the charger briefly or
move it, the radio sleeps when idle):

```bash
./target/release/oura scan
```

**✅ Success:** the ring shows up in the scan list. This alone confirms adapter +
BlueZ + proximity are all working. If it doesn't appear: adapter/permission problem
(Step 0/1), or the ring's radio is asleep — put it on the charger and retry.

---

## Step 4 — get the 16-byte auth key (Option A: reset + own the key)

> **Chosen path for this setup.** Option B (extract the existing key from the paired
> phone) is **not viable here**: the only rooted phone is a Galaxy S8 that (a) is **not
> the phone the ring is synced with** — so it never held the key — and (b) is too old
> (Android 9) to reliably run the current Oura app. So we own the key instead via a
> reset. Confirmed acceptable by the owner: the ring will be temporarily disconnected
> from the official Oura app during the spike.

Everything past `scan` needs the ring's **16-byte auth key**. Since we can't extract
the existing one, we **reset the ring and set our own** key from the desktop with
`oura pair` (this is the `SetAuthKey` op `2410` documented in
`docs/android-app-reversing.md`).

**Before you reset — protect your history (do this first):**
- Your Oura history is **cloud-stored under your account, not on the ring** — a reset
  does not touch it, and re-onboarding later restores everything. **But** any data
  still buffered on the ring that hasn't synced yet **is** wiped by a reset.
- So: open the **official Oura app and let it fully sync** (confirm today's data is
  in), *then* reset. That guarantees zero loss.
- Understand the gap: while the ring is paired to `open_oura`, it does **not** feed
  Oura's cloud, so the spike period will be a hole in your Oura history. Pre-reset
  history is safe; normal syncing resumes when you re-onboard to the Oura app.

**Reset + pair (own the key):**
1. Fully sync in the official Oura app (above), then remove/unpair the ring there.
2. Factory-reset the ring so it accepts a new key. `open_oura` gates reset behind
   `--include-danger`; the exact reset + pair sequence is in `oura pair --help` /
   `crates/README.md` — follow those (the reset op is danger-gated for a reason).
3. Run `oura pair` from the desktop to establish a **known 16-byte key you choose**,
   and save it to `key.hex` (16 bytes = **32 hex characters**; match the byte-ordering
   the CLI expects per `crates/README.md`).

Because *you* set the key, there's no extraction, no Frida, no phone — the S8 is not
needed at all.

> **Reversibility:** nothing is bricked. To go back to normal Oura use, factory-reset
> the ring again and re-add it in the official Oura app; your account history is intact.

---

## Step 5 — the real proof: authenticate, live HR, history

With `key.hex` in hand:

```bash
# a) Authenticate + device info — proves the crypto handshake works
./target/release/oura --key-file key.hex info

# b) Live heart rate at rest — proves real-time read (sit still; finger PPG)
./target/release/oura --key-file key.hex live-hr

# c) Pull the history-event stream — the actual value proposition
./target/release/oura --key-file key.hex sync
./target/release/oura --key-file key.hex events     # decoded events
./target/release/oura --key-file key.hex rdata      # raw sample data
./target/release/oura --key-file key.hex accel      # motion, to sanity-check

# d) Their reimplemented analysis over YOUR data — the "own scores" reference
./target/release/oura --key-file key.hex sleep-analyze
./target/release/oura --key-file key.hex sessions
```

**✅ Phase 0 passes if:**
- `info` authenticates and prints device info (Ring 5, battery, firmware).
- `live-hr` streams a plausible resting BPM.
- `sync`/`events`/`rdata` pull and **decode** history without erroring, and the raw
  HR/IBI/temperature/motion values look sane for your ring (not garbage/zeros).
- `sleep-analyze` produces something recognisable vs what the Oura app shows.

The data lands in `open_oura`'s local SQLite (`oura-store`) — inspect it directly to
eyeball raw sample resolution, which is the whole reason we're doing this.

**Optional cross-check:** the Python bench can help explore/verify:
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python tools/oura_protocol.py --list
```

---

## Step 6 — decision gate (belongs to the user)

Record the outcome of each ✅ above. Then decide, *with* the evidence:

1. Did auth + history pull + decode work on **our** Ring 5 firmware? (If no →
   stop here; the whole project is blocked until the protocol is re-derived.)
2. **Option A vs B for the long term:** own the ring (drop the Cloud API) vs keep
   both (root + BLE contention). Phase 0 uses B read-only, but the *product* choice
   is a one-way door — see feasibility doc §7–8.
3. Appetite check: proven-possible ≠ worth-the-multi-week-Kotlin-port. Re-confirm the
   raw dataset is worth it vs "Cloud API + webhooks + a chest strap for live HR".

Only if Phase 0 is green **and** the decision is made does Phase 2 (Kotlin auth proof)
begin. Nothing in the app changes during Phase 0.

---

## Safety notes

- Phase 0 is **read-only** — stick to the passive commands above. `open_oura` gates
  `reset` / `factory-reset` / `dfu` / `flight-mode` behind explicit danger flags; do
  **not** pass `--include-state` / `--include-danger` during a read-only spike (a
  reset would invalidate your extracted key and disconnect the official app).
- The extracted `auth_key` is a credential — keep `key.hex` out of git (it's already
  in `open_oura`'s `.gitignore`) and off any shared machine.
- This is your own ring and your own data; it's outside Oura's ToS but a legitimate
  owner-only use. Named, not a blocker.
