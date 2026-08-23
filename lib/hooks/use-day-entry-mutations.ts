"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getLocalStore } from "@/lib/local-store";
import { invalidateWorkoutSummaries, invalidateActivityWrites } from "@/lib/cache-groups";
import type { DayExercise } from "@/app/api/day-log/route";
import type { ActivityLog } from "@trainingai/shared/types";

export type EditExState = { ex: DayExercise; weights: number[]; reps: number[] } | null;

/**
 * Edit/delete for a day's logged exercises, sessions and activities.
 *
 * LB-1: these four handlers used to live in `health-content.tsx`, driving the day-overlay sheet.
 * Q-110 replaced the calendar's day-tap with a push to `/health/day`, which left the sheet — and
 * therefore every edit and delete control in the app — unreachable. They are a hook rather than a
 * second copy so the day screen and any future caller share one write path per domain.
 *
 * `onChanged(date)` is called after the caches are cleared, never before: every one of these reads
 * back through `day-log:<date>`, so refetching first repaints the pre-write row from a cache hit.
 */
export function useDayEntryMutations(
  userId: string | undefined,
  currentDate: () => string,
  onChanged: (date: string) => void,
) {
  const [editEx, setEditEx] = useState<EditExState>(null);
  const [deleteEx, setDeleteEx] = useState<DayExercise | null>(null);
  const [deleteSession, setDeleteSession] = useState<{ id: string; name: string } | null>(null);
  const [deleteActivity, setDeleteActivity] = useState<ActivityLog | null>(null);
  const [mutating, setMutating] = useState(false);

  const handleEditSave = useCallback(async () => {
    if (!editEx) return;
    const ex = editEx;
    const date = currentDate();
    setMutating(true);
    // Feedback-first (PERF-10): close + toast synchronously, don't wait on the
    // network round-trip.
    toast.success("Updated");
    setEditEx(null);
    try {
      const res = await fetch("/api/workout-entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseLogId: ex.ex.exerciseLogId, weights: ex.weights, reps: ex.reps }),
      });
      if (!res.ok) throw new Error();
      // Mirror into the local store so this device's own render reflects the edit
      // immediately instead of waiting for the next pull (SYNC-R4).
      if (userId) {
        const store = getLocalStore(userId);
        if (store) {
          // intensityPct omitted (not set to null) — the server recomputes it from the
          // new weights/1RM; the mirror must not clobber that with a bare null (SYNC-4).
          const sets = ex.weights.map((weightKg, i) => ({
            setNumber: i + 1, weightKg, reps: ex.reps[i] ?? 0,
          }));
          await store.updateExerciseLogLocally(ex.ex.exerciseLogId, sets);
        }
      }
      // weights-summary/strength-trend/exercise-history/progress-summary all derive from this edit
      // too, not just the mid-session-log subset invalidateExerciseLogged covers (CCH-2/SYN-9).
      await invalidateWorkoutSummaries().catch(() => {});
      onChanged(date);
    } catch {
      toast.error("Failed to update");
      // Reconcile back to server truth since the optimistic toast already said it saved.
      await invalidateWorkoutSummaries().catch(() => {});
      onChanged(date);
    }
    finally { setMutating(false); }
  }, [editEx, currentDate, onChanged, userId]);

  const handleDeleteExercise = useCallback(async () => {
    if (!deleteEx) return;
    const ex = deleteEx;
    const date = currentDate();
    setMutating(true);
    toast.success("Deleted");
    setDeleteEx(null);
    try {
      const res = await fetch("/api/workout-entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseLogId: ex.exerciseLogId }),
      });
      if (!res.ok) throw new Error();
      const resBody = await res.json().catch(() => null) as { sessionDeleted?: boolean } | null;
      // Mirror into the local store so it vanishes from this device's own render
      // immediately instead of resurrecting until the next pull (SYNC-R4). If this
      // was the session's last exercise, the server also tombstoned the whole
      // session (SYN-2) — mirror that too, or the empty shell lingers locally.
      if (userId) {
        const store = getLocalStore(userId);
        if (store) {
          if (resBody?.sessionDeleted && ex.workoutSessionId) {
            await store.deleteWorkoutSessionLocally(ex.workoutSessionId);
          } else {
            await store.deleteExerciseLogLocally(ex.exerciseLogId);
          }
        }
      }
      // Deleting a session decrements its AI-periodization phase counter server-side;
      // clear the derived caches (periodization overview, training load, timeline, …)
      // so the stale "N sessions" count refreshes instead of sticking for 30 min.
      await invalidateWorkoutSummaries().catch(() => {});
      onChanged(date);
    } catch {
      toast.error("Failed to delete");
      await invalidateWorkoutSummaries().catch(() => {});
      onChanged(date);
    }
    finally { setMutating(false); }
  }, [deleteEx, currentDate, onChanged, userId]);

  const handleDeleteSession = useCallback(async () => {
    if (!deleteSession) return;
    const session = deleteSession;
    const date = currentDate();
    setMutating(true);
    toast.success("Session deleted");
    setDeleteSession(null);
    try {
      const res = await fetch("/api/workout-sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutSessionId: session.id }),
      });
      if (!res.ok) throw new Error();
      // Mirror into the local store (SYN-2) so the empty session shell disappears
      // from this device's own render immediately instead of resurrecting until
      // the next pull.
      if (userId) {
        const store = getLocalStore(userId);
        if (store) await store.deleteWorkoutSessionLocally(session.id);
      }
      // Deleting a whole session shifts phase counters, training load, timeline
      // and history counts — clear derived caches so they don't serve stale totals.
      await invalidateWorkoutSummaries().catch(() => {});
      onChanged(date);
    } catch {
      toast.error("Failed to delete session");
      await invalidateWorkoutSummaries().catch(() => {});
      onChanged(date);
    }
    finally { setMutating(false); }
  }, [deleteSession, currentDate, onChanged, userId]);

  const handleDeleteActivity = useCallback(async () => {
    if (!deleteActivity) return;
    const log = deleteActivity;
    const date = currentDate();
    setMutating(true);
    try {
      const res = await fetch("/api/activity-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: log.id }),
      });
      if (!res.ok) throw new Error();
      // Q-488: three other screens read activity_logs local-first, so a server-only delete left it
      // visible there until the next sync. See deleteActivityLog in sqlite-backend for the why.
      if (userId) await getLocalStore(userId)?.deleteActivityLog(log.id).catch(() => {});
      toast.success("Deleted");
      setDeleteActivity(null);
      await invalidateActivityWrites();
      onChanged(date);
    } catch { toast.error("Failed to delete"); }
    finally { setMutating(false); }
  }, [deleteActivity, currentDate, onChanged, userId]);

  return {
    editEx, setEditEx,
    deleteEx, setDeleteEx,
    deleteSession, setDeleteSession,
    deleteActivity, setDeleteActivity,
    mutating,
    handleEditSave, handleDeleteExercise, handleDeleteSession, handleDeleteActivity,
  };
}
