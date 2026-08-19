import { NextRequest, NextResponse } from "next/server";
import { refusalResponse, isRefusal } from '@/lib/api/route-errors'
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { computeDefaultVolumeTargets } from "@trainingai/shared/ai-periodization/volume-targets";
import type { Program } from "@trainingai/shared/types";
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A whole program with its sessions and exercises.
const MAX_BODY_BYTES = 256 * 1024

async function getUserId() {
  const session = await auth();
  return session?.user?.id;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const programs = await (await getRepository()).listPrograms(userId);
  return NextResponse.json({ programs }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = (read.body ?? {}) as { program?: Program; linkPhaseSetOwnership?: boolean; recalibrateCycleAnchor?: boolean; programId?: string };

  const repo = await getRepository();

  // Recalibration-only request — recomputes the block-cycle anchor from training
  // history without touching the program's sessions/exercises.
  if (body.recalibrateCycleAnchor && body.programId) {
    await repo.autoRecalibrateCycleAnchor(userId, body.programId);
    return NextResponse.json({ ok: true });
  }

  if (!body.program?.name) {
    return NextResponse.json({ error: "Invalid program" }, { status: 400 });
  }

  try {
    // A client-supplied FK into a strictly user-scoped table: `phase_sets.user_id` is NOT NULL and
    // there is no shared or global set, so any id the caller does not own is either a mistake or an
    // attempt to mount someone else's phase structure onto their own program (Q-129). Same
    // validate-against-the-owned-list shape as phase-sets/[id]/route.ts does for style ids.
    if (body.program.phaseSetId) {
      const ownedPhaseSetIds = new Set((await repo.listPhaseSets(userId)).map(ps => ps.id))
      if (!ownedPhaseSetIds.has(body.program.phaseSetId)) {
        return NextResponse.json({ error: 'Invalid phaseSetId' }, { status: 400 })
      }
    }

    // Capture the phase set this program was on before this save overwrites it,
    // so we can tell below whether the user just switched to a different one.
    const previousPhaseSetId = body.program.id
      ? (await repo.listPrograms(userId)).find(p => p.id === body.program!.id)?.phaseSetId
      : undefined

    const saved = await repo.saveProgram(userId, {
      ...body.program,
      userId,
      id: body.program.id ?? '',
      createdAt: body.program.createdAt ?? new Date(),
      updatedAt: new Date(),
    });

    // Only update phase settings when the caller explicitly sets phaseSetId or sessionsPerCycle.
    // Simple activation calls (spreading the existing program) must not touch phase_set_id so
    // they don't fail on DBs where the column isn't yet present.
    const hasPhaseUpdate = body.program.phaseSetId !== undefined || body.program.sessionsPerCycle !== undefined
    if (body.program.phaseMode && hasPhaseUpdate) {
      await repo.updateProgramPhaseSettings(saved.id, userId, {
        phaseMode: body.program.phaseMode,
        ...(body.program.sessionsPerCycle !== undefined ? { sessionsPerCycle: body.program.sessionsPerCycle ?? null } : {}),
        ...(body.program.phaseSetId !== undefined ? { phaseSetId: body.program.phaseSetId || null } : {}),
      });
    }

    // Switching to a different phase set on an already-automatic program changes the
    // block length (sessionsPerCycle * total phase cycles), so the existing cycle anchor
    // would place the user at the wrong point in the new cycle — re-derive it from history.
    if (
      body.program.phaseMode === 'automatic' &&
      body.program.phaseSetId &&
      previousPhaseSetId &&
      body.program.phaseSetId !== previousPhaseSetId
    ) {
      await repo.autoRecalibrateCycleAnchor(userId, saved.id);
    }

    if (body.linkPhaseSetOwnership && saved.phaseSetId) {
      await repo.linkPhaseSetOwnership(saved.phaseSetId, saved.id, userId);
    }

    // Seed default weekly per-muscle volume targets for new AI-dynamic programs so the
    // engine can steer set volume each session; never overwrite targets already set.
    if (body.program.phaseMode === 'ai_dynamic' && saved.id) {
      const existing = await repo.listVolumeTargets(userId, saved.id);
      if (existing.length === 0) {
        const targets = computeDefaultVolumeTargets(
          body.program.trainingGoal ?? 'strength',
          body.program.sessions ?? [],
        );
        if (targets.length > 0) await repo.replaceVolumeTargets(userId, saved.id, targets);
      }
    }

    // A structural edit (roles, exercises, time budget) must void any cached AI
    // prescription for this program's sessions — otherwise the pre-edit prescription
    // keeps driving load until its 7-day expiry. Cleared to 'consumed' so the next
    // view of each session regenerates a fresh, edit-aware prescription.
    if (saved.id) await repo.clearProgramPrescriptions(userId, saved.id);

    return NextResponse.json({ ok: true, program: saved });
  } catch (e) {
    // Past a refusal only — a name clash is a user action, not a server fault.
    if (!isRefusal(e)) {
      reportServerError(e, { userId, url: '/api/workout-templates' })
      console.error('[workout-templates POST]', e)
    }
    return refusalResponse(e, 'Save failed')
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = (read.body ?? {}) as { id?: string; name?: string };
  if (!body.id && !body.name) return NextResponse.json({ error: "Missing id or name" }, { status: 400 });

  const repo = await getRepository();
  if (body.id) {
    await repo.deleteProgram(userId, body.id);
  } else {
    const programs = await repo.listPrograms(userId);
    const program = programs.find(p => p.name === body.name);
    if (program) await repo.deleteProgram(userId, program.id);
  }
  return NextResponse.json({ ok: true });
}
