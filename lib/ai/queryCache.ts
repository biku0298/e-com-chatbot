/** Bounded, process-local query cache; concurrent identical requests share one operation. */
export function createQueryCache<T>(load: (query: string) => Promise<T>, maxEntries = 128, ttlMs = 300000) {
  const entries = new Map<string, { expires: number; promise: Promise<T> }>();
  return (query: string): Promise<T> => {
    const existing = entries.get(query);
    if (existing && existing.expires > Date.now()) return existing.promise;
    if (existing) entries.delete(query);
    const entry = { expires: Date.now() + ttlMs, promise: Promise.resolve().then(() => load(query)) };
    entries.set(query, entry);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    entry.promise.catch(() => { if (entries.get(query) === entry) entries.delete(query); });
    return entry.promise;
  };
}
