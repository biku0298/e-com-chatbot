import assert from 'node:assert/strict';
import { ChatApiError, createChatApi } from '../lib/client/chatApi';
import { createConversation } from '../lib/client/conversation';
import { createInitialShoppingState, mergeShoppingState } from '../lib/chat/conversationState';
import type { ChatRequest, ChatResponse, MoreRequest, MoreResponse } from '../lib/chat/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const state = mergeShoppingState(createInitialShoppingState(), { type: 'dress', gender: 'girls', ageMin: 6, ageMax: 6 });
const product = { id: 1, name: 'Dress', price: 500, imageUrl: '/ray-icon.png', color: 'pink', size: '6Y' };
const search: ChatResponse = {
  reply: 'Found options', products: [product], suggestions: [{ label: 'Try blue' }], shoppingState: state,
  action: 'search', readyForSearch: true, filters: { type: 'dress' }, searchQuery: 'pink dress',
};

async function main() {
  const chats: { body: ChatRequest; signal: AbortSignal; result: ReturnType<typeof deferred<ChatResponse>> }[] = [];
  const pages: { body: MoreRequest; signal: AbortSignal; result: ReturnType<typeof deferred<MoreResponse>> }[] = [];
  const conversation = createConversation({
    chat(body, signal) {
      const result = deferred<ChatResponse>();
      chats.push({ body, signal, result });
      return result.promise; // Deliberately ignores abort to exercise stale-response protection.
    },
    more(body, signal) {
      const result = deferred<MoreResponse>();
      pages.push({ body, signal, result });
      return result.promise;
    },
  });
  let notifications = 0;
  const unsubscribe = conversation.subscribe(() => notifications++);
  assert.equal(conversation.send(' '), false);
  assert.equal(conversation.showMore(), false);
  assert.equal(conversation.send(' dress '), true);
  assert.equal(conversation.send('duplicate'), false);
  assert.equal(conversation.showMore(), false);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].body.message, 'dress');
  assert.deepEqual(chats[0].body.history, [{ sender: 'bot', text: 'Hi! Looking for something for your little one? 🎁' }]);
  chats[0].result.resolve(search);
  await settle();
  assert.equal(conversation.getSnapshot().isLoading, false);
  assert.deepEqual(conversation.getSnapshot().messages.at(-1)?.products, [product]);
  assert.equal(conversation.showMore(), true);
  assert.equal(conversation.showMore(), false);
  assert.equal(pages[0].body.skip, 6);
  assert.equal(pages[0].body.originalQuery, 'pink dress');
  assert.equal(pages[0].body.shoppingState, state);
  pages[0].result.reject(new ChatApiError('Could not fetch more products. Please try again.'));
  await settle();
  assert.equal(conversation.getSnapshot().messages.at(-1)?.text, 'Could not fetch more products. Please try again.');
  assert.equal(conversation.showMore(), true);
  assert.equal(pages[1].body.skip, 6, 'failed pagination must not advance the offset');
  pages[1].result.resolve({ ...search, reply: 'More options' });
  await settle();
  conversation.showMore();
  assert.equal(pages[2].body.skip, 12);
  pages[2].result.resolve({ ...search, products: [] });
  await settle();
  assert.equal(conversation.getSnapshot().messages.at(-1)?.text, "That's all we have matching those filters!");

  for (let i = 0; i < 4; i++) {
    conversation.send('next');
    assert.equal(chats.at(-1)?.body.shoppingState, state);
    assert.ok(chats.at(-1)!.body.history!.length <= 6);
    assert.ok(chats.at(-1)!.body.history!.every(row => Object.keys(row).length === 2));
    chats.at(-1)!.result.resolve({ ...search, products: [], action: 'ask', readyForSearch: false });
    await settle();
  }
  assert.equal(chats.at(-1)?.body.history?.length, 6);
  conversation.send('old conversation');
  const oldChat = chats.at(-1)!;
  conversation.reset();
  assert.equal(oldChat.signal.aborted, true);
  assert.equal(conversation.getSnapshot().messages.length, 1);
  assert.equal(conversation.showMore(), false);
  conversation.send('new conversation');
  const newChat = chats.at(-1)!;
  assert.equal(newChat.body.shoppingState, undefined);
  assert.equal(newChat.body.history?.length, 1);
  oldChat.result.resolve(search);
  await settle();
  assert.equal(conversation.getSnapshot().messages.length, 2);
  assert.equal(conversation.getSnapshot().isLoading, true, 'old finally cannot clear new request loading');
  newChat.result.resolve(search);
  await settle();

  conversation.showMore();
  const oldPage = pages.at(-1)!;
  conversation.reset();
  assert.equal(oldPage.signal.aborted, true);
  oldPage.result.resolve(search);
  await settle();
  assert.equal(conversation.getSnapshot().messages.length, 1);
  assert.equal(conversation.showMore(), false);

  conversation.send('stale error');
  const staleError = chats.at(-1)!;
  conversation.reset();
  staleError.result.reject(new Error('stale failure'));
  await settle();
  assert.equal(conversation.getSnapshot().messages.length, 1);
  conversation.send('network error');
  chats.at(-1)!.result.reject(new TypeError('Failed to fetch'));
  await settle();
  assert.equal(conversation.getSnapshot().isLoading, false);
  assert.equal(conversation.getSnapshot().messages.at(-1)?.text, 'Something went wrong. Please try again.');
  conversation.send('unmount');
  const canceled = chats.at(-1)!;
  conversation.cancel();
  canceled.result.resolve(search);
  await settle();
  assert.equal(conversation.getSnapshot().messages.at(-1)?.text, 'unmount');
  assert.equal(canceled.signal.aborted, true);
  assert.ok(notifications > 0);
  unsubscribe();

  const requests: { url: string; options: RequestInit }[] = [];
  let response = Response.json(search);
  const api = createChatApi('https://store.example/assistant/', async (url, options) => {
    requests.push({ url: String(url), options: options! });
    return response;
  });
  const signal = new AbortController().signal;
  await api.chat({ message: 'dress' }, signal);
  assert.equal(requests[0].url, 'https://store.example/assistant');
  assert.equal(requests[0].options.signal, signal);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0].options.body)), { message: 'dress' });
  response = Response.json({ error: 'Could not fetch more products. Please try again.' }, { status: 500 });
  await assert.rejects(api.more({ skip: 6 }, signal), /Could not fetch more products/);
  assert.equal(requests[1].url, 'https://store.example/assistant/more');
  response = Response.json(null);
  await assert.rejects(api.chat({ message: 'dress' }, signal), /Something went wrong/);
  console.log('Client regression checks passed (overlap, reset races, cancellation, state/history, pagination, endpoints and HTTP errors).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
