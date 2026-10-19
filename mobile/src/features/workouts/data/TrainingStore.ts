import { z } from 'zod';
import { ProgramWriteSchema } from '@trainingai/shared/validation/program-write';
import { InjuryCreateSchema } from '@trainingai/shared/validation/injury';
import { PhaseSetCloneBody } from '@trainingai/shared/validation/phase-set';
import { buildOwnedPhaseSetName } from '@trainingai/shared/phase-set-naming';
import { DEFAULT_TZ, toAestDay } from '@trainingai/shared/date-utils';
import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import type { AccountConnection } from '../../account/session.ts';
import { ApiError } from '../../account/api/client.ts';
import { programSpec, injurySpec, phaseSetsSpec, type SavedProgram } from './models.ts';
import { failureNotice } from '../../../core/reporting/index.ts';

const programBody = ProgramWriteSchema.extend({
  sessions: ProgramWriteSchema.shape.sessions.unwrap(),
});
const injuryBody = InjuryCreateSchema.required({ startedDate: true }).extend({
  notes: z.string().max(1000).nullable(),
});
const identity = { id: z.uuid(), targetId: z.uuid() };
const commandSchema = z.discriminatedUnion('kind', [
  z.object({
    ...identity,
    kind: z.literal('program_save'),
    program: programBody,
    linkPhaseSetOwnership: z.boolean().default(false),
    attempts: z.array(z.array(z.uuid())).default([]),
    clone: PhaseSetCloneBody.optional(),
    cloneBefore: z.array(z.string()).optional(),
    cloneId: z.uuid().optional(),
  }),
  z.object({ ...identity, kind: z.literal('program_delete') }),
  z.object({ ...identity, kind: z.literal('injury_save'), body: injuryBody }),
  z.object({
    ...identity,
    kind: z.literal('injury_resolve'),
    date: InjuryCreateSchema.shape.startedDate.unwrap(),
  }),
  z.object({ ...identity, kind: z.literal('injury_delete') }),
]);
export type TrainingCommand = z.infer<typeof commandSchema>;
const frameSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  programs: programSpec.schema.shape.programs.nullable(),
  injuries: injurySpec.schema.nullable(),
  programIds: z.record(z.string(), z.string().nullable()),
  operations: z.array(commandSchema),
});
type Frame = z.infer<typeof frameSchema>;
export type TrainingState = Frame & { ready: boolean; syncing: boolean; error: string | null };
const key = 'training-changes.v1';

