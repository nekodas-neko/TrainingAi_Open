/**
 * #4118: the Gradle retry helper (.github/actions/android-ndk/gradle/gradle-retry.sh) retries a failed
 * DOWNLOAD with growing waits, and never turns a failing Kotlin test or a compile error into a retry or a
 * pass. Run against stand-ins for `./gradlew` that print what Gradle prints; `sleep` is replaced so the
 * waits are recorded, not slept.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRIPT = path.resolve(__dirname, '../../.github/actions/android-ndk/gradle/gradle-retry.sh')

const RATE_LIMITED = `> Task :workout-status:testDebugUnitTest FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':workout-status:testDebugUnitTest'.
> Could not resolve all files for configuration ':workout-status:debugUnitTestRuntimeClasspath'.
   > Could not download nativeruntime-dist-compat-1.0.18.jar (org.robolectric:nativeruntime-dist-compat:1.0.18)
      > Could not get resource 'https://repo.maven.apache.org/maven2/org/robolectric/nativeruntime-dist-compat/1.0.18/nativeruntime-dist-compat-1.0.18.jar'.
         > Could not GET 'https://repo.maven.apache.org/maven2/org/robolectric/nativeruntime-dist-compat/1.0.18/nativeruntime-dist-compat-1.0.18.jar'. Received status code 429 from server: Too Many Requests
`
const MAVEN_DOWN = `* What went wrong:
Execution failed for task ':workout-status:testDebugUnitTest'.
> Could not resolve all files for configuration ':workout-status:debugUnitTestRuntimeClasspath'.
   > Could not resolve org.robolectric:robolectric:4.16.
      > Could not get resource 'https://repo.maven.apache.org/maven2/org/robolectric/robolectric/4.16/robolectric-4.16.pom'.
         > Could not GET 'https://repo.maven.apache.org/maven2/org/robolectric/robolectric/4.16/robolectric-4.16.pom'.
            > Connect to repo.maven.apache.org:443 [repo.maven.apache.org/151.101.0.215] failed: Connection refused
`
const FAILING_TEST = `> Task :workout-status:testDebugUnitTest FAILED

WorkoutNotificationTest > builds the ongoing notification FAILED
    java.lang.AssertionError at WorkoutNotificationTest.kt:41

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':workout-status:testDebugUnitTest'.
> There were failing tests. See the report at: file:///work/build/reports/tests/testDebugUnitTest/index.html
`
/** Robolectric fetching its android-all jar at test time: Gradle sees only failing tests. */
const ROBOLECTRIC_429 = `> Task :workout-status:testDebugUnitTest

WorkoutNotificationTest > builds the ongoing notification FAILED
    java.lang.AssertionError: Failed to fetch maven artifact org.robolectric:android-all-instrumented:14-robolectric-10818077-i7
        Caused by: java.util.concurrent.ExecutionException: java.io.IOException: Server returned HTTP response code: 429 for URL: https://repo1.maven.org/maven2/org/robolectric/android-all-instrumented/14-robolectric-10818077-i7/android-all-instrumented-14-robolectric-10818077-i7.jar

* What went wrong:
Execution failed for task ':workout-status:testDebugUnitTest'.
> There were failing tests. See the report at: file:///work/build/reports/tests/testDebugUnitTest/index.html
`
const KOTLIN_ERROR = `> Task :workout-status:compileDebugKotlin FAILED
e: file:///work/WorkoutNotification.kt:12:5 Unresolved reference: notifyy
`

