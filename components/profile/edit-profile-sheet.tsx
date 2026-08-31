'use client'

import { useState } from 'react'
import { savePreference } from '@/lib/user/preferences-sync'
import { toast } from 'sonner'
import { ChevronDown, KeyRound, Loader2, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { User } from '@trainingai/shared/types'

interface EditProfileSheetProps {
  user: User | null
  onSaved: (updated: User) => void
}

function Divider() {
  return <div className="h-px bg-border mx-4" />
}

export function EditProfileSheet({ user, onSaved }: EditProfileSheetProps) {
  const [open, setOpen] = useState(false)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [weightGoalKg, setWeightGoalKg] = useState(user?.weightGoalKg?.toString() ?? '')
  const [timezone, setTimezone] = useState(user?.timezone ?? 'Australia/Brisbane')
  const [units, setUnits] = useState<'kg' | 'lbs'>('kg')
  const [foodRegion, setFoodRegion] = useState('AU')

  const [hasPassword, setHasPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [isPasswordExpanded, setIsPasswordExpanded] = useState(false)

  const [saving, setSaving] = useState(false)
  // Both are always-selected groups, so `hasSelection` is unconditionally true.
  const unitsGroup = useRovingRadioGroup(true)
  const regionGroup = useRovingRadioGroup(true)

  function resetFromUser(u: User | null) {
    if (!u) return
    setDisplayName(u.displayName ?? '')
    setWeightGoalKg(u.weightGoalKg?.toString() ?? '')
    setTimezone(u.timezone ?? 'Australia/Brisbane')
    try {
      const fr = localStorage.getItem('ta_food_region')
      if (fr) setFoodRegion(fr)
    } catch { /* ignore */ }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) resetFromUser(user)
    setOpen(nextOpen)
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // BF-78. This sheet edits three fields and now sends three. The five it used to resend
        // were a workaround for the route nulling anything omitted; it is a real partial update
        // now, so resending them would be the thing that could go stale.
        body: JSON.stringify({
          displayName: displayName || null,
          weightGoalKg: weightGoalKg ? Number(weightGoalKg) : null,
          timezone: timezone || null,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast.success('Profile saved')
      onSaved(data.user)
      setOpen(false)
    } catch {
      toast.error('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  async function savePassword() {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPassword || undefined, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update password')
        return
      }
      toast.success('Password updated')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setHasPassword(true)
    } catch {
      toast.error('Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="h-4 w-4" />
          Edit Profile
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-0">
        <SheetHeader className="px-4 pb-4 border-b border-border">
          <SheetTitle>Edit Profile</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto">
          <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden mx-4 mt-4">
            {/* Display Name */}
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <Label htmlFor="ep-displayName" className="text-xs text-muted-foreground">Display Name</Label>
                <Input
                  id="ep-displayName"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder={user?.name ?? 'Your name'}
                  className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            <Divider />

            {/* Weight Goal */}
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <Label htmlFor="ep-weightGoal" className="text-xs text-muted-foreground">Weight Goal (kg)</Label>
                <Input
                  id="ep-weightGoal"
                  type="number"
                  value={weightGoalKg}
                  onChange={e => setWeightGoalKg(e.target.value)}
                  placeholder="80"
                  min={20}
                  max={500}
                  step={0.1}
                  className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            <Divider />

            {/* Timezone */}
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Timezone</p>
                <p className="text-sm font-medium mt-0.5 truncate">{timezone}</p>
              </div>
              <button
                type="button"
                aria-label="Auto-detect timezone"
                onClick={() => {
                  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
                  setTimezone(detected)
                  toast.success(`Set to ${detected}`)
                }}
                className="flex-none rounded-lg px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted transition"
              >
                Auto-detect
              </button>
            </div>

            <Divider />

            {/* Weight Units */}
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p id="ep-units-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Weight Units</p>
                <p className="text-sm font-medium mt-0.5">Kg / Lbs</p>
              </div>
              <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold" {...unitsGroup.groupProps} aria-labelledby="ep-units-label">
                <button
                  type="button"
                  {...unitsGroup.getRadioProps(units === 'kg', 0)}
                  onClick={() => setUnits('kg')}
                  className={`rounded-lg px-3 py-1.5 transition ${units === 'kg' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                >kg</button>
                <button
                  type="button"
                  {...unitsGroup.getRadioProps(units === 'lbs', 1)}
                  onClick={() => setUnits('lbs')}
                  className={`rounded-lg px-3 py-1.5 transition ${units === 'lbs' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                >lbs</button>
              </div>
            </div>

            <Divider />

            {/* Food Region */}
            <div className="px-4 py-3 space-y-2">
              <p id="ep-foodRegion-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Food Region</p>
              <p className="text-[10px] text-muted-foreground">Used to bias AI food analysis toward local brands.</p>
              <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border" {...regionGroup.groupProps} aria-labelledby="ep-foodRegion-label">
                {['AU', 'US', 'UK', 'NZ'].map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    {...regionGroup.getRadioProps(foodRegion === r, i)}
                    onClick={() => { setFoodRegion(r); savePreference('foodRegion', r) }}
                    className={`rounded-lg px-4 py-1.5 transition ${foodRegion === r ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                  >{r}</button>
                ))}
              </div>
            </div>

            <Divider />

            {/* Change Password */}
            <div>
              <button
                type="button"
                onClick={() => setIsPasswordExpanded(v => !v)}
                aria-expanded={isPasswordExpanded}
                className="flex w-full items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Change Password</span>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isPasswordExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isPasswordExpanded && (
                <div className="space-y-3 px-4 pb-4">
                  {hasPassword && (
                    <div className="space-y-1">
                      <Label htmlFor="ep-currentPassword" className="text-xs text-muted-foreground">Current password</Label>
                      <Input
                        id="ep-currentPassword"
                        type="password"
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                        className="h-9"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="ep-newPassword" className="text-xs text-muted-foreground">New password</Label>
                    <Input
                      id="ep-newPassword"
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ep-confirmPassword" className="text-xs text-muted-foreground">Confirm new password</Label>
                    <Input
                      id="ep-confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-9"
                    />
                  </div>
                  <Button
                    onClick={savePassword}
                    disabled={savingPassword || !newPassword || !confirmPassword}
                    variant="outline"
                    className="w-full h-9"
                  >
                    {savingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Update password
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pt-4 pb-6">
            <Button onClick={save} disabled={saving} className="w-full h-11">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Profile
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
