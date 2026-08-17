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

echo '--- reachability: the emulator must see the host server ---'
adb wait-for-device
# 10.0.2.2 is the emulator's alias for the host loopback. If this fails the APK would fall back to
# an error page and never open the local DB, which would read as a migration failure.
#
# Any HTTP status counts as reachable — `/` redirects to /sign-in, which proves the hop works.
# Deliberately not /api/version: it awaits an outbound GitHub Releases call before responding, so
# it can time out against a perfectly healthy server.
adb shell 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://10.0.2.2:3000/' 2>/dev/null \
  | tr -d '\r' | grep -qE '^[1-5][0-9][0-9]$' \
  && echo 'host reachable from inside the emulator' \
  || echo 'WARN: could not confirm host reachability (curl may be absent from this image); continuing'

echo '--- install ---'
adb install -r -g "$APK"

echo '--- launch, and give the WebView time to boot and open the store ---'
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1

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
