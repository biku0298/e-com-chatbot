import type { FunnelField, HistoryMessage } from '../chat/types';
import { FUNNEL_ORDER, REMOVE_LABELS } from '../config';

export class InputError extends Error {}
const MAX_TEXT = 2000;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Request must be an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > MAX_TEXT) {
    throw new InputError(name + ' must be a string of at most ' + MAX_TEXT + ' characters');
  }
  return value.trim();
}
function history(value: unknown): HistoryMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError('History must be an array');
  return value.slice(-6).map(item => {
    const row = object(item);
    if (row.sender !== 'user' && row.sender !== 'bot') throw new InputError('Invalid history sender');
    return { sender: row.sender, text: text(row.text, 'History text') };
  });
}
function state(value: unknown) {
  return value === undefined || value === null ? undefined : object(value);
}
const MAX_REFINE_VALUE = 50;
function funnelField(value: unknown): FunnelField {
  if (typeof value !== 'string' || !FUNNEL_ORDER.includes(value as FunnelField)) throw new InputError('Invalid refinement field');
  return value as FunnelField;
}
/** Chip refinements may only touch funnel attributes, never price, gender or age. */
function refine(value: unknown): Partial<Record<FunnelField, string>> | undefined {
  if (value === undefined || value === null) return undefined;
  const result: Partial<Record<FunnelField, string>> = {};
  for (const [key, raw] of Object.entries(object(value))) {
    const field = funnelField(key);
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_REFINE_VALUE) throw new InputError('Invalid refinement value');
    result[field] = raw.trim();
  }
  return Object.keys(result).length ? result : undefined;
}
/** Only optional preferences can be cleared by a chip; type, price, gender and age never. */
function remove(value: unknown): FunnelField[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new InputError('Remove must be an array');
  const fields = [...new Set(value.map(funnelField))];
  if (fields.some(field => !REMOVE_LABELS[field])) throw new InputError('Invalid removal field');
  return fields.length ? fields : undefined;
}
export function parseChatInput(value: unknown) {
  const row = object(value);
  return {
    message: text(row.message, 'Message', true),
    history: history(row.history),
    shoppingState: state(row.shoppingState),
    refine: refine(row.refine),
    remove: remove(row.remove),
  };
}
export function parseMoreInput(value: unknown) {
  const row = object(value);
  const skip = row.skip ?? 0;
  if (typeof skip !== 'number' || !Number.isSafeInteger(skip) || skip < 0) throw new InputError('Skip must be a non-negative integer');
  const filters = row.filters === undefined ? {} : object(row.filters);
  for (const key of ['category', 'type', 'gender', 'occasion', 'color', 'fit']) {
    if (filters[key] != null) text(filters[key], key);
  }
  for (const key of ['maxPrice', 'ageMin', 'ageMax']) {
    const value = filters[key];
    if (value != null && ((typeof value !== 'number' && typeof value !== 'string') || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value) < 0)) throw new InputError('Invalid ' + key);
  }
  return { filters, skip, originalQuery: text(row.originalQuery, 'Original query'), history: history(row.history), shoppingState: state(row.shoppingState) };
}
