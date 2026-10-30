'use client';

import { useState } from 'react';
import type { ProductSearchResult, Suggestion } from '@/lib/chat/types';
import { STORE_CONFIG } from '@/lib/config';
import { useConversation } from './useConversation';
import { useVoiceInput } from './useVoiceInput';
import { useProductDetail } from './useProductDetail';
import MessageList from './MessageList';
import ProductDetailView from './ProductDetailView';
import styles from './chatWidget.module.css';

export default function ChatWidget({ apiBaseUrl = '/api/chat' }: { apiBaseUrl?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const conversation = useConversation(apiBaseUrl);
  const voice = useVoiceInput();
  const productDetail = useProductDetail(apiBaseUrl);

  function send(text: string) {
    if (conversation.send(text)) {
      voice.stop();
      setInput('');
    }
  }

  function choose(suggestion: Suggestion) {
    if (conversation.choose(suggestion)) {
      voice.stop();
      setInput('');
    }
  }

  function close() {
    productDetail.close();
    setIsOpen(false);
  }

  function openProduct(product: ProductSearchResult) {
    if (product.slug) productDetail.open({ slug: product.slug, id: product.id }, product);
  }

  function reset() {
    voice.stop();
    conversation.reset();
    setInput('');
  }

  return (
    <div className={styles.widgetContainer}>
      {isOpen && (
        <div className={styles.chatWindow}>
          {/* The chat stays mounted (and unreachable by keyboard) under the product popup. */}
          <div className={styles.chatContent} inert={Boolean(productDetail.view)}>
            <div className={styles.header}>
              <div className={styles.avatar}>
                <img src="/ray-icon.png" alt={STORE_CONFIG.assistantName} width={26} height={26} style={{ objectFit: 'contain' }} />
              </div>
              <div className={styles.headerText}>
                <div className={styles.headerTitle}>{STORE_CONFIG.assistantName}</div>
                <div className={styles.headerSubtitle}>{STORE_CONFIG.assistantRole}</div>
              </div>
              <button className={styles.closeBtn} onClick={close} aria-label="Close chat">✕</button>
            </div>

            <MessageList
              messages={conversation.messages}
              isLoading={conversation.isLoading}
              onSend={send}
              onChoose={choose}
              onShowMore={conversation.showMore}
              onReset={reset}
              onOpenProduct={openProduct}
            />

            <div className={styles.inputArea}>
              <input
                className={styles.textInput}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send(input)}
                placeholder="Ask Ray anything..."
                disabled={conversation.isLoading}
                aria-label="Message"
              />
              <button
                className={`${styles.micBtn} ${voice.isListening ? styles.micActive : ''}`}
                onClick={() => voice.start(send)}
                disabled={conversation.isLoading || voice.isListening}
                title="Voice input"
              >🎤</button>
              <button className={styles.sendBtn} onClick={() => send(input)} disabled={conversation.isLoading} aria-label="Send message">➤</button>
            </div>
          </div>

          {productDetail.view && <ProductDetailView view={productDetail.view} onBack={productDetail.close} onOpen={productDetail.open} />}
        </div>
      )}

      {!isOpen && (
        <button className={styles.toggleBtn} onClick={() => setIsOpen(true)} aria-label={`Open ${STORE_CONFIG.assistantName} chat`}>
          <img src="/ray-icon.png" alt={STORE_CONFIG.assistantName} width={34} height={34} style={{ objectFit: 'contain' }} />
        </button>
      )}
    </div>
  );
}