describe('gradle-retry.sh (#4118)', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-retry-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  /** A stand-in for gradlew: attempt N prints `outputs[N]` (the last one repeats) and exits with `codes[N]`. */
  function run(outputs: string[], codes: number[], env: Record<string, string> = {}) {
    fs.mkdirSync(path.join(dir, 'bin'))
    fs.writeFileSync(path.join(dir, 'bin', 'sleep'), `#!/usr/bin/env bash\necho "$1" >> "${dir}/sleeps"\n`, { mode: 0o755 })
    outputs.forEach((o, i) => fs.writeFileSync(path.join(dir, `out${i}`), o))
    fs.writeFileSync(path.join(dir, 'fake-gradlew'), `#!/usr/bin/env bash
n=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${dir}/count"
last=${outputs.length - 1}; i=$(( n - 1 )); [ $i -gt $last ] && i=$last
cat "${dir}/out$i"
codes=(${codes.join(' ')}); c=$(( n - 1 )); [ $c -ge \${#codes[@]} ] && c=$(( \${#codes[@]} - 1 ))
exit \${codes[$c]}
`, { mode: 0o755 })
    const r = spawnSync('bash', [SCRIPT, path.join(dir, 'fake-gradlew'), 'testDebugUnitTest'], {
      env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, GRADLE_RETRY_WAITS: '', ...env },
      encoding: 'utf8',
    })
    const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').trim() : '')
    return {
      code: r.status, out: r.stdout + r.stderr,
      attempts: Number(read('count') || 0),
      sleeps: read('sleeps') ? read('sleeps').split('\n').map(Number) : [],
    }
  }
  const unset = { GRADLE_RETRY_WAITS: undefined as unknown as string }

  it('a passing run is run once and its code is kept', () => {
    const r = run(['BUILD SUCCESSFUL\n'], [0])
    expect(r).toMatchObject({ code: 0, attempts: 1, sleeps: [] })
  })

  it('by default a rate-limited download is retried once after 60 s, as before', () => {
    const r = run([RATE_LIMITED, 'BUILD SUCCESSFUL\n'], [1, 0], unset)
    expect(r).toMatchObject({ code: 0, attempts: 2, sleeps: [60] })
  })

  it('with "60 180 300" a download that stays rate-limited for two attempts passes on the third', () => {
    const r = run([RATE_LIMITED, RATE_LIMITED, 'BUILD SUCCESSFUL\n'], [1, 1, 0], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 0, attempts: 3, sleeps: [60, 180] })
  })

  it('a download that never succeeds fails after the last wait, and says it is the download', () => {
    const r = run([RATE_LIMITED], [1], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r.code).toBe(1)
    expect(r.attempts).toBe(4)
    expect(r.sleeps).toEqual([60, 180, 300])
    expect(r.out).toContain('::error::The dependency download failed on all 4 attempts')
    expect(r.out).toContain('This is the download, not the code under test')
  })

  it('Maven Central being down (connection refused) is the same: retried, then named as the download', () => {
    const r = run([MAVEN_DOWN], [1], { GRADLE_RETRY_WAITS: '60 180' })
    expect(r.code).toBe(1)
    expect(r.attempts).toBe(3)
    expect(r.out).toContain('::error::The dependency download failed on all 3 attempts')
  })

  it('a failing Kotlin test is not retried, keeps its code, and is not called a download failure', () => {
    const r = run([FAILING_TEST], [1], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 1, attempts: 1, sleeps: [] })
    expect(r.out).not.toContain('This is the download')
    expect(r.out).not.toContain('::warning::')
  })

  it('a failing test stays red even when its log also holds a download error from an earlier step', () => {
    const r = run([`${RATE_LIMITED.split('FAILURE')[0]}\n${FAILING_TEST}`], [1], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 1, attempts: 1, sleeps: [] })
  })

  it('a download that recovers and then hits a failing test ends red, after the retry that fetched it', () => {
    const r = run([RATE_LIMITED, FAILING_TEST], [1, 1], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 1, attempts: 2, sleeps: [60] })
    expect(r.out).not.toContain('::error::The dependency download failed')
  })

  it('Robolectric\'s own test-time download failing the tests is retried, and passes when the retry does', () => {
    const r = run([ROBOLECTRIC_429, 'BUILD SUCCESSFUL\n'], [1, 0], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 0, attempts: 2, sleeps: [60] })
  })

  it('Robolectric\'s download that never succeeds fails, named as the download', () => {
    const r = run([ROBOLECTRIC_429], [1], { GRADLE_RETRY_WAITS: '60 180' })
    expect(r.code).toBe(1)
    expect(r.attempts).toBe(3)
    expect(r.out).toContain('This is the download, not the code under test')
  })

  it('a Kotlin compile error is not retried', () => {
    const r = run([KOTLIN_ERROR], [1], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 1, attempts: 1, sleeps: [] })
  })

  it('a failure with no download word in it is not retried', () => {
    const r = run(['FAILURE: Build failed with an exception.\n* What went wrong:\nSomething else\n'], [3], { GRADLE_RETRY_WAITS: '60 180 300' })
    expect(r).toMatchObject({ code: 3, attempts: 1, sleeps: [] })
  })
})
