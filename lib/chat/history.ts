import { HistoryMessage } from './types';

/** Format the last few messages as a readable transcript for Gemini */
export function formatHistory(history: HistoryMessage[]): string {
  if (!history || history.length === 0) return '';
  return (
    '\n\nConversation so far:\n' +
    history.map((m) => `${m.sender === 'user' ? 'Customer' : 'Ray'}: ${m.text}`).join('\n')
  );
}
