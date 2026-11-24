// #4134 review: a write rule must never sit on a shape `mobile/` READS with. The native app parses
// the program list, its cached copy and its queued commands with the schemas it imports from
// `packages/shared/src/validation/`, so one stored lift with a blank name would stop the whole list
// loading if any of them refused it. Rules for what the server ACCEPTS live on request schemas that
// only server routes import (`WorkoutTemplateWriteRequestSchema`, ...).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const ROOT = process.cwd()
const BLANK = '​'

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** Every `packages/shared/src/validation/<module>` the native app imports. */
function validationModulesMobileImports(): string[] {
  const found = new Set<string>()
  for (const file of sourceFiles(join(ROOT, 'mobile/src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/@trainingai\/shared\/validation\/([\w-]+)/g)) found.add(m[1])
  }
  return [...found].sort()
}

/** The module's own source plus every relative module it pulls in. */
function transitiveSource(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry)) return []
  seen.add(entry)
  const text = readFileSync(entry, 'utf8')
  const files = [entry]
  for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    const base = resolve(dirname(entry), m[1])
    for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
      try { statSync(candidate); files.push(...transitiveSource(candidate, seen)); break } catch { /* next */ }
    }
  }
  return files
}

const storedProgram = (exerciseName: string) => ({
  id: '10000000-0000-4000-8000-000000000001',
  userId: 'one',
  name: 'Saved plan',
  isActive: true,
  phaseMode: 'manual',
  sessions: [{ id: 's1', name: 'Upper', position: 0, exercises: [{ id: 'e1', exerciseName, position: 0 }] }],
})

describe('schemas the native app imports keep reading a stored program with a blank lift name (#4134)', () => {
  const modules = validationModulesMobileImports()

  it('finds the modules the app imports (the guard is not vacuous)', () => {
    expect(modules).toContain('program-write')
    expect(modules.length).toBeGreaterThan(10)
  })

  it('none of them, nor anything they import, uses the visible-name rule', () => {
    const offenders = modules.flatMap(m =>
      transitiveSource(join(ROOT, `packages/shared/src/validation/${m}.ts`))
        .filter(f => /visible-name|hasVisibleCharacter|visibleExerciseName/.test(readFileSync(f, 'utf8')))
        .map(f => `${m} -> ${f.replace(`${ROOT}/`, '')}`))
    expect(offenders).toEqual([])
  })

  it('every program-shaped schema it exports parses a stored program whose lift name is U+200B', async () => {
    let checked = 0
    for (const m of modules) {
      const exports = (await import(`@trainingai/shared/validation/${m}`)) as Record<string, unknown>
      for (const [name, value] of Object.entries(exports)) {
        if (!/^Program\w*Schema$|^ProgramWrite/.test(name) || !value || typeof (value as { safeParse?: unknown }).safeParse !== 'function') continue
        const r = (value as { safeParse: (v: unknown) => { success: boolean } }).safeParse(storedProgram(BLANK))
        expect(r.success, `${m}.${name} refuses a stored blank lift name`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('and the same lift is still refused where the SERVER accepts a write', async () => {
    const { WorkoutTemplateWriteRequestSchema } = await import('@trainingai/shared/validation/program-write-request')
    expect(WorkoutTemplateWriteRequestSchema.safeParse({ program: storedProgram(BLANK) }).success).toBe(false)
  })
})
