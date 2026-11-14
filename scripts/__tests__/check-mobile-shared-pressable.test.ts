/**
 * #3759 — feature code in the native app uses the shared Pressable, never React Native's.
 *
 * Each case builds a small tree in a temp directory (`--root`), so no file in the repo is written.
 * The last case runs the check over the real tree, which is how CI runs it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.join(__dirname, '..', 'check-mobile-shared-pressable.js')
let root: string

const put = (rel: string, src: string) => {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, src)
}
const run = (cwdRoot: string | null = root): { code: number; out: string } => {
  try {
    const out = execFileSync('node', [script, ...(cwdRoot ? ['--root', cwdRoot] : [])], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'shared-pressable-'))
  put(
    'mobile/src/features/home/components/Card.tsx',
    `import { View } from 'react-native';\nimport { Pressable } from '../../../shared/ui/Pressable';\nexport const x = [View, Pressable];\n`,
  )
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('check-mobile-shared-pressable', () => {
  it('passes a feature file that takes Pressable from the shared UI', () => {
    const r = run()
    expect(r.out).toMatch(/OK — 1 feature files/)
    expect(r.code).toBe(0)
  })

  it("fails a feature file that imports Pressable from 'react-native'", () => {
    put(
      'mobile/src/features/home/components/Bad.tsx',
      `import { useState } from 'react';\nimport { Pressable, View } from 'react-native';\nexport const x = [useState, Pressable, View];\n`,
    )
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/mobile\/src\/features\/home\/components\/Bad\.tsx:2/)
  })

  it('fails a multi-line and a renamed import', () => {
    put(
      'mobile/src/features/a/Multi.tsx',
      `import {\n  View,\n  Pressable,\n} from 'react-native';\nexport const x = [View, Pressable];\n`,
    )
    put(
      'mobile/src/features/a/Renamed.tsx',
      `import { Pressable as Tap } from "react-native";\nexport const x = Tap;\n`,
    )
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/features\/a\/Multi\.tsx:1/)
    expect(r.out).toMatch(/features\/a\/Renamed\.tsx:1/)
  })

  it('leaves the shared UI, a type import, PressableProps and a commented-out import alone', () => {
    put(
      'mobile/src/shared/ui/Pressable.tsx',
      `import { Pressable as NativePressable } from 'react-native';\nexport const Pressable = NativePressable;\n`,
    )
    put(
      'mobile/src/features/a/Types.tsx',
      `import type { Pressable } from 'react-native';\nimport { type PressableProps, View } from 'react-native';\n// import { Pressable } from 'react-native';\nexport type T = [typeof Pressable, PressableProps, typeof View];\n`,
    )
    const r = run()
    expect(r.out).toMatch(/OK/)
    expect(r.code).toBe(0)
  })

  it('passes on the repo as it stands', () => {
    const r = run(null)
    expect(r.out).toMatch(/OK/)
    expect(r.code).toBe(0)
  })
})
