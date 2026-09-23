// OR-130. `fileAtBase` returned `null` for two different facts — "the branch added this file" and
// "we could not read the base" — and `verdict` turns a `null` base into `'fail'`. So a read failure
// became an accusation: a file byte-identical to `main` reported as this branch's new violation,
// non-deterministically, which cost a session to diagnose.
//
// These cases run against this repository's own HEAD rather than `origin/main`, because HEAD exists
// in every checkout including CI's, and the distinction under test is about git's stderr, not about
// which ref is being read.
import { describe, expect, it } from 'vitest'

const { showAtBase, fileAtBase, verdict, resolveBaseRef, DEFAULT_BASE_REFS } = require('../lib/base-ref.js') as {
  resolveBaseRef: (refs?: string[]) => string | null
  DEFAULT_BASE_REFS: string[]
  showAtBase: (ref: string, p: string) => { content: string | null; unreadable: boolean; reason?: string }
  fileAtBase: (ref: string | null, p: string) => string | null
  verdict: (a: { count: number; limit: number; atBase: number | null }) => string
}

describe('showAtBase tells absent from unreadable', () => {
  it('reads a file that is there', () => {
    const r = showAtBase('HEAD', 'package.json')
    expect(r.unreadable).toBe(false)
    expect(r.content).toContain('"name"')
  })

  it('calls a path that is genuinely not at the ref absent, not unreadable', () => {
    const r = showAtBase('HEAD', 'no/such/file/at/all.ts')
    expect(r).toEqual({ content: null, unreadable: false })
  })

  it('calls a base it cannot read unreadable, not absent', () => {
    const r = showAtBase('or130-definitely-not-a-ref', 'package.json')
    expect(r.unreadable).toBe(true)
  })

  // The mechanism behind the real failure has never been reproduced, so the next occurrence has to
  // identify itself. Carrying git's own words out is the only part of this fix that can do that.
  it('carries git own reason out, so the next occurrence names its cause', () => {
    const r = showAtBase('or130-definitely-not-a-ref', 'package.json')
    expect(r.reason).toContain('or130-definitely-not-a-ref')
  })

  // The regression itself: before OR-130 these two produced an identical value, so nothing
  // downstream could tell them apart. `content` alone still cannot — the flag is the whole fix.
  it('distinguishes the two cases that used to be one', () => {
    const absent = showAtBase('HEAD', 'no/such/file/at/all.ts')
    const unreadable = showAtBase('or130-definitely-not-a-ref', 'package.json')
    expect(absent.content).toBe(unreadable.content)
    expect(absent.unreadable).not.toBe(unreadable.unreadable)
  })
})

describe('the strict fallback is unchanged', () => {
  // Deliberate, and it is the CI half of OR-130: in CI the base comes from a `|| true` fetch, so a
  // fetch failure leaves NO base ref and every atBase is null. Turning an unknown base into a pass
  // would disable every base-aware ratchet in the repo on any blip, which is far worse than the bug.
  it('still fails an over-limit count when nothing is known about the base', () => {
    expect(verdict({ count: 1, limit: 0, atBase: null })).toBe('fail')
  })

  it('returns null without consulting git when there is no base ref', () => {
    expect(fileAtBase(null, 'package.json')).toBeNull()
  })

  it('still reports an unreadable base as absent, so the outcome stays strict', () => {
    expect(fileAtBase('or130-definitely-not-a-ref', 'package.json')).toBeNull()
  })
})


