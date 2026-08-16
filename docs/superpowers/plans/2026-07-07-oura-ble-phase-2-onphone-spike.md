# Oura Direct-BLE Phase 2 — On-Phone Auth + Persistence Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the proven Phase-0 ring protocol running inside the APK — a Kotlin Capacitor plugin + foreground service that scans, connects, authenticates against our Ring 5 with the key we own, streams live data (battery, accel, live-HR attempt), drains history event counts, and measures day-to-day reconnection UX — surfaced on an admin-gated debug screen so the owner can see live ring data on the S25.

**Architecture:** Native side = a `com.trainingai.app.oura` Kotlin package (pure protocol/auth objects + a GATT state machine + a `connectedDevice` foreground service) exposed through one Capacitor plugin `OuraBle`, registered in `MainActivity`. Web side = a guarded dynamic-import wrapper (`lib/oura-ble/plugin.ts`, same shape as `lib/activity/gps-tracking.ts`) + an admin-gated debug screen at `/admin/oura-ble`. No API routes, no DB writes, no sync domain — this is deliberately Phase 2 only: the decoder port (Phase 3), the `oura_raw_samples` offline-first domain (Phase 4) and our own analysis (Phase 5) are explicitly out of scope (see `2026-07-07-oura-direct-ble-phase-0-results.md` §5).

**Tech Stack:** Kotlin (new to the Android project — enabled in this plan), Android `BluetoothGatt` + `BluetoothLeScanner`, `javax.crypto` AES/ECB/PKCS5, Capacitor 8 plugin API, Next.js admin route, JUnit for the pure protocol/auth units.

