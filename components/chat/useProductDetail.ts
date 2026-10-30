import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductDetail, ProductSearchResult } from '@/lib/chat/types';
import { ChatApiError, createChatApi } from '@/lib/client/chatApi';

export type ProductRef = { slug: string; id: string };

/** What the popup shows: the card it was opened from while the full details load. */
export type ProductView = {
  ref: ProductRef;
  preview: ProductSearchResult | null;
  product: ProductDetail | null;
  isLoading: boolean;
  error: string | null;
};

const FAILURE_MESSAGE = "Couldn't load this product right now — please try again in a moment.";

/** Opens one product inside the chat; the latest request wins and closing cancels it. */
export function useProductDetail(apiBaseUrl: string) {
  const [api] = useState(() => createChatApi(apiBaseUrl));
  const [view, setView] = useState<ProductView | null>(null);
  const pending = useRef<AbortController | null>(null);
  // Focus returns here (the card that opened the popup) when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(false);

  const open = useCallback((ref: ProductRef, preview: ProductSearchResult | null = null) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    if (!isOpen.current) {
      isOpen.current = true;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // Switching colour keeps the current product on screen until the new one arrives.
    setView(current => ({ ref, preview: current ? current.preview : preview, product: current?.product ?? null, isLoading: true, error: null }));
    api.product(ref.slug, ref.id, controller.signal).then(
      product => {
        if (!controller.signal.aborted) setView(current => current && { ...current, ref, product, isLoading: false, error: null });
      },
      error => {
        if (controller.signal.aborted) return;
        const message = error instanceof ChatApiError ? error.message : FAILURE_MESSAGE;
        setView(current => current && { ...current, isLoading: false, error: message });
      },
    );
  }, [api]);

  const close = useCallback(() => {
    pending.current?.abort();
    isOpen.current = false;
    setView(null);
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }, []);

  useEffect(() => () => pending.current?.abort(), []);
  return { view, open, close };
}
