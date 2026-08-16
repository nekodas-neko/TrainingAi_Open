'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Sparkles, Check } from 'lucide-react'
import { readCacheSync, cachedFetch } from '@/lib/sqlite/cache'
import { invalidateExerciseLibrary } from '@/lib/cache-groups'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'
import type { ExerciseLibraryEntry, MuscleAssignment, ExerciseType } from '@trainingai/shared/types/program'
import { fuzzyScore } from '@trainingai/shared/exercise-utils'

export { fuzzyScore }

const MUSCLE_OPTIONS = [
  'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Forearms',
  'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Core',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors',
]

const EQUIPMENT_OPTIONS = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight']

interface GeneratedExercise {
  normalizedName: string
  instructions: string
  muscles: MuscleAssignment[]
  equipment: string[]
}

export interface AddExerciseSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName?: string
  onAdded: (exercise: ExerciseLibraryEntry) => void
}

export function AddExerciseSheet({ open, onOpenChange, initialName = '', onAdded }: AddExerciseSheetProps) {
  const [name, setName] = useState(initialName)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedExercise | null>(null)
  const [genError, setGenError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reviewName, setReviewName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [muscles, setMuscles] = useState<MuscleAssignment[]>([])
  const [equipment, setEquipment] = useState<string[]>([])
  const [exerciseType, setExerciseType] = useState<ExerciseType>('weighted')
  const [matches, setMatches] = useState<ExerciseLibraryEntry[]>([])
  const [library, setLibrary] = useState<ExerciseLibraryEntry[]>(() => {
    try {
      const cached = readCacheSync<{ exercises: ExerciseLibraryEntry[] }>('exercise-library')
      return cached?.exercises ?? []
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (!open || library.length > 0) return
    cachedFetch<{ exercises: ExerciseLibraryEntry[] } | null>(
      'exercise-library', '/api/exercise-library', TTL_LONG,
      d => { if (d?.exercises) setLibrary(d.exercises) },
      { freshWithinTtl: true },
    ).catch(() => {})
  }, [open, library.length])

  useEffect(() => {
    if (!open) {
      setName(initialName)
      setGenerated(null)
      setGenError(false)
      setReviewName('')
      setInstructions('')
      setMuscles([])
      setEquipment([])
      setExerciseType('weighted')
      setMatches([])
    }
  }, [open, initialName])

  useEffect(() => {
    if (open && initialName) setName(initialName)
  }, [initialName, open])

  useEffect(() => {
    if (!name.trim()) { setMatches([]); return }
    const normalizedQuery = generated?.normalizedName ?? ''
    const scored = library
      .map(ex => ({
        ex,
        score: Math.max(fuzzyScore(name, ex.name), normalizedQuery ? fuzzyScore(normalizedQuery, ex.name) : 0),
      }))
      .filter(({ score }) => score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ ex }) => ex)
    setMatches(scored)
  }, [name, generated, library])

  async function handleGenerate() {
    if (!name.trim()) return
    setGenerating(true)
    setGenError(false)
    try {
      const res = await fetch('/api/exercises/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error()
      const data: GeneratedExercise = await res.json()
      setGenerated(data)
      setReviewName(data.normalizedName)
      setInstructions(data.instructions)
      setMuscles(data.muscles)
      setEquipment(data.equipment)
      setExerciseType(data.equipment.length === 1 && data.equipment[0] === 'bodyweight' ? 'bodyweight' : 'weighted')
    } catch {
      setGenError(true)
    } finally {
      setGenerating(false)
    }
  }

  function handleUseExisting(ex: ExerciseLibraryEntry) {
    onAdded(ex)
    onOpenChange(false)
  }

  async function handleRenameAndUse(ex: ExerciseLibraryEntry) {
    const newName = reviewName.trim() || generated?.normalizedName || name.trim()
    if (!newName) return
    setSaving(true)
    try {
      const res = await fetch('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, mergeWithId: ex.id }),
      })
      if (!res.ok) { toast.error('Failed to rename exercise'); return }
      const data = await res.json()
      await invalidateExerciseLibrary()
      setLibrary(prev => prev.map(e => e.id === data.exercise.id ? data.exercise : e))
      onAdded(data.exercise)
      onOpenChange(false)
    } catch {
      toast.error('Failed to rename exercise')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    const finalName = reviewName.trim() || name.trim()
    if (!finalName) return
    setSaving(true)
    try {
      const res = await fetch('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName, muscles, equipment, instructions: instructions || undefined, exerciseType }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? 'Save failed')
        return
      }
      const data = await res.json()
      await invalidateExerciseLibrary()
      setLibrary(prev => [...prev, data.exercise])
      onAdded(data.exercise)
      onOpenChange(false)
      toast.success('Exercise added to library')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  function toggleMuscle(muscle: string, role: 'main' | 'secondary') {
    const existing = muscles.find(m => m.muscle === muscle)
    if (existing) {
      if (existing.role === role) {
        setMuscles(muscles.filter(m => m.muscle !== muscle))
      } else {
        setMuscles(muscles.map(m => m.muscle === muscle ? { ...m, role } : m))
      }
    } else {
      setMuscles([...muscles, { muscle, role }])
    }
  }

  const showReview = generated !== null || genError

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Add Exercise</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Name + Generate */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Exercise name</p>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                placeholder="e.g. DB Bench Press"
                className="h-9 flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleGenerate} disabled={generating || !name.trim()} className="shrink-0">
                {generating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Sparkles className="h-4 w-4" /><span className="ml-1.5">Generate</span></>
                }
              </Button>
            </div>
          </div>

          {/* Fuzzy matches */}
          {matches.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Similar exercises already in library</p>
              {matches.map(ex => (
                <div key={ex.id} className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ex.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {ex.muscles.filter(m => m.role === 'main').map(m => m.muscle).join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" onClick={() => handleUseExisting(ex)}>
                      Use
                    </Button>
                    {showReview && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" onClick={() => handleRenameAndUse(ex)} disabled={saving}>
                        Rename &amp; use
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI error */}
          {genError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 flex items-center justify-between gap-3">
              <p className="text-sm text-destructive">Generation failed — fill in manually or retry</p>
              <Button size="sm" variant="ghost" onClick={handleGenerate} disabled={generating}>Retry</Button>
            </div>
          )}

          {/* Review form */}
          {showReview && (
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Review &amp; save</p>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Name</p>
                <Input value={reviewName} onChange={e => setReviewName(e.target.value)} className="h-9" />
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Instructions</p>
                <textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Type</p>
                <div className="flex gap-1.5">
                  {(['weighted', 'bodyweight'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setExerciseType(t)}
                      className="text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize"
                      style={exerciseType === t
                        ? { borderColor: 'var(--color-brand)', color: 'var(--color-brand)', background: 'color-mix(in oklch, var(--color-brand) 10%, transparent)' }
                        : { borderColor: 'var(--color-border)', color: 'var(--color-muted-foreground)' }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Equipment</p>
                <div className="flex flex-wrap gap-1.5">
                  {EQUIPMENT_OPTIONS.map(o => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setEquipment(prev => prev.includes(o) ? prev.filter(e => e !== o) : [...prev, o])}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                        equipment.includes(o) ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground'
                      }`}
                      style={equipment.includes(o) ? { borderColor: 'var(--color-brand)', color: 'var(--color-brand)' } : undefined}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Muscles</p>
                <div className="flex flex-wrap gap-1.5">
                  {MUSCLE_OPTIONS.map(m => {
                    const assignment = muscles.find(a => a.muscle === m)
                    return (
                      <div key={m} className="flex rounded-lg overflow-hidden border border-border text-xs">
                        <button
                          type="button"
                          onClick={() => toggleMuscle(m, 'main')}
                          className={`px-2 py-1 transition-colors ${assignment?.role === 'main' ? 'bg-brand text-brand-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                          style={assignment?.role === 'main' ? { background: 'var(--color-brand)' } : undefined}
                          title="Primary"
                        >
                          {m}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMuscle(m, 'secondary')}
                          className={`px-1.5 py-1 border-l border-border transition-colors ${assignment?.role === 'secondary' ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground hover:text-foreground'}`}
                          title="Secondary"
                        >
                          2°
                        </button>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Tap name = primary · 2° = secondary · tap again to remove</p>
              </div>

              <Button className="w-full" onClick={handleSave} disabled={saving || !reviewName.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Save to library
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
