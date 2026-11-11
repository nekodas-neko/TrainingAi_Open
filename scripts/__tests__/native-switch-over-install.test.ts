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

// The shape of `adb shell dumpsys package com.trainingai.app` on Android 16, trimmed.
const dump = (versionCode: number, granted: string[], denied: string[] = []) => `Packages:
  Package [com.trainingai.app] (a1b2c3):
    versionCode=${versionCode} minSdk=26 targetSdk=36
    versionName=1.492.0
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1 installed=true hidden=false
      runtime permissions:
${granted.map((name) => `        ${name}: granted=true, flags=[ USER_SET ]`).join('\n')}
${denied.map((name) => `        ${name}: granted=false, flags=[ USER_SET ]`).join('\n')}
`
const BEFORE = dump(1_513_000, ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'], ['android.permission.RECORD_AUDIO'])
const AFTER = dump(2_000_000_000, ['android.permission.CAMERA'], ['android.permission.POST_NOTIFICATIONS'])

function harness(over: Record<string, unknown> = {}) {
  const calls: string[][] = []
  let installedYet = false
  const adb = vi.fn((args: string[]) => {
    calls.push(args)
    if (args[0] === 'devices') return 'List of devices attached\nR5CY123\tdevice\n'
    if (args.includes('path')) return 'package:/data/app/~~x/com.trainingai.app-y/base.apk\n'
    if (args.includes('dumpsys')) return installedYet ? AFTER : BEFORE
    if (args.includes('install')) installedYet = true
    return ''
  })
  const writes: string[] = []
  const records: Record<string, any>[] = []
  const fs = {
    existsSync: () => true,
    mkdirSync: vi.fn(),
    writeFileSync: (p: string, body: string) => {
      writes.push(p)
      if (p.endsWith('record.json')) records.push(JSON.parse(body))
    },
    readFileSync: () => Buffer.from('apk'),
  }
  const inspect = vi.fn((apk: string) => (apk.endsWith('base.apk') ? info(1_513_000) : info(2_000_000_000)))
  const deps = {
    env: {}, adb, fs, inspect, log: vi.fn(), manifestPrint: () => GOOD_MANIFEST,
    now: new Date('2026-11-14T03:04:05Z'), ...over,
  }
  return { deps, calls, writes, records, adb }
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
  it('lets only the two read-only shell commands through (#3722)', async () => {
    const { assertSafeAdb, buildAdb } = await load()
    expect(buildAdb('S1').packageDump()).toEqual(['-s', 'S1', 'shell', 'dumpsys', 'package', 'com.trainingai.app'])
    for (const ok of [buildAdb().packagePath(), buildAdb().packageDump(), buildAdb('S1').packageDump(), ['devices'], ['pull', '/a', '/b']])
      expect(() => assertSafeAdb(ok)).not.toThrow()
    for (const bad of [
      ['shell', 'pm', 'uninstall', 'com.trainingai.app'],
      ['shell', 'pm', 'uninstall', '-k', '--user', '0', 'com.trainingai.app'],
      ['shell', 'cmd', 'package', 'uninstall', 'com.trainingai.app'],
      ['shell', 'pm', 'clear', 'com.trainingai.app'],
      ['shell', 'pm', 'revoke', 'com.trainingai.app', 'android.permission.CAMERA'],
      ['shell', 'pm', 'grant', 'com.trainingai.app', 'android.permission.CAMERA'],
      ['shell', 'am', 'force-stop', 'com.trainingai.app'],
      ['shell', 'rm', '-rf', '/data/data/com.trainingai.app'],
      ['shell', 'dumpsys', 'package', 'com.trainingai.app', ';', 'pm', 'clear', 'x'],
      ['shell', 'dumpsys package com.trainingai.app; pm uninstall com.trainingai.app'],
      ['shell', 'dumpsys', 'package', 'com.other.app'],
      ['-s', 'S1', 'shell', 'pm', 'path', 'com.other.app'],
      ['shell'],
      ['install-multiple', '-r', '/a.apk'],
      ['push', '/a', '/b'],
      ['root'],
      ['reboot'],
      ['backup', '-apk', 'com.trainingai.app'],
    ])
      expect(() => assertSafeAdb(bad), bad.join(' ')).toThrow()
  })
  it('reads the versionCode and the granted permissions from dumpsys, and compares two reads', async () => {
    const { parsePackageDump, comparePhoneState } = await load()
    const before = parsePackageDump(BEFORE)
    expect(before).toEqual({
      versionCode: 1_513_000,
      versionName: '1.492.0',
      grantedPermissions: ['android.permission.CAMERA', 'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'],
    })
    expect(comparePhoneState(before, parsePackageDump(AFTER))).toEqual({
      lost: ['android.permission.POST_NOTIFICATIONS'], gained: [],
    })
    expect(parsePackageDump('Unable to find package: com.trainingai.app')).toEqual({
      versionCode: null, versionName: null, grantedPermissions: [],
    })
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
      'shell dumpsys package com.trainingai.app',
    ])
    expect(h.writes.some((w) => w.endsWith('record.json'))).toBe(true)
    expect(h.records.at(-1)?.phone.before.versionCode).toBe(1_513_000)
    expect(h.records.at(-1)?.phone.after).toBeUndefined()
  })
  it('records the phone before and after a real install, and only reads it (#3722)', async () => {
    const { main } = await load()
    const h = harness()
    const out = main([...ARGS, '--i-have-the-owners-yes'], h.deps)
    const lines = h.calls.map((c) => c.join(' '))
    expect(lines.filter((l) => l === 'shell dumpsys package com.trainingai.app')).toHaveLength(2)
    expect(lines.indexOf('shell dumpsys package com.trainingai.app')).toBeLessThan(lines.findIndex((l) => l.startsWith('install')))
    expect(lines.at(-1)).toBe('shell dumpsys package com.trainingai.app')
    // Every call the whole flow makes is one of the four allowed verbs.
    expect(new Set(h.calls.map((c) => c[0]))).toEqual(new Set(['devices', 'shell', 'pull', 'install']))
    const phone = h.records.at(-1)?.phone
    expect(phone.before.versionCode).toBe(1_513_000)
    expect(phone.after.versionCode).toBe(2_000_000_000)
    expect(phone.changes.lost).toEqual(['android.permission.POST_NOTIFICATIONS'])
    expect(out.changes?.lost).toContain('android.permission.POST_NOTIFICATIONS')
    const said = (h.deps.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(said).toMatch(/No longer granted[^\n]*POST_NOTIFICATIONS/)
    expect(said).not.toMatch(/WARNING/)
  })
  it('refuses when the phone reports a different versionCode from the APK pulled off it', async () => {
    const { main } = await load()
    const h = harness({ inspect: (apk: string) => (apk.endsWith('base.apk') ? info(1_492_000) : info(2_000_000_000)) })
    expect(() => main([...ARGS, '--i-have-the-owners-yes'], h.deps)).toThrow(/phone reports versionCode 1513000/)
    expect(h.calls.some((c) => c.includes('install'))).toBe(false)
  })
  it('refuses when the installed versionCode cannot be read, and warns when the install did not take', async () => {
    const { main } = await load()
    const blind = harness()
    blind.adb.mockImplementation((args: string[]) => {
      if (args[0] === 'devices') return 'List of devices attached\nR5CY123\tdevice\n'
      if (args.includes('path')) return 'package:/data/app/~~x/com.trainingai.app-y/base.apk\n'
      return ''
    })
    expect(() => main([...ARGS, '--i-have-the-owners-yes'], blind.deps)).toThrow(/Could not read the installed versionCode/)
    expect(blind.adb.mock.calls.some(([c]) => (c as string[]).includes('install'))).toBe(false)
    const stuck = harness()
    stuck.adb.mockImplementation((args: string[]) => {
      if (args[0] === 'devices') return 'List of devices attached\nR5CY123\tdevice\n'
      if (args.includes('path')) return 'package:/data/app/~~x/com.trainingai.app-y/base.apk\n'
      return args.includes('dumpsys') ? BEFORE : ''
    })
    main([...ARGS, '--i-have-the-owners-yes'], stuck.deps)
    expect((stuck.deps.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).toMatch(/WARNING: expected versionCode 2000000000/)
  })
  it('installs with -r only after the backup, with the flag', async () => {
    const { main } = await load()
    const h = harness()
    expect(main([...ARGS, '--i-have-the-owners-yes'], h.deps).installed).toBe(true)
    const at = h.calls.findIndex((c) => c[0] === 'install')
    expect(h.calls[at]).toEqual(['install', '-r', expect.stringMatching(/new\.apk$/)])
    expect(h.calls.filter((c) => c[0] === 'install')).toHaveLength(1)
    expect(h.calls.findIndex((c) => c[0] === 'pull')).toBeLessThan(at)
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
