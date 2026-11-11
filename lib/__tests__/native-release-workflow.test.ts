import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { load } from 'js-yaml'
import { NATIVE_CALLBACKS } from '@/lib/auth/mobile/native-transaction'

// .github/workflows/native-release.yml builds the REAL app's APK (#2840). lib/github-release.ts
// offers the first `.apk` on the `apk-latest` release to the installed app as an update, so a
// workflow that put its APK there could hand the owner the native app as an "update". It keeps a
// workflow artifact, and publishes to `native-release-latest` only after the switch (#3723).
const workflow = readFileSync(new URL('../../.github/workflows/native-release.yml', import.meta.url), 'utf8')
const code = workflow.replace(/^\s*#.*$/gm, '')
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a workflow file has no type
const parsed = load(workflow) as any

describe('native-release.yml', () => {
  it('runs only when dispatched by hand', () => {
    const triggers = code.match(/^on:\n((?: {2}.*\n|\n)+)/m)?.[1] ?? ''
    expect(triggers.match(/^ {2}\S+?:/gm)).toEqual(['  workflow_dispatch:'])
  })

  // #3723. The APK has the real app's ID and key and a higher version code: published before the
  // switch, opening it would install over the Capacitor app and skip the switch runbook.
  it('never touches apk-latest, and publishes only from the gated publish job', () => {
    expect(code).not.toMatch(/apk-latest/)
    expect(code).not.toMatch(/softprops|action-gh-release|create-release|upload-release-asset/)
    expect(code).not.toMatch(/\bgit\s+push\b/)
    const { build, publish } = parsed.jobs
    // The build job, which runs the checked-out code and holds the key, has no write token and no
    // release call; the publish job has the token and builds nothing.
    expect(build.permissions).toBeUndefined()
    expect(JSON.stringify(build.steps)).not.toMatch(/\bgh\s+release\b|releases/)
    expect(publish.permissions).toEqual({ contents: 'write' })
    expect(publish.needs).toBe('build')
    expect(JSON.stringify(publish.steps)).not.toMatch(/secrets\.|gradlew|apksigner|checkout/)
    // Every release call names the rolling native tag.
    expect(publish.env.RELEASE_TAG).toBe('native-release-latest')
    const calls = [...code.matchAll(/gh release (\S+) (\S+)/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const [, , tag] of calls) expect(tag).toBe('"$RELEASE_TAG"')
  })

  it('publishes only when dispatched with both publish and confirm_switch_done', () => {
    const inputs = parsed.on.workflow_dispatch.inputs
    expect(inputs.publish).toMatchObject({ type: 'boolean', default: false })
    expect(inputs.confirm_switch_done).toMatchObject({ type: 'boolean', default: false })
    const condition: string = parsed.jobs.publish.if
    for (const term of [
      "github.event_name == 'workflow_dispatch'",
      'inputs.publish',
      'inputs.confirm_switch_done',
      '!inputs.emulator_abi',
      "github.ref == 'refs/heads/main'",
    ]) expect(condition).toContain(term)
    expect(condition).not.toMatch(/\|\|/)
  })

  it('refuses publish without confirm_switch_done before anything is built', () => {
    const steps = parsed.jobs.build.steps as { name?: string; uses?: string; run?: string; env?: Record<string, string> }[]
    const check = steps.findIndex(step => step.name === 'Check the publish request')
    const checkout = steps.findIndex(step => step.uses?.startsWith('actions/checkout@'))
    expect(check).toBeGreaterThanOrEqual(0)
    expect(check).toBeLessThan(checkout)
    expect(steps[check].env).toMatchObject({
      PUBLISH: '${{ inputs.publish }}',
      CONFIRMED: '${{ inputs.confirm_switch_done }}',
    })
    expect(steps[check].run).toMatch(/if \[ "\$CONFIRMED" != "true" \]; then\n\s+echo "::error::publish needs confirm_switch_done too\.[^\n]*"\n\s+exit 1/)
  })

  it('publishes a prerelease that is never marked latest', () => {
    const run = (parsed.jobs.publish.steps as { run?: string }[]).map(step => step.run ?? '').join('\n')
    const writes = run.split('\n').filter(line => /gh release (create|edit)/.test(line))
    expect(writes).toHaveLength(2)
    for (const line of writes) expect(line).toMatch(/--prerelease --latest=false/)
    // lib/github-release.ts reads these two back.
    expect(run).toContain('TITLE="TrainingAi release build (v$NAME)"')
    expect(run).toContain('version code $CODE (v$NAME)')
  })

  it('keeps its APK as a workflow artifact', () => {
    expect(code).toMatch(/uses:\s*actions\/upload-artifact@/)
    expect(code).toMatch(/retention-days: 14/)
    expect(code).toMatch(/^permissions:\n\s+contents:\s*read\s*$/m)
  })

  it('builds the real app ID, signed with the installed app\'s key and certificate', () => {
    expect(code).toMatch(/PACKAGE:\s*com\.trainingai\.app\s*$/m)
    expect(code).toMatch(/EAS_BUILD_PROFILE:\s*android-preview/)
    expect(code).not.toMatch(/APP_VARIANT/)
    expect(code).toMatch(/secrets\.ANDROID_DEBUG_KEYSTORE_B64/)
    const android = readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8')
    const installed = android.match(/EXPECTED_CERT_SHA256:\s*([0-9a-f]{64})/)?.[1]
    expect(installed).toBeTruthy()
    expect(code).toContain(`EXPECTED_CERT_SHA256: ${installed}`)
  })

  // The switch rehearsal's emulator build (native-switch-rehearsal.yml) adds x86_64. It must never be
  // the artifact the owner installs, so it carries its own name, and the default build stays arm64.
  it('names the emulator build apart, and builds arm64 only unless asked', () => {
    expect(code).toContain("name: ${{ inputs.emulator_abi && 'trainingai-release-apk-emulator' || 'trainingai-release-apk' }}")
    expect(code).toMatch(/ABIS=arm64-v8a\n/)
    expect(code).toMatch(/if \[ "\$EMULATOR_ABI" = "true" \]; then ABIS=arm64-v8a,x86_64; fi/)
    expect(code).toContain('-PreactNativeArchitectures="$ABIS"')
    expect(code).toMatch(/emulator_abi:\n(?: {8}.*\n)*? {8}default: false/)
  })

  it('does not interpolate inputs into a script', () => {
    const scripts = [...code.matchAll(/run:\s*\|\n((?: {10,}.*\n|\n)+)/g)].map(m => m[1]).join('\n')
    expect(scripts).not.toMatch(/\$\{\{/)
  })
})

describe('the real app\'s sign-in callback', () => {
  it('is the same on the server and in the app', () => {
    // Read as text: importing the app's module would make Vite load mobile/tsconfig.json, which
    // extends expo's base config, and that is not installed in the root-only CI install. The
    // mobile suite (native-release.test.ts) covers MOBILE_CALLBACKS itself.
    const session = readFileSync(new URL('../../mobile/src/features/account/session.ts', import.meta.url), 'utf8')
    expect(session).toContain("android: 'com.trainingai.app:/auth/callback'")
    expect(NATIVE_CALLBACKS.android).toBe('com.trainingai.app:/auth/callback')
  })
})

describe('the ref and the backup floor', () => {
  const steps = code.split(/^ {6}- /m)
  const stepNamed = (name: string) => steps.find(s => s.includes(`name: ${name}`)) ?? ''

  it('only builds main or a v* tag, checked before any code is checked out', () => {
    const check = stepNamed('Check the ref')
    expect(check).toContain('REF: ${{ inputs.ref }}')
    expect(check).toContain('"$REF" = "main"')
    expect(check).toContain('^v[0-9A-Za-z._-]+$')
    expect(check).toContain('exit 1')
    expect(code.indexOf('name: Check the ref')).toBeLessThan(code.indexOf('actions/checkout@'))
    expect(code.indexOf('name: Check the ref')).toBeLessThan(code.indexOf('actions/setup-node@'))
    expect(code).toMatch(/ref: refs\/\$\{\{ inputs\.ref == 'main' && 'heads' \|\| 'tags' \}\}\/\$\{\{ inputs\.ref \}\}/)
  })

  const pinned = () => {
    const block = workflow.match(/REQUIRED_BACKUP_EXCLUSIONS: \|\n((?: {4}\S+\n)+)/)?.[1] ?? ''
    return block.split('\n').map(l => l.trim()).filter(Boolean)
  }

  it('pins the required exclusions in the workflow and hands them to the verifier', () => {
    expect([...pinned()].sort()).toEqual([
      // #3728: the Capacitor app's leftover databases, each SQLite side file named.
      'database:oura_raw.db',
      'database:oura_raw.db-journal',
      'database:oura_raw.db-shm',
      'database:oura_raw.db-wal',
      'database:trainingaiSQLite.db',
      'database:trainingaiSQLite.db-journal',
      'database:trainingaiSQLite.db-shm',
      'database:trainingaiSQLite.db-wal',
      'file:SQLite',
      'root:app_webview',
      'sharedpref:SecureStore',
      'sharedpref:SecureStore.xml',
      'sharedpref:oura_ble.xml',
      'sharedpref:trainingai_home_widgets.xml',
      'sharedpref:workout-status.xml',
    ])
    expect(code).toContain('--require-exclusions "$REQUIRED_BACKUP_EXCLUSIONS"')
  })

  it('matches what the app\'s own backup plugin excludes', async () => {
    // Loaded, not text-matched: the old app's databases are built from two names and four suffixes.
    const { createRequire } = await import('node:module')
    const stub = { withAndroidManifest: () => undefined, withDangerousMod: () => undefined, AndroidConfig: {} }
    const plugin = readFileSync(new URL('../../mobile/src/integrations/auth/private-backups.cjs', import.meta.url), 'utf8')
    const loaded: { exports: { exclusions?: string[][] } } = { exports: {} }
    new Function('require', 'module', plugin)(
      (name: string) => (name === 'expo/config-plugins' ? stub : createRequire(import.meta.url)(name)),
      loaded,
    )
    const own = (loaded.exports.exclusions ?? []).map(([domain, path]) => `${domain}:${path}`)
    expect(own.length).toBeGreaterThan(8)
    expect([...own].sort()).toEqual([...pinned()].sort())
  })

  it('pins the permission floor, the forbidden list and both foreground services (#3722)', () => {
    const block = (name: string) =>
      (workflow.match(new RegExp(`^  ${name}: \\|\\n((?: {4}\\S+\\n)+)`, 'm'))?.[1] ?? '').split('\n').map(l => l.trim()).filter(Boolean)
    const permissions = block('REQUIRED_PERMISSIONS')
    expect(permissions).toContain('android.permission.SYSTEM_ALERT_WINDOW')
    expect(permissions).toContain('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE')
    expect(permissions.length).toBeGreaterThanOrEqual(25)
    expect(block('FORBIDDEN_PERMISSIONS')).toEqual(['android.permission.ACCESS_BACKGROUND_LOCATION'])
    expect(block('REQUIRED_FOREGROUND_SERVICES')).toEqual([
      'expo.modules.location.services.LocationTaskService:location',
      'expo.modules.activityservice.ActivityForegroundService:connectedDevice',
    ])
    expect(code).toContain('--require-permissions "$REQUIRED_PERMISSIONS"')
    expect(code).toContain('--forbid-permissions "$FORBIDDEN_PERMISSIONS"')
    expect(code).toContain('--require-foreground-services "$REQUIRED_FOREGROUND_SERVICES"')
  })
})
