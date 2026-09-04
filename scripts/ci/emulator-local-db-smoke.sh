#!/usr/bin/env bash
# Q-250. Runs INSIDE the emulator action (adb is available, the device is booted).
#
# Asserts the one thing no other check in this repo can: that the local SQLite migrations actually
# apply on a real Android SQLite. Two production incidents came from migrations that were fine
# everywhere except there — a WAL pragma inside the upgrade transaction (#27) and a non-idempotent
# ADD COLUMN that rolled back the whole version (#85). Both left every local read returning empty.
#
# The assertion is PRAGMA user_version read off the device, not a log line. A log can be emitted by
# code that then fails; user_version is the database's own record of which upgrade actually
# committed. sqlite-service.ts stamps it, so it is the same value the app trusts on next open.
set -euo pipefail

PKG='com.trainingai.app'
APK='android/app/build/outputs/apk/debug/app-debug.apk'

# The expected version comes from the source, not a constant duplicated here — a hardcoded number
# would silently stop matching the day someone adds a migration, which is exactly the change this
# job exists to check.
EXPECTED=$(node -e "
  const s = require('fs').readFileSync('lib/sqlite/migrations.ts', 'utf8');
  const v = [...s.matchAll(/toVersion:\s*(\d+)/g)].map(m => +m[1]);
  if (!v.length) { console.error('no toVersion found in migrations.ts'); process.exit(1); }
  console.log(Math.max(...v));
")
echo "Expecting local SQLite schema version ${EXPECTED}"

echo '--- reachability, part 1: a shell probe if the image happens to carry one ---'
adb wait-for-device
# 10.0.2.2 is the emulator's alias for the host loopback. If the hop is broken the WebView shows an
# error page, no form is ever drawn, and the failure reads as a UI-automation problem eight minutes
# later — which is exactly how runs 1-4 were misread.
#
# This stays ADVISORY on purpose, and that is a change of role rather than a repeat of the old bug:
# it used to be the only reachability check and it never once confirmed the hop, so "could not
# confirm" was silently equivalent to "reachable". The assertion is now part 2 below, which needs no
# binary that may be missing; this is kept only because when a probe IS present it names the failure
# in one line instead of via a log grep.
#
# Any HTTP status counts as reachable — `/` redirects to /sign-in, which proves the hop works.
# Deliberately not /api/version: it awaits an outbound GitHub Releases call before responding, so
# it can time out against a perfectly healthy server.
PROBE_RESULT='no probe binary on this image'
for probe in \
  'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://10.0.2.2:3000/' \
  'toybox wget -q -O /dev/null http://10.0.2.2:3000/ && echo 200' \
  'echo | toybox nc -w 3 10.0.2.2 3000 >/dev/null && echo 200'
do
  OUT=$(adb shell "$probe" 2>&1 | tr -d '\r' | tail -1 || true)
  case "$OUT" in
    [1-5][0-9][0-9]) PROBE_RESULT="reachable (HTTP $OUT)"; break ;;
  esac
done
echo "shell probe: $PROBE_RESULT"
# The job's verdict is written to a file as it is decided, not left to be grepped back out of
# interleaved stdout. The final workflow step prints this, so reading the diagnosis costs a
# five-line log tail instead of the several hundred that capped this investigation before.
echo "shell probe: $PROBE_RESULT" > /tmp/q250-verdict.txt

echo '--- install ---'
adb install -r -g "$APK"

echo '--- reachability, part 2: the WebView itself, which is the probe that cannot be missing ---'
# The app IS the reachability test, and it is the only one guaranteed to exist on the image. If the
# WebView cannot fetch the document from the host alias, Chromium logs a net:: error and Capacitor
# renders an error page; neither is distinguishable from "Maestro cannot read text in a WebView"
# once the flow has already timed out, which is the ambiguity that capped this investigation.
# Launching alone first — before Maestro, whose `clearState: true` relaunches anyway — separates the
# two candidates cleanly and costs one app start.
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 20
adb logcat -d > /tmp/logcat-launch.txt 2>&1 || true

NET_ERR=$(grep -oE 'net::ERR_[A-Z_]+' /tmp/logcat-launch.txt | sort -u | tr '\n' ' ' || true)
if [ -n "$NET_ERR" ]; then
  echo "candidate (b): the emulator could not reach the host — ${NET_ERR}" >> /tmp/q250-verdict.txt
  echo "FAIL: the WebView could not load from http://10.0.2.2:3000 — ${NET_ERR}"
  echo 'The emulator cannot reach the host server, so no form is ever drawn. This is a host/emulator'
  echo 'networking failure, NOT a Maestro or accessibility problem — do not chase the UI flow.'
  echo "shell probe said: $PROBE_RESULT"
  echo '--- log tail ---'
  grep -iE 'chromium|capacitor|trainingai|net::' /tmp/logcat-launch.txt | tail -40 || tail -40 /tmp/logcat-launch.txt
  exit 1
fi
echo 'no net:: errors after launch — the WebView reached the host'
echo 'reachability: OK, the WebView loaded from the host' >> /tmp/q250-verdict.txt

# "No net:: error" is weaker than it sounds, and the last run proved it matters: a hierarchy came
# back carrying no sign-in text, which is equally consistent with the WebView being opaque to the
# driver and with the page never having rendered the form. The server's own access log settles it —
# it records what the WebView actually asked for. Nothing else in this job can see that.
SIGNIN_HITS=$(grep -cE 'GET /sign-in|/sign-in ' /tmp/next-server.log 2>/dev/null || echo 0)
echo "server saw /sign-in requests: ${SIGNIN_HITS}" >> /tmp/q250-verdict.txt