// The half of OR-130 that was missed, found on its FOURTH occurrence (2026-09-23).
//
// OR-130 instrumented `fileAtBase`, which is the path where a per-file read fails. It is not the
// path that fires. When NO base ref resolves at all, `fileAtBase(null, …)` returns null without
// consulting git — so no per-file warning can exist — and `verdict` turns that null into 'fail'.
// The ratchet then runs in ABSOLUTE mode while its output still reads as a judgement about the
// branch: a file byte-identical to main, named as this branch's new violation.
describe('a run with no base at all says so (OR-130, the missed half)', () => {
  it('returns null when none of the refs resolve', () => {
    expect(resolveBaseRef(['or134-nope-a', 'or134-nope-b'])).toBeNull()
  })

  it('still resolves normally with the real defaults', () => {
    expect(DEFAULT_BASE_REFS).toContain('origin/main')
  })

  // Saying so changes no verdict — absolute mode is stricter and stays exactly as it is. What
  // changes is that a reader can tell which mode produced the answer in front of them.
  it('does not alter the verdict for an unknown base', () => {
    expect(verdict({ count: 1, limit: 0, atBase: null })).toBe('fail')
  })
})


// OR-134 — the stream the diagnostic is written to, pinned because getting it wrong is invisible.
//
// `execFileSync` returns STDOUT ONLY. The ratchet scripts are spawned that way by their own tests,
// so a warning on stderr cannot appear in anything those tests see or report. Across five
// occurrences of the goals-route flake, "no warning fired" was read as evidence three times — and
// it was never evidence, because the diagnostic was written where the observer could not look.
describe('the diagnostic is written where its reader will actually see it (OR-134)', () => {
  it('execFileSync captures stdout and not stderr — the fact the choice rests on', () => {
    const { execFileSync } = require('child_process')
    const out = execFileSync('node', ['-e', 'process.stdout.write("OUT");process.stderr.write("ERR")'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(out).toContain('OUT')
    expect(out).not.toContain('ERR')
  })

  it('base-ref writes its warnings to stdout, so a spawned run reports them', () => {
    const { execFileSync } = require('child_process')
    const lib = require.resolve('../lib/base-ref.js')
    const out = execFileSync('node', ['-e', `require(${JSON.stringify(lib)}).resolveBaseRef(['or134-a','or134-b'])`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(out, 'a warning on stderr would leave this empty').toContain('no base branch resolved')
  })
})

// LA-132 — a file bigger than execFileSync's 1 MiB default is readable at base.
//
// `showAtBase` spawned git without a `maxBuffer`, so anything over 1 MiB failed with
// `spawnSync git ENOBUFS`. That is not a path-absent message, so it was classified unreadable,
// retried three times, and then treated as ABSENT — which is strict. The visible effect was a
// doc-size failure naming a line count the branch had not caused, because the ratchet could no
// longer tell "the base already has this" from "you added it".
//
// It was never intermittent: `docs/implementation-backlog.md` crossed 1 MiB and every base read of
// it failed from then on, in CI and the sandbox alike. It read as a flake only because the ratchet
// it broke reports a line count rather than the read behind it.
//
// The real backlog is the witness deliberately — a synthetic 2 MiB fixture would pin the buffer
// size and not the thing that regressed, which is that the repo's largest tracked doc is readable.
//
// `LA-132` shipped the fix (`maxBuffer` on `showAtBase`); this pins it. Two sessions diagnosed the
// same defect independently within hours, from opposite ends — one from the ENOBUFS line in a CI
// log, one from the ratchet's wrong line count — which is the argument for a test rather than a
// third rediscovery.
describe('a file over the default spawn buffer is readable at base (LA-132)', () => {
  it('reads the backlog at base rather than reporting it absent', () => {
    const baseRef = resolveBaseRef()
    if (!baseRef) return // no base to read against; resolveBaseRef warns for itself

    const rel = 'docs/implementation-backlog.md'
    const onDisk = require('fs').statSync(
      require('path').resolve(__dirname, '..', '..', rel),
    ).size
    expect(onDisk, 'the witness must exceed 1 MiB or it pins nothing').toBeGreaterThan(1024 * 1024)

    const res = showAtBase(baseRef, rel)
    expect(res.unreadable, `base read failed: ${res.reason ?? ''}`).toBe(false)
    expect(res.content, 'a null here is the ENOBUFS path reporting the file as absent').not.toBeNull()
  })
})
