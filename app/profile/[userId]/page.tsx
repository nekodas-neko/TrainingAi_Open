'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, UserIcon, Flame } from 'lucide-react'
import { TITLES } from '@trainingai/shared/types/friends'
import type { PublicProfile } from '@trainingai/shared/types/friends'
import { TrophyCase } from '@/components/more/trophy-case'
import { useTransitionRouter } from "@/lib/view-transition";

function formatVolume(kg: number): string {
  const tons = kg / 1000
  if (tons >= 1000) return `${(tons / 1000).toFixed(1)}kT`
  if (tons >= 1) return `${tons.toFixed(1)}T`
  return `${Math.round(kg)}kg`
}

export default function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const router = useTransitionRouter()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/profile/${userId}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error: string }) => Promise.reject(e.error)))
      .then(setProfile)
      .catch((e: string) => setError(typeof e === 'string' ? e : 'Could not load profile'))
      .finally(() => setLoading(false))
  }, [userId])

  const titleDef = profile?.equippedTitle ? TITLES[profile.equippedTitle] : null
  const TitleIcon = titleDef?.Icon

  const xp = profile?.xp ?? 0
  const currentLevelXp = profile?.currentLevelXp ?? 0
  const nextLevelXp = profile?.nextLevelXp ?? 100
  const xpProgress = nextLevelXp > currentLevelXp
    ? Math.min(1, (xp - currentLevelXp) / (nextLevelXp - currentLevelXp))
    : 1

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <header className="flex items-center gap-3 px-4 pt-safe pb-3 border-b border-border">
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-xl hover:bg-muted transition">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Profile</h1>
      </header>

      <div className="flex-1 px-4 pt-6 pb-safe-action space-y-6">
        {loading && (
          <div className="flex flex-col items-center gap-4 pt-12">
            <div className="h-24 w-24 rounded-full bg-muted animate-pulse" />
            <div className="h-5 w-32 rounded bg-muted animate-pulse" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 pt-12 text-center">
            <UserIcon className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {profile && (
          <>
            {/* Hero */}
            <div className="flex flex-col items-center gap-3">
              <div
                className="relative h-24 w-24 overflow-hidden rounded-full border-2"
                style={{ borderColor: 'var(--color-brand)', boxShadow: '0 0 20px color-mix(in oklch, var(--color-brand) 35%, transparent)' }}
              >
                {profile.avatar ? (
                  <Image src={profile.avatar} alt="" fill sizes="96px"
                    unoptimized={profile.avatar.startsWith('data:')} className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    <UserIcon className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
              </div>

              <div className="text-center">
                <p className="text-xl font-bold">{profile.displayName ?? profile.name}</p>
                {titleDef && TitleIcon && (
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <TitleIcon className="h-3.5 w-3.5 text-shadow-bg" style={{ color: 'var(--color-brand)' }} />
                    <span className="text-sm font-semibold text-shadow-bg" style={{ color: 'var(--color-brand)' }}>
                      {titleDef.display}
                    </span>
                  </div>
                )}
                {profile.friendCode && (
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{profile.friendCode}</p>
                )}
              </div>

              {/* Level badge */}
              <div
                className="flex items-center gap-2 rounded-2xl px-4 py-2 border"
                style={{
                  background: 'color-mix(in oklch, var(--color-brand) 10%, transparent)',
                  borderColor: 'color-mix(in oklch, var(--color-brand) 30%, transparent)',
                }}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black"
                  style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}
                >
                  {profile.level}
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold leading-none text-shadow-bg" style={{ color: 'var(--color-brand)' }}>
                    Level {profile.level} · {profile.levelLabel}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{profile.xp.toLocaleString()} XP total</p>
                </div>
              </div>

              {/* XP bar */}
              <div className="w-full max-w-xs">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in oklch, var(--color-brand) 12%, transparent)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.round(xpProgress * 100)}%`, background: 'var(--color-brand)', boxShadow: '0 0 6px var(--color-brand)' }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1 px-0.5">
                  <p className="text-[10px] text-muted-foreground tabular-nums">{xp.toLocaleString()} XP</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {nextLevelXp > xp ? `${(nextLevelXp - xp).toLocaleString()} to next level` : 'Max level'}
                  </p>
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className={`grid gap-2 ${profile.totalDistanceKm > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <div className="rounded-2xl bg-muted/40 border border-border p-3 text-center">
                <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>{profile.lifetimeSessions.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Sessions</p>
              </div>
              <div className="rounded-2xl bg-muted/40 border border-border p-3 text-center">
                <p className="text-lg font-bold tabular-nums" style={{ color: '#ff6a1a' }}>{formatVolume(profile.lifetimeVolumeKg)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Volume</p>
              </div>
              <div className="rounded-2xl bg-muted/40 border border-border p-3 text-center">
                <p className="flex items-center justify-center gap-1 text-lg font-bold tabular-nums" style={{ color: '#f59e0b' }}>
                  {profile.bestStreak}
                  <Flame className="h-4 w-4 flex-none" aria-hidden />
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Best streak</p>
              </div>
              {profile.totalDistanceKm > 0 && (
                <div className="rounded-2xl bg-muted/40 border border-border p-3 text-center">
                  <p className="text-lg font-bold tabular-nums" style={{ color: '#00d4ff' }}>{profile.totalDistanceKm.toFixed(1)}km</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Distance</p>
                </div>
              )}
            </div>

            {/* Trophy Case */}
            <TrophyCase achievements={profile.achievements} readOnly pinnedIds={profile.trophyCase} />
          </>
        )}
      </div>
    </div>
  )
}
