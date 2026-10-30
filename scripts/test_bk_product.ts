import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBkClient } from '../lib/bk/client';
import { CatalogUnavailableError } from '../lib/catalog/errors';
import { createBkProductDetail, descriptionParagraphs, isProductRef, toProductDetail } from '../lib/search/bkProductDetail';
import { toRayProduct, type BkCard } from '../lib/search/bkLiveSearch';
import { createChatApi } from '../lib/client/chatApi';

/** Product popup checks against recorded product pages (fixtures/bk/product-*.json). Never hits the API. */
const fixture = (name: string) => JSON.parse(readFileSync(`fixtures/bk/${name}.json`, 'utf8'));
const SHIRT = { slug: 'barn-ranch-shirt-maroon', id: 'cmvjfxyyk00rr8d3wrnw7ndqo' };
const SHARARA = { slug: 'girls-cotton-floral-printed-kurti-sharara-dupatta-set-pink', id: 'cmv2cur0q0m63593wqj7mfsu9' };

function fixtureClient(status?: number) {
  const requested: string[] = [];
  const client = createBkClient({
    rateLimit: false,
    log: () => {},
    sleep: async () => {},
    fetch: (async (url: string) => {
      requested.push(String(url));
      if (status) return Response.json({ error: 'nope' }, { status });
      const path = new URL(String(url)).pathname;
      if (path.endsWith(`${SHIRT.slug}/${SHIRT.id}`)) return Response.json(fixture('product-shirt'));
      return Response.json({ error: 'Product not found' }, { status: 404 });
    }) as typeof fetch,
  });
  return { client, requested };
}

