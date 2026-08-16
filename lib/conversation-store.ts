"use client";

export type Message = {
  role: "user" | "assistant";
  content: string;
  ts: number;
};

export const ConversationStore = {
  key: (sheetId: string) => `chat_history_${sheetId}`,

  get: (sheetId: string): Message[] => {
    if (typeof window === "undefined") {
      return [];
    }
    const raw = localStorage.getItem(ConversationStore.key(sheetId));
    return raw ? JSON.parse(raw) : [];
  },

  add: (sheetId: string, role: "user" | "assistant", content: string) => {
    const history = ConversationStore.get(sheetId);
    const updated = [...history, { role, content, ts: Date.now() }];
    if (typeof window !== "undefined") {
      localStorage.setItem(
        ConversationStore.key(sheetId),
        JSON.stringify(updated),
      );
    }
    return updated;
  },

  set: (sheetId: string, conversation: Message[]) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        ConversationStore.key(sheetId),
        JSON.stringify(conversation),
      );
    }
  },

  clear: (sheetId: string) => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ConversationStore.key(sheetId));
    }
  },
};
