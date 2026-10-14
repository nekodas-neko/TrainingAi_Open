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
        body: { scope },
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
  async initialize() {
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
      });
      this.saved = JSON.stringify(this.chat.messages);
    } catch {
      this.update({ localError: 'Could not read your conversation. Reopen Coach to retry.' });
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
    };
    this.localWrites = this.localWrites
      .catch(() => {})
      .then(async () => {
        if (this.disposed || epoch !== this.epoch) return;
        try {
          await this.resources.saveDraft(this.key, frame);
          this.update({ localError: null });
        } catch {
          this.update({
            localError:
              'Could not save this conversation on the phone. Keep Coach open and retry.',
          });
        }
      });
    return this.localWrites;
  }
  async send(text = this.current.input) {
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
    this.update({ input: '', stopped: false });
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
      this.update({ threadId: id, input: '', historyError: null, stopped: false });
      this.checkpoint();
      return true;
    } catch {
      this.update({
        openError: 'Could not open that conversation. Your current chat is still here.',
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
      } catch {
        this.update({
          opening: false,
          localError:
            'Could not keep this conversation on the phone. Retry before starting a new one.',
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
    });
    this.checkpoint();
    return true;
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
        } catch {
          this.update({ historyError: coachError(null, 'save conversation history') });
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
