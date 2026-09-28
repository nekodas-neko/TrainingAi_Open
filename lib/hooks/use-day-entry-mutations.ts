"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getLocalStore } from "@/lib/local-store";
import { pushThenRevalidate } from "@/lib/local-store/push-then-revalidate";
import { invalidateWorkoutSummaries, invalidateActivityWrites } from "@/lib/cache-groups";
import { todayInTz } from "@trainingai/shared/date-utils";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
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
  // The user's setting, not the device's and not the Brisbane default — a bare `todayInTz()` keys
  // the outbox row to the wrong day for anyone outside AEST (Q-477).
  const tz = useUserTimezone();

  const handleEditSave = useCallback(async () => {
    if (!editEx) return;
    const ex = editEx;
    const date = currentDate();
    setMutating(true);
    const store = userId ? getLocalStore(userId) : null;
    const sets = ex.weights.map((weightKg, i) => ({
      setNumber: i + 1, weightKg, reps: ex.reps[i] ?? 0,
    }));
    try {
      if (store) {
        // LA-166: write locally in PENDING mode and queue, so this survives offline. It used to
        // `fetch` first and mirror only after a 2xx, which offline toasted "Updated", then
        // "Failed to update", and queued nothing — the edit was simply gone.
        //
        // `pending`, not the default `synced`: a row left synced is one a pull may clobber before
        // the push lands. It moves to synced on push confirmation.
        await store.updateExerciseLogLocally(ex.ex.exerciseLogId, sets, { pending: true });
        await store.queueMutation({
          userId: userId!, domain: 'exercise_log_edit', date: todayInTz(tz),
          payload: { exerciseLogId: ex.ex.exerciseLogId, weights: ex.weights, reps: ex.reps },
        });
        // Feedback fires after the LOCAL write, never after the network — the saves-feel-instant
        // rule, and offline there is no network to wait for.
        toast.success("Updated");
        setEditEx(null);
        await invalidateWorkoutSummaries().catch(() => {});
        onChanged(date);
        pushThenRevalidate(userId!, async () => {
          await invalidateWorkoutSummaries().catch(() => {});
          onChanged(currentDate());
        });
        return;
      }
      // Web fallback, logic-free by policy: the sandbox has no local store, so `pnpm dev` still
      // renders. It carries no defaults or semantics the device path lacks.
      toast.success("Updated");
      setEditEx(null);
      const res = await fetch("/api/workout-entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseLogId: ex.ex.exerciseLogId, weights: ex.weights, reps: ex.reps }),
      });
      if (!res.ok) throw new Error();
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
  }, [editEx, currentDate, onChanged, userId, tz]);

  const handleDeleteExercise = useCallback(async () => {
    if (!deleteEx) return;
    const ex = deleteEx;
    const date = currentDate();
    setMutating(true);
    const store = userId ? getLocalStore(userId) : null;
    try {
      if (store) {
        // LA-166, same shape as the edit above and as `handleDeleteActivity` (Q-328).
        //
        // **The session cascade is deliberately NOT mirrored here.** Online, the response says
        // whether this was the session's last exercise and the shell is tombstoned with it. Offline
        // nothing can know that, and the server's own `deleteExerciseLog` cascades when the push
        // lands — so an empty session can linger on this device until the next pull reaps it.
        // Queuing a second `workout_session_delete` to close that window would double-delete
        // whenever the guess is wrong, which is worse than a shell that self-heals.
        await store.deleteExerciseLogLocally(ex.exerciseLogId, { pending: true });
        await store.queueMutation({
          userId: userId!, domain: 'exercise_log_delete', date: todayInTz(tz),
          payload: { exerciseLogId: ex.exerciseLogId },
        });
        toast.success("Deleted");
        setDeleteEx(null);
        await invalidateWorkoutSummaries().catch(() => {});
        onChanged(date);
        pushThenRevalidate(userId!, async () => {
          await invalidateWorkoutSummaries().catch(() => {});
          onChanged(currentDate());
        });
        return;
      }
      // Web fallback, logic-free by policy: the sandbox has no local store, so `pnpm dev` still
      // renders. It carries no defaults or semantics the device path lacks.
      toast.success("Deleted");
      setDeleteEx(null);
      const res = await fetch("/api/workout-entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseLogId: ex.exerciseLogId }),
      });
      if (!res.ok) throw new Error();
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
  }, [deleteEx, currentDate, onChanged, userId, tz]);

  const handleDeleteSession = useCallback(async () => {
    if (!deleteSession) return;
    const session = deleteSession;
    const date = currentDate();
    setMutating(true);
    const store = userId ? getLocalStore(userId) : null;
    try {
      if (store) {
        await store.deleteWorkoutSessionLocally(session.id, { pending: true });
        await store.queueMutation({
          userId: userId!, domain: 'workout_session_delete', date: todayInTz(tz),
          payload: { workoutSessionId: session.id },
        });
        toast.success("Session deleted");
        setDeleteSession(null);
        await invalidateWorkoutSummaries().catch(() => {});
        onChanged(date);
        pushThenRevalidate(userId!, async () => {
          await invalidateWorkoutSummaries().catch(() => {});
          onChanged(currentDate());
        });
        return;
      }
      // Web fallback, logic-free by policy: the sandbox has no local store, so `pnpm dev` still
      // renders. It carries no defaults or semantics the device path lacks.
      toast.success("Session deleted");
      setDeleteSession(null);
      const res = await fetch("/api/workout-sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutSessionId: session.id }),
      });
      if (!res.ok) throw new Error();
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
  }, [deleteSession, currentDate, onChanged, userId, tz]);

  const handleDeleteActivity = useCallback(async () => {
    if (!deleteActivity) return;
    const log = deleteActivity;
    const date = currentDate();
    setMutating(true);
    const store = userId ? getLocalStore(userId) : null;
    try {
      if (store) {
        // Q-328: local tombstone + outbox, so this works offline. It was the one activity-log
        // write with no outbox domain — created through the queue, deleted by a bare `fetch` that
        // simply failed with no connection.
        //
        // `softDeleteActivityLogPending`, NOT `deleteActivityLog`. The latter leaves the row
        // `synced`, which is right for a delete that already reached the server and wrong for one
        // that has not: a pull would clobber it. The row moves to `synced` on push confirmation,
        // which is what lets `applyDelta` reap its tombstone later.
        await store.softDeleteActivityLogPending(log.id);
        await store.queueMutation({
          userId: userId!, domain: 'activity_logs', date: todayInTz(tz),
          payload: { id: log.id, deleted: true },
        });
        // Feedback fires after the LOCAL write, never after the network — the saves-feel-instant
        // rule, and offline there is no network to wait for.
        toast.success("Deleted");
        setDeleteActivity(null);
        await invalidateActivityWrites();
        onChanged(date);
        pushThenRevalidate(userId!, async () => {
          await invalidateActivityWrites();
          onChanged(currentDate());
        });
        return;
      }
      // Web fallback, logic-free by policy: the sandbox has no local store, so `pnpm dev` still
      // renders. It carries no defaults or semantics the device path lacks.
      const res = await fetch("/api/activity-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: log.id }),
      });
      // A 404 means the row is already gone (Q-556) — same outcome the user asked for, not a
      // failure to report.
      if (!res.ok && res.status !== 404) throw new Error();
      toast.success("Deleted");
      setDeleteActivity(null);
      await invalidateActivityWrites();
      onChanged(date);
    } catch { toast.error("Failed to delete"); }
    finally { setMutating(false); }
  }, [deleteActivity, currentDate, onChanged, userId, tz]);

  return {
    editEx, setEditEx,
    deleteEx, setDeleteEx,
    deleteSession, setDeleteSession,
    deleteActivity, setDeleteActivity,
    mutating,
    handleEditSave, handleDeleteExercise, handleDeleteSession, handleDeleteActivity,
  };
}
