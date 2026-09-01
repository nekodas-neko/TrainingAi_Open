'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MoreSubScreen } from '@/components/more/sub-screen'
import { PersonalDetailsSection, type PersonalDetailsValues } from '@/components/profile/personal-details-section'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { invalidateGoalRecommendations, invalidateUserProfile } from '@/lib/cache-groups'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { formatDateDisplay, todayInTz } from '@trainingai/shared/date-utils'
import type { User } from '@trainingai/shared/types'

/**
 * More → Profile details (BF-79).
 *
 * The owner asked for the personal information in *"1 section in the more/details"*; this is that
 * screen. It is a sibling of `More → Health` (BF-71's DEXA & RMR screen), which keeps the More tab
 * itself a list of destinations rather than a page with editors embedded in it.
 *
 * **Every field on this screen writes through the one PATCH below.** Before BF-79 the same three
 * columns were editable from two components that each resent the other's fields; BF-78 removed the
 * resends and this removes the second editor, so a profile column is now written from exactly one
 * place in the app.
 */

interface BodyMetadata {
  recent?: { date: string; weightKg: number | null; bodyFat: number | null }[]
}

const EMPTY: PersonalDetailsValues = { displayName: '', heightCm: '', birthYear: '', sex: '' }

export function DetailsContent() {
  const [values, setValues] = useState<PersonalDetailsValues>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The server payload seeds the fields once. Without this an in-flight edit is overwritten by a
  // revalidation of the value it is replacing — the field would visibly revert mid-typing.
  const seeded = useRef(false)

  const onLoadError = useCallback(() => setLoadFailed(true), [])
  const profile = useCachedValue<{ user: User }>('more-user-profile', '/api/user/profile', TTL_MEDIUM, { onError: onLoadError })
  const bodyMeta = useCachedValue<BodyMetadata>('body-metadata', '/api/body-metadata', TTL_MEDIUM)

  const user = profile?.user ?? null

  useEffect(() => {
    if (!user || seeded.current) return
    seeded.current = true
    setValues({
      displayName: user.displayName ?? '',
      heightCm: user.heightCm?.toString() ?? '',
      birthYear: user.dateOfBirth ? user.dateOfBirth.slice(0, 4) : '',
      sex: user.sex ?? '',
    })
  }, [user])

  useEffect(() => () => { if (patchTimer.current) clearTimeout(patchTimer.current) }, [])

  async function patch(fields: Record<string, unknown>) {
    setSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Only the field that changed. `/api/user/profile` is a real partial update since BF-78,
        // so sending the others back would be a way to overwrite a newer value, not a safeguard.
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error()
      await Promise.all([invalidateUserProfile(), invalidateGoalRecommendations()])
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const onChange = useCallback((field: keyof PersonalDetailsValues, value: string) => {
    setValues(v => ({ ...v, [field]: value }))
    if (patchTimer.current) clearTimeout(patchTimer.current)

    // Biological sex is a three-way choice, not typing — there is no next keystroke to wait for,
    // and debouncing it only delays the save behind a timer the user cannot see.
    if (field === 'sex') {
      patch({ sex: value || null })
      return
    }
    patchTimer.current = setTimeout(() => {
      if (field === 'displayName') patch({ displayName: value || null })
      else if (field === 'heightCm') patch({ heightCm: value ? Number(value) : null })
      else if (field === 'birthYear') patch({ dateOfBirth: value ? `${value}-01-01` : null })
    }, 800)
  }, [])

  const today = todayInTz(user?.timezone)
  // `formatDateDisplay` builds the date component-wise. `new Date('2026-07-06')` parses as UTC
  // midnight and renders the previous day west of UTC (Q-130), and a bare `toLocaleDateString`
  // renders in the DEVICE's zone rather than the user's — both of which this row would hit.
  const dateLabel = (date: string) => date === today ? 'Today' : formatDateDisplay(date)

  const latestWeight = bodyMeta?.recent?.find(r => r.weightKg != null)
  const latestBf = bodyMeta?.recent?.find(r => r.bodyFat != null)

  return (
    <MoreSubScreen title="Profile details">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Your name and the body facts the app needs to estimate energy balance. Changes save on their
        own. Weight and body fat are measurements — they are logged on the Health page and shown here
        as the latest reading.
      </p>

      {loadFailed && !user && (
        <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          Could not load your profile. Check your connection and reopen this screen.
        </p>
      )}

      <PersonalDetailsSection
        values={values}
        onChange={onChange}
        latestWeightKg={latestWeight?.weightKg ?? null}
        latestWeightLabel={latestWeight ? dateLabel(latestWeight.date) : null}
        latestBfPct={latestBf?.bodyFat ?? null}
        latestBfLabel={latestBf ? dateLabel(latestBf.date) : null}
        saving={saving}
        namePlaceholder={user?.name ?? undefined}
      />
    </MoreSubScreen>
  )
}
