#!/usr/bin/env bash
# #2849. Rehearses switch-over day (docs/runbooks/native-switch-over.md) on an EMULATOR, with the
# exact APKs the phone will get, in the order it gets them:
#
#   1. the installed app's own build (the Capacitor app, the stand-in for what is on the phone);
#   2. the native release over it with `adb install -r`, as the switch-over wrapper runs it;
#   3. a downgrade back to step 1's APK, which Android must refuse;
#   4. the rollback build (the Capacitor app with a higher versionCode) over the native app.
#
# After each install it checks the versionCode Android reports, that a marker file planted in the
# app's data folder at step 1 is still there (the property that keeps the outbox and the signed-in
# state through an upgrade), and that the app starts and keeps running without a crash.
#
# The emulator is offline (airplane mode): the APKs talk to production, and a rehearsal has no
# business there. Nothing is signed in, so no health data is ever on screen.
#
# Runs INSIDE .github/workflows/native-switch-rehearsal.yml's emulator step. Never point it at a
# phone: it installs a fresh copy of the app, which on the owner's phone would mean an uninstall
# had already happened. It never uninstalls, clears or downgrades with -d.
set -euo pipefail

PKG='com.trainingai.app'
: "${INSTALLED_APK:?}" "${NATIVE_APK:?}" "${INSTALLED_CODE:?}" "${NATIVE_CODE:?}" "${REHEARSAL_OUT:?}"
ROLLBACK_APK="${ROLLBACK_APK:-}"
ROLLBACK_CODE="${ROLLBACK_CODE:-}"
SETTLE="${REHEARSAL_SETTLE_SECONDS:-30}"
DATA="/data/data/$PKG"
MARKER="$DATA/files/switch-rehearsal-marker"
OUT="$REHEARSAL_OUT"
mkdir -p "$OUT"
: > "$OUT/summary.md"

failures=0
fail() { echo "::error::$*"; echo "- ❌ $*" >> "$OUT/summary.md"; failures=$((failures + 1)); }
pass() { echo "ok: $*"; echo "- ✅ $*" >> "$OUT/summary.md"; }
step() { echo; echo "=== $*"; printf '\n**%s**\n\n' "$*" >> "$OUT/summary.md"; }

# awk reads to the end, so nothing upstream dies of SIGPIPE under pipefail (head -1 would).
installed_code() {
  adb shell dumpsys package "$PKG" | awk 'match($0, /versionCode=[0-9]+/) { if (v == "") v = substr($0, RSTART + 12, RLENGTH - 12) } END { print v }'
}

expect_code() {
  local want=$1 got
  got=$(installed_code)
  if [ "$got" = "$want" ]; then pass "Android reports versionCode $got"; else fail "Android reports versionCode '$got', expected $want"; fi
}

# `adb install -r` prints "Success" or a failure code such as INSTALL_FAILED_UPDATE_INCOMPATIBLE.
install_r() {
  local apk=$1 label=$2 output
  output=$(adb install -r "$apk" 2>&1 || true)
  echo "$output" > "$OUT/$label-install.txt"
  if grep -q '^Success' <<< "$output"; then
    pass "adb install -r accepted the $label APK"
    return 0
  fi
  if grep -q 'INSTALL_FAILED_NO_MATCHING_ABIS' <<< "$output"; then
    fail "the $label APK has no code for this emulator's CPU (arm64-only build on an image without ARM translation). Try another api_level; this is the emulator, not the APK"
  else
    fail "adb install -r refused the $label APK: $(grep -m1 -o 'INSTALL_[A-Z_]*' <<< "$output" || echo "$output" | tail -1)"
  fi
  return 1
}

marker_present() {
  if adb shell "test -f '$MARKER'"; then pass "the app's data folder survived ($1)"; else fail "the marker in the app's data folder is gone ($1): the install wiped the app's data"; fi
}