async function main() {
  // ── Mapping: one colour, many sizes, no discount ──
  const shirt = toProductDetail(fixture('product-shirt'));
  assert.deepEqual([shirt.id, shirt.slug, shirt.name, shirt.brand], [SHIRT.id, SHIRT.slug, 'Barn Ranch Shirt', 'Midora']);
  assert.deepEqual([shirt.price, shirt.mrp, shirt.discountPercent, shirt.inStock], [2500, null, 0, true]);
  assert.equal(shirt.sizes.length, 12);
  assert.deepEqual(shirt.sizes[0], { label: '4-5y', price: 2500, mrp: null, inStock: true });
  assert.deepEqual(shirt.colours, [], 'a single colour offers no colour choice');
  assert.deepEqual(shirt.details, [
    { label: 'Material', value: 'Cotton Blend' },
    { label: 'Fit', value: 'Comfort' },
    { label: 'Sleeve Length', value: 'Puff Sleeve' },
    { label: 'Made in', value: 'India' },
  ], 'attribute names come from the product type, in its display order');
  assert.equal(shirt.description.length, 2, 'escaped line breaks split paragraphs');
  assert.match(shirt.description[0], /^A deep \*\*maroon shirt\*\*/);
  assert.ok(shirt.description.every(paragraph => !paragraph.includes('\\')), 'no stray backslashes');
  assert.equal(shirt.images.length, 4);
  assert.ok(shirt.images.every(image => image.url.startsWith('https://') && image.thumbnailUrl.startsWith('https://')));
  assert.match(shirt.images[0].url, /-card\.webp$/, 'the main image comes first');

  // ── Mapping: discounted, another colour available ──
  const sharara = toProductDetail(fixture('product-sharara-set'));
  assert.deepEqual([sharara.price, sharara.mrp, sharara.discountPercent], [899, 2499, 64]);
  assert.deepEqual(sharara.sizes, [{ label: '7-8y', price: 899, mrp: 2499, inStock: true }], 'one real size is still shown');
  assert.deepEqual(sharara.colours.map(colour => [colour.name, colour.current]), [['Blue', false], ['Pink', true]], 'colours in a fixed order, the shown one marked');
  assert.ok(sharara.colours.every(colour => isProductRef(colour.slug, colour.id)), 'every colour can be opened');
  assert.equal(sharara.description.length, 8, 'each "- " line is its own bullet');
  assert.ok(sharara.description.every(line => line.startsWith('- ')));
  assert.equal(sharara.returns, 'Returnable within 7 days');

  // ── Mapping: no sizes, not returnable ──
  const toy = toProductDetail(fixture('product-toy'));
  assert.deepEqual([toy.name, toy.price, toy.sizes, toy.colours, toy.description], ['Ganesha Painting Kit', 399, [], [], []], 'a single free size is not a choice');
  assert.equal(toy.images.length, 5);
  assert.equal(toy.returns, 'Not returnable');

  // ── Mapping edge cases ──
  assert.deepEqual(descriptionParagraphs('One\\\n\\\nTwo\nstill two'), ['One', 'Two still two']);
  assert.deepEqual(descriptionParagraphs(null), []);
  const soldOut = toProductDetail({
    product: { name: 'Sold out' },
    currentGroup: { id: 'abcdefgh12', slug: 'sold-out', variants: [{ size: { value: 'S' }, price: 300, stock: 0 }, { size: { value: 'M' }, price: 200, stock: 0 }] },
  });
  assert.deepEqual([soldOut.inStock, soldOut.price], [false, 200], 'out of stock: still the lowest price, marked unavailable');
  const mixed = toProductDetail({
    product: { name: 'Mixed' },
    currentGroup: { id: 'abcdefgh12', slug: 'mixed', variants: [{ size: { value: 'S' }, price: 100, mrp: 400, stock: 0 }, { size: { value: 'M' }, price: 250, mrp: 500, stock: 3 }] },
  });
  assert.deepEqual([mixed.price, mixed.mrp, mixed.discountPercent], [250, 500, 50], 'the lowest price among sizes in stock');
  assert.equal(toProductDetail({}).name, '', 'an empty response maps without throwing');

  // ── Fetching through the shared client ──
  const { client, requested } = fixtureClient();
  const productDetail = createBkProductDetail(client);
  assert.equal((await productDetail(SHIRT.slug, SHIRT.id))?.name, 'Barn Ranch Shirt');
  assert.equal(requested[0], `https://api.bachpankart.com/api/consumer/products/by-group/${SHIRT.slug}/${SHIRT.id}`);
  assert.equal(await productDetail(SHARARA.slug, SHARARA.id), null, 'a product the store does not know → null');
  const before = requested.length;
  for (const [slug, id] of [['../menu', SHIRT.id], [SHIRT.slug, 'x/y'], ['Barn', SHIRT.id], [SHIRT.slug, ''], ['a?b=c', SHIRT.id]]) {
    assert.equal(await productDetail(slug, id), null, `rejected: ${slug} ${id}`);
  }
  assert.equal(requested.length, before, 'malformed slugs or ids never reach the API');
  await assert.rejects(createBkProductDetail(fixtureClient(503).client)(SHIRT.slug, SHIRT.id), CatalogUnavailableError, 'an outage is an error, not "not found"');
  assert.equal(await createBkProductDetail(fixtureClient(400).client)(SHIRT.slug, SHIRT.id), null);

  // ── Cards carry the slug the popup needs ──
  const card = fixture('clothing-topwear').groups[0] as BkCard;
  const product = toRayProduct(card);
  assert.equal(product.slug, card.slug);
  assert.ok(isProductRef(product.slug!, product.id), 'every card can open its popup');

  // ── Browser client ──
  const urls: string[] = [];
  const api = createChatApi('/api/chat/', async url => {
    urls.push(String(url));
    return urls.length === 1 ? Response.json(shirt) : Response.json({ error: 'This product is no longer available.' }, { status: 404 });
  });
  const signal = new AbortController().signal;
  assert.equal((await api.product(SHIRT.slug, SHIRT.id, signal)).name, 'Barn Ranch Shirt');
  assert.equal(urls[0], `/api/chat/product/${SHIRT.slug}/${SHIRT.id}`);
  await assert.rejects(api.product(SHARARA.slug, SHARARA.id, signal), /no longer available/);
  console.log('Product popup checks passed (mapping, sizes, colours, description, fetch, bad input, outages and client URL).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
