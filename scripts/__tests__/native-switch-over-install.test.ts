// #2840 — the switch-over install wrapper, with a mocked adb. No test touches a real device.
import { describe, it, expect, vi } from 'vitest'

type Mod = typeof import('../native-switch-over/install.mjs')
const load = async (): Promise<Mod> => (await import('../native-switch-over/install.mjs')) as Mod

const CERT = 'A'.repeat(64)
const info = (versionCode: number, certificates = [CERT], pkg = 'com.trainingai.app') => ({
  package: pkg, versionCode, certificates,
})
const GOOD_MANIFEST =
  '<application android:allowBackup="true" android:fullBackupContent="@xml/b" android:dataExtractionRules="@xml/d">'

function harness(over: Record<string, unknown> = {}) {
  const calls: string[][] = []
  const adb = vi.fn((args: string[]) => {
    calls.push(args)
    if (args[0] === 'devices') return 'List of devices attached\nR5CY123\tdevice\n'
    if (args.includes('path')) return 'package:/data/app/~~x/com.trainingai.app-y/base.apk\n'
    return ''
  })
  const writes: string[] = []
  const fs = {
    existsSync: () => true,
    mkdirSync: vi.fn(),
    writeFileSync: (p: string) => writes.push(p),
    readFileSync: () => Buffer.from('apk'),
  }
  const inspect = vi.fn((apk: string) => (apk.endsWith('base.apk') ? info(1_513_000) : info(2_000_000_000)))
  const deps = {
    env: {}, adb, fs, inspect, log: vi.fn(), manifestPrint: () => GOOD_MANIFEST,
    now: new Date('2026-11-14T03:04:05Z'), ...over,
  }
  return { deps, calls, writes, adb }
}
const ARGS = ['--apk', '/tmp/new.apk', '--backup-root', '/tmp/bk']

describe('argument guards', () => {
  it.each(['uninstall', '--uninstall', 'clear', '-d', '--downgrade'])('refuses %s', async (word) => {
    const { parseArgs, Refusal } = await load()
    expect(() => parseArgs([...ARGS, word])).toThrow(Refusal)
  })
  it('needs --apk', async () => {
    const { parseArgs } = await load()
    expect(() => parseArgs([])).toThrow(/--apk/)
  })
  it('is dry-run unless the explicit flag is given', async () => {
    const { parseArgs } = await load()
    expect(parseArgs(ARGS).yes).toBe(false)
    expect(parseArgs([...ARGS, '--i-have-the-owners-yes']).yes).toBe(true)
  })
  it('never runs in CI', async () => {
    const { main } = await load()
    const h = harness({ env: { GITHUB_ACTIONS: 'true' } })
    expect(() => main(ARGS, h.deps)).toThrow(/never runs in CI/)
    expect(h.adb).not.toHaveBeenCalled()
  })
})

describe('command construction', () => {
  it('only allows adb install -r <apk>', async () => {
    const { assertSafeAdb, buildAdb } = await load()
    expect(buildAdb().install('/a.apk')).toEqual(['install', '-r', '/a.apk'])
    expect(buildAdb('S1').install('/a.apk')).toEqual(['-s', 'S1', 'install', '-r', '/a.apk'])
    expect(() => assertSafeAdb(['-s', 'S1', 'install', '-r', '/a.apk'])).not.toThrow()
    for (const bad of [
      ['uninstall', 'com.trainingai.app'], ['shell', 'pm', 'clear', 'com.trainingai.app'],
      ['install', '-r', '-d', '/a.apk'], ['install', '/a.apk'], ['install', '-r', '-g', '/a.apk'],
    ])
      expect(() => assertSafeAdb(bad)).toThrow()
  })
  it('detects the backup-rule gaps', async () => {
    const { checkBackupRules } = await load()
    expect(checkBackupRules(GOOD_MANIFEST)).toEqual([])
    expect(checkBackupRules('<application android:allowBackup="false">')).toEqual([])
    expect(checkBackupRules('<application android:allowBackup="true">')).toHaveLength(1)
    expect(checkBackupRules('<application android:allowBackup="true" android:fullBackupContent="@x">')[0]).toMatch(/dataExtractionRules/)
  })
})

describe('the flow', () => {
  it('dry-run backs up and verifies but never installs', async () => {
    const { main } = await load()
    const h = harness()
    const out = main(ARGS, h.deps)
    expect(out.installed).toBe(false)
    expect(h.calls.map((c) => c.join(' '))).toEqual([
      'devices',
      'shell pm path com.trainingai.app',
      'pull /data/app/~~x/com.trainingai.app-y/base.apk /tmp/bk/20261114T030405/base.apk',
    ])
    expect(h.writes.some((w) => w.endsWith('record.json'))).toBe(true)
  })
  it('installs with -r only after the backup, with the flag', async () => {
    const { main } = await load()
    const h = harness()
    expect(main([...ARGS, '--i-have-the-owners-yes'], h.deps).installed).toBe(true)
    expect(h.calls.at(-1)).toEqual(['install', '-r', expect.stringMatching(/new\.apk$/)])
    expect(h.calls.findIndex((c) => c[0] === 'pull')).toBeLessThan(h.calls.length - 1)
  })
  it.each([
    ['a lower versionCode', (a: string) => (a.endsWith('base.apk') ? info(1_513_000) : info(1_512_000))],
    ['a different certificate', (a: string) => (a.endsWith('base.apk') ? info(1) : info(2, ['B'.repeat(64)]))],
  ])('refuses %s without installing', async (_n, inspect) => {
    const { main } = await load()
    const h = harness({ inspect })
    expect(() => main([...ARGS, '--i-have-the-owners-yes'], h.deps)).toThrow()
    expect(h.calls.some((c) => c.includes('install'))).toBe(false)
  })
  it('refuses a build with weak backup rules', async () => {
    const { main } = await load()
    const h = harness({ manifestPrint: () => '<application android:allowBackup="true">' })
    expect(() => main([...ARGS, '--i-have-the-owners-yes'], h.deps)).toThrow(/Backup rules/)
    expect(h.calls.some((c) => c.includes('install'))).toBe(false)
  })
  it('refuses when two phones are attached and no --serial is given', async () => {
    const { main } = await load()
    const adb = vi.fn(() => 'List of devices attached\nA\tdevice\nB\tdevice\n')
    expect(() => main(ARGS, harness({ adb }).deps)).toThrow(/exactly one/)
  })
})

describe('the android.yml / build.gradle wiring (#2840)', () => {
  it('keeps the default formula and the cert check, and passes the override via env', async () => {
    const { readFileSync } = await import('node:fs')
    const gradle = readFileSync('android/app/build.gradle', 'utf8')
    const wf = readFileSync('.github/workflows/android.yml', 'utf8')
    expect(gradle).toContain('parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2]')
    expect(gradle).toContain("System.getenv('ANDROID_VERSION_CODE_OVERRIDE')")
    expect(wf).toContain('EXPECTED_CERT_SHA256: d390062e367da6eee52ee74ca18632eae7686e5edb9c0c25e2fc98a3744d893c')
    expect(wf).toContain('ANDROID_VERSION_CODE_OVERRIDE: ${{ inputs.version_code }}')
    expect(wf).not.toMatch(/run:[^\n]*\$\{\{ *inputs\.version_code/)
  })
})