**Source of truth for protocol bytes:** the `oura-native-ble` skill (`.claude/skills/oura-native-ble/SKILL.md`) for everything it documents concretely, and the **Rust source** of [`Th0rgal/open_oura`](https://github.com/Th0rgal/open_oura) for everything it doesn't (the skill itself says: source of truth is the Rust source, NOT the docs). Task 1 clones the repo and transcribes the handful of byte sequences we need that our docs don't carry. **Never invent protocol bytes.**

**Key Phase-0 lessons this plan bakes in** (results doc §3): no OS-level *service-UUID* scan filter (D1/D2 — use manufacturer-ID `0x02b2` and name filters instead, and log which one matched); match by name, never by address (RE2 — the ring rotates its RPA every ~1–2 min); patient scan loop, the ring only advertises when worn+moving (RE4); back off hard after repeated failures — a wedged radio recovers only via its firmware watchdog, retries don't help (RE6); single bond slot (RE7); verify Android's bonding behaviour on insufficient-authentication and record it (RE8); persist the deciseconds cursor (RE9); **send SyncTime before anything stateful** (RE10 — also the top hypothesis for the live-HR 0-beats mystery); keep decode pure/infallible (RE11).

**Deployment coupling (important):** the APK is a WebView loading the Railway URL (`capacitor.config.ts` `server.url`), so the JS half ships by merging to `main`, but the native half requires the owner to rebuild + reinstall the APK (`pnpm cap:sync` equivalent: `npx cap sync android && cd android && ./gradlew assembleDebug`). The JS wrapper must therefore degrade gracefully when the plugin is missing (older APK) *and* when running in a plain browser.

---

## File Structure

| File | Responsibility |
|---|---|
| `android/build.gradle` (modify) | Add Kotlin Gradle plugin classpath |
| `android/app/build.gradle` (modify) | Apply `kotlin-android`, set `jvmTarget` |
| `android/app/src/main/AndroidManifest.xml` (modify) | BLE runtime permissions + foreground-service declaration |
| `android/app/src/main/java/com/trainingai/app/oura/OuraAuth.kt` (create) | Pure: AES/ECB/PKCS5 nonce encryption + key-hex parsing |
| `android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt` (create) | Pure: UUIDs, command builders, frame parser, response recognisers |
| `android/app/src/main/java/com/trainingai/app/oura/OuraGattClient.kt` (create) | GATT state machine: scan → connect → MTU → subscribe-all → auth → ready |
| `android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt` (create) | Foreground service: persistence loop, backoff/wedge policy, metrics, log buffer |
| `android/app/src/main/java/com/trainingai/app/oura/OuraBlePlugin.kt` (create) | Capacitor plugin: key mgmt, service control, commands, event bridge to JS |
| `android/app/src/main/java/com/trainingai/app/MainActivity.java` (modify) | `registerPlugin(OuraBlePlugin.class)` |
| `android/app/src/test/java/com/trainingai/app/oura/OuraAuthTest.kt` (create) | JUnit: AES vector tests |
| `android/app/src/test/java/com/trainingai/app/oura/OuraProtocolTest.kt` (create) | JUnit: builder/parser byte tests |
| `lib/oura-ble/plugin.ts` (create) | Typed guarded wrapper (`getOuraBle()`), graceful degradation |
| `components/oura-ble/oura-ble-debug.tsx` (create) | Debug screen orchestrator (client component) |
| `components/oura-ble/log-console.tsx` (create) | Memoised scrolling log view |
| `app/admin/oura-ble/page.tsx` (create) | Admin-gated route wrapping the debug screen |
| `docs/module-map.md` (modify) | One-line row for the new module |
| `docs/implementation-backlog.md` (modify) | Remove this item's queue entry on completion |
| `package.json` + `lib/changelog.ts` (modify) | Minor version bump (new user-visible admin screen) |

Everything under `android/.../oura/` has zero dependencies on the rest of the app. `OuraAuth`/`OuraProtocol` are pure JVM (unit-testable without a device); only `OuraGattClient`/`OuraRingService`/`OuraBlePlugin` touch Android APIs.

---

### Task 1: Clone the porting reference and transcribe the undocumented byte sequences

The skill documents most commands concretely (§5), but four things must come from the Rust source. Do this FIRST so later tasks have real bytes.

**Files:**
- Reference only (nothing committed): clone into the session scratchpad, NOT the repo.

- [ ] **Step 1: Clone open_oura into the scratchpad**

```bash
git clone --depth 1 https://github.com/Th0rgal/open_oura "$SCRATCHPAD/open_oura"
```

(Use the session scratchpad directory; never commit this clone or any part of it.)

- [ ] **Step 2: Locate and record the four undocumented items**

Record each finding (file, function, exact bytes/offsets) in a scratch note — they feed Tasks 3, 5 and 6:

```bash
cd "$SCRATCHPAD/open_oura"
grep -rn "req_set_feature_mode\|feature_mode" crates/oura-protocol/src/ | head -30
grep -rn "fn live_heart_rate" crates/oura-link/src/client.rs
grep -rn "battery" crates/oura-protocol/src/ crates/oura-link/src/client.rs | head -20
grep -rn "0x10\|get_history\|req_.*history\|events_request" crates/oura-protocol/src/ | head -30
grep -rn "accel" crates/oura-link/src/client.rs | head -10
```

1. **`req_set_feature_mode` wire format** — the exact bytes to put a feature (DAYTIME_HR `0x02`, SPO2 `0x04`) into `CONNECTED_LIVE`. Needed for the live-HR attempt.
2. **Battery response layout** — which payload byte is percent, which is the charging flag, in the `0d 06 …` response.
3. **History request + completion layout** — confirm the `10 09 <u32 LE cursor> 08 ff ff ff ff` guess from the cheatsheet, and where `bytes_left` sits in the `11 08 …` completion packet (and whether Ring 5 uses the extended `0x2f` sync path after GET_CAPABILITIES — see `docs/sync-orchestration.md` in the clone).
4. **The live-HR and accel call sequences** — the ordered list of commands `OuraClient::live_heart_rate` and the accel stream send around the actual streaming (mode changes, feature mode set/restore), so our Kotlin replays the same sequence.

- [ ] **Step 3: Sanity-check the documented commands against the same source**

Diff the skill §5 table (firmware `08 03 00 00 00`, serial `18 03 08 00 10`, battery `0c 00`, SyncTime `12 09 <u64> 00`, notifications `1c 01 3f`, nonce `2f 01 2b`, auth `2f 11 2d`, BLE fast-HR `16 01 01`) against the Rust request builders. Where they disagree, **the Rust source wins** — note any delta for the skill-correction commit in Task 12.

No commit for this task (nothing in the repo changes).

---

### Task 2: Enable Kotlin in the Android build

**Files:**
- Modify: `android/build.gradle`
- Modify: `android/app/build.gradle`

- [ ] **Step 1: Add the Kotlin Gradle plugin to the buildscript classpath**

In `android/build.gradle`, inside `buildscript { dependencies { … } }`, after the existing `com.google.gms:google-services` line:

```gradle
        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20'
```

- [ ] **Step 2: Apply the plugin in the app module**

In `android/app/build.gradle`, directly after `apply plugin: 'com.android.application'`:

```gradle
apply plugin: 'kotlin-android'
```

and inside the `android { … }` block (after `buildTypes`):

```gradle
    kotlinOptions {
        jvmTarget = '21'
    }
```

(`capacitor.build.gradle` already sets Java source/target compatibility to 21 — the Kotlin jvmTarget must match. Do NOT edit `capacitor.build.gradle`; it is regenerated by `cap sync`.)

- [ ] **Step 3: Verify the toolchain**

```bash
cd android && ./gradlew :app:compileDebugKotlin --console=plain
```

Expected: `BUILD SUCCESSFUL` (no Kotlin sources yet — this proves plugin resolution + JDK 21). The sandbox has JDK 21 and a proxy-configured truststore, so the first run downloading the Gradle distribution + Kotlin artifacts through the proxy is expected to work but slow (minutes). If the sandbox genuinely cannot complete the download, mark this step **owner-verified** in the PR description and continue — the pure-Kotlin tasks still get written TDD-style and the owner runs the gradle gate locally before building the APK.

- [ ] **Step 4: Commit**

```bash
git add android/build.gradle android/app/build.gradle
git commit -m "build(android): enable Kotlin for the Oura BLE plugin"
```

---

### Task 3: `OuraAuth` — AES nonce encryption (pure, TDD)

**Files:**
- Create: `android/app/src/main/java/com/trainingai/app/oura/OuraAuth.kt`
- Test: `android/app/src/test/java/com/trainingai/app/oura/OuraAuthTest.kt`

- [ ] **Step 1: Write the failing test**

The two vectors below were generated with an independent implementation (Node `crypto`, AES-128-ECB, PKCS7): they lock our Kotlin crypto to a known-good reference, not to itself.

```kotlin
package com.trainingai.app.oura

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OuraAuthTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun encryptsNonceToKnownVector() {
        val key = OuraAuth.parseKeyHex("000102030405060708090a0b0c0d0e0f")!!
        val nonce = ByteArray(15) { it.toByte() }
        val out = OuraAuth.encryptNonce(key, nonce)
        assertEquals(16, out.size)
        assertEquals("b61e6af8da7260d2214369b951bf8963", hex(out))
    }

    @Test fun differentKeyDifferentCiphertext() {
        val key = OuraAuth.parseKeyHex("ffeeddccbbaa99887766554433221100")!!
        val nonce = ByteArray(15) { it.toByte() }
        assertEquals("4a5972df95370770e136fd68179510d1", hex(OuraAuth.encryptNonce(key, nonce)))
    }

    @Test fun parseKeyHexRejectsBadInput() {
        assertNull(OuraAuth.parseKeyHex("zz"))
        assertNull(OuraAuth.parseKeyHex("00010203"))                       // too short
        assertNull(OuraAuth.parseKeyHex("000102030405060708090a0b0c0d0e0f00")) // too long
        assertEquals(16, OuraAuth.parseKeyHex("  000102030405060708090A0B0C0D0E0F ")!!.size) // trims + case-insensitive
    }
}
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.trainingai.app.oura.OuraAuthTest" --console=plain
```

Expected: FAIL — `Unresolved reference: OuraAuth`.

- [ ] **Step 3: Implement**

```kotlin
package com.trainingai.app.oura

import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/** Per-connection ring auth crypto (skill §4): the ring sends a 15-byte nonce;
 *  we return it encrypted with our 16-byte key using AES/ECB/PKCS5Padding
 *  (15 bytes pad to exactly one 16-byte block). */
object OuraAuth {
    fun encryptNonce(key: ByteArray, nonce: ByteArray): ByteArray {
        require(key.size == 16) { "key must be 16 bytes" }
        require(nonce.size == 15) { "nonce must be 15 bytes" }
        val cipher = Cipher.getInstance("AES/ECB/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        return cipher.doFinal(nonce)
    }

    /** 32 hex chars → 16 bytes (the open_oura key.hex format); null if malformed. */
    fun parseKeyHex(hex: String): ByteArray? {
        val clean = hex.trim().lowercase()
        if (!Regex("^[0-9a-f]{32}$").matches(clean)) return null
        return ByteArray(16) { clean.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Same command as Step 2. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/OuraAuth.kt android/app/src/test/java/com/trainingai/app/oura/OuraAuthTest.kt
git commit -m "feat(oura-ble): AES/ECB nonce auth crypto with reference vectors"
```

---

### Task 4: `OuraProtocol` — command builders + frame parser (pure, TDD)

**Files:**
- Create: `android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt`
- Test: `android/app/src/test/java/com/trainingai/app/oura/OuraProtocolTest.kt`

- [ ] **Step 1: Write the failing tests**

```kotlin
package com.trainingai.app.oura

import org.junit.Assert.*
import org.junit.Test

class OuraProtocolTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun documentedCommandBytes() {
        assertEquals("2f012b", hex(OuraProtocol.reqNonce()))
        assertEquals("0c00", hex(OuraProtocol.reqBattery()))
        assertEquals("0803000000", hex(OuraProtocol.reqFirmwareVersion()))
        assertEquals("1803080010", hex(OuraProtocol.reqSerialNumber()))
        assertEquals("1c013f", hex(OuraProtocol.reqEnableAllNotifications()))
        assertEquals("160101", hex(OuraProtocol.reqBleFastHrMode(true)))
        assertEquals("160100", hex(OuraProtocol.reqBleFastHrMode(false)))
    }

    @Test fun authenticateWrapsEncryptedNonce() {
        val enc = ByteArray(16) { 0xAA.toByte() }
        val req = OuraProtocol.reqAuthenticate(enc)
        assertEquals("2f112d" + "aa".repeat(16), hex(req))
    }

    @Test fun syncTimeIsLittleEndianU64WithTrailingZero() {
        // 0x0102030405060708 LE = 08 07 06 05 04 03 02 01
        val req = OuraProtocol.reqSyncTime(0x0102030405060708L)
        assertEquals("1209" + "0807060504030201" + "00", hex(req))
    }

    @Test fun parsesSimpleFrame() {
        val f = OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x02, 0x55, 0x01))!!
        assertEquals(0x0d, f.tag)
        assertNull(f.subOp)
        assertEquals("5501", hex(f.payload))
    }

    @Test fun parsesExtendedFrameWithSubOp() {
        // nonce response: 2f 10 2c <15 bytes>
        val raw = byteArrayOf(0x2f, 0x10, 0x2c) + ByteArray(15) { it.toByte() }
        val f = OuraProtocol.parseFrame(raw)!!
        assertEquals(0x2f, f.tag)
        assertEquals(0x2c, f.subOp)
        assertTrue(OuraProtocol.isNonceResponse(f))
        assertEquals(15, OuraProtocol.nonceFrom(f).size)
        assertEquals(0x00, OuraProtocol.nonceFrom(f)[0].toInt())
        assertEquals(0x0e, OuraProtocol.nonceFrom(f)[14].toInt())
    }

    @Test fun recognisesAuthResult() {
        val ok = OuraProtocol.parseFrame(byteArrayOf(0x2f, 0x02, 0x2e, 0x00))!!
        val bad = OuraProtocol.parseFrame(byteArrayOf(0x2f, 0x02, 0x2e, 0x01))!!
        assertTrue(OuraProtocol.authSucceeded(ok))
        assertFalse(OuraProtocol.authSucceeded(bad))
    }

    @Test fun malformedFramesReturnNull() {
        assertNull(OuraProtocol.parseFrame(byteArrayOf()))
        assertNull(OuraProtocol.parseFrame(byteArrayOf(0x0d)))
        assertNull(OuraProtocol.parseFrame(byteArrayOf(0x0d, 0x05, 0x01))) // declared len > actual
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.trainingai.app.oura.OuraProtocolTest" --console=plain
```

Expected: FAIL — unresolved references.

- [ ] **Step 3: Implement**

```kotlin
package com.trainingai.app.oura

import java.util.UUID

/** Wire protocol for the Oura Ring (skill §2–§5 + open_oura's oura-protocol crate).
 *  Pure — no Android imports — so every builder/parser is unit-testable on the JVM.
 *  Frames are tag–length–payload, multi-byte integers little-endian; extended ops
 *  use outer tag 0x2f with the first payload byte as the sub-op. */
object OuraProtocol {
    val RING_SERVICE: UUID = UUID.fromString("98ed0001-a541-11e4-b6a0-0002a5d5c51b")
    val WRITE_CHAR: UUID = UUID.fromString("98ed0002-a541-11e4-b6a0-0002a5d5c51b")
    val NOTIFY_CHAR: UUID = UUID.fromString("98ed0003-a541-11e4-b6a0-0002a5d5c51b")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val MANUFACTURER_ID = 0x02b2
    const val PREFERRED_MTU = 247 // Ring 5 (skill §2)

    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    fun reqNonce() = bytes(0x2f, 0x01, 0x2b)
    fun reqAuthenticate(encryptedNonce: ByteArray): ByteArray {
        require(encryptedNonce.size == 16)
        return bytes(0x2f, 0x11, 0x2d) + encryptedNonce
    }
    fun reqBattery() = bytes(0x0c, 0x00)
    fun reqFirmwareVersion() = bytes(0x08, 0x03, 0x00, 0x00, 0x00)
    fun reqSerialNumber() = bytes(0x18, 0x03, 0x08, 0x00, 0x10)
    fun reqEnableAllNotifications() = bytes(0x1c, 0x01, 0x3f)
    fun reqBleFastHrMode(fast: Boolean) = bytes(0x16, 0x01, if (fast) 0x01 else 0x00)

    /** SyncTime `12 09 <u64 LE UTC seconds> 00` — MUST precede any stateful op (RE10). */
    fun reqSyncTime(utcSeconds: Long): ByteArray {
        val out = ByteArray(11)
        out[0] = 0x12; out[1] = 0x09
        for (i in 0 until 8) out[2 + i] = ((utcSeconds ushr (8 * i)) and 0xff).toByte()
        out[10] = 0x00
        return out
    }

    data class Frame(val tag: Int, val subOp: Int?, val payload: ByteArray)

    /** One notification → one frame; null on malformed input (infallible-decoder rule, RE11). */
    fun parseFrame(raw: ByteArray): Frame? {
        if (raw.size < 2) return null
        val tag = raw[0].toInt() and 0xff
        val len = raw[1].toInt() and 0xff
        if (raw.size < 2 + len) return null
        val payload = raw.copyOfRange(2, 2 + len)
        val subOp = if (tag == 0x2f && payload.isNotEmpty()) payload[0].toInt() and 0xff else null
        return Frame(tag, subOp, payload)
    }

    fun isNonceResponse(f: Frame) = f.tag == 0x2f && f.subOp == 0x2c && f.payload.size >= 16
    fun nonceFrom(f: Frame): ByteArray = f.payload.copyOfRange(1, 16)
    fun authSucceeded(f: Frame) =
        f.tag == 0x2f && f.subOp == 0x2e && f.payload.size >= 2 && f.payload[1].toInt() == 0x00
}
```

- [ ] **Step 4: Run the tests — expect PASS (7 tests)**

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt android/app/src/test/java/com/trainingai/app/oura/OuraProtocolTest.kt
git commit -m "feat(oura-ble): pure protocol builders and frame parser"
```

---

### Task 5: Source-ported builders — feature mode, battery parse, history drain

This task transcribes the Task-1 findings into `OuraProtocol` **with tests that pin the transcription**. The code below shows the *shape*; the byte constants marked `⟨from Rust⟩` must be the values recorded in Task 1 — if the cheatsheet guess in a comment disagrees with the Rust source, the Rust source wins and the comment is updated.

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt`
- Modify: `android/app/src/test/java/com/trainingai/app/oura/OuraProtocolTest.kt`

- [ ] **Step 1: Add the transcribed builders + parsers to `OuraProtocol`**

```kotlin
    // ---- transcribed from open_oura crates/oura-protocol (Task 1) ----

    object FeatureId { const val DAYTIME_HR = 0x02; const val SPO2 = 0x04 }
    object FeatureMode { const val OFF = 0; const val AUTOMATIC = 1; const val REQUESTED = 2; const val CONNECTED_LIVE = 3 }
    // NOTE: the mode enum *values* above are placeholders for the real ones — read the
    // Rust `feature_mode` module constants in Task 1 and transcribe the actual numeric
    // values + the request wire format here before use.

    fun reqSetFeatureMode(featureId: Int, mode: Int): ByteArray =
        bytes(/* ⟨from Rust: req_set_feature_mode⟩ */)

    fun reqFeatureStatus(featureId: Int): ByteArray = bytes(0x2f, 0x02, 0x20, featureId)

    /** GetHistory — cheatsheet shows `10 09 00 00 00 00 08 ff ff ff ff` with cursor 0;
     *  confirm the cursor is the leading u32 LE against the Rust request builder. */
    fun reqGetHistory(cursorDeciseconds: Long): ByteArray {
        val out = ByteArray(11)
        out[0] = 0x10; out[1] = 0x09
        for (i in 0 until 4) out[2 + i] = ((cursorDeciseconds ushr (8 * i)) and 0xff).toByte()
        out[6] = 0x08
        for (i in 7..10) out[i] = 0xff.toByte()
        return out
    }

    data class Battery(val percent: Int, val charging: Boolean)
    /** Battery response `0d 06 …` — percent/charging offsets ⟨from Rust⟩. */
    fun parseBattery(f: Frame): Battery? {
        if (f.tag != 0x0d || f.payload.isEmpty()) return null
        return Battery(f.payload[0].toInt() and 0xff, /* charging flag offset ⟨from Rust⟩ */ false)
    }

    data class HistoryCompletion(val bytesLeft: Long)
    /** Completion `11 08 …` — bytes_left offset/width ⟨from Rust⟩. */
    fun parseHistoryCompletion(f: Frame): HistoryCompletion? { /* ⟨from Rust⟩ */ return null }
```

- [ ] **Step 2: Pin each transcription with a test**

For every transcribed builder, add a test asserting the exact hex the Rust builder produces for the same inputs (compute the expected bytes by reading the Rust code, or by running the Rust unit tests/`cargo test` in the clone if the sandbox toolchain allows). Example shape:

```kotlin
    @Test fun setFeatureModeMatchesRustBuilder() {
        // expected hex derived from crates/oura-protocol req_set_feature_mode(DAYTIME_HR, CONNECTED_LIVE)
        assertEquals("<hex from Rust>", hex(OuraProtocol.reqSetFeatureMode(OuraProtocol.FeatureId.DAYTIME_HR, OuraProtocol.FeatureMode.CONNECTED_LIVE)))
    }
```

Also record (as a code comment on `liveHrSequence` below) the ordered command sequence `OuraClient::live_heart_rate` and the accel stream use, and expose them:

```kotlin
    /** Ordered command sequence replayed for live HR, exactly as open_oura's
     *  OuraClient::live_heart_rate does it (Task 1 finding #4). */
    fun liveHrStartSequence(): List<ByteArray> = listOf(/* ⟨from Rust⟩ */)
    fun liveHrStopSequence(): List<ByteArray> = listOf(/* ⟨from Rust⟩ */)
    fun accelStartSequence(): List<ByteArray> = listOf(/* ⟨from Rust⟩ */)
    fun accelStopSequence(): List<ByteArray> = listOf(/* ⟨from Rust⟩ */)
```

- [ ] **Step 3: Run all protocol tests — expect PASS**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.trainingai.app.oura.*" --console=plain
```

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/ android/app/src/test/java/com/trainingai/app/oura/
git commit -m "feat(oura-ble): feature-mode, battery and history builders ported from oura-protocol"
```

---

### Task 6: Manifest — BLE permissions + foreground service

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add permissions**

After the existing `FOREGROUND_SERVICE_LOCATION` permission line:

```xml
    <!-- Oura Ring direct BLE (Phase 2 spike) -->
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
```

(`neverForLocation` is correct: we never derive location from BLE, and it exempts the scan from needing location permission on Android 12+. Legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` maxSdk entries are unnecessary — minSdk 26 but the only real device is the S25 on a current Android; if the owner ever sideloads on the old S8 the plugin will simply report permission-denied.)

- [ ] **Step 2: Declare the service** (inside `<application>`, after the `<provider>` element):

```xml
        <service
            android:name=".oura.OuraRingService"
            android:foregroundServiceType="connectedDevice"
            android:exported="false" />
```

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml
git commit -m "feat(oura-ble): BLE permissions and connected-device foreground service declaration"
```

---

### Task 7: `OuraGattClient` — scan/connect/auth state machine

**Files:**
- Create: `android/app/src/main/java/com/trainingai/app/oura/OuraGattClient.kt`

No unit test (Android BLE APIs aren't mockable without heavy scaffolding; this class is exercised on-device — that's the whole point of the spike). Keep ALL protocol logic in the pure objects; this class only sequences GATT operations.

- [ ] **Step 1: Implement**

```kotlin
package com.trainingai.app.oura

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.ArrayDeque

/** One scan→connect→auth lifecycle against the ring. Owned and restarted by
 *  OuraRingService; reports everything through the listener so the service can
 *  apply the backoff/wedge policy and the plugin can mirror it to JS.
 *
 *  Phase-0 lessons applied here: scan by manufacturer id 0x02b2 + name prefix,
 *  NEVER by address (RE2) and never with an OS service-UUID filter (D1/D2);
 *  request MTU 247; subscribe every notify/indicate characteristic in the ring
 *  service; auth per connection; on INSUFFICIENT_AUTHENTICATION try createBond()
 *  once and record what happened (RE8). */
@SuppressLint("MissingPermission") // service checks BLUETOOTH_SCAN/CONNECT before starting
class OuraGattClient(
    private val context: Context,
    private val key: ByteArray,
    private val listener: Listener,
) {
    interface Listener {
        fun onLog(line: String)
        fun onState(state: State)
        fun onReady()
        fun onFrame(frame: OuraProtocol.Frame, raw: ByteArray)
        fun onFailure(reason: String)   // terminal for this attempt — service decides on retry
    }

    enum class State { IDLE, SCANNING, CONNECTING, PREPARING, AUTHENTICATING, READY, CLOSED }

    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var state = State.IDLE
    private var bondAttempted = false

    // GATT allows one outstanding operation; queue descriptor + characteristic writes.
    private val opQueue = ArrayDeque<() -> Unit>()
    private var opInFlight = false

    private fun setState(s: State) { state = s; listener.onState(s) }
    private fun log(msg: String) = listener.onLog(msg)

    private fun enqueue(op: () -> Unit) { opQueue.add(op); pump() }
    private fun pump() {
        if (opInFlight) return
        val op = opQueue.poll() ?: return
        opInFlight = true
        op()
    }
    private fun opDone() { opInFlight = false; pump() }

    // ---- scan ----

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val name = result.scanRecord?.deviceName ?: result.device.name
            val mfr = result.scanRecord?.getManufacturerSpecificData(OuraProtocol.MANUFACTURER_ID)
            log("scan hit: name=$name rssi=${result.rssi} mfrMatch=${mfr != null}")
            stopScan()
            connect(result.device)
        }
        override fun onScanFailed(errorCode: Int) {
            listener.onFailure("scan failed: code=$errorCode")
        }
    }

    fun start(scanTimeoutMs: Long) {
        setState(State.SCANNING)
        val scanner = manager.adapter?.bluetoothLeScanner
            ?: return listener.onFailure("bluetooth adapter unavailable")
        // D1/D2 lesson: no service-UUID filter. Manufacturer-id filter keeps the scan
        // legal with the screen off; name filter is the belt-and-braces second match.
        val filters = listOf(
            ScanFilter.Builder().setManufacturerData(OuraProtocol.MANUFACTURER_ID, byteArrayOf(), byteArrayOf()).build(),
            ScanFilter.Builder().setDeviceName("Oura Ring 5").build(),
        )
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        log("scanning (mfr 0x02b2 + name filters, ${scanTimeoutMs / 1000}s window)…")
        scanner.startScan(filters, settings, scanCallback)
        main.postDelayed(scanTimeoutRunnable, scanTimeoutMs)
    }

    private val scanTimeoutRunnable = Runnable {
        if (state == State.SCANNING) {
            stopScan()
            listener.onFailure("scan timeout — ring not advertising (worn + moving wakes it, RE4)")
        }
    }

    private fun stopScan() {
        main.removeCallbacks(scanTimeoutRunnable)
        try { manager.adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
    }

    // ---- connect / prepare / auth ----

    private fun connect(device: BluetoothDevice) {
        setState(State.CONNECTING)
        log("connecting to ${device.address} (bondState=${device.bondState})")
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    @Suppress("DEPRECATION") // legacy write API works on all API levels incl. the S25; spike-appropriate
    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            log("connectionStateChange status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                setState(State.PREPARING)
                g.requestMtu(OuraProtocol.PREFERRED_MTU)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val wasReady = state == State.READY
                close()
                listener.onFailure(if (wasReady) "link dropped (status=$status)" else "connect failed (status=$status)")
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            log("mtu=$mtu status=$status")
            g.discoverServices()
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val service = g.getService(OuraProtocol.RING_SERVICE)
                ?: return listener.onFailure("ring service missing after discovery")
            writeChar = service.getCharacteristic(OuraProtocol.WRITE_CHAR)
            // Subscribe EVERY notify/indicate characteristic in the service (skill §2 —
            // Ring 5's 0004/0005/0006 roles are uncharacterised; subscribe them all).
            for (ch in service.characteristics) {
                val props = ch.properties
                val notify = props and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
                val indicate = props and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
                if (!notify && !indicate) continue
                enqueue {
                    g.setCharacteristicNotification(ch, true)
                    val cccd = ch.getDescriptor(OuraProtocol.CCCD) ?: run { opDone(); return@enqueue }
                    cccd.value = if (notify) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                 else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    if (!g.writeDescriptor(cccd)) { log("writeDescriptor(${ch.uuid}) rejected"); opDone() }
                }
            }
            enqueue { opDone(); startAuth() }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (status == 5 /* GATT_INSUFFICIENT_AUTHENTICATION */ || status == 8 || status == 137) {
                // RE8: record whether Android auto-bonds or we must createBond() ourselves.
                log("RE8: CCCD write insufficient-auth (status=$status), bondAttempted=$bondAttempted")
                if (!bondAttempted) {
                    bondAttempted = true
                    log("RE8: calling createBond(); service will retry the connection after bonding")
                    g.device.createBond()
                }
                close()
                listener.onFailure("insufficient authentication — bonding initiated")
                return
            }
            if (status != BluetoothGatt.GATT_SUCCESS) log("descriptor write status=$status on ${d.characteristic.uuid}")
            opDone()
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) log("characteristic write status=$status")
            opDone()
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            val raw = c.value ?: return
            val frame = OuraProtocol.parseFrame(raw)
            if (frame == null) { log("unparsed notification: ${raw.joinToString("") { "%02x".format(it) }}"); return }
            handleFrame(frame, raw)
        }
    }

    private fun startAuth() {
        setState(State.AUTHENTICATING)
        log("auth: requesting nonce")
        write(OuraProtocol.reqNonce())
    }

    private fun handleFrame(frame: OuraProtocol.Frame, raw: ByteArray) {
        if (state == State.AUTHENTICATING && OuraProtocol.isNonceResponse(frame)) {
            log("auth: nonce received, sending encrypted response")
            write(OuraProtocol.reqAuthenticate(OuraAuth.encryptNonce(key, OuraProtocol.nonceFrom(frame))))
            return
        }
        if (state == State.AUTHENTICATING && frame.tag == 0x2f && frame.subOp == 0x2e) {
            if (OuraProtocol.authSucceeded(frame)) {
                setState(State.READY)
                log("auth: SUCCESS")
                listener.onReady()
            } else {
                listener.onFailure("auth REJECTED — wrong key?")
                close()
            }
            return
        }
        listener.onFrame(frame, raw)
    }

    /** Serialised write of one command frame to the ring. */
    @Suppress("DEPRECATION")
    fun write(command: ByteArray) {
        val g = gatt ?: return
        val ch = writeChar ?: return
        enqueue {
            ch.value = command
            ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            if (!g.writeCharacteristic(ch)) { log("writeCharacteristic rejected"); opDone() }
        }
    }

    fun close() {
        stopScan()
        opQueue.clear(); opInFlight = false
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        gatt = null
        if (state != State.CLOSED) setState(State.CLOSED)
    }
}
```

- [ ] **Step 2: Compile**

```bash
cd android && ./gradlew :app:compileDebugKotlin --console=plain
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/OuraGattClient.kt
git commit -m "feat(oura-ble): GATT scan/connect/subscribe/auth state machine"
```

---

### Task 8: `OuraRingService` — foreground persistence loop + metrics

**Files:**
- Create: `android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt`

- [ ] **Step 1: Implement**

```kotlin
package com.trainingai.app.oura

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque

/** Holds the persistent ring connection and measures the thing Phase 2 exists to
 *  answer: what reconnection UX looks like over a real day. Patient scan loop with
 *  backoff (RE4), hard cool-down after consecutive failures because a wedged radio
 *  only recovers by itself (RE6). All observations go to a timestamped ring-buffer
 *  log + a metrics object the plugin exposes to the debug screen. */
class OuraRingService : Service(), OuraGattClient.Listener {

    companion object {
        @Volatile var instance: OuraRingService? = null
        /** Set by the plugin so service events reach JS without a bound connection. */
        @Volatile var eventSink: ((type: String, data: JSONObject) -> Unit)? = null
        private val BACKOFF_MS = longArrayOf(5_000, 10_000, 30_000, 60_000, 120_000, 300_000)
        private const val WEDGE_FAILURES = 6           // RE6: stop hammering after this many
        private const val WEDGE_COOLDOWN_MS = 900_000L // 15 min — let the firmware watchdog work
        private const val SCAN_WINDOW_MS = 90_000L     // RE4: long patient window
        private const val KEEPALIVE_MS = 300_000L      // battery poll proves the link is alive
        private const val CHANNEL_ID = "oura-ble"
    }

    private val main = Handler(Looper.getMainLooper())
    private var client: OuraGattClient? = null
    private var key: ByteArray? = null
    private var consecutiveFailures = 0
    private var stopped = false

    // -- metrics (the Phase-2 deliverable) --
    private var serviceStartedAt = 0L
    private var connectAttemptStartedAt = 0L
    private var connectedAt = 0L
    private var connectCount = 0
    private var dropCount = 0
    private var lastTimeToConnectMs = 0L
    private var totalConnectedMs = 0L
    private var battery: Int? = null
    private var state = "idle"

    private val logBuffer = ArrayDeque<String>()
    private fun log(line: String) {
        val stamped = "${System.currentTimeMillis()} $line"
        synchronized(logBuffer) { logBuffer.add(stamped); if (logBuffer.size > 1000) logBuffer.poll() }
        eventSink?.invoke("ouraLog", JSONObject().put("line", stamped))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        serviceStartedAt = SystemClock.elapsedRealtime()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val keyHex = getSharedPreferences("oura_ble", MODE_PRIVATE).getString("key_hex", null)
        key = keyHex?.let { OuraAuth.parseKeyHex(it) }
        if (key == null) { log("no key stored — stopping"); stopSelf(); return START_NOT_STICKY }
        startInForeground("Connecting to ring…")
        stopped = false
        log("service started")
        attemptConnection()
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        client?.close(); client = null
        instance = null
        log("service destroyed")
        super.onDestroy()
    }

    private fun startInForeground(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Oura Ring", NotificationManager.IMPORTANCE_LOW))
        }
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("TrainingAI · Oura Ring")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(2001, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(2001, notification)
        }
    }

    private fun updateNotification(text: String) = startInForeground(text)

    private fun attemptConnection() {
        if (stopped) return
        val k = key ?: return
        connectAttemptStartedAt = SystemClock.elapsedRealtime()
        client?.close()
        client = OuraGattClient(this, k, this).also { it.start(SCAN_WINDOW_MS) }
    }

    private fun scheduleRetry() {
        if (stopped) return
        val delay = if (consecutiveFailures >= WEDGE_FAILURES) {
            log("RE6 wedge guard: $consecutiveFailures consecutive failures — cooling down ${WEDGE_COOLDOWN_MS / 60000} min")
            WEDGE_COOLDOWN_MS
        } else {
            BACKOFF_MS[minOf(consecutiveFailures, BACKOFF_MS.size - 1)]
        }
        updateNotification("Ring unreachable — retrying in ${delay / 1000}s")
        main.postDelayed({ attemptConnection() }, delay)
    }

    private val keepalive = object : Runnable {
        override fun run() {
            if (state == "ready") { client?.write(OuraProtocol.reqBattery()); main.postDelayed(this, KEEPALIVE_MS) }
        }
    }

    // ---- OuraGattClient.Listener ----

    override fun onLog(line: String) = log(line)

    override fun onState(s: OuraGattClient.State) {
        state = s.name.lowercase()
        emitStatus()
    }

    override fun onReady() {
        connectCount++
        consecutiveFailures = 0
        connectedAt = SystemClock.elapsedRealtime()
        lastTimeToConnectMs = connectedAt - connectAttemptStartedAt
        state = "ready"
        log("READY in ${lastTimeToConnectMs}ms (connect #$connectCount)")
        updateNotification("Connected · auth OK")
        // RE10: SyncTime first, then enable notifications, then battery.
        client?.write(OuraProtocol.reqSyncTime(System.currentTimeMillis() / 1000))
        client?.write(OuraProtocol.reqEnableAllNotifications())
        client?.write(OuraProtocol.reqBattery())
        main.postDelayed(keepalive, KEEPALIVE_MS)
        emitStatus()
    }

    override fun onFrame(frame: OuraProtocol.Frame, raw: ByteArray) {
        OuraProtocol.parseBattery(frame)?.let {
            battery = it.percent
            updateNotification("Connected · ${it.percent}% battery")
        }
        val hex = raw.joinToString("") { "%02x".format(it) }
        eventSink?.invoke("ouraFrame", JSONObject()
            .put("tag", frame.tag).put("subOp", frame.subOp ?: JSONObject.NULL).put("hex", hex))
        emitStatus()
    }

    override fun onFailure(reason: String) {
        if (state == "ready") {
            dropCount++
            totalConnectedMs += SystemClock.elapsedRealtime() - connectedAt
            log("DROP #$dropCount: $reason")
        } else {
            log("attempt failed: $reason")
        }
        consecutiveFailures++
        state = "disconnected"
        main.removeCallbacks(keepalive)
        emitStatus()
        scheduleRetry()
    }

    // ---- plugin surface ----

    fun sendCommand(command: ByteArray): Boolean {
        if (state != "ready") return false
        client?.write(command); return true
    }

    fun status(): JSONObject = JSONObject()
        .put("state", state)
        .put("battery", battery ?: JSONObject.NULL)
        .put("connectCount", connectCount)
        .put("dropCount", dropCount)
        .put("lastTimeToConnectMs", lastTimeToConnectMs)
        .put("totalConnectedMs", totalConnectedMs +
            if (state == "ready") SystemClock.elapsedRealtime() - connectedAt else 0)
        .put("serviceUptimeMs", SystemClock.elapsedRealtime() - serviceStartedAt)
        .put("consecutiveFailures", consecutiveFailures)

    fun logSnapshot(): JSONArray {
        val arr = JSONArray()
        synchronized(logBuffer) { logBuffer.forEach { arr.put(it) } }
        return arr
    }

    private fun emitStatus() { eventSink?.invoke("ouraStatus", status()) }
}
```

- [ ] **Step 2: Compile** (`./gradlew :app:compileDebugKotlin`) — expect `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt
git commit -m "feat(oura-ble): foreground service with reconnect backoff, wedge guard and metrics"
```

---

### Task 9: `OuraBlePlugin` — the Capacitor bridge + registration

**Files:**
- Create: `android/app/src/main/java/com/trainingai/app/oura/OuraBlePlugin.kt`
- Modify: `android/app/src/main/java/com/trainingai/app/MainActivity.java`

- [ ] **Step 1: Implement the plugin**

```kotlin
package com.trainingai.app.oura

import android.Manifest
import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

@CapacitorPlugin(
    name = "OuraBle",
    permissions = [Permission(
        alias = "bluetooth",
        strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT],
    )],
)
class OuraBlePlugin : Plugin() {

    override fun load() {
        OuraRingService.eventSink = { type, data ->
            notifyListeners(type, JSObject.fromJSONObject(data))
        }
    }

    private fun prefs() = context.getSharedPreferences("oura_ble", android.content.Context.MODE_PRIVATE)

    // ---- key management (the key never leaves SharedPreferences; never logged) ----

    @PluginMethod fun setKey(call: PluginCall) {
        val hex = call.getString("hex") ?: return call.reject("hex required")
        if (OuraAuth.parseKeyHex(hex) == null) return call.reject("key must be 32 hex chars")
        prefs().edit().putString("key_hex", hex.trim().lowercase()).apply()
        call.resolve()
    }

    @PluginMethod fun hasKey(call: PluginCall) =
        call.resolve(JSObject().put("hasKey", prefs().contains("key_hex")))

    @PluginMethod fun clearKey(call: PluginCall) {
        prefs().edit().remove("key_hex").apply(); call.resolve()
    }

    // ---- permissions ----

    @PluginMethod fun ensurePermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == com.getcapacitor.PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("bluetooth", call, "onBluetoothPermission")
        }
    }

    @PermissionCallback fun onBluetoothPermission(call: PluginCall) =
        call.resolve(JSObject().put("granted", getPermissionState("bluetooth") == com.getcapacitor.PermissionState.GRANTED))

    // ---- service control ----

    @PluginMethod fun startService(call: PluginCall) {
        if (!prefs().contains("key_hex")) return call.reject("no key stored")
        val intent = Intent(context, OuraRingService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        call.resolve()
    }

    @PluginMethod fun stopService(call: PluginCall) {
        context.stopService(Intent(context, OuraRingService::class.java))
        call.resolve()
    }

    @PluginMethod fun getStatus(call: PluginCall) {
        val svc = OuraRingService.instance
            ?: return call.resolve(JSObject().put("state", "stopped"))
        call.resolve(JSObject.fromJSONObject(svc.status()))
    }

    @PluginMethod fun getLog(call: PluginCall) {
        val svc = OuraRingService.instance
            ?: return call.resolve(JSObject().put("lines", com.getcapacitor.JSArray()))
        call.resolve(JSObject().put("lines", com.getcapacitor.JSArray.from(svc.logSnapshot())))
    }

    // ---- commands (all require state=ready; each returns {sent: boolean}) ----

    private fun send(call: PluginCall, command: ByteArray) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        call.resolve(JSObject().put("sent", svc.sendCommand(command)))
    }

    @PluginMethod fun readBattery(call: PluginCall) = send(call, OuraProtocol.reqBattery())
    @PluginMethod fun readInfo(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        svc.sendCommand(OuraProtocol.reqFirmwareVersion())
        svc.sendCommand(OuraProtocol.reqSerialNumber())
        call.resolve(JSObject().put("sent", true))
    }
    @PluginMethod fun syncTime(call: PluginCall) =
        send(call, OuraProtocol.reqSyncTime(System.currentTimeMillis() / 1000))

    @PluginMethod fun startLiveHr(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.liveHrStartSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }
    @PluginMethod fun stopLiveHr(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.liveHrStopSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }
    @PluginMethod fun startAccel(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.accelStartSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }
    @PluginMethod fun stopAccel(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        OuraProtocol.accelStopSequence().forEach { svc.sendCommand(it) }
        call.resolve()
    }

    /** History drain: sends GetHistory from the persisted deciseconds cursor (RE9).
     *  Raw frames stream to JS as ouraFrame events; the debug screen counts by tag. */
    @PluginMethod fun drainHistory(call: PluginCall) {
        val svc = OuraRingService.instance ?: return call.reject("service not running")
        val cursor = prefs().getLong("history_cursor_ds", 0L)
        call.resolve(JSObject().put("sent", svc.sendCommand(OuraProtocol.reqGetHistory(cursor))).put("cursor", cursor))
    }
}
```

(Cursor *advance* on the `0x11` completion packet: wire it in `OuraRingService.onFrame` once Task 5's `parseHistoryCompletion` has the real layout — on completion, write `max(seen ring_timestamp)+1` to `history_cursor_ds` in the same prefs, mirroring open_oura's `cursor+1 when events_received > 0` rule from skill §7.)

- [ ] **Step 2: Register in MainActivity**

In `MainActivity.java`, at the very top of `onCreate`, **before** `super.onCreate(savedInstanceState);`:

```java
        registerPlugin(com.trainingai.app.oura.OuraBlePlugin.class);
```

- [ ] **Step 3: Compile + run the full unit-test suite**

```bash
cd android && ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest --console=plain
```

Expected: `BUILD SUCCESSFUL`, all Oura tests pass.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/oura/OuraBlePlugin.kt android/app/src/main/java/com/trainingai/app/MainActivity.java
git commit -m "feat(oura-ble): Capacitor plugin bridging key mgmt, service control and ring commands"
```

---

### Task 10: JS wrapper — `lib/oura-ble/plugin.ts`

**Files:**
- Create: `lib/oura-ble/plugin.ts`

- [ ] **Step 1: Implement** (same guarded-dynamic-import shape as `lib/activity/gps-tracking.ts`):

```ts
import type { PluginListenerHandle } from '@capacitor/core'

export interface OuraBleStatus {
  state: 'stopped' | 'idle' | 'scanning' | 'connecting' | 'preparing' | 'authenticating' | 'ready' | 'closed' | 'disconnected'
  battery: number | null
  connectCount: number
  dropCount: number
  lastTimeToConnectMs: number
  totalConnectedMs: number
  serviceUptimeMs: number
  consecutiveFailures: number
}

export interface OuraFrameEvent { tag: number; subOp: number | null; hex: string }

export interface OuraBlePlugin {
  setKey(opts: { hex: string }): Promise<void>
  hasKey(): Promise<{ hasKey: boolean }>
  clearKey(): Promise<void>
  ensurePermissions(): Promise<{ granted: boolean }>
  startService(): Promise<void>
  stopService(): Promise<void>
  getStatus(): Promise<OuraBleStatus | { state: 'stopped' }>
  getLog(): Promise<{ lines: string[] }>
  readBattery(): Promise<{ sent: boolean }>
  readInfo(): Promise<{ sent: boolean }>
  syncTime(): Promise<{ sent: boolean }>
  startLiveHr(): Promise<void>
  stopLiveHr(): Promise<void>
  startAccel(): Promise<void>
  stopAccel(): Promise<void>
  drainHistory(): Promise<{ sent: boolean; cursor: number }>
  addListener(event: 'ouraLog', cb: (data: { line: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'ouraStatus', cb: (data: OuraBleStatus) => void): Promise<PluginListenerHandle>
  addListener(event: 'ouraFrame', cb: (data: OuraFrameEvent) => void): Promise<PluginListenerHandle>
}

/**
 * Returns the native OuraBle plugin, or null when unavailable: plain browser,
 * or an APK built before the plugin existed (the WebView JS ships from Railway
 * independently of the APK — the two can be out of step). Callers must render
 * an explicit unavailable state, never fail silently.
 */
export async function getOuraBle(): Promise<OuraBlePlugin | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    if (!Capacitor.isPluginAvailable('OuraBle')) return null
    return registerPlugin<OuraBlePlugin>('OuraBle')
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/oura-ble/plugin.ts
git commit -m "feat(oura-ble): typed guarded JS wrapper for the native plugin"
```

---

### Task 11: Debug screen — `/admin/oura-ble`

**Files:**
- Create: `components/oura-ble/log-console.tsx`
- Create: `components/oura-ble/oura-ble-debug.tsx`
- Create: `app/admin/oura-ble/page.tsx`

Conventions that apply (CLAUDE.md): theme tokens only (no hex literals, no `text-white`), Lucide icons, `pt-safe` on the full-screen header, real `<Button>` controls, files well under 800 lines, no `useState` lazy-initializer cache reads. This screen is native-only by nature — on web (`pnpm dev`) it must render a clear "native plugin unavailable" state, which is also the sandbox verification path.

- [ ] **Step 1: `log-console.tsx`**

```tsx
'use client'

import { memo, useEffect, useRef } from 'react'

export const LogConsole = memo(function LogConsole({ lines }: { lines: string[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto' }) }, [lines.length])
  return (
    <div className="h-64 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
      {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all">{l}</div>)}
      <div ref={endRef} />
    </div>
  )
})
```

- [ ] **Step 2: `oura-ble-debug.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Battery, Bluetooth, BluetoothOff, HeartPulse, History, KeyRound, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOuraBle, type OuraBlePlugin, type OuraBleStatus, type OuraFrameEvent } from '@/lib/oura-ble/plugin'
import { LogConsole } from './log-console'

type Availability = 'checking' | 'unavailable' | 'ready'

export function OuraBleDebug() {
  const pluginRef = useRef<OuraBlePlugin | null>(null)
  const [availability, setAvailability] = useState<Availability>('checking')
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [status, setStatus] = useState<OuraBleStatus | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({})
  const pendingLines = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    const handles: Array<{ remove: () => Promise<void> }> = []
    ;(async () => {
      const plugin = await getOuraBle()
      if (cancelled) return
      if (!plugin) { setAvailability('unavailable'); return }
      pluginRef.current = plugin
      setAvailability('ready')
      setHasKey((await plugin.hasKey()).hasKey)
      const s = await plugin.getStatus()
      if ('battery' in s) setStatus(s)
      const { lines: existing } = await plugin.getLog()
      setLines(existing)
      handles.push(await plugin.addListener('ouraLog', ({ line }) => { pendingLines.current.push(line) }))
      handles.push(await plugin.addListener('ouraStatus', (st) => setStatus(st)))
      handles.push(await plugin.addListener('ouraFrame', (f: OuraFrameEvent) => {
        setTagCounts((prev) => {
          const key = `0x${f.tag.toString(16).padStart(2, '0')}${f.subOp != null ? `/${f.subOp.toString(16)}` : ''}`
          return { ...prev, [key]: (prev[key] ?? 0) + 1 }
        })
      }))
    })()
    // Batch log lines into state at 4 Hz — frames can arrive at ~50 Hz during streams.
    const flush = setInterval(() => {
      if (pendingLines.current.length === 0) return
      const batch = pendingLines.current
      pendingLines.current = []
      setLines((prev) => [...prev, ...batch].slice(-500))
    }, 250)
    return () => {
      cancelled = true
      clearInterval(flush)
      handles.forEach((h) => { void h.remove() })
    }
  }, [])

  const withPlugin = useCallback(async (fn: (p: OuraBlePlugin) => Promise<unknown>) => {
    const p = pluginRef.current
    if (!p) return
    try { await fn(p) } catch (err) {
      setLines((prev) => [...prev, `ui error: ${err instanceof Error ? err.message : String(err)}`])
    }
  }, [])

  if (availability === 'checking') return <p className="text-sm text-muted-foreground">Checking native plugin…</p>
  if (availability === 'unavailable') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-4">
        <BluetoothOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Native OuraBle plugin unavailable. This screen only works in the APK — and only an APK
          built after the plugin was added (rebuild with <code>npx cap sync android</code> +{' '}
          <code>./gradlew assembleDebug</code>).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Key setup */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" /> Ring key</h2>
        {hasKey ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Key stored on device.</p>
            <Button variant="outline" size="sm" onClick={() => withPlugin(async (p) => { await p.clearKey(); setHasKey(false) })}>Clear</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="32-hex key from key.hex"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            />
            <Button size="sm" onClick={() => withPlugin(async (p) => { await p.setKey({ hex: keyInput }); setKeyInput(''); setHasKey(true) })}>Save</Button>
          </div>
        )}
      </section>

      {/* Connection + metrics */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium"><Bluetooth className="h-4 w-4" /> Connection</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!hasKey} onClick={() => withPlugin(async (p) => {
            const { granted } = await p.ensurePermissions()
            if (granted) await p.startService()
          })}><Play className="mr-1 h-4 w-4" /> Start service</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.stopService())}><Square className="mr-1 h-4 w-4" /> Stop</Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">State</dt><dd>{status?.state ?? 'stopped'}</dd>
          <dt className="text-muted-foreground">Battery</dt>
          <dd className="flex items-center gap-1"><Battery className="h-3.5 w-3.5" />{status?.battery != null ? `${status.battery}%` : '—'}</dd>
          <dt className="text-muted-foreground">Connects / drops</dt><dd>{status ? `${status.connectCount} / ${status.dropCount}` : '—'}</dd>
          <dt className="text-muted-foreground">Last time-to-connect</dt><dd>{status ? `${(status.lastTimeToConnectMs / 1000).toFixed(1)}s` : '—'}</dd>
          <dt className="text-muted-foreground">Connected total</dt><dd>{status ? `${Math.round(status.totalConnectedMs / 60000)}m of ${Math.round(status.serviceUptimeMs / 60000)}m` : '—'}</dd>
        </dl>
      </section>

      {/* Live data + history */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4" /> Live data</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.readBattery())}>Battery</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.readInfo())}>Info</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.syncTime())}>SyncTime</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.startAccel())}>Accel</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.stopAccel())}>Stop accel</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.startLiveHr())}><HeartPulse className="mr-1 h-4 w-4" /> Live HR</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.stopLiveHr())}>Stop HR</Button>
          <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.drainHistory())}><History className="mr-1 h-4 w-4" /> Drain history</Button>
        </div>
        {Object.keys(tagCounts).length > 0 && (
          <div className="text-xs text-muted-foreground">
            Frames by tag:{' '}
            {Object.entries(tagCounts).sort(([, a], [, b]) => b - a).map(([tag, n]) => `${tag}×${n}`).join(' · ')}
          </div>
        )}
      </section>

      {/* Log */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h2 className="text-sm font-medium">Log</h2>
        <LogConsole lines={lines} />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: `app/admin/oura-ble/page.tsx`** (mirror the `/admin` gate exactly):

```tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { OuraBleDebug } from '@/components/oura-ble/oura-ble-debug'
import { BottomNav } from '@/components/shell/bottom-nav'

export default async function OuraBlePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id)) redirect('/')

  return (
    <>
      <main className="pt-safe-or-4 mx-auto max-w-lg px-4 pb-24">
        <h1 className="mb-4 text-lg font-semibold">Oura Ring — direct BLE</h1>
        <OuraBleDebug />
      </main>
      <BottomNav isAdmin />
    </>
  )
}
```

Also add a link/entry to this page from the admin content screen (`app/admin/admin-content.tsx`) following whatever navigation pattern its existing tool sections use — a small "Oura BLE debug" entry with a `Bluetooth` Lucide icon.

- [ ] **Step 4: Verify in the web sandbox**

```bash
pnpm exec tsc --noEmit && pnpm lint
pnpm dev   # then load /admin/oura-ble as the admin test user
```

Expected: page renders the "Native OuraBle plugin unavailable" state with zero console errors. (Grant the seeded `test@local.dev` user admin via the local DB if needed — the session-208 journal shows the pattern — and remove the grant after.)

- [ ] **Step 5: Commit**

```bash
git add components/oura-ble/ app/admin/oura-ble/ app/admin/admin-content.tsx
git commit -m "feat(oura-ble): admin debug screen for the direct-BLE spike"
```

---

### Task 12: Full gate + bookkeeping

**Files:**
- Modify: `docs/module-map.md`, `docs/implementation-backlog.md`, `package.json`, `lib/changelog.ts`, `projectOverview.md`, `docs/overview/history-newest.md`, `.claude/skills/oura-native-ble/SKILL.md` (only if Task 1 Step 3 found doc/source deltas)

- [ ] **Step 1: Run the full gate**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd android && ./gradlew :app:testDebugUnitTest --console=plain
```

All green. (Gradle is NOT in CI — the Custom Rules check doesn't compile Kotlin — so the gradle run here, or by the owner locally, is the only compile gate for the native half. Say so in the PR description.)

- [ ] **Step 2: Module map row** — add to the Oura section of `docs/module-map.md`:

```markdown
| Oura direct-BLE (Phase 2 spike) | `lib/oura-ble/plugin.ts` + `android/.../oura/` (Kotlin plugin, foreground service) + `/admin/oura-ble` debug screen | Native ring connection: scan/auth/live-stream/history-drain; no DB writes yet (Phases 3–5 pending) |
```

- [ ] **Step 3: Backlog + journal + version**

- Remove this item's entry from the `docs/implementation-backlog.md` Queue (per the backlog protocol; annotate instead if partially done).
- Bump `package.json` minor + add a `lib/changelog.ts` entry ("Direct-BLE Oura debug screen (admin): connect to the ring natively, live data + connection metrics").
- Append the session journal entry to `docs/overview/history-newest.md` and update `projectOverview.md` (status + a Known-Issues row: **"Oura BLE plugin: NOT verified on device — pending owner APK rebuild + on-device spike protocol"** — the sandbox cannot exercise any of the native surface).

- [ ] **Step 4: Commit + push + PR**

```bash
git add -A && git commit -m "docs: module map, backlog, changelog and journal for the Oura BLE spike"
git push -u origin feat/oura-ble-phase2-spike
```

Open the PR, get CI green, then **ask for merge confirmation** (this is a code/deploy PR — the merge gate applies). State explicitly which failure surfaces were NOT exercised: everything native (BLE, foreground service, bonding, Samsung WebView) — the on-device protocol below is the real verification.

---

## On-device spike protocol (owner-run, after merge + APK rebuild)

The merge only ships the JS. The native half needs:

```bash
git pull origin main
npx cap sync android
cd android && ./gradlew assembleDebug   # then adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Then, on the S25 (ring charged, `key.hex` at hand):

1. **Key + permissions:** open `/admin/oura-ble`, paste the 32-hex key, Start service → grant the Bluetooth permission prompt. Expected notification: "Connecting to ring…".
2. **First connect + auth (the Kotlin-port go/no-go):** wear the ring and move your hand near the phone (RE4). Watch the log for `scan hit` → `auth: SUCCESS` → battery %. Record **time-to-first-connect**. If the log shows the RE8 insufficient-auth path, note whether Android auto-showed a pairing dialog or `createBond()` was needed — **record the answer in the Phase-2 results doc; this is an explicit Phase-0 open question.**
3. **Live data:** tap Accel (expect tag counts climbing ~50/s while moving the ring), then Battery/Info. Tap SyncTime, wait ~2 min worn and still, then Live HR for ≥60 s — this tests the RE10 hypothesis for the Phase-0 0-beats mystery. Either outcome is a finding; record it.
4. **History drain:** tap Drain history — expect a frame burst and the tag-count panel to mirror the Phase-0 distribution (`0x80`/temp/motion tags dominant). Run it twice: the second run should be near-empty (cursor advanced, RE9) once cursor-advance is wired.
5. **Persistence soak (the actual Phase-2 question):** leave the service running for 2–3 normal days (worn all day, phone in pocket, overnight on the finger). Check `/admin/oura-ble` a few times a day and record from the metrics panel: connects, drops, last time-to-connect, connected-minutes vs service-uptime. Watch for: Samsung battery-optimisation killing the service (whitelist the app in Settings → Battery if so — note it), the RE6 wedge guard triggering, and reconnect behaviour when walking away from the phone and back.
6. **Decision gate:** "does day-to-day reconnection feel acceptable worn normally?" Write the answer + all recorded numbers into `docs/superpowers/plans/2026-07-XX-oura-ble-phase-2-results.md` (docs-only PR, mirroring the Phase-0 results doc structure). **Go** → queue Phase 3 (decoder port — validate against the 7604-event `oura.db` corpus) via a planning session. **No-go** → the ring goes back to the official app (reversibility proven, results doc §7) and the direct-BLE track is parked with its findings recorded.

This soak also naturally collects the **overnight sleep/SpO₂** wear the separate overnight-validation backlog item wants (re-run the desktop `oura sync` for the decode check, or wait for Phase 3).

---

## Self-Review Notes

- **Spec coverage:** all six Phase-2 checklist boxes from the results doc §5 are covered — plugin scaffold (T9), auth port with the D1/D2 scan lesson (T3/T4/T7), RE8 bonding answer (T7 + on-device protocol step 2), one live value (battery, T8/T9), foreground-service persistence + metrics (T8 + protocol step 5), and the decision (protocol step 6). The plan adds live accel/HR and a raw history drain beyond the strict minimum because the user's stated goal is "see what live data will look like" — all reuse the same command plumbing, no extra architecture.
- **The `⟨from Rust⟩` markers in Task 5 are deliberate**, not placeholders-by-laziness: those bytes must come from the open_oura source per the skill's own source-of-truth rule, and Task 1 + Task 5 Step 2 make the transcription a concrete, test-pinned step. Everything our docs state concretely is written out in full.
- **Type consistency:** `OuraProtocol.Frame` is used by `OuraGattClient.Listener.onFrame`, `OuraRingService.onFrame`, and `parseBattery`/`parseHistoryCompletion`; JS `OuraBleStatus` mirrors `OuraRingService.status()` keys one-for-one; `getOuraBle()` return shape matches the debug screen's usage.
- **No cache/sync/DB surface touched**: no cache keys, no outbox domains, no migrations — the strict-rule checklists for those don't bite. The one CI caveat (Kotlin not compiled in CI) is called out in Task 12.
