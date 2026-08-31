'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'

/** What `/api/exercise-gif` answers with. Both fields are null when it matched nothing. */
export interface ExerciseMedia {
  gifUrl: string | null
  imageUrl: string | null
}

const NO_MEDIA: ExerciseMedia = { gifUrl: null, imageUrl: null }

// Exercise media is generated offline and looked up by name; nothing in the app writes it, so there
// is no invalidation group for it to belong to and this TTL is the whole freshness story. One fetch
// site — this hook — means one TTL expression, which is what the one-canonical-TTL rule protects. It
// is named here rather than in `packages/shared/src/cache-ttl.ts` because that path is Lane A's.
export const EXERCISE_MEDIA_TTL = TTL_LONG

export const exerciseMediaKey = (name: string) => `exercise-media:${name}`

/**
 * The clip and start frame for a set of exercises, shared through the cache.
 *
 * This is the one place `/api/exercise-gif` is fetched. It was hand-rolled at four call sites — the
 * warm-up screen, the exercise stats sheet, the config preview sheet and the builder review — each
 * with its own copy of the response shape and its own idea of what a failure means, which is what
 * the extract-at-two-sites rule exists to stop before a fifth (BF-65).
 *
 * **The cache key is what makes the second screen instant.** The warm-up screen fetches media for
 * every exercise in the session, then unmounts on the mode change and drops its map; the ready
 * screen wants exactly one entry of it a minute later. Going through `exercise-media:<name>` means
 * the seed below answers that read synchronously rather than showing a spinner for a file the app
 * already has. `freshWithinTtl` is deliberately not set: the seed already gives the instant paint,
 * and skipping the revalidation entirely would make a regenerated clip's URL stale for six hours
 * instead of one paint.
 */
export function useExerciseMedia(
  names: readonly string[],
  opts?: {
    /**
     * Also request the gif and frame binaries, so the service worker holds them when the phone goes
     * offline. The warm-up screen does this for the whole session up front and is why the ready
     * screen's clip plays in airplane mode; a single-exercise caller has nothing to gain from it.
     */
    prefetchBinaries?: boolean
    /**
     * `cachedFetch` swallows `!res.ok`, so a caller that renders an error state has to be told.
     * Omitting it means an unreachable route is indistinguishable from an exercise with no match —
     * which is the right reading for a picture, and the wrong one for a sheet that says "couldn't
     * load".
     */
    onError?: () => void
  },
): { media: Record<string, ExerciseMedia>; loading: boolean } {
  // Callers pass an inline array; the joined string is what the effects depend on, so a new array
  // with the same names does not re-fetch.
  const namesKey = useMemo(
    () => [...new Set(names.filter(Boolean))].sort().join('\n'),
    [names],
  )

  const [media, setMedia] = useState<Record<string, ExerciseMedia>>({})
  const [loading, setLoading] = useState(false)

  const onErrorRef = useRef(opts?.onError)
  onErrorRef.current = opts?.onError
  const prefetchBinaries = opts?.prefetchBinaries ?? false
  const prefetchedRef = useRef<Set<string>>(new Set())

  // Seeded in an effect, never a `useState` initializer — a cache read in an initializer is the
  // hydration mismatch from session 165.
  useEffect(() => {
    if (!namesKey) return
    const seeded: Record<string, ExerciseMedia> = {}
    for (const name of namesKey.split('\n')) {
      const hit = readCacheSync<ExerciseMedia>(exerciseMediaKey(name))
      if (hit) seeded[name] = { gifUrl: hit.gifUrl ?? null, imageUrl: hit.imageUrl ?? null }
    }
    if (Object.keys(seeded).length > 0) setMedia(current => ({ ...seeded, ...current }))
  }, [namesKey])

  useEffect(() => {
    if (!namesKey) { setLoading(false); return }
    const list = namesKey.split('\n')
    let alive = true
    setLoading(true)

    void Promise.all(list.map(name =>
      cachedFetch<ExerciseMedia>(
        exerciseMediaKey(name),
        `/api/exercise-gif?name=${encodeURIComponent(name)}`,
        EXERCISE_MEDIA_TTL,
        data => {
          const entry: ExerciseMedia = { gifUrl: data?.gifUrl ?? null, imageUrl: data?.imageUrl ?? null }
          if (prefetchBinaries && !prefetchedRef.current.has(name)) {
            prefetchedRef.current.add(name)
            if (entry.gifUrl) void fetch(entry.gifUrl).catch(() => null)
            if (entry.imageUrl) void fetch(entry.imageUrl).catch(() => null)
          }
          if (alive) setMedia(current => ({ ...current, [name]: entry }))
        },
        { onError: () => { if (alive) onErrorRef.current?.() } },
      ),
    )).then(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [namesKey, prefetchBinaries])

  return { media, loading }
}

/** The single-exercise shape, which is what four of the five call sites want. */
export function useExerciseMediaFor(
  name: string | null | undefined,
  opts?: { prefetchBinaries?: boolean; onError?: () => void },
): { media: ExerciseMedia; loading: boolean } {
  const names = useMemo(() => (name ? [name] : []), [name])
  const { media, loading } = useExerciseMedia(names, opts)
  return { media: (name && media[name]) || NO_MEDIA, loading }
}
