import { Chat } from '@ai-sdk/react';
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { z } from 'zod';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';
import {
  coachError,
  archiveSchema,
  conversationSchema,
  emptyConversation,
  historySpec,
  type CoachScope,
  type LocalThread,
} from './models.ts';
import { WidgetResultSchema, type WidgetResult } from './widgets.ts';
import { CoachTransport } from './CoachTransport.ts';
import { RENDERED_PATCH_DOMAINS } from './patch.ts';
import { failureNotice } from '../../../core/reporting/index.ts';
import type { CoachContext } from '@trainingai/shared/coach/context';
import { INTENT_NEEDS, type CoachIntent } from '@trainingai/shared/coach/chips';

/** How an entry point opens the Coach (#3896 steps 6-7): about one lift, session or workout, and
 *  optionally straight into one of its buttons (the action menu's shortcuts). */
export type CoachOpenRequest = { context?: CoachContext; chip?: string };

type State = {
  ready: boolean;
  input: string;
  threadId: string | null;
  localError: string | null;
  historyError: string | null;
  openError: string | null;
  opening: boolean;
  localThreads: LocalThread[];
  stopped: boolean;
  /** What this conversation was opened about; sent with every request, persisted with it. */
  context: CoachContext | null;
  /** A button an entry point asked to tap once the Coach's buttons have loaded. */
  pendingChip: string | null;
  /**
   * The button that started the exchange under way (#3896 review). Sent with every request of that
   * exchange — the button's own turn and each tool-result turn after it (`addToolResult`,
   * `sendAutomaticallyWhen`), which the SDK sends with no body of their own — until the user types a
   * message or taps another button. The server checks it on each request as on the first.
   */
  intent: CoachIntent | null;
  /** The lift this conversation was opened about no longer reads (a 404 from about): it was dropped. */
  contextGone: boolean;
};
export class CoachConversation {
  readonly chat: Chat<UIMessage>;
  private current: State = {
    ready: false,
    input: '',
    threadId: null,
    localError: null,
    historyError: null,
    openError: null,
    opening: false,
    localThreads: [],
    stopped: false,
    context: null,
    pendingChip: null,
    intent: null,
    contextGone: false,
  };
  private listeners = new Set<() => void>();
  private localWrites: Promise<unknown> = Promise.resolve();
  private historyWrites: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private disposed = false;
  private key: string;
  private saved = '';
  private inputTimer: ReturnType<typeof setTimeout> | null = null;
  private requestCleanup: (() => void) | null = null;
  private continued = new Set<string>();
  private localId: string;
  private visible = true;
  private inBackground = false;
  constructor(
    readonly resources: WorkoutResources,
    scope: CoachScope,
    private uuid: () => string,
  ) {
    this.key = `coach-conversation.v1:${scope}`;
    this.localId = uuid();
    this.chat = new Chat({
      generateId: uuid,
      transport: new CoachTransport({
        api: '/api/coach',
        // #3896 step 5: the gated patch domains this build renders, so the server offers them.
        // #3896 steps 6-7: and the context it was opened about, read at send time.
        body: () => ({
          scope,
          patchDomains: RENDERED_PATCH_DOMAINS,
          ...(this.current.context && { context: this.current.context }),
          ...(this.current.intent && { intent: this.current.intent }),
        }),
        fetch: async (_url, init) => {
          if (this.disposed || !resources.connection.coachStream)
            throw new Error('Coach is unavailable.');
          const body = JSON.parse(String(init?.body));
          if (body.messages.length > 60)
            throw new Error('Start a new conversation to continue.');
          const controller = new AbortController();
          const cancel = () => controller.abort();
          if (init?.signal?.aborted) cancel();
          init?.signal?.addEventListener('abort', cancel, { once: true });
          const timer = setTimeout(cancel, 120000);
          const cleanup = () => {
            clearTimeout(timer);
            init?.signal?.removeEventListener('abort', cancel);
            if (this.requestCleanup === cleanup) this.requestCleanup = null;
          };
          this.requestCleanup = cleanup;
          try {
            return await resources.connection.coachStream(body, controller.signal);
          } catch (error) {
            cleanup();
            throw error;
          }
        },
      }),
      sendAutomaticallyWhen: (state) => {
        if (!this.visible || this.inBackground || this.disposed) return false;
        if (!lastAssistantMessageIsCompleteWithToolCalls(state) || state.messages.length >= 60)
          return false;
        const signature = JSON.stringify(
          state.messages.at(-1)?.parts.filter((part) => part.type.startsWith('tool-')),
        );
        if (this.continued.has(signature)) return false;
        this.continued.add(signature);
        return true;
      },
      onFinish: ({ isError, isAbort }) => {
        this.update({ stopped: isAbort || isError });
        this.requestCleanup?.();
        this.checkpoint();
        if (!isError && !isAbort) void this.saveHistory();
      },
      onError: () => {
        this.requestCleanup?.();
        this.update({ stopped: true });
        this.checkpoint();
      },
    });
  }
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(change: Partial<State>) {
    if (!this.disposed) {
      this.current = { ...this.current, ...change };
      this.listeners.forEach((listener) => listener());
    }
  }
  private initializing: Promise<void> | null = null;
  /** One read at a time: the provider and `prepare` may both ask, and a second read finishing late
   *  must not put back a context `prepare` has just replaced. */
  initialize() {
    this.initializing ??= this.load().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }
  private async load() {
    try {
      const [saved, archived] = await Promise.all([
        this.resources.draft(this.key, conversationSchema),
        this.resources.draft(`${this.key}:archive`, archiveSchema),
      ]);
      if (this.disposed) return;
      this.chat.messages = saved?.messages ?? [];
      this.localId = saved?.localId ?? this.localId;
      this.update({ localThreads: archived ?? [], stopped: saved?.stopped ?? false });
      this.update({
        ready: true,
        input: saved?.input ?? '',
        threadId: saved?.threadId ?? null,
        context: saved?.context ?? this.current.context,
        intent: usableIntent(saved?.intent, saved?.context ?? this.current.context),
      });
      this.saved = JSON.stringify(this.chat.messages);
    } catch (failure) {
      this.update({
        localError: failureNotice(
          'Could not read your conversation. Reopen Coach to retry.',
          failure,
        ),
      });
    }
  }
  input(value: string) {
    this.update({ input: value });
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = setTimeout(() => {
      this.inputTimer = null;
      this.checkpoint();
    }, 350);
  }
  checkpoint() {
    if (!this.current.ready || this.disposed) return;
    const epoch = this.epoch;
    const frame = {
      ...emptyConversation,
      localId: this.localId,
      stopped: this.current.stopped || this.busy,
      input: this.current.input,
      threadId: this.current.threadId,
      messages: this.chat.messages,
      context: this.current.context,
      intent: this.current.intent,
    };
    this.localWrites = this.localWrites
      .catch(() => {})
      .then(async () => {
        if (this.disposed || epoch !== this.epoch) return;
        try {
          await this.resources.saveDraft(this.key, frame);
          this.update({ localError: null });
        } catch (failure) {
          this.update({
            localError:
              failureNotice(
                'Could not save this conversation on the phone. Keep Coach open and retry.',
                failure,
              ),
          });
        }
      });
    return this.localWrites;
  }
  async send(text = this.current.input, intent?: CoachIntent | null) {
    if (
      !this.current.ready ||
      this.busy ||
      this.disposed ||
      !this.visible ||
      this.inBackground ||
      this.current.opening ||
      !text.trim()
    )
      return;
    if (this.chat.messages.length >= 60) return;
    // A button sets its intent for the exchange it starts; a typed message clears it. The transport's
    // `body` reads it at send time, so the tool-result turns that follow carry it too.
    this.update({ input: '', stopped: false, intent: intent ?? null });
    const result = this.chat.sendMessage({ text: text.trim() });
    this.checkpoint();
    await result;
  }
  async retry() {
    if (!this.current.ready || this.busy || this.disposed || this.inBackground || !this.visible)
      return;
    this.update({ stopped: false });
    const result = this.chat.regenerate();
    this.checkpoint();
    await result;
  }
  get busy() {
    return this.chat.status === 'submitted' || this.chat.status === 'streaming';
  }
  enter() {
    this.visible = true;
  }
  leave() {
    this.visible = false;
    this.stop();
  }
  background(value: boolean) {
    this.inBackground = value;
    if (value) this.stop();
  }
  resolve(toolCallId: string, result: WidgetResult) {
    if (this.disposed) return;
    if (result.status === 'applied') {
      this.chat.messages = this.chat.messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          'toolCallId' in part && part.toolCallId === toolCallId
            ? { ...part, state: 'output-available', output: result }
            : part,
        ),
      })) as UIMessage[];
      this.checkpoint();
      const latest = this.chat.messages.at(-1);
      const part = latest?.parts.find(
        (part) => 'toolCallId' in part && part.toolCallId === toolCallId,
      );
      if (!this.busy && part?.type.startsWith('tool-')) {
        void this.chat.addToolResult({ tool: part.type.slice(5), toolCallId, output: result });
      }
      if (!this.busy) void this.saveHistory();
      return;
    }
    if (this.busy) return;
    const latest = this.chat.messages.findLast((message) => message.role === 'assistant');
    const part = latest?.parts.find(
      (part) => 'toolCallId' in part && part.toolCallId === toolCallId,
    );
    if (
      !part ||
      !('state' in part) ||
      part.state !== 'input-available' ||
      !part.type.startsWith('tool-')
    )
      return;
    void this.chat.addToolResult({
      tool: part.type.slice(5),
      toolCallId,
      output: WidgetResultSchema.parse(result),
    });
    this.checkpoint();
  }
  reopen(toolCallId: string) {
    if (this.busy || this.disposed || this.chat.messages.length >= 60) return;
    const part = this.chat.messages
      .flatMap((message) => message.parts)
      .find((part) => 'toolCallId' in part && part.toolCallId === toolCallId);
    if (!part || !('output' in part) || (part.output as WidgetResult)?.status !== 'chose')
      return;
    this.chat.messages = [
      ...this.chat.messages,
      {
        id: this.uuid(),
        role: 'assistant',
        parts: [
          { ...part, toolCallId: this.uuid(), state: 'input-available', output: undefined },
        ],
      },
    ] as UIMessage[];
    this.checkpoint();
  }
  async open(id: string) {
    if (this.busy || this.current.opening || this.disposed) return false;
    this.update({ opening: true, openError: null });
    const archived = this.current.localThreads.find((thread) => thread.id === id);
    if (archived) {
      this.localId = archived.id;
      this.chat.messages = archived.frame.messages;
      this.chat.clearError();
      this.saved = '';
      this.update({
        threadId: archived.frame.threadId,
        input: archived.frame.input,
        opening: false,
        stopped: archived.frame.stopped,
        context: archived.frame.context ?? null,
        intent: usableIntent(archived.frame.intent, archived.frame.context ?? null),
        pendingChip: null,
        contextGone: false,
      });
      await this.checkpoint();
      return true;
    }
    const epoch = this.epoch;
    try {
      const spec = {
        path: '/api/coach/threads',
        query: { threadId: z.uuid().parse(id) },
        schema: z.object({
          messages: z.array(
            z.object({
              role: z.enum(['user', 'assistant']),
              parts: z.array(z.object({ type: z.string() }).passthrough()),
            }),
          ),
        }),
        ttl: 300000,
      };
      await this.resources.load(spec, true);
      const state = this.resources.state(spec);
      if (!state.data || epoch !== this.epoch || this.disposed) throw new Error();
      this.chat.messages = state.data.messages.map((message) => ({
        ...message,
        id: this.uuid(),
      })) as UIMessage[];
      this.localId = this.uuid();
      this.saved = JSON.stringify(this.chat.messages);
      this.chat.clearError();
      this.update({
        threadId: id,
        input: '',
        historyError: null,
        stopped: false,
        context: null,
        intent: null,
        pendingChip: null,
        contextGone: false,
      });
      this.checkpoint();
      return true;
    } catch (failure) {
      this.update({
        openError: failureNotice(
          'Could not open that conversation. Your current chat is still here.',
          failure,
        ),
      });
      return false;
    } finally {
      this.update({ opening: false });
    }
  }
  async newConversation() {
    if (this.current.opening || this.busy) return false;
    this.update({ opening: true });
    const frame = {
      stopped: this.current.stopped,
      localId: this.localId,
      input: this.current.input,
      threadId: this.current.threadId,
      messages: this.chat.messages,
      context: this.current.context,
      intent: this.current.intent,
    };
    if (frame.messages.length || frame.input.trim()) {
      const title = frame.messages
        .filter((m) => m.role === 'user')
        .flatMap((m) => m.parts)
        .find((part) => part.type === 'text');
      const archive = [
        {
          id: this.localId,
          title: title?.type === 'text' ? title.text.slice(0, 120) : 'Unsent draft',
          updatedAt: new Date().toISOString(),
          frame,
        },
        ...this.current.localThreads.filter((thread) => thread.id !== this.localId),
      ].slice(0, 20);
      try {
        await this.resources.saveDraft(`${this.key}:archive`, archive);
      } catch (failure) {
        this.update({
          opening: false,
          localError:
            failureNotice(
              'Could not keep this conversation on the phone. Retry before starting a new one.',
              failure,
            ),
        });
        return false;
      }
      if (this.disposed) return false;
      this.update({ localThreads: archive });
    }
    this.localId = this.uuid();
    this.epoch++;
    this.chat.messages = [];
    this.chat.clearError();
    this.saved = '';
    this.update({
      threadId: null,
      input: '',
      historyError: null,
      openError: null,
      opening: false,
      stopped: false,
      context: null,
      intent: null,
      pendingChip: null,
      contextGone: false,
    });
    this.checkpoint();
    return true;
  }
  /**
   * Called by every way into the Coach before it shows (#3896 steps 6-7). With a context: a
   * conversation already under way is kept in history and a fresh one starts about that lift,
   * session or workout, so its buttons show. Without one (the Coach button): an empty conversation
   * drops any context it was left with, and one under way is left as it is.
   */
  async prepare(request: CoachOpenRequest = {}) {
    if (this.disposed) return false;
    if (!this.current.ready) await this.initialize();
    const empty = !this.chat.messages.length && !this.current.input.trim();
    if (!request.context) {
      if (empty && (this.current.context || this.current.contextGone)) {
        this.update({ context: null, intent: null, pendingChip: null, contextGone: false });
        this.checkpoint();
      }
      return true;
    }
    const same = JSON.stringify(request.context) === JSON.stringify(this.current.context);
    if (!(empty && same)) {
      if (this.busy) {
        await this.chat.stop();
        this.stop();
      }
      if (!empty && !(await this.newConversation())) return false;
    }
    this.update({
      context: request.context,
      intent: null,
      pendingChip: request.chip ?? null,
      contextGone: false,
    });
    this.checkpoint();
    return true;
  }
  /**
   * The about read answered 404 for this conversation's context (#3896 review): an old recap's lift
   * that the program has since replaced. The context is dropped, so later requests do not 404 too,
   * and the screen shows the general buttons with a line saying the lift has changed.
   */
  dropContext() {
    if (this.disposed || !this.current.context) return;
    this.update({ context: null, intent: null, pendingChip: null, contextGone: true });
    this.checkpoint();
  }
  /** The entry point's button was tapped (or can't be): it is not tapped again. */
  takePendingChip = () => {
    const chip = this.current.pendingChip;
    if (chip) this.update({ pendingChip: null });
    return chip;
  }
  saveHistory(force = false) {
    const epoch = this.epoch,
      messages = this.chat.messages,
      fingerprint = JSON.stringify(messages);
    if (!messages.length || this.disposed || (!force && fingerprint === this.saved))
      return this.historyWrites;
    this.historyWrites = this.historyWrites
      .catch(() => {})
      .then(async () => {
        if (epoch !== this.epoch || this.disposed || (!force && fingerprint === this.saved))
          return;
        try {
          const response = z.object({ threadId: z.uuid() }).parse(
            await this.resources.connection.post('/api/coach/threads', {
              threadId: this.current.threadId,
              messages: messages.map(({ role, parts }) => ({ role, parts })),
            }),
          );
          if (epoch !== this.epoch || this.disposed) return;
          this.saved = fingerprint;
          this.update({ threadId: response.threadId, historyError: null });
          this.checkpoint();
          this.resources.invalidate([historySpec.path]);
        } catch (failure) {
          // coachError(null): its status texts are about suggestions, not saving the history.
          this.update({
            historyError: failureNotice(coachError(null, 'save conversation history'), failure),
          });
        }
      });
    return this.historyWrites;
  }
  stop() {
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = null;
    void this.chat.stop();
    this.checkpoint();
  }
  dispose() {
    this.stop();
    this.disposed = true;
    this.epoch++;
    this.listeners.clear();
  }
}
/** A saved intent that still fits its saved context; a lift button without its lift is dropped, as the
 *  server would refuse it. */
function usableIntent(intent: CoachIntent | null | undefined, context: CoachContext | null) {
  if (!intent) return null;
  const lift = context?.origin === 'exercise' && !!context.sessionExerciseId;
  return INTENT_NEEDS[intent].lift === lift ? intent : null;
}
