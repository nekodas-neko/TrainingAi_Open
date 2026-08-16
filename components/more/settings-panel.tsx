"use client"

import { useEffect, useState } from 'react'
import { Activity, Bell, Calendar, ChevronDown, Loader2, Palette, Route, Settings, Terminal, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { subscribeToPush, unsubscribeFromPush } from '@/lib/push-client'
import { ThemeColorPicker } from '@/components/theme-color-picker'
import { DynamicBackgroundSettings } from '@/components/profile/dynamic-background-settings'
import { HomeWidgetsSection } from './home-widgets-section'
import { MoreRow, MoreRowGroup } from './more-row'
import { useTransitionRouter } from '@/lib/view-transition'

/** Preferences · Theme & Appearance · Home Widgets. Every value here is a localStorage flag read
 *  by some other screen, so the state is local to this panel — nothing in the More tab read it. */
export function SettingsPanel() {
  const [appearanceExpanded, setAppearanceExpanded] = useState(false)
  const [preferencesExpanded, setPreferencesExpanded] = useState(false)
  const [calendarSync, setCalendarSync] = useState(true)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushSupported, setPushSupported] = useState(false)
  const [sendingTestPush, setSendingTestPush] = useState(false)
  const [dayReviewRemindersEnabled, setDayReviewRemindersEnabled] = useState(true)
  const [restChipEnabled, setRestChipEnabled] = useState(true)
  const [runChipEnabled, setRunChipEnabled] = useState(true)
  const [healthAlertsEnabled, setHealthAlertsEnabled] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('ta_pref_day_review_reminders')
    if (stored !== null) setDayReviewRemindersEnabled(stored !== 'false')
    const chip = localStorage.getItem('ta_pref_rest_chip')
    if (chip !== null) setRestChipEnabled(chip !== 'false')
    const runChip = localStorage.getItem('ta_pref_run_chip')
    if (runChip !== null) setRunChipEnabled(runChip !== 'false')
    const health = localStorage.getItem('ta_pref_health_alerts')
    if (health !== null) setHealthAlertsEnabled(health !== 'false')
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('ta_pref_calendar_sync')
    if (stored !== null) setCalendarSync(stored !== 'false')
    // Check push support and current state
    if (typeof window !== 'undefined' && 'PushManager' in window) {
      setPushSupported(true)
      setPushEnabled(localStorage.getItem('ta_pref_push_enabled') === 'true')
    }
  }, [])

  const toggleCalendarSync = (val: boolean) => {
    setCalendarSync(val)
    localStorage.setItem('ta_pref_calendar_sync', String(val))
  }

  const toggleDayReviewReminders = (val: boolean) => {
    setDayReviewRemindersEnabled(val)
    localStorage.setItem('ta_pref_day_review_reminders', String(val))
  }

  const toggleHealthAlerts = (val: boolean) => {
    setHealthAlertsEnabled(val)
    localStorage.setItem('ta_pref_health_alerts', String(val))
  }

  const toggleRestChip = (val: boolean) => {
    setRestChipEnabled(val)
    localStorage.setItem('ta_pref_rest_chip', String(val))
  }

  const toggleRunChip = (val: boolean) => {
    setRunChipEnabled(val)
    localStorage.setItem('ta_pref_run_chip', String(val))
  }

  const togglePush = async (val: boolean) => {
    if (val) {
      const ok = await subscribeToPush()
      if (ok) {
        setPushEnabled(true)
        localStorage.setItem('ta_pref_push_enabled', 'true')
        toast.success('Push notifications enabled')
      } else {
        toast.error('Could not enable push notifications')
      }
    } else {
      await unsubscribeFromPush()
      setPushEnabled(false)
      localStorage.setItem('ta_pref_push_enabled', 'false')
    }
  }

  const sendTestPush = async () => {
    setSendingTestPush(true)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? 'Failed to send test notification')
        return
      }
      toast.success('Test notification sent')
    } catch {
      toast.error('Network error — try again')
    } finally {
      setSendingTestPush(false)
    }
  }

  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border/60">

      {/* Preferences */}
      <div>
        <Collapsible open={preferencesExpanded} onOpenChange={setPreferencesExpanded}>
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
              <Settings className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Preferences</p>
              <p className="text-[10px] text-muted-foreground">Calendar sync &amp; app behaviour</p>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${preferencesExpanded ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/60 divide-y divide-border/60">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Sync to Google Calendar</p>
                  <p className="text-[10px] text-muted-foreground">Add a calendar event after each completed workout</p>
                </div>
              </div>
              <Switch checked={calendarSync} onCheckedChange={toggleCalendarSync} />
            </div>
            {pushSupported && (
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Push Notifications</p>
                    <p className="text-[10px] text-muted-foreground">Workout reminders and goal nudges</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pushEnabled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={sendingTestPush}
                      onClick={sendTestPush}
                    >
                      {sendingTestPush ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Send test'}
                    </Button>
                  )}
                  <Switch checked={pushEnabled} onCheckedChange={togglePush} />
                </div>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Day &amp; Week Review Reminders</p>
                  <p className="text-[10px] text-muted-foreground">Wind-down nudge before bed, weekly recap on Sunday</p>
                </div>
              </div>
              <Switch checked={dayReviewRemindersEnabled} onCheckedChange={toggleDayReviewReminders} />
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Health Anomaly Alerts</p>
                  <p className="text-[10px] text-muted-foreground">Notify me when illness signs, high stress, or low readiness show up</p>
                </div>
              </div>
              <Switch checked={healthAlertsEnabled} onCheckedChange={toggleHealthAlerts} />
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Rest Timer in Status Bar</p>
                  <p className="text-[10px] text-muted-foreground">Live rest countdown in the status-bar pill while resting</p>
                </div>
              </div>
              <Switch checked={restChipEnabled} onCheckedChange={toggleRestChip} />
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                  <Route className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Run/Walk in Status Bar</p>
                  <p className="text-[10px] text-muted-foreground">Live distance/time progress in the status-bar pill during a run or guided walk</p>
                </div>
              </div>
              <Switch checked={runChipEnabled} onCheckedChange={toggleRunChip} />
            </div>
          </div>
        </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Appearance */}
      <div>
        <Collapsible open={appearanceExpanded} onOpenChange={setAppearanceExpanded}>
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))' }}>
              <Palette className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Theme &amp; Appearance</p>
              <p className="text-[10px] text-muted-foreground">Accent colour, display preferences</p>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${appearanceExpanded ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 border-t border-border/60 pt-3">
            <ThemeColorPicker />
            <DynamicBackgroundSettings />
          </div>
        </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Home Widgets */}
      <HomeWidgetsSection />

    </div>
  )
}

/** Developer is a separate group rather than a fourth row in the card above: it is admin-only, so
 *  folding it into the same container would leave a visibly short card for everyone else. */
export function DeveloperSettingsGroup() {
  const router = useTransitionRouter()
  return (
    <MoreRowGroup label="Developer">
      <MoreRow
        icon={Terminal}
        label="Device consoles &amp; diagnostics"
        onClick={() => router.push('/more/settings/developer')}
      />
    </MoreRowGroup>
  )
}
