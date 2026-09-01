"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import type { ChangeEvent } from 'react'
import NextImage from 'next/image'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { invalidateUserProfile } from '@/lib/cache-groups'
import { TTL_MEDIUM, TTL_SHORT } from '@trainingai/shared/cache-ttl'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  Bluetooth, Camera, Check, CloudDownload, Copy, Dumbbell, Info, LogOut, Scan, Settings, Shield, Sparkles, UserRound,
} from 'lucide-react'
import { signOutAndClearDevice } from '@/lib/sign-out'
import type { AchievementResult } from '@/components/profile/achievements-grid'
import { EditProfileSheet } from '@/components/profile/edit-profile-sheet'
import { GoalsSection } from '@/components/profile/goals-section'
import { LevelSheet } from '@/components/profile/level-sheet'
import { TITLES } from '@trainingai/shared/types/friends'
import type { User } from '@trainingai/shared/types/user'
import type { Season } from '@trainingai/shared/types/friends'
import { CURRENT_VERSION } from '@trainingai/shared/changelog'
import dynamic from 'next/dynamic'
import { TitlePickerSheet } from './title-picker-sheet'
import { TrophyCase } from './trophy-case'
import { StatsGrid } from './stats-grid'
import { FeedbackSection } from './feedback-section'
import { MoreRow, MoreRowGroup } from './more-row'

