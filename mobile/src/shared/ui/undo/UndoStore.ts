export type UndoAction = {
  key: string;
  showNotice?: boolean;
  label: string;
  apply: () => Promise<void>;
  revert: () => Promise<void>;
};
export type UndoState = {
  id: number;
  showNotice?: boolean;
  label: string;
  phase: 'saving' | 'ready' | 'undoing' | 'error';
  error: string | null;
} | null;
export class UndoStore {
  private state: UndoState = null;
  private action: UndoAction | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private canceled = false;
  private accessible = false;
  private activeKeys = new Set<string>();
  constructor(private duration = 8000) {}
  resume() {
    this.canceled = false;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: UndoState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private expire(id: number) {
    this.clearTimer();
    if (!this.accessible)
      this.timer = setTimeout(() => {
        if (this.state?.id === id) this.dismiss();
      }, this.duration);
  }
  setAccessible(value: boolean) {
    this.accessible = value;
    if (value) this.clearTimer();
    else if (this.state?.phase === 'ready' && !this.state.error) this.expire(this.state.id);
  }
  async perform(action: UndoAction) {
    if (this.canceled || this.activeKeys.has(action.key)) return false;
    this.activeKeys.add(action.key);
    const id = ++this.sequence;
    this.clearTimer();
    this.action = null;
    const presentation = action.showNotice === false ? { showNotice: false } : {};
    this.publish({ ...presentation, id, label: action.label, phase: 'saving', error: null });
    try {
      await action.apply();
      if (!this.canceled && this.state?.id === id) {
        this.action = action;
        this.publish({ ...presentation, id, label: action.label, phase: 'ready', error: null });
        this.expire(id);
      }
      return !this.canceled;
    } catch {
      if (!this.canceled && this.state?.id === id)
        this.publish({
          ...presentation,
          id,
          label: 'Could not save that change.',
          phase: 'error',
          error: null,
        });
      return false;
    } finally {
      this.activeKeys.delete(action.key);
    }
  }
  async undo() {
    const state = this.state;
    const action = this.action;
    if (
      this.canceled ||
      !state ||
      state.phase !== 'ready' ||
      !action ||
      this.activeKeys.has(action.key)
    )
      return false;
    this.clearTimer();
    this.activeKeys.add(action.key);
    this.publish({ ...state, phase: 'undoing', error: null });
    try {
      await action.revert();
      if (!this.canceled && this.state?.id === state.id) this.dismiss();
      return !this.canceled;
    } catch {
      if (!this.canceled && this.state?.id === state.id)
        this.publish({ ...state, phase: 'ready', error: 'Could not undo. Try again.' });
      return false;
    } finally {
      this.activeKeys.delete(action.key);
    }
  }
  dismiss() {
    this.clearTimer();
    this.action = null;
    this.publish(null);
  }
  cancel() {
    this.canceled = true;
    this.clearTimer();
    this.action = null;
    this.state = null;
    this.listeners.clear();
  }
}
