/**
 * Run a conversation against the LIVE bachpankart API and Gemini, without the browser.
 *   npm run try:bk -- "bib for my baby" "1"
 * Each argument is one customer turn; a turn starting with "chip:" clicks that chip label
 * from the previous reply. Requests go through the budgeted client (printed per request).
 */
process.env.CATALOG_SOURCE = 'bk_live';
process.env.BK_RATE_LIMIT ??= 'on';

import type { ChatResponse, HistoryMessage, ShoppingState } from '../lib/chat/types';

async function main() {
  const { assistant } = await import('../lib/assistant/runtime');
  const turns = process.argv.slice(2);
  if (!turns.length) throw new Error('Pass one or more customer messages, e.g. npm run try:bk -- "stroller"');
  let state: ShoppingState | undefined;
  let last: ChatResponse | undefined;
  const history: HistoryMessage[] = [];
  for (const turn of turns) {
    const chip = turn.startsWith('chip:') ? last?.suggestions.find(s => s.label.toLowerCase() === turn.slice(5).trim().toLowerCase()) : undefined;
    if (turn.startsWith('chip:') && !chip) throw new Error(`No chip "${turn.slice(5)}" in: ${last?.suggestions.map(s => s.label).join(' | ')}`);
    const message = chip?.label ?? turn;
    console.log(`\n👤 ${message}${chip ? '  (chip)' : ''}`);
    last = await assistant.chat({ message, history: history.slice(-6), shoppingState: state, refine: chip?.refine, remove: chip?.remove });
    state = last.shoppingState;
    history.push({ sender: 'user', text: message }, { sender: 'bot', text: last.reply });
    console.log(`🤖 ${last.reply}`);
    for (const p of last.products) {
      const price = p.maxPrice && p.maxPrice !== p.price ? `₹${p.price}–${p.maxPrice}` : `₹${p.price}`;
      console.log(`   • ${p.name} | ${p.brand ?? ''} | ${price}${p.discountPercent ? ` (${p.discountPercent}% off)` : ''} | ${p.gender ?? ''} ${p.size} | ${p.url ?? ''}`);
    }
    if (last.suggestions.length) console.log(`   chips: ${last.suggestions.map(s => s.label).join(' | ')}${last.nextRefinement ? `  [${last.nextRefinement}]` : ''}`);
    if (last.hasMore) console.log('   (more available)');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
