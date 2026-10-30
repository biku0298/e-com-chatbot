import { useEffect, useRef, useState } from 'react';
import type { ProductSearchResult, Suggestion } from '@/lib/chat/types';
import type { Message } from '@/lib/client/conversation';
import { STORE_CONFIG } from '@/lib/config';
import { rupees } from './format';
import styles from './chatWidget.module.css';

const WELCOME_SUGGESTIONS = [
  { label: 'Suggest a birthday gift 🎁', query: 'Suggest a birthday gift for a child' },
  { label: "What's new this week 🆕", query: "What's new this week?" },
  { label: 'Help me find the right size 📏', query: 'Help me find the right size' },
  { label: 'Check return/exchange policy 📋', query: 'What is your return and exchange policy?' },
];
/** Department or category choices: show the top few (most stock first), the rest behind "More options". */
const CHOICE_CHIPS_SHOWN = 4;
const isChoiceRow = (suggestions?: Suggestion[]) =>
  Boolean(suggestions && suggestions.length > CHOICE_CHIPS_SHOWN + 1 && suggestions.every(s => s.refine?.vertical || s.refine?.category));
const LOADING_PHRASES =['Sending your query...', 'Understanding your question...', 'Finding matching products...'];

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

/** Lowest price only (no range across sizes), with the MRP struck through when discounted. */
function ProductPrice({ product: p }: { product: ProductSearchResult }) {
  return (
    <div className={styles.priceRow}>
      <span className={styles.productPrice}>{rupees(p.price)}</span>
      {p.mrp != null && p.mrp > p.price && <span className={styles.mrp}>{rupees(p.mrp)}</span>}
      {!!p.discountPercent && <span className={styles.discountBadge}>{p.discountPercent}% OFF</span>}
    </div>
  );
}

function ProductResults({ products, onOpenProduct }: { products: ProductSearchResult[]; onOpenProduct: (product: ProductSearchResult) => void }) {
  return (
    <div className={styles.productGrid}>
      {products.map(p => {
        // The image URL is used exactly as the API returns it.
        const preview = (
          <>
            <img src={p.imageUrl} alt={p.name} className={styles.productImg} />
            <div className={styles.productName} title={p.name}>{p.name}</div>
          </>
        );
        return (
          <div key={p.id} className={styles.productCard}>
            {/* Opens the product popup inside the chat (never leaves for the store). */}
            {p.slug ? <button type="button" className={styles.productLink} onClick={() => onOpenProduct(p)} aria-label={`View ${p.name}`}>{preview}</button> : preview}
            {p.brand && <div className={styles.productBrand}>{p.brand}</div>}
            <div className={styles.productMeta}>
              {p.gender && (
                <span className={`${styles.metaTag} ${styles.metaTagGender}`}>
                  {p.gender === 'boys' ? '👦' : p.gender === 'girls' ? '👧' : '👶'} {p.gender}
                </span>
              )}
            </div>
            <div className={styles.cardFooter}>
              <ProductPrice product={p} />
              <button className={styles.addToCartBtn} onClick={() => alert(`Added "${p.name}" to cart! 🛒`)}>🛒 Add to Cart</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  messages: Message[];
  isLoading: boolean;
  onSend: (text: string) => void;
  onChoose: (suggestion: Suggestion) => void;
  onShowMore: () => void;
  onReset: () => void;
  onOpenProduct: (product: ProductSearchResult) => void;
};

export default function MessageList({ messages, isLoading, onSend, onChoose, onShowMore, onReset, onOpenProduct }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<Message['id']>>(() => new Set());
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
        const allSuggestions = msg.isPolicy ? msg.suggestions?.slice(0, 1) : msg.suggestions;
        const collapsed = isChoiceRow(allSuggestions) && !expanded.has(msg.id);
        const suggestions = collapsed ? allSuggestions!.slice(0, CHOICE_CHIPS_SHOWN) : allSuggestions;
        return (
          <div key={msg.id}>
            <div className={`${styles.messageRow} ${styles[msg.sender]}`}>
              <div className={`${styles.bubble} ${styles[msg.sender]}`}>{msg.text}</div>
            </div>
            {hasProducts && <ProductResults products={msg.products!} onOpenProduct={onOpenProduct} />}
            {showFollowups && (
              <div className={styles.followups}>
                {suggestions?.map((suggestion, i) => (
                  <button key={i} className={styles.suggestionBtn} onClick={() => onChoose(suggestion)}>{suggestion.label}</button>
                ))}
                {collapsed && (
                  <button className={styles.suggestionBtn} onClick={() => setExpanded(previous => new Set(previous).add(msg.id))}>
                    More options ▾
                  </button>
                )}
                {hasProducts && msg.hasMore !== false && <button className={styles.suggestionBtn} onClick={onShowMore}>🔄 Show more</button>}
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