echo '--- sign in, which is what makes the local store exist at all ---'
# `getLocalStore(userId)` requires a signed-in user, so an app sitting on the sign-in screen never
# creates a database and the poll below waits 90 s for a file that cannot appear. That is exactly
# how this job failed every run before Q-250's flow landed — steps 1-14 green, assertion impossible.
adb logcat -c
maestro test .maestro/sign-in.yaml --format junit --output /tmp/maestro-report.xml || {
  echo 'FAIL: the sign-in flow did not complete.'
  echo '--- maestro debug output ---'
  tail -60 ~/.maestro/tests/*/maestro.log 2>/dev/null || true
  # The remaining candidate once reachability is proven above: Maestro may not see inside the
  # WebView at all. The hierarchy says so directly — an empty or chrome-only tree means the fix is
  # `setWebContentsDebuggingEnabled(true)` plus web-view selectors, never a longer timeout. Reading
  # it from a log grep is guesswork; this prints the tree.
  echo '--- view hierarchy (is anything inside the WebView visible to Maestro?) ---'
  maestro hierarchy > /tmp/maestro-hierarchy.txt 2>&1 || true
  head -120 /tmp/maestro-hierarchy.txt || true
  echo "candidate (a): reachability passed and Maestro still could not find the form" >> /tmp/q250-verdict.txt
  echo "hierarchy bytes: $(wc -c < /tmp/maestro-hierarchy.txt 2>/dev/null || echo 0)" >> /tmp/q250-verdict.txt
  echo "sign-in text visible to Maestro: $(grep -ciE 'sign in|email|password' /tmp/maestro-hierarchy.txt 2>/dev/null || echo 0) matches" >> /tmp/q250-verdict.txt
  echo '--- app log tail ---'
  adb logcat -d > /tmp/logcat.txt 2>&1 || true
  grep -iE 'trainingai|chromium.*CONSOLE' /tmp/logcat.txt | tail -40 || tail -40 /tmp/logcat.txt
  exit 1
}

# The store opens after the remote document loads and JS runs; poll rather than sleeping a fixed
# span, so a fast run is fast and a slow one still passes.
DB_PATH=''
for i in $(seq 1 90); do
  FOUND=$(adb shell "run-as $PKG ls databases 2>/dev/null" | tr -d '\r' | grep -i 'trainingai.*\.db$' | head -1 || true)
  if [ -n "$FOUND" ]; then DB_PATH="databases/$FOUND"; echo "found $DB_PATH after ${i}s"; break; fi
  sleep 1
done

adb logcat -d > /tmp/logcat.txt 2>&1 || true

if [ -z "$DB_PATH" ]; then
  echo 'FAIL: the app never created a local SQLite database.'
  echo '--- app log tail ---'
  grep -iE 'trainingai|initSQLite|reconcileSchema|sqlite|chromium.*CONSOLE' /tmp/logcat.txt | tail -60 || tail -60 /tmp/logcat.txt
  exit 1
fi

echo '--- pull the database and read its own version stamp ---'
adb shell "run-as $PKG cat $DB_PATH" > /tmp/pulled-local.db
if [ ! -s /tmp/pulled-local.db ]; then
  echo "FAIL: pulled database is empty ($DB_PATH)"
  exit 1
fi

ACTUAL=$(sqlite3 /tmp/pulled-local.db 'PRAGMA user_version;' | tr -d '[:space:]')
echo "PRAGMA user_version = ${ACTUAL:-<unreadable>}"

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "FAIL: local SQLite opened at version '${ACTUAL}', expected '${EXPECTED}'."
  echo 'A migration did not commit on real Android SQLite. This is the #27/#85 failure shape:'
  echo 'the upgrade transaction rolls back, the app falls back to a version-1 open, and every'
  echo 'local read returns empty on the device while every test and every fresh install passes.'
  echo '--- initSQLite / reconcileSchema log lines ---'
  grep -iE 'initSQLite|reconcileSchema|upgrade|CONSOLE' /tmp/logcat.txt | tail -40 || true
  echo '--- tables actually present ---'
  sqlite3 /tmp/pulled-local.db ".tables" || true
  exit 1
fi

echo '--- the upgrade path must also be clean, not merely arrived-at ---'
# reconcileSchema() is the safety net for a partially-applied upgrade. If it had to repair anything,
# the version above would still read correct while a migration was quietly broken — so a repair is
# a failure of the migration even though the end state looks right.
if grep -q 'added missing column' /tmp/logcat.txt 2>/dev/null; then
  echo 'FAIL: reconcileSchema repaired a column, so a migration did not apply cleanly.'
  grep 'added missing column' /tmp/logcat.txt | tail -20
  exit 1
fi
if grep -q 'version upgrade failed' /tmp/logcat.txt 2>/dev/null; then
  echo 'FAIL: the versioned upgrade threw and the service fell back to a version-1 open.'
  grep -A3 'version upgrade failed' /tmp/logcat.txt | tail -20
  exit 1
fi

TABLES=$(sqlite3 /tmp/pulled-local.db ".tables" | wc -w)
echo "PASS: local SQLite opened at version ${ACTUAL} with ${TABLES} tables, no reconcile repairs."
