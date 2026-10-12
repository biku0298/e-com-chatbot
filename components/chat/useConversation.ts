import { useEffect, useState, useSyncExternalStore } from 'react';
import { createChatApi } from '@/lib/client/chatApi';
import { createConversation } from '@/lib/client/conversation';

export function useConversation(apiBaseUrl: string) {
  const [conversation] = useState(() => createConversation(createChatApi(apiBaseUrl)));
  const snapshot = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot, conversation.getSnapshot);
  useEffect(() => () => conversation.cancel(), [conversation]);
  return { ...snapshot, send: conversation.send, choose: conversation.choose, showMore: conversation.showMore, reset: conversation.reset };
}