export class TrainingStore {
  private current: TrainingState;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private initializing: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private generation = 0;
  private cancelled = false;
  private uploadingId: string | null = null;
  private versions = { programs: 0, injuries: 0 };
  constructor(
    private storage: ScopedStorage,
    readonly connection: AccountConnection,
    private uuid: () => string,
    private changed: (confirmed: boolean, mutated?: boolean) => void,
    private now = Date.now,
  ) {
    this.current = {
      version: 1,
      origin: connection.origin,
      userId: connection.userId,
      programs: null,
      injuries: null,
      programIds: {},
      operations: [],
      ready: false,
      syncing: false,
      error: null,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.current;
  private active() {
    if (this.cancelled) {
      throw new Error('The account changed.');
    }
  }
  private publish(patch: Partial<TrainingState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  initialize = (): Promise<void> => {
    if (this.cancelled) {
      return Promise.reject(new Error('The account changed.'));
    }
    if (this.current.ready) {
      return Promise.resolve();
    }
    if (this.initializing) {
      return this.initializing;
    }
    const generation = this.generation;
    this.initializing = (async () => {
      try {
        const raw = await this.storage.get(key);
        const frame = raw ? frameSchema.parse(JSON.parse(raw)) : null;
        if (
          frame &&
          (frame.origin !== this.connection.origin || frame.userId !== this.connection.userId)
        ) {
          throw new Error('Wrong account.');
        }
        if (
          frame &&
          [...(frame.programs ?? []), ...(frame.injuries ?? [])].some(
            (row) => row.userId !== this.connection.userId,
          )
        ) {
          throw new Error('Wrong account data.');
        }
        if (generation !== this.generation) {
          return;
        }
        this.publish({ ...(frame ?? {}), ready: true, error: null });
        this.changed(false, false);
        void this.sync();
      } catch (error) {
        if (generation === this.generation) {
          this.publish({
            error: failureNotice(
              'Could not open saved program and injury changes. Existing changes have been preserved.',
              error,
            ),
          });
        }
        throw error;
      } finally {
        if (generation === this.generation) {
          this.initializing = null;
        }
      }
    })();
    return this.initializing;
  };
  private commit(update: (frame: Frame) => Frame) {
    const generation = this.generation;
    const result = this.writes.then(async () => {
      if (generation !== this.generation) {
        throw new Error('The account changed.');
      }
      this.active();
      const frame = frameSchema.parse(update(this.current));
      await this.storage.set(key, JSON.stringify(frame));
      if (generation !== this.generation) {
        throw new Error('The account changed.');
      }
      this.publish(frame);
    });
    this.writes = result.catch(() => undefined);
    return result;
  }
  tracks(path: string) {
    return this.domain(path) !== null;
  }
  private domain(path: string) {
    return path === programSpec.path
      ? ('programs' as const)
      : path === injurySpec.path
        ? ('injuries' as const)
        : null;
  }
  data(path: string): unknown {
    if (path === programSpec.path && this.current.programs !== null) {
      return { programs: this.current.programs };
    }
    if (path === injurySpec.path && this.current.injuries !== null) {
      return this.current.injuries;
    }
    return undefined;
  }
  revision(path: string) {
    const domain = this.domain(path);
    return domain ? this.versions[domain] : 0;
  }
  async seed(path: string, data: unknown) {
    const domain = this.domain(path);
    if (!domain || this.current[domain] !== null) {
      return;
    }
    const rows =
      domain === 'programs'
        ? programSpec.schema.parse(data).programs
        : injurySpec.schema.parse(data);
    if (rows.some((row) => row.userId !== this.connection.userId)) {
      throw new Error('Wrong account data.');
    }
    await this.commit((frame) => (frame[domain] === null ? { ...frame, [domain]: rows } : frame));
  }
  async mergeRemote(path: string, data: unknown, revision: number) {
    const domain = this.domain(path);
    if (!domain) {
      return;
    }
    const rows =
      domain === 'programs'
        ? programSpec.schema.parse(data).programs
        : injurySpec.schema.parse(data);
    if (rows.some((row) => row.userId !== this.connection.userId)) {
      throw new Error('Wrong account data.');
    }
    await this.commit((frame) => {
      if (revision !== this.versions[domain]) {
        return frame;
      }
      const pending = frame.operations.filter((operation) =>
        operation.kind.startsWith(domain === 'programs' ? 'program_' : 'injury_'),
      );
      const touched = new Set(
        pending.flatMap((operation) => [
          operation.targetId,
          frame.programIds[operation.targetId] ?? operation.targetId,
        ]),
      );
      const deleted = new Set(
        pending
          .filter((operation) => operation.kind.endsWith('_delete'))
          .flatMap((operation) => [
            operation.targetId,
            frame.programIds[operation.targetId] ?? operation.targetId,
          ]),
      );
      const local = frame[domain] ?? [];
      const combined = rows
        .filter((row) => !deleted.has(row.id))
        .map((row) =>
          touched.has(row.id) ? (local.find((item) => item.id === row.id) ?? row) : row,
        );
      for (const row of local) {
        if (
          touched.has(row.id) &&
          !deleted.has(row.id) &&
          !combined.some((item) => item.id === row.id)
        ) {
          combined.push(row);
        }
      }
      if (domain === 'programs') {
        const active = pending.findLast(
          (operation) => operation.kind === 'program_save' && operation.program.isActive,
        );
        if (active) {
          const activeId = frame.programIds[active.targetId] ?? active.targetId;
          return {
            ...frame,
            programs: (combined as SavedProgram[]).map((program) => ({
              ...program,
              isActive: program.id === activeId,
            })),
          };
        }
      }
      return { ...frame, [domain]: combined };
    });
  }
  resolveProgramId = (id: string) => this.current.programIds[id] ?? id;
  pendingFor(path: string, id?: string) {
    const domain = this.domain(path);
    if (!domain) {
      return [];
    }
    return this.current.operations.filter(
      (operation) =>
        operation.kind.startsWith(domain === 'programs' ? 'program_' : 'injury_') &&
        (!id || operation.targetId === id || this.resolveProgramId(operation.targetId) === id),
    );
  }
  private append(operations: TrainingCommand[], change: TrainingCommand) {
    const index = operations.findLastIndex((operation) =>
      change.kind.startsWith('program_')
        ? this.resolveProgramId(operation.targetId) === this.resolveProgramId(change.targetId)
        : operation.targetId === change.targetId,
    );
    if (
      index >= 0 &&
      operations[index].id !== this.uploadingId &&
      change.kind === 'program_save' &&
      operations[index].kind === 'program_save'
    ) {
      const previous = operations[index];
      if (
        !change.clone &&
        previous.clone &&
        change.program.phaseSetId === previous.program.phaseSetId
      ) {
        change = { ...change, clone: previous.clone };
      }
      const sameClone = JSON.stringify(previous.clone) === JSON.stringify(change.clone);
      return operations.map((operation, at) =>
        at === index
          ? {
              ...change,
              id: previous.id,
              attempts: previous.attempts,
              ...(sameClone
                ? { cloneBefore: previous.cloneBefore, cloneId: previous.cloneId }
                : {}),
            }
          : operation,
      );
    }
    if (
      index >= 0 &&
      operations[index].id !== this.uploadingId &&
      change.kind === 'injury_save' &&
      operations[index].kind === 'injury_save'
    ) {
      return operations.map((operation, at) =>
        at === index ? { ...change, id: operation.id } : operation,
      );
    }
    return [...operations, change];
  }
  async saveProgram(
    program: z.infer<typeof programBody>,
    options: {
      creating?: boolean;
      linkPhaseSetOwnership?: boolean;
      clone?: z.infer<typeof PhaseSetCloneBody>;
    } = {},
  ) {
    await this.initialize();
    const body = programBody.parse(program);
    const targetId = body.id || this.uuid();
    const change = commandSchema.parse({
      kind: 'program_save',
      id: this.uuid(),
      targetId,
      program: { ...body, id: targetId },
      linkPhaseSetOwnership: options.linkPhaseSetOwnership,
      clone: options.clone,
    });
    await this.commit((frame) => {
      const id = frame.programIds[targetId] ?? targetId;
      const previous = frame.programs?.find((program) => program.id === id);
      const stamp = new Date(this.now()).toISOString();
      const record = programSpec.schema.shape.programs.element.parse({
        ...body,
        id,
        userId: this.connection.userId,
        createdAt: previous?.createdAt ?? stamp,
        updatedAt: stamp,
      });
      return {
        ...frame,
        programIds:
          (!body.id || options.creating) && !Object.hasOwn(frame.programIds, targetId)
            ? { ...frame.programIds, [targetId]: null }
            : frame.programIds,
        programs: [
          ...(frame.programs ?? [])
            .filter((program) => program.id !== id)
            .map((program) => (record.isActive ? { ...program, isActive: false } : program)),
          record,
        ],
        operations: this.append(frame.operations, change),
      };
    });
    this.versions.programs++;
    this.changed(false, true);
    void this.sync();
    return targetId;
  }
  async deleteProgram(targetId: string) {
    await this.initialize();
    const change = commandSchema.parse({ kind: 'program_delete', id: this.uuid(), targetId });
    await this.commit((frame) => ({
      ...frame,
      programs: (frame.programs ?? []).filter(
        (program) =>
          program.id !== targetId && program.id !== (frame.programIds[targetId] ?? targetId),
      ),
      operations: [...frame.operations, change],
    }));
    this.versions.programs++;
    this.changed(false, true);
    void this.sync();
  }
  async saveInjury(body: z.infer<typeof injuryBody>, id = this.uuid()) {
    await this.initialize();
    const parsed = injuryBody.parse(body);
    const change = commandSchema.parse({
      kind: 'injury_save',
      id: this.uuid(),
      targetId: id,
      body: parsed,
    });
    await this.commit((frame) => {
      const previous = frame.injuries?.find((injury) => injury.id === id);
      const stamp = new Date(this.now()).toISOString();
      const record = injurySpec.schema.element.parse({
        ...previous,
        ...parsed,
        id,
        userId: this.connection.userId,
        resolvedDate: null,
        createdAt: previous?.createdAt ?? stamp,
        updatedAt: stamp,
      });
      return {
        ...frame,
        injuries: [...(frame.injuries ?? []).filter((injury) => injury.id !== id), record],
        operations: this.append(frame.operations, change),
      };
    });
    this.versions.injuries++;
    this.changed(false, true);
    void this.sync();
    return id;
  }
  async changeInjury(targetId: string, date?: string) {
    await this.initialize();
    const change = commandSchema.parse({
      kind: date ? 'injury_resolve' : 'injury_delete',
      id: this.uuid(),
      targetId,
      date,
    });
    await this.commit((frame) => ({
      ...frame,
      injuries: date
        ? (frame.injuries ?? []).map((injury) =>
            injury.id === targetId
              ? { ...injury, resolvedDate: date, updatedAt: new Date(this.now()).toISOString() }
              : injury,
          )
        : (frame.injuries ?? []).filter((injury) => injury.id !== targetId),
      operations: [...frame.operations, change],
    }));
    this.versions.injuries++;
    this.changed(false, true);
    void this.sync();
  }
  private updateCommand(
    id: string,
    patch: Partial<
      Pick<
        Extract<TrainingCommand, { kind: 'program_save' }>,
        'attempts' | 'cloneId' | 'cloneBefore'
      >
    >,
  ) {
    return this.commit((frame) => ({
      ...frame,
      operations: frame.operations.map((operation) =>
        operation.kind === 'program_save' && operation.id === id
          ? { ...operation, ...patch }
          : operation,
      ),
    }));
  }
  private async clonePhase(command: Extract<TrainingCommand, { kind: 'program_save' }>) {
    this.active();
    if (!command.clone || command.cloneId) {
      return command.cloneId;
    }
    const phaseSets = phaseSetsSpec.schema.parse(
      await this.connection.get(phaseSetsSpec.path),
    ).phaseSets;
    this.active();
    const source = phaseSets.find((set) => set.id === command.clone!.phaseSetId);
    if (!source) {
      throw new Error('The source phase set is no longer available.');
    }
    const name = buildOwnedPhaseSetName(
      typeof source.templateBaseName === 'string' ? source.templateBaseName : source.name,
      command.clone.programName,
    );
    const phases = source.phases.map((phase) => ({
      name: phase.name,
      phaseType: phase.phaseType,
      durationCycles: command.clone!.overrides[String(phase.position)] ?? phase.durationCycles,
      primaryStyleId: phase.primaryStyleId ?? null,
    }));
    if (command.clone.includeBaseline) {
      phases.unshift({
        name: 'Baseline',
        phaseType: 'baseline',
        durationCycles: 1,
        primaryStyleId: null,
      });
    }
    const candidates = command.cloneBefore
      ? phaseSets.filter(
          (set) =>
            !command.cloneBefore!.includes(set.id) &&
            set.name === name &&
            JSON.stringify(
              set.phases.map((phase) => ({
                name: phase.name,
                phaseType: phase.phaseType,
                durationCycles: phase.durationCycles,
                primaryStyleId: phase.primaryStyleId ?? null,
              })),
            ) === JSON.stringify(phases),
        )
      : [];
    if (candidates.length > 1) {
      throw new Error('More than one phase clone matches this save.');
    }
    if (!command.cloneBefore) {
      await this.updateCommand(command.id, { cloneBefore: phaseSets.map((set) => set.id) });
    }
    const id =
      candidates[0]?.id ??
      z
        .object({ id: z.uuid() })
        .parse(await this.connection.post('/api/phase-sets/clone', command.clone)).id;
    this.active();
    await this.updateCommand(command.id, { cloneId: id });
    return id;
  }
  private async replay(command: TrainingCommand) {
    this.active();
    if (command.kind !== 'program_save' && command.kind !== 'program_delete') {
      const payload =
        command.kind === 'injury_save'
          ? { id: command.targetId, ...command.body }
          : command.kind === 'injury_resolve'
            ? { id: command.targetId, resolvedDate: command.date }
            : { id: command.targetId, deleted: true };
      const date =
        command.kind === 'injury_save'
          ? command.body.startedDate
          : command.kind === 'injury_resolve'
            ? command.date
            : toAestDay(new Date(this.now()), this.connection.timezone ?? DEFAULT_TZ);
      const response = z
        .object({ processed: z.literal(1), errors: z.array(z.unknown()).length(0) })
        .parse(
          await this.connection.post('/api/sync/push', {
            mutations: [{ id: command.id, domain: 'injuries', date, payload }],
          }),
        );
      return response;
    }
    const remoteId = this.current.programIds[command.targetId];
    if (command.kind === 'program_delete') {
      if (remoteId === null) {
        return {};
      }
      if (!this.connection.delete) {
        throw new Error('This connection cannot delete programs.');
      }
      return await this.connection.delete(programSpec.path, { id: remoteId ?? command.targetId });
    }
    const phaseSetId = await this.clonePhase(command);
    this.active();
    let id = remoteId === null ? undefined : (remoteId ?? command.targetId);
    if (remoteId === null) {
      const programs = programSpec.schema.parse(
        await this.connection.get(programSpec.path),
      ).programs;
      this.active();
      if (programs.some((program) => program.userId !== this.connection.userId)) {
        throw new Error('Wrong account data.');
      }
      const sessionIds = command.program.sessions.map((session) => session.id!);
      const attempted = command.attempts.some(
        (ids) => JSON.stringify(ids) === JSON.stringify(sessionIds),
      )
        ? command.attempts
        : [...command.attempts, sessionIds];
      const existing = programs.find((program) =>
        attempted.some(
          (ids) =>
            ids.length > 0 &&
            program.sessions.length === ids.length &&
            program.sessions.every((session, index) => session.id === ids[index]),
        ),
      );
      id = existing?.id;
      if (!id) {
        await this.updateCommand(command.id, { attempts: attempted });
      }
    }
    this.active();
    const result = z
      .object({
        ok: z.literal(true),
        program: programSpec.schema.shape.programs.element.extend({ id: z.uuid() }),
      })
      .parse(
        await this.connection.post(programSpec.path, {
          program: { ...command.program, id, ...(phaseSetId ? { phaseSetId } : {}) },
          linkPhaseSetOwnership: command.linkPhaseSetOwnership || !!phaseSetId,
        }),
      );
    if (result.program.userId !== this.connection.userId) {
      throw new Error('Wrong account data.');
    }
    return result;
  }
  sync = (): Promise<void> => {
    if (this.flushing) {
      return this.flushing;
    }
    if (this.cancelled || !this.current.ready || !this.current.operations.length) {
      return Promise.resolve();
    }
    const generation = this.generation;
    this.publish({ syncing: true, error: null });
    this.flushing = this.flush(generation).finally(() => {
      if (generation === this.generation) {
        this.flushing = null;
        this.uploadingId = null;
        this.publish({ syncing: false });
      }
    });
    return this.flushing;
  };
  private async flush(generation: number) {
    try {
      await this.writes;
      while (generation === this.generation && this.current.operations.length) {
        const command = this.current.operations[0];
        this.uploadingId = command.id;
        const response = await this.replay(command);
        if (generation !== this.generation) {
          return;
        }
        await this.commit((frame) => {
          if (command.kind === 'program_save') {
            const saved = z
              .object({ program: programSpec.schema.shape.programs.element })
              .parse(response).program;
            const remoteId = frame.programIds[command.targetId] ?? command.targetId;
            const newer = frame.operations.some(
              (operation) =>
                operation.id !== command.id &&
                operation.kind === 'program_save' &&
                operation.targetId === command.targetId,
            );
            const nextActive = frame.operations.findLast(
              (operation) =>
                operation.id !== command.id &&
                operation.kind === 'program_save' &&
                operation.program.isActive,
            );
            const confirmed =
              nextActive &&
              (frame.programIds[nextActive.targetId] ?? nextActive.targetId) !== saved.id
                ? { ...saved, isActive: false }
                : saved;
            return {
              ...frame,
              programIds: { ...frame.programIds, [command.targetId]: saved.id },
              programs: (frame.programs ?? []).map((program) =>
                program.id === remoteId
                  ? newer
                    ? { ...program, id: saved.id }
                    : confirmed
                  : program,
              ),
              operations: frame.operations.filter((operation) => operation.id !== command.id),
            };
          }
          return {
            ...frame,
            operations: frame.operations.filter((operation) => operation.id !== command.id),
          };
        });
        this.versions[command.kind.startsWith('program_') ? 'programs' : 'injuries']++;
        this.changed(true, true);
        this.uploadingId = null;
      }
    } catch (error) {
      if (generation === this.generation) {
        this.publish({
          error:
            error instanceof ApiError && [401, 403].includes(error.status)
              ? 'Sign in again to upload saved program and injury changes.'
              : error instanceof ApiError && [400, 404, 409, 422].includes(error.status)
                ? failureNotice(
                    'The backend refused a saved change. Review the pending program or injury and save corrections before retrying.',
                    error,
                  )
                : failureNotice(
                    'Saved on this phone. Program and injury changes will upload when connected; retry if needed.',
                    error,
                  ),
        });
      }
    }
  }
  cancel() {
    this.cancelled = true;
    this.generation++;
  }
}
