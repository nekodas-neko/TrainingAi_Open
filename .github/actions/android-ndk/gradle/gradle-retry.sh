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
# ~/.m2 (`MavenArtifactFetcher`: "Failed to fetch maven artifact ... Server returned HTTP response code: 429"):
# there the failing tests ARE the download failure, so it is recognised by its own text, ahead of the test
# verdict. Anything else that is not a failed download is never retried and is the job's own result: a compile
# error (`e: ...`, `X.java:12: error:`) or a failing test (`There were failing tests`) says so in its log, and
# those win over a Gradle download word that also appears in the same log. A retry can only repeat the same
# command, so it can never turn a failing test into a pass; at worst it costs one more attempt. After the last
# attempt a failed download says so in one line, so a red job reads as "the repository did not answer", not
# as a code failure.
# Wrap only a Gradle build or test with it, never a signing or publishing step.
read -r -a waits <<< "${GRADLE_RETRY_WAITS:-60}"
download='Could not (GET|HEAD) |Received status code (429|5[0-9]{2}) from server|was not found in any of the following sources|could not resolve plugin artifact|Could not resolve |Could not download '
robolectric='Failed to fetch maven artifact|Server returned HTTP response code: (429|5[0-9]{2}) for URL'
code='There were failing tests|^e: |\.java:[0-9]+: error:|Compilation error'

log="$(mktemp)"
attempt=1
total=$(( ${#waits[@]} + 1 ))
"$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
download_failed() {
  grep -qE "$robolectric" "$log" && return 0
  grep -qE "$download" "$log" && ! grep -qE "$code" "$log"
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
# What the last attempt downloaded from a remote repository: 0 means the restored cache served everything (#4118).
echo "::notice::Gradle downloaded $(grep -cE '^Download https?://' "$log" || true) artifact(s) from remote repositories in the last attempt."
exit "$rc"
