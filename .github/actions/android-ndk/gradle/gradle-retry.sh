#!/usr/bin/env bash
# Runs a Gradle command and retries it, ONLY when its log shows a dependency or plugin could not be
# downloaded or resolved. Installed as $RUNNER_TEMP/gradle-retry.sh by the action beside it (#4025, #4118).
#
#   GRADLE_RETRY_WAITS  seconds to wait before each retry, space-separated; the number of waits is the number
#                       of retries. Default "60": one retry after a minute (what every caller had before).
#                       The pull-request compile check passes "60 180 300" (#4118): Maven Central's 429 can
#                       outlast one minute.
#
# Two kinds of download are recognised. Gradle's own (a dependency or plugin it fetches: "Could not GET ...
# Received status code 429"). And Robolectric's, which a unit test makes at TEST time with its own client, into
# ~/.m2 (`MavenArtifactFetcher`): there the failing tests ARE the download failure, so it is recognised by its own
# two-part text, "Failed to fetch maven artifact" together with "Server returned HTTP response code: 429|5xx for
# URL: https://repo...", and only when EVERY failed test in the log failed on that fetch. A test that merely prints
# an HTTP status, or a fetch failure next to a genuine assertion failure, is a code result (#4157).
#
# Anything that is not a failed download is never retried and is the job's own result, and it wins over every
# download pattern in the same log: a compile error (`e: ...`, `X.java:12: error:`), a project that cannot be
# resolved (`Could not resolve project :x`, a configuration mistake that only looks like a download word), and a
# failing test (`There were failing tests`) each say so in their log. A retry can only repeat the same command, so
# it can never turn a failing test into a pass; at worst it costs one more attempt. When the last attempt failed
# for one of those reasons the script says which in one `::error::` line, and after a failed download it says the
# repository did not answer, so a red job names its cause either way.
# Wrap only a Gradle build or test with it, never a signing or publishing step.
read -r -a waits <<< "${GRADLE_RETRY_WAITS:-60}"
download='Could not (GET|HEAD) |Received status code (429|5[0-9]{2}) from server|was not found in any of the following sources|could not resolve plugin artifact|Could not resolve |Could not download '
robolectric_fetch='Failed to fetch maven artifact'
robolectric_status='Server returned HTTP response code: (429|5[0-9]{2}) for URL: https?://'
compile_error='^e: |\.java:[0-9]+: error:|Compilation error'
project_error='Could not resolve project |Project with path .* could not be found'
test_failed='There were failing tests'

log="$(mktemp)"
attempt=1
total=$(( ${#waits[@]} + 1 ))
"$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}

# Prints "fetch" when the log has failed tests and every one of them failed on Robolectric's artifact fetch,
# "other" when one failed for any other reason, and "none" when no failed test can be read from it. A failed test is
# a `Class > name FAILED` line and the lines under it up to the next blank line.
failed_tests() {
  awk '
    /^[^ >].* > .* FAILED$/ { if (inblock && !fetch) other++; inblock = 1; fetch = 0; n++; next }
    inblock && /^[[:space:]]*$/ { if (!fetch) other++; inblock = 0; next }
    inblock && /Failed to fetch maven artifact/ { fetch = 1 }
    END { if (inblock && !fetch) other++; print (n == 0 ? "none" : (other > 0 ? "other" : "fetch")) }
  ' "$log"
}
# Why a failed run is not a download, one phrase; empty when it is not recognised as anything else.
not_a_download() {
  if grep -qE "$compile_error" "$log"; then echo "a compile error"
  elif grep -qE "$project_error" "$log"; then echo "a project that could not be resolved"
  elif grep -qE "$robolectric_fetch" "$log" && grep -qE "$robolectric_status" "$log" && [ "$(failed_tests)" = fetch ]; then return 0
  elif grep -qE "$test_failed" "$log"; then echo "a failing test"
  fi
}
download_failed() {
  [ -z "$(not_a_download)" ] || return 1
  grep -qE "$robolectric_fetch" "$log" && grep -qE "$robolectric_status" "$log" && [ "$(failed_tests)" = fetch ] && return 0
  grep -qE "$download" "$log"
}
while [ "$rc" -ne 0 ] && download_failed; do
  if [ "$attempt" -ge "$total" ]; then
    echo "::error::The dependency download failed on all $total attempts: Maven Central (or another repository) did not answer, or answered 429 or 5xx. This is the download, not the code under test; re-run the job."
    break
  fi
  wait="${waits[$((attempt - 1))]}"
  echo "::warning::A dependency or plugin could not be downloaded or resolved (attempt $attempt of $total); trying again in $wait seconds."
  sleep "$wait"
  attempt=$((attempt + 1))
  "$@" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
done
if [ "$rc" -ne 0 ]; then
  why="$(not_a_download)"
  [ -n "$why" ] && echo "::error::The build failed on $why, not on a dependency download; it was not retried."
fi
# What the last attempt downloaded from a remote repository: 0 means the restored cache served everything (#4118).
echo "::notice::Gradle downloaded $(grep -cE '^Download https?://' "$log" || true) artifact(s) from remote repositories in the last attempt."
exit "$rc"
