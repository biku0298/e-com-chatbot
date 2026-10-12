import { useEffect, useRef, useState } from 'react';
import type { ProductSearchResult } from '@/lib/chat/types';
import type { Message } from '@/lib/client/conversation';
import { STORE_CONFIG } from '@/lib/config';
import styles from './chatWidget.module.css';

const WELCOME_SUGGESTIONS = [
  { label: 'Suggest a birthday gift 🎁', query: 'Suggest a birthday gift for a child' },
  { label: "What's new this week 🆕", query: "What's new this week?" },
  { label: 'Help me find the right size 📏', query: 'Help me find the right size' },
  { label: 'Check return/exchange policy 📋', query: 'What is your return and exchange policy?' },
];
const LOADING_PHRASES = ['Sending your query...', 'Understanding your question...', 'Finding matching products...'];

function LoadingIndicator() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setPhase(value => (value + 1) % LOADING_PHRASES.length), 1200);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className={styles.messageRow}>
      <div className={styles.loadingBubble}>
        <div className={styles.loadingDots}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
        <span className={styles.loadingText}>{LOADING_PHRASES[phase]}</span>
      </div>
    </div>
  );
}

function ProductResults({ products }: { products: ProductSearchResult[] }) {
  return (
    <div className={styles.productGrid}>
      {products.map(p => (
        <div key={p.id} className={styles.productCard}>
          <img src={p.imageUrl} alt={p.name} className={styles.productImg} />
          <div className={styles.productName}>{p.name}</div>
          <div className={styles.productMeta}>
            {p.gender && (
              <span className={`${styles.metaTag} ${styles.metaTagGender}`}>
                {p.gender === 'boys' ? '👦' : p.gender === 'girls' ? '👧' : '👶'} {p.gender}
              </span>
            )}
            {p.size && <span className={`${styles.metaTag} ${styles.metaTagSize}`}>📏 {p.size}</span>}
            {p.occasion && (
              <span className={`${styles.metaTag} ${
                p.occasion === 'party' ? styles.metaTagParty
                : p.occasion === 'ethnic' ? styles.metaTagEthnic
                : styles.metaTagCasual
              }`}>
                {p.occasion === 'party' ? '🎉' : p.occasion === 'ethnic' ? '🪷' : '👕'} {p.occasion}
              </span>
            )}
          </div>
          <div className={styles.productPrice}>₹{p.price}</div>
          <button className={styles.addToCartBtn} onClick={() => alert(`Added "${p.name}" to cart! 🛒`)}>🛒 Add to Cart</button>
        </div>
      ))}
    </div>
  );
}

type Props = {
  messages: Message[];
  isLoading: boolean;
  onSend: (text: string) => void;
  onShowMore: () => void;
  onReset: () => void;
};

export default function MessageList({ messages, isLoading, onSend, onShowMore, onReset }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);
  const lastBotIdx = messages.reduce((last, message, index) => message.sender === 'bot' ? index : last, -1);

  return (
    <div className={styles.messageArea}>
      {messages.length === 1 && (
        <div>
          <div className={styles.introText}>
            Hi, I&apos;m <strong>{STORE_CONFIG.assistantName}</strong> 🐣 — your shopping assistant at {STORE_CONFIG.storeName}.
            I can help you find the perfect clothes and essentials for your little one.
          </div>
          <div className={styles.greeting}>How can I help you today?</div>
          {WELCOME_SUGGESTIONS.map(item => (
            <button key={item.query} className={`${styles.suggestionBtn} ${styles.welcomeSuggestion}`} onClick={() => onSend(item.query)}>{item.label}</button>
          ))}
        </div>
      )}

      {messages.length > 1 && messages.map((msg, idx) => {
        const hasProducts = Boolean(msg.products?.length);
        // Sizing questions intentionally have no chips until recommendations arrive.
        const showFollowups = idx === lastBotIdx && !isLoading && (
          hasProducts || (msg.action === 'ask' && !msg.isSizing) || msg.action === 'general' || msg.isPolicy
        );
        const suggestions = msg.isPolicy ? msg.suggestions?.slice(0, 1) : msg.suggestions;
        return (
          <div key={msg.id}>
            <div className={`${styles.messageRow} ${styles[msg.sender]}`}>
              <div className={`${styles.bubble} ${styles[msg.sender]}`}>{msg.text}</div>
            </div>
            {hasProducts && <ProductResults products={msg.products!} />}
            {showFollowups && (
              <div className={styles.followups}>
                {suggestions?.map((suggestion, i) => (
                  <button key={i} className={styles.suggestionBtn} onClick={() => onSend(suggestion.label)}>{suggestion.label}</button>
                ))}
                {hasProducts && <button className={styles.suggestionBtn} onClick={onShowMore}>🔄 Show similar products</button>}
                <button className={`${styles.suggestionBtn} ${styles.resetBtn}`} onClick={onReset}>🏠 Start Over</button>
              </div>
            )}
          </div>
        );
      })}
      {isLoading && <LoadingIndicator />}
      <div ref={endRef} />
    </div>
  );
}
