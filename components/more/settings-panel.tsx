"use client"

import { useEffect, useState } from 'react'
import { savePreference } from '@/lib/user/preferences-sync'
import { Activity, Bell, Calendar, ChevronDown, Palette, Route, Settings, Terminal, Timer } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
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
  }, [])

  const toggleCalendarSync = (val: boolean) => {
    setCalendarSync(val)
    savePreference('calendarSync', val)
  }

  const toggleDayReviewReminders = (val: boolean) => {
    setDayReviewRemindersEnabled(val)
    savePreference('dayReviewReminders', val)
  }

  const toggleHealthAlerts = (val: boolean) => {
    setHealthAlertsEnabled(val)
    savePreference('healthAlerts', val)
  }

  const toggleRestChip = (val: boolean) => {
    setRestChipEnabled(val)
    localStorage.setItem('ta_pref_rest_chip', String(val))
  }

  const toggleRunChip = (val: boolean) => {
    setRunChipEnabled(val)
    localStorage.setItem('ta_pref_run_chip', String(val))
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

/** Developer is a separate card rather than a fourth row in the block above: it is admin-only, so
 *  folding it into the same container would leave a visibly short card for everyone else. It
 *  carries no heading (BF-82) — "DEVELOPER" over one row was the same single-row-group shape the
 *  More tab had seven of, and the row already says what it is. */
export function DeveloperSettingsGroup() {
  const router = useTransitionRouter()
  return (
    <MoreRowGroup>
      <MoreRow
        icon={Terminal}
        label="Device consoles &amp; diagnostics"
        onClick={() => router.push('/more/settings/developer')}
      />
    </MoreRowGroup>
  )
}
