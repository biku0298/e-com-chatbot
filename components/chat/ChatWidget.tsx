'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './chatWidget.module.css';

// Browser SpeechRecognition type (not in default TS lib)
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import { Filters, ProductSearchResult, ShoppingState } from '@/lib/chat/types';
import { createInitialShoppingState } from '@/lib/chat/conversationState';

type Message = {
  id: number;
  sender: 'user' | 'bot';
  text: string;
  products?: ProductSearchResult[];
  suggestions?: string[];
  action?: 'ask' | 'search' | 'policy' | 'general';
  readyForSearch?: boolean;
  isPolicy?: boolean;
  isSizing?: boolean;
};


const WELCOME_SUGGESTIONS = [
  { label: 'Suggest a birthday gift 🎁', query: 'Suggest a birthday gift for a child' },
  { label: "What's new this week 🆕", query: "What's new this week?" },
  { label: 'Help me find the right size 📏', query: 'Help me find the right size' },
  { label: 'Check return/exchange policy 📋', query: 'What is your return and exchange policy?' },
];

const LOADING_PHRASES = [
  'Sending your query...',
  'Understanding your question...',
  'Finding matching products...',
];

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, sender: 'bot', text: 'Hi! Looking for something for your little one? 🎁' },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [lastFilters, setLastFilters] = useState<Filters>({});
  const [lastQuery, setLastQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [shoppingState, setShoppingState] = useState<ShoppingState>(createInitialShoppingState());
  const messageEndRef = useRef<HTMLDivElement>(null);
  const messageIdCounter = useRef(2);

  const INITIAL_MESSAGE: Message = { id: 1, sender: 'bot', text: 'Hi! Looking for something for your little one? 🎁' };

  // Cycle through loading phrases while waiting
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingPhase((p) => (p + 1) % LOADING_PHRASES.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  async function sendToBot(text: string) {
    const history = messages.slice(-6).map(({ sender, text: t }) => ({ sender, text: t }));
    const userMessage: Message = { id: messageIdCounter.current++, sender: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    fetchBotReply(text, history);
  }

  async function fetchBotReply(
    text: string,
    history: { sender: 'user' | 'bot'; text: string }[]
  ) {
    setLoadingPhase(0);
    setIsLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, shoppingState }),
      });
      const data = await res.json();

      // Update conversational shopping state with authoritative server state
      if (data.shoppingState) {
        setShoppingState(data.shoppingState);
      }

      // Store filters + query + reset offset for pagination (only when search is ready and products returned)
      if (data.readyForSearch && data.filters && data.products?.length > 0) {
        setLastFilters(data.filters);
        setLastQuery(text);
        setOffset(6); // first page shown = 6 products
      }

      const botMessage: Message = {
        id: messageIdCounter.current++,
        sender: 'bot',
        text: data.reply || data.error || "Sorry, I couldn't understand that. Try again?",
        products: data.products || [],
        suggestions: data.suggestions || [],
        action: data.action,
        readyForSearch: data.readyForSearch ?? false,
        isPolicy: data.isPolicy ?? false,
        isSizing: data.isSizing ?? false,
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: messageIdCounter.current++, sender: 'bot', text: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleShowMore() {
    setLoadingPhase(0);
    setIsLoading(true);
    try {
      const res = await fetch('/api/chat/more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: lastFilters, skip: offset, originalQuery: lastQuery }),
      });
      const data = await res.json();
      const products: ProductSearchResult[] = data.products || [];

      const botMessage: Message = {
        id: messageIdCounter.current++,
        sender: 'bot',
        text: products.length
          ? 'Here are some more options ✨'
          : "That's all we have matching those filters!",
        products,
        suggestions: [], // no dynamic suggestion on "more" results
      };
      setMessages((prev) => [...prev, botMessage]);
      setOffset((prev) => prev + 6);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: messageIdCounter.current++, sender: 'bot', text: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleReset() {
    setMessages([INITIAL_MESSAGE]);
    setLastFilters({});
    setLastQuery('');
    setOffset(0);
    setInput('');
    setShoppingState(createInitialShoppingState());
  }

  function handleSend() {
    if (input.trim() === '' || isLoading) return;
    sendToBot(input.trim());
  }

  function handleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in your browser. Please use Chrome or Edge.');
      return;
    }
    if (isListening) return; // already recording

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend   = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript) sendToBot(transcript);
    };

    recognition.start();
  }

  // Index of the last bot message (for follow-up chips)
  const lastBotIdx = messages.reduce(
    (acc, m, i) => (m.sender === 'bot' ? i : acc),
    -1
  );

  return (
    <div className={styles.widgetContainer}>
      {isOpen && (
        <div className={styles.chatWindow}>
          <div className={styles.header}>
            <div className={styles.avatar}>
              <img src="/ray-icon.png" alt="Ray" width={26} height={26} style={{ objectFit: 'contain' }} />
            </div>
            <div className={styles.headerText}>
              <div className={styles.headerTitle}>Ray</div>
              <div className={styles.headerSubtitle}>Your AI shopping assistant</div>
            </div>
            <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>
              ✕
            </button>
          </div>

          {/* ── Messages ── */}
          <div className={styles.messageArea}>
            {/* Welcome screen — only when no conversation has started */}
            {messages.length === 1 && (
              <div>
                <div className={styles.introText}>
                  Hi, I&apos;m <strong>Ray</strong> 🐣 — your shopping assistant at Bachpankart.
                  I can help you find the perfect clothes and essentials for your little one.
                </div>
                <div className={styles.greeting}>How can I help you today?</div>
                {WELCOME_SUGGESTIONS.map((item, i) => (
                  <button
                    key={i}
                    className={styles.suggestionBtn}
                    onClick={() => sendToBot(item.query)}
                    style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {/* Conversation messages */}
            {messages.length > 1 &&
              messages.map((msg, idx) => (
                <div key={msg.id}>
                  <div className={`${styles.messageRow} ${styles[msg.sender]}`}>
                    <div className={`${styles.bubble} ${styles[msg.sender]}`}>
                      {msg.text}
                    </div>
                  </div>

                  {/* Product cards — wrap grid */}
                  {msg.products && msg.products.length > 0 && (
                    <div className={styles.productGrid}>
                      {msg.products.map((p) => (
                        <div key={p.id} className={styles.productCard}>
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className={styles.productImg}
                          />
                          <div className={styles.productName}>{p.name}</div>
                          <div className={styles.productMeta}>
                            {p.gender && (
                              <span className={`${styles.metaTag} ${styles.metaTagGender}`}>
                                {p.gender === 'boys' ? '👦' : p.gender === 'girls' ? '👧' : '👶'} {p.gender}
                              </span>
                            )}
                            {p.size && (
                              <span className={`${styles.metaTag} ${styles.metaTagSize}`}>
                                📏 {p.size}
                              </span>
                            )}
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
                          <button
                            className={styles.addToCartBtn}
                            onClick={() => alert(`Added "${p.name}" to cart! 🛒`)}
                          >
                            🛒 Add to Cart
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Follow-up chips — product search result replies */}
                  {idx === lastBotIdx &&
                    msg.products &&
                    msg.products.length > 0 &&
                    !isLoading && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', margin: '4px 0 10px 0' }}>
                        {/* 2 dynamic context-aware chips from backend */}
                        {msg.suggestions && msg.suggestions.map((s, i) => (
                          <button
                            key={i}
                            className={styles.suggestionBtn}
                            onClick={() => sendToBot(s)}
                          >
                            {s}
                          </button>
                        ))}
                        {/* Fixed: show next batch with same filters */}
                        <button
                          className={styles.suggestionBtn}
                          onClick={handleShowMore}
                        >
                          🔄 Show similar products
                        </button>
                        {/* Fixed: reset conversation */}
                        <button
                          className={`${styles.suggestionBtn} ${styles.resetBtn}`}
                          onClick={handleReset}
                        >
                          🏠 Start Over
                        </button>
                      </div>
                    )}

                  {/* Follow-up chips — ask clarification replies (NO pagination, NO product chips) */}
                  {idx === lastBotIdx &&
                    msg.action === 'ask' &&
                    (!msg.products || msg.products.length === 0) &&
                    !msg.isSizing &&
                    !isLoading && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', margin: '4px 0 10px 0' }}>
                        {/* 2-4 quick response suggestion chips */}
                        {msg.suggestions && msg.suggestions.map((s, i) => (
                          <button
                            key={i}
                            className={styles.suggestionBtn}
                            onClick={() => sendToBot(s)}
                          >
                            {s}
                          </button>
                        ))}
                        {/* Reset option */}
                        <button
                          className={`${styles.suggestionBtn} ${styles.resetBtn}`}
                          onClick={handleReset}
                        >
                          🏠 Start Over
                        </button>
                      </div>
                    )}

                  {/* Follow-up chips — general small talk replies */}
                  {idx === lastBotIdx &&
                    msg.action === 'general' &&
                    !isLoading && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', margin: '4px 0 10px 0' }}>
                        {msg.suggestions && msg.suggestions.map((s, i) => (
                          <button
                            key={i}
                            className={styles.suggestionBtn}
                            onClick={() => sendToBot(s)}
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          className={`${styles.suggestionBtn} ${styles.resetBtn}`}
                          onClick={handleReset}
                        >
                          🏠 Start Over
                        </button>
                      </div>
                    )}

                  {/* Follow-up chips — policy replies */}
                  {idx === lastBotIdx &&
                    msg.isPolicy &&
                    !isLoading && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', margin: '4px 0 10px 0' }}>
                        {/* Dynamic policy-related follow-up */}
                        {msg.suggestions && msg.suggestions[0] && (
                          <button
                            className={styles.suggestionBtn}
                            onClick={() => sendToBot(msg.suggestions![0])}
                          >
                            {msg.suggestions[0]}
                          </button>
                        )}
                        {/* Always show Start Over for policy replies */}
                        <button
                          className={`${styles.suggestionBtn} ${styles.resetBtn}`}
                          onClick={handleReset}
                        >
                          🏠 Start Over
                        </button>
                      </div>
                    )}

                  {/* Follow-up chips — sizing 'ask' replies: no chips until products arrive */}
                  {/* When isSizing=true: Ray is still gathering info, intentionally no chips shown */}
                </div>
              ))}

            {/* Cycling loading indicator */}
            {isLoading && (
              <div className={styles.messageRow}>
                <div className={styles.loadingBubble}>
                  <div className={styles.loadingDots}>
                    <span className={styles.loadingDot} />
                    <span className={styles.loadingDot} />
                    <span className={styles.loadingDot} />
                  </div>
                  <span className={styles.loadingText}>
                    {LOADING_PHRASES[loadingPhase]}
                  </span>
                </div>
              </div>
            )}

            <div ref={messageEndRef} />
          </div>

          {/* ── Input ── */}
          <div className={styles.inputArea}>
            <input
              className={styles.textInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Ray anything..."
              disabled={isLoading}
            />
            <button
              className={`${styles.micBtn} ${isListening ? styles.micActive : ''}`}
              onClick={handleVoiceInput}
              disabled={isLoading || isListening}
              title="Voice input"
            >
              🎤
            </button>
            <button className={styles.sendBtn} onClick={handleSend} disabled={isLoading}>
              ➤
            </button>
          </div>
        </div>
      )}

      {!isOpen && (
        <button className={styles.toggleBtn} onClick={() => setIsOpen(true)} aria-label="Open Ray chat">
          <img src="/ray-icon.png" alt="Ray" width={34} height={34} style={{ objectFit: 'contain' }} />
        </button>
      )}
    </div>
  );
}
