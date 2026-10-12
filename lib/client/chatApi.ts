import type { ChatRequest, ChatResponse, MoreRequest, MoreResponse } from '../chat/types';

export interface ChatApi {
  chat(body: ChatRequest, signal: AbortSignal): Promise<ChatResponse>;
  more(body: MoreRequest, signal: AbortSignal): Promise<MoreResponse>;
}

export class ChatApiError extends Error {}

/** Change endpoints or inject a transport without changing conversation or rendering code. */
export function createChatApi(baseUrl = '/api/chat', request: typeof fetch = fetch): ChatApi {
  const base = baseUrl.replace(/\/$/, '');
  async function post<T>(url: string, body: ChatRequest | MoreRequest, signal: AbortSignal): Promise<T> {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ChatApiError(typeof data?.error === 'string' ? data.error : 'Something went wrong. Please try again.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Something went wrong. Please try again.');
    }
    return data as T;
  }
  return {
    chat: (body, signal) => post<ChatResponse>(base, body, signal),
    more: (body, signal) => post<MoreResponse>(`${base}/more`, body, signal),
  };
}