const AchievementsSection = dynamic(
  () => import('./achievements-section').then(m => ({ default: m.AchievementsSection })),
  { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-xl bg-muted" /> },
)

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const LEVEL_LABELS = ['', 'Novice', 'Novice', 'Beginner', 'Beginner', 'Intermediate', 'Intermediate', 'Advanced', 'Advanced', 'Elite', 'Elite', 'Legend']

interface AchievementsData {
  level: number
  levelLabel: string
  xp: number
  currentLevelXp: number
  nextLevelXp: number
  lifetimeStats: { sessions: number; totalVolumeKg: number; bestStreak: number; totalSets: number; totalDistanceKm: number }
  achievements: AchievementResult[]
}

interface ProgramWeekInfo {
  mode: 'cycle' | 'tenure' | null
  weeksRunning?: number
  cycleCurrent?: number
  cycleTotal?: number
  phaseName?: string
  blockComplete?: boolean
  programName: string | null
}

function resizeToDataUrl(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}


interface ProfileTabProps {
  user: User | null
  seasons: Season[]
  equippedTitle?: string | null
  friendCode?: string | null
  onUserSaved: (updated: User) => void
  onTitleChange?: (titleId: string | null) => void
}

export function ProfileTab({ user, seasons, equippedTitle, friendCode, onUserSaved, onTitleChange }: ProfileTabProps) {
  const router = useTransitionRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [avatarOverride, setAvatarOverride] = useState<string | null>(null)
  const [achievementsData, setAchievementsData] = useState<AchievementsData | null>(null)
  const [achievementsLoading, setAchievementsLoading] = useState(true)
  const [showAllAchievements, setShowAllAchievements] = useState(false)
  const [showTitlePicker, setShowTitlePicker] = useState(false)
  const [friendCodeCopied, setFriendCodeCopied] = useState(false)
  const [programWeeks, setProgramWeeks] = useState<ProgramWeekInfo | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [feedbackCount, setFeedbackCount] = useState(0)

  const isAdmin = user?.isAdmin

  // useLayoutEffect (not useEffect) so the synchronous cache seed below lands BEFORE first paint —
  // otherwise AchievementsSection renders its Loader2 spinner for one frame even with a warm cache
  // (defeating instant paint). The async cachedFetch calls stay fire-and-forget as before.
  useLayoutEffect(() => {
    // Fetch achievements
    if (user?.id) {
      const achCacheKey = `achievements:${user.id}`
      const synced = readCacheSync<AchievementsData>(achCacheKey)
      if (synced) {
        setAchievementsData(synced)
        setAchievementsLoading(false)
      }
      cachedFetch<AchievementsData>(
        achCacheKey,
        '/api/achievements',
        TTL_SHORT,
        (d) => { setAchievementsData(d); setAchievementsLoading(false) },
      ).catch(() => setAchievementsLoading(false))
    } else {
      setAchievementsLoading(false)
    }

    // Seed synchronously so StatsGrid's program info paints on a repeat visit instead of
    // rendering defaults until /api/program-week resolves.
    const seededPw = readCacheSync<ProgramWeekInfo | null>('program-week')
    if (seededPw) setProgramWeeks(seededPw)
    cachedFetch<ProgramWeekInfo | null>('program-week', '/api/program-week', TTL_MEDIUM, d => { if (d) setProgramWeeks(d) }).catch(() => {})
  }, [user?.id])

  useEffect(() => {
    if (!isAdmin) return
    const seededPending = readCacheSync<{ count: number; feedbackCount: number }>('admin-pending-count')
    if (seededPending) {
      if (seededPending.count != null) setPendingCount(seededPending.count)
      if (seededPending.feedbackCount != null) setFeedbackCount(seededPending.feedbackCount)
    }
    cachedFetch<{ count: number; feedbackCount: number }>(
      'admin-pending-count', '/api/admin/pending-count', TTL_MEDIUM,
      d => {
        if (d?.count != null) setPendingCount(d.count)
        if (d?.feedbackCount != null) setFeedbackCount(d.feedbackCount)
      },
    ).catch(() => {})
  }, [isAdmin])

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) { toast.error('Image must be under 5MB'); return }
    try {
      const dataUrl = await resizeToDataUrl(file)
      const res = await fetch('/api/user/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: dataUrl }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? 'Failed to save avatar'); return }
      setAvatarOverride(dataUrl)
      await invalidateUserProfile()
      toast.success('Avatar saved')
    } catch {
      toast.error('Failed to process image')
    }
  }

  const displayAvatar = avatarOverride ?? user?.avatar ?? null
  const displayName = user?.displayName ?? user?.name ?? null
  const initials = (displayName ?? user?.email ?? '?').slice(0, 2).toUpperCase()
  const title = equippedTitle ? TITLES[equippedTitle] : null

  const xp = achievementsData?.xp ?? 0
  const level = achievementsData?.level ?? 1
  const levelLabel = achievementsData?.levelLabel ?? LEVEL_LABELS[level] ?? 'Novice'
  const currentLevelXp = achievementsData?.currentLevelXp ?? 0
  const nextLevelXp = achievementsData?.nextLevelXp ?? 100
  const xpProgress = nextLevelXp > currentLevelXp
    ? Math.min(1, (xp - currentLevelXp) / (nextLevelXp - currentLevelXp))
    : 1
  const totalSessions = achievementsData?.lifetimeStats.sessions ?? 0
  const totalVolumeKg = achievementsData?.lifetimeStats.totalVolumeKg ?? 0
  const bestStreak = achievementsData?.lifetimeStats.bestStreak ?? 0
  const totalSets = achievementsData?.lifetimeStats.totalSets ?? 0
  const totalDistanceKm = achievementsData?.lifetimeStats.totalDistanceKm ?? 0
  const unlockedCount = achievementsData?.achievements.filter(a => a.unlocked).length ?? 0
  const totalAchievements = achievementsData?.achievements.length ?? 0
  const recentUnlocked = achievementsData?.achievements.filter(a => a.unlocked).slice(-4).reverse() ?? []

  return (
    <div className="px-4 pt-6 pb-8 space-y-6">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div
            className="relative h-24 w-24 overflow-hidden rounded-full border-2"
            style={{ borderColor: 'var(--color-brand)', boxShadow: '0 0 20px color-mix(in oklch, var(--color-brand) 35%, transparent)' }}
          >
            {displayAvatar ? (
              <NextImage src={displayAvatar} alt="Avatar" fill sizes="96px"
                unoptimized={displayAvatar.startsWith('data:')} className="object-cover" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-2xl font-bold"
                style={{ background: 'color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))' }}
              >
                {initials}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()} aria-label="Change profile photo"
            className="tap-dense tap-target-44 absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-background border border-border flex items-center justify-center shadow-sm hover:bg-muted transition"
          >
            <Camera className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />

        <div className="text-center">
          <p className="text-xl font-bold">{displayName ?? 'No name set'}</p>
          <button
            onClick={() => setShowTitlePicker(true)}
            className="inline-flex items-center gap-1 mt-0.5 rounded-lg px-2 py-0.5 active:opacity-70 transition"
          >
            {title ? (
              <>
                <title.Icon className="w-3.5 h-3.5" style={{ color: 'var(--color-brand)' }} />
                <span className="text-sm font-semibold text-shadow-bg" style={{ color: 'var(--color-brand)' }}>{title.display}</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Tap to set title</span>
            )}
          </button>
          <p className="text-sm text-muted-foreground mt-0.5">{user?.email}</p>
          {friendCode && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(friendCode)
                  setFriendCodeCopied(true)
                  toast.success('Friend code copied')
                  setTimeout(() => setFriendCodeCopied(false), 1500)
                } catch {
                  toast.error('Could not copy friend code')
                }
              }}
              className="inline-flex items-center gap-1 mt-0.5 rounded-lg px-2 py-0.5 active:opacity-70 transition"
            >
              <span className="text-xs text-muted-foreground font-mono">{friendCode}</span>
              {friendCodeCopied ? (
                <Check className="w-3 h-3 text-muted-foreground" />
              ) : (
                <Copy className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>

        {/* Level badge */}
        <LevelSheet
          level={level}
          xp={xp}
          currentLevelXp={currentLevelXp}
          nextLevelXp={nextLevelXp}
          achievements={achievementsData?.achievements ?? []}
        >
          <button
            className="flex items-center gap-2 rounded-2xl px-4 py-2 border cursor-pointer active:scale-95 transition-transform"
            style={{
              background: 'color-mix(in oklch, var(--color-brand) 10%, transparent)',
              borderColor: 'color-mix(in oklch, var(--color-brand) 30%, transparent)',
            }}
          >
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black"
              style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}
            >
              {level}
            </div>
            <div className="text-left">
              <p className="text-xs font-bold leading-none text-shadow-bg" style={{ color: 'var(--color-brand)' }}>
                Level {level} · {levelLabel}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{xp} XP total · tap for details</p>
            </div>
          </button>
        </LevelSheet>

        {/* XP bar */}
        {achievementsData && (
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
        )}
      </div>

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      <StatsGrid
        totalSessions={totalSessions}
        totalSets={totalSets}
        totalVolumeKg={totalVolumeKg}
        bestStreak={bestStreak}
        totalDistanceKm={totalDistanceKm}
        programWeeks={programWeeks}
        user={user}
      />

      {/* ── Trophy Case ───────────────────────────────────────────────────── */}
      {achievementsData && <TrophyCase achievements={achievementsData.achievements} />}

      {/* ── Achievements ──────────────────────────────────────────────────── */}
      <AchievementsSection
        achievementsLoading={achievementsLoading}
        achievements={achievementsData?.achievements ?? null}
        showAllAchievements={showAllAchievements}
        setShowAllAchievements={setShowAllAchievements}
        unlockedCount={unlockedCount}
        totalAchievements={totalAchievements}
        recentUnlocked={recentUnlocked}
      />

      {/* ── Year in review ────────────────────────────────────────────────── */}
      <button
        onClick={() => router.push('/year-review')}
        className="w-full flex items-center gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3.5 text-left active:bg-muted/20 transition-colors"
      >
        <Sparkles className="w-4 h-4 text-muted-foreground flex-none" />
        <span className="text-sm font-semibold flex-1">Your Year</span>
        <span className="text-xs text-muted-foreground">View →</span>
      </button>

      {/* ── Season badges ─────────────────────────────────────────────────── */}
      {seasons.filter(s => s.result).length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Season Badges</p>
          <div className="flex flex-wrap gap-2">
            {seasons.filter(s => s.result).map(season => (
              <div
                key={season.id}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold border"
                style={{
                  borderColor: season.result!.badgeLabel === 'Gold' ? '#f59e0b' : season.result!.badgeLabel === 'Silver' ? '#9ca3af' : '#cd7c2e',
                  color: season.result!.badgeLabel === 'Gold' ? '#f59e0b' : season.result!.badgeLabel === 'Silver' ? '#9ca3af' : '#cd7c2e',
                  background: 'var(--muted)',
                }}
              >
                {season.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Goals ─────────────────────────────────────────────────────────── */}
      <GoalsSection user={user} onUserSaved={onUserSaved} />

      {/* ── YOUR SETUP ────────────────────────────────────────────────────── */}
      {/* BF-82. These were SEVEN groups of one row each — nine counting `Feedback` here, which
          hand-copied `MoreRowGroup`'s markup, and `Developer` on the Settings sub-screen, which
          used the real one. A heading exists to group things; a heading per row is three stacked
          elements to present one tappable line, and it is most of why this screen read as long and
          empty at the same time.

          Two headings, not none and not more: a flat list would be simpler, but `Admin` is
          conditional and destructive-adjacent and reads as a mistake appended to one. Any split
          finer than *your stuff / the app* puts us back at one-row headings, which is the defect. */}
      <MoreRowGroup label="Your setup">
        {/* BF-79 put name, biological sex, birth year and height on one screen. They live there and
            nowhere else — do not re-scatter them while regrouping. */}
        <MoreRow
          icon={UserRound}
          label="Profile details"
          onClick={() => router.push('/more/details')}
        />
        {/* The Program Builder used to be a More sub-tab literally named "Workout", colliding with
            the Workout tab in the bottom nav two containers away (Q-235). */}
        <MoreRow
          icon={Dumbbell}
          label="Sessions, progression &amp; schedule"
          onClick={() => router.push('/program')}
        />
        {/* BF-71: /api/measured-rmr and /api/dexa-scans shipped reachable from nowhere, so both
            tables sat empty while every resting rate the app quoted was predicted. */}
        <MoreRow
          icon={Scan}
          label="DEXA &amp; RMR results"
          onClick={() => router.push('/more/clinical')}
        />
        {/* Ring, strap, scale and the background-location permission used to sit inline here, four
            cards deep in this scroll (Q-233). */}
        <MoreRow
          icon={Bluetooth}
          label="Ring, strap, scale &amp; permissions"
          onClick={() => router.push('/more/devices')}
        />
      </MoreRowGroup>

      {/* ── APP ───────────────────────────────────────────────────────────── */}
      <MoreRowGroup label="App">
        {/* Preferences, Theme & Appearance and Home Widgets were three collapsibles inline here
            (Q-232). */}
        <MoreRow
          icon={Settings}
          label="Notifications, appearance &amp; home layout"
          onClick={() => router.push('/more/settings')}
        />
        {/* Data operations do not belong under a version number — they were one block with it
            under an "About" heading (Q-232). */}
        <MoreRow
          icon={CloudDownload}
          label="Data &amp; Sync"
          onClick={() => router.push('/more/data')}
        />
        {/* Keep: the version string is how a stale-bundle question gets answered. */}
        <MoreRow
          icon={Info}
          label={`TrainingAI v${CURRENT_VERSION}`}
          onClick={() => router.push('/more/about')}
        />
        {/* Admin sits INSIDE this group rather than keeping its own heading — that is how it
            became a single-row group. `isAdmin` makes it three rows for everyone else and four for
            the owner, both fine. */}
        {isAdmin && (
          <MoreRow
            icon={Shield}
            label="Admin Console"
            onClick={() => router.push('/admin')}
            badges={<>
              {pendingCount > 0 && (
                <span className="ml-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 leading-none">
                  {pendingCount}
                </span>
              )}
              {feedbackCount > 0 && (
                <span className="ml-1 rounded-full bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">
                  {feedbackCount}
                </span>
              )}
            </>}
          />
        )}
      </MoreRowGroup>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      {/* Feedback opens a sheet rather than navigating, so it sits with the other actions instead
          of pretending to be an eighth destination. */}
      <div className="space-y-2">
        <FeedbackSection />
        <EditProfileSheet user={user} onSaved={(updated) => { onUserSaved(updated); invalidateUserProfile().catch(() => {}) }} />
        <Button variant="ghost" className="w-full text-destructive hover:text-destructive"
          onClick={() => { void signOutAndClearDevice(); }}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>

      <TitlePickerSheet
        open={showTitlePicker}
        onOpenChange={setShowTitlePicker}
        unlockedAchievementIds={achievementsData?.achievements.filter(a => a.unlocked).map(a => a.id) ?? []}
        currentTitle={equippedTitle ?? null}
        onEquip={(titleId) => {
          onTitleChange?.(titleId)
          setShowTitlePicker(false)
        }}
      />
    </div>
  )
}