# Starts the app from its launcher icon, waits, and checks it is still running and wrote nothing to
# the crash log. Saves a screenshot and the device log for the artifact.
launch_check() {
  local label=$1 pid crashes
  adb logcat -c || true
  adb logcat -b crash -c || true
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1 || true
  sleep "$SETTLE"
  pid=$(adb shell pidof "$PKG" | tr -d '\r' || true)
  adb exec-out screencap -p > "$OUT/$label.png" 2> /dev/null || true
  adb logcat -d > "$OUT/$label-logcat.txt" 2> /dev/null || true
  crashes=$(adb logcat -b crash -d 2> /dev/null | grep -c "$PKG" || true)
  if [ "${crashes:-0}" -gt 0 ]; then
    adb logcat -b crash -d > "$OUT/$label-crash.txt" 2> /dev/null || true
    fail "the $label app crashed on start (see $label-crash.txt)"
  elif [ -z "$pid" ]; then
    fail "the $label app is not running ${SETTLE}s after start"
  else
    pass "the $label app started and was still running after ${SETTLE}s"
  fi
  adb shell am force-stop "$PKG" || true
}

list_data() {
  adb shell "ls -la '$DATA' '$DATA/files' '$DATA/databases' '$DATA/shared_prefs' 2>/dev/null" > "$OUT/$1-data-folder.txt" || true
}

adb wait-for-device
# Root, to plant and read the marker inside the app's private folder. The google_apis images allow it.
adb root > /dev/null
sleep 3
adb wait-for-device
adb shell cmd connectivity airplane-mode enable > /dev/null 2>&1 || adb shell settings put global airplane_mode_on 1
if [ "$(adb shell settings get global airplane_mode_on | tr -d '\r')" = "1" ]; then pass "the emulator is offline"; else fail "could not turn on airplane mode"; fi

if adb shell pm path "$PKG" > /dev/null 2>&1; then
  fail "$PKG is already on this emulator; the rehearsal needs a fresh one"
  exit 1
fi

step "1. The installed app's build ($INSTALLED_CODE)"
output=$(adb install "$INSTALLED_APK" 2>&1 || true)
echo "$output" > "$OUT/installed-install.txt"
if grep -q '^Success' <<< "$output"; then pass "installed the stand-in for the app on the phone"; else fail "could not install the stand-in: $(echo "$output" | tail -1)"; exit 1; fi
expect_code "$INSTALLED_CODE"
launch_check installed
adb shell "mkdir -p '$DATA/files' && echo rehearsal > '$MARKER'"
marker_present "planted"
list_data installed

step "2. The native release over it, with adb install -r ($NATIVE_CODE)"
if install_r "$NATIVE_APK" native; then
  expect_code "$NATIVE_CODE"
  marker_present "after the native install"
  launch_check native
  list_data native
fi

step "3. A downgrade back to the old build is refused"
output=$(adb install -r "$INSTALLED_APK" 2>&1 || true)
echo "$output" > "$OUT/downgrade-install.txt"
if grep -q 'INSTALL_FAILED_VERSION_DOWNGRADE' <<< "$output"; then
  pass "Android refused the downgrade (INSTALL_FAILED_VERSION_DOWNGRADE), as the runbook expects"
else
  fail "the downgrade was not refused as expected: $(echo "$output" | tail -1)"
fi
expect_code "$NATIVE_CODE"
marker_present "after the refused downgrade"

if [ -n "$ROLLBACK_APK" ]; then
  step "4. The rollback build over the native app ($ROLLBACK_CODE)"
  if install_r "$ROLLBACK_APK" rollback; then
    expect_code "$ROLLBACK_CODE"
    marker_present "after the rollback"
    launch_check rollback
    list_data rollback
  fi
else
  step "4. Rollback: skipped (no rollback APK given)"
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "Rehearsal: $failures check(s) failed."
  exit 1
fi
echo "Rehearsal: every check passed."
