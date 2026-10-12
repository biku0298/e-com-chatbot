import type { ChatResponse, HistoryMessage, MoreResponse, ShoppingState, Filters, Suggestion } from '../chat/types';
import { ChatApiError, type ChatApi } from './chatApi';

export type Message = HistoryMessage & {
  id: number;
  products?: MoreResponse['products'];
  suggestions?: Suggestion[];
  action?: ChatResponse['action'];
  isPolicy?: boolean;
  isSizing?: boolean;
};

type Snapshot = { messages: Message[]; isLoading: boolean };
const INITIAL_MESSAGE: Message = { id: 1, sender: 'bot', text: 'Hi! Looking for something for your little one? 🎁' };
const FAILURE_MESSAGE = 'Something went wrong. Please try again.';
const PAGE_SIZE = 6;

/** Framework-neutral session; the server remains authoritative for shopping state. */
export function createConversation(api: ChatApi) {
  let snapshot: Snapshot = { messages: [INITIAL_MESSAGE], isLoading: false };
  let shoppingState: ShoppingState | undefined;
  let pagination: { filters: Filters; query: string; offset: number } | undefined;
  let nextId = 2;
  let pending: AbortController | undefined;
  const listeners = new Set<() => void>();

  function update(next: Snapshot) {
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  function append(message: Omit<Message, 'id'>) {
    update({ ...snapshot, messages: [...snapshot.messages, { ...message, id: nextId++ }] });
  }
  function history(): HistoryMessage[] {
    return snapshot.messages.slice(-6).map(({ sender, text }) => ({ sender, text }));
  }
  async function run(controller: AbortController, task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      if (pending === controller) {
        append({ sender: 'bot', text: error instanceof ChatApiError ? error.message : FAILURE_MESSAGE });
      }
    } finally {
      // A reset/new request may have replaced this one, even if a transport ignores abort.
      if (pending === controller) {
        pending = undefined;
        update({ ...snapshot, isLoading: false });
      }
    }
  }
  function begin() {
    const controller = new AbortController();
    pending = controller;
    update({ ...snapshot, isLoading: true });
    return controller;
  }
  function cancel() {
    const controller = pending;
    pending = undefined;
    controller?.abort();
    if (snapshot.isLoading) update({ ...snapshot, isLoading: false });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    send(text: string): boolean {
      const message = text.trim();
      if (!message || pending) return false;
      const body = { message, history: history(), shoppingState };
      const controller = begin();
      append({ sender: 'user', text: message });
      void run(controller, async () => {
        const data = await api.chat(body, controller.signal);
        if (pending !== controller) return;
        if (data.shoppingState) shoppingState = data.shoppingState;
        if (data.readyForSearch && data.filters && data.products?.length) {
          pagination = { filters: data.filters, query: data.searchQuery || message, offset: PAGE_SIZE };
        }
        append({
          sender: 'bot',
          text: data.reply || "Sorry, I couldn't understand that. Try again?",
          products: data.products || [],
          suggestions: data.suggestions || [],
          action: data.action,
          isPolicy: data.isPolicy,
          isSizing: data.isSizing,
        });
      });
      return true;
    },
    showMore(): boolean {
      if (pending || !pagination) return false;
      const page = pagination;
      const body = { filters: page.filters, originalQuery: page.query, skip: page.offset, shoppingState, history: history() };
      const controller = begin();
      void run(controller, async () => {
        const data = await api.more(body, controller.signal);
        if (pending !== controller) return;
        if (data.shoppingState) shoppingState = data.shoppingState;
        const products = data.products || [];
        pagination = { ...page, offset: page.offset + PAGE_SIZE };
        append({
          sender: 'bot',
          text: products.length ? (data.reply || 'Here are some more options ✨') : "That's all we have matching those filters!",
          products,
          suggestions: data.suggestions || [],
          action: 'search',
        });
      });
      return true;
    },
    reset() {
      cancel();
      shoppingState = undefined;
      pagination = undefined;
      update({ messages: [INITIAL_MESSAGE], isLoading: false });
    },
    cancel,
  };
}
