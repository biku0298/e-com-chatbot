import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBkClient } from '../lib/bk/client';
import { CatalogUnavailableError } from '../lib/catalog/errors';
import { toApiParams, toFacetParams } from '../lib/search/bkApiParams';
import { createBkFacetSearch, createBkLiveSearch, toFacetCounts, toRayProduct, violatesFilters, type BkCard } from '../lib/search/bkLiveSearch';

/** Live-search checks against recorded fixtures: a fake fetch serves fixtures/bk by URL. Never hits the API. */
type Index = { name: string; url: string; ok: boolean }[];
const index: Index = JSON.parse(readFileSync('fixtures/bk/index.json', 'utf8'));
const fixture = (name: string) => JSON.parse(readFileSync(`fixtures/bk/${name}.json`, 'utf8'));

/** Same request = same params, ignoring order and a default page=1. */
function key(url: string): string {
  const params = new URL(url).searchParams;
  if (params.get('page') === '1') params.delete('page');
  return [...params.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&') + '|' + new URL(url).pathname;
}
const byKey = new Map(index.filter(entry => entry.ok).map(entry => [key(entry.url), entry.name]));

function fixtureClient(overrides: Record<string, unknown> = {}) {
  const requested: string[] = [];
  const client = createBkClient({
    rateLimit: false,
    log: () => {},
    fetch: (async (url: string) => {
      requested.push(String(url));
      const params = new URL(String(url)).searchParams;
      const override = overrides[params.get('categorySlug') ?? params.get('q') ?? ''];
      if (override === 'fail') return Response.json({}, { status: 503 });
      if (override) return Response.json(override);
      const name = byKey.get(key(String(url)));
      return name ? Response.json(fixture(name)) : Response.json({ error: 'no fixture for ' + url }, { status: 404 });
    }) as typeof fetch,
  });
  return { client, requested };
}

async function main() {
  // ── toApiParams ──
  const params = (filters: object, options = {}) => Object.fromEntries(toApiParams(filters, options));
  assert.deepEqual(params({ category: 'topwear' }), { verticalSlug: 'clothing', categorySlug: 'topwear', sort: 'newest', limit: '24', page: '1' });
  assert.deepEqual(params({ category: 'topwear', type: 'shirts', gender: 'boys', ageMin: 5, ageMax: 5, color: 'mango-orange,peach', maxPrice: 800 }), {
    verticalSlug: 'clothing', categorySlug: 'topwear', genders: 'BOYS,UNISEX', productTypes: 'shirts', colors: 'mango-orange,peach',
    ageMonthsMin: '60', ageMonthsMax: '60', priceMax: '800', sort: 'newest', limit: '24', page: '1',
  });
  assert.equal(params({ category: 'dresses', gender: 'girls' }).genders, 'GIRLS,UNISEX');
  assert.equal(params({ vertical: 'toys', gender: 'boys' }).genders, undefined, 'no gender where every product is unisex');
  assert.equal(params({ gender: 'girls', ageMin: 4, ageMax: 4 }).genders, 'GIRLS,UNISEX', 'unknown vertical keeps gender');
  assert.deepEqual([params({ ageMin: 4, ageMax: 6 }).ageMonthsMin, params({ ageMin: 4, ageMax: 6 }).ageMonthsMax], ['48', '72']);
  assert.equal(params({ category: 'strollers', ageMin: 1, ageMax: 1 }).ageMonthsMin, undefined, 'no age where products carry none');
  assert.equal(params({ category: 'topwear', occasion: 'casual' }).occasion, 'Casual', 'attribute labels use the API spelling');
  assert.deepEqual([params({ vertical: 'toys', searchText: 'dinosaur' }).q, params({ vertical: 'toys', material: 'wood,wooden' }).materials], ['dinosaur', 'wood,wooden']);
  assert.equal(params({ category: 'ethnic,ethnic-wear' }).categorySlug, undefined, 'a list is never sent as one slug');
  assert.equal(params({ category: 'ethnic,ethnic-wear' }, { category: 'ethnic-wear', page: 2 }).categorySlug, 'ethnic-wear');
  for (const key of ['priceMin', 'discountMin']) assert.equal(params({ category: 'topwear', maxPrice: 500 })[key], undefined);

  // ── API card → Ray product ──
  const raw: BkCard = fixture('clothing-topwear').groups[0];
  const product = toRayProduct(raw);
  assert.equal(product.id, 'cmvjv7e1z01n7043w7bdav8d9');
  assert.equal(product.url, 'https://bachpankart.com/product/little-rancher-shirt-maroon/cmvjv7e1z01n7043w7bdav8d9');
  assert.equal(product.imageUrl, raw.image, 'image URL exactly as returned');
  assert.deepEqual([product.brand, product.price, product.maxPrice, product.mrp, product.discountPercent, product.gender], ['Midora', 2500, 2500, null, 0, 'boys']);
  assert.equal(product.size, '4-5y – 14-15y');
  assert.deepEqual(product.facets?.color, { slug: 'maroon', name: 'Maroon' });
  assert.deepEqual(product.facets?.vertical, { slug: 'clothing', name: 'Apparel' });
  const sale = toRayProduct({ ...raw, minPrice: 1080, maxPrice: 1850, minMrp: 1280, discountPercent: 16, color: null });
  assert.deepEqual([sale.mrp, sale.discountPercent, sale.maxPrice, sale.color, sale.facets?.color], [1280, 16, 1850, '', undefined], 'discount + null colour');

  // ── Live search over fixtures ──
  const { client, requested } = fixtureClient();
  const search = createBkLiveSearch(client, () => {});
  const topwear = await search({ category: 'topwear' }, 'ignored', 0, 24);
  assert.equal(topwear.length, 24);
  assert.equal(new Set(topwear.map(p => p.id)).size, 24);
  const window = await search({ category: 'topwear' }, '', 6, 6);
  assert.deepEqual(window.map(p => p.id), topwear.slice(6, 12).map(p => p.id), '"show more" slices the cached page');
  assert.equal(requested.length, 1, 'repeat page comes from the cache');

  // Overlap: one call per category, merged and de-duplicated by id.
  const ethnic = await search({ vertical: 'clothing', category: 'ethnic,ethnic-wear' }, '', 0, 24);
  assert.equal(requested.filter(url => url.includes('categorySlug=ethnic')).length, 2);
  assert.deepEqual(new Set(ethnic.map(p => p.category)), new Set(['ethnic', 'ethnic-wear']));
  assert.equal(new Set(ethnic.map(p => p.id)).size, ethnic.length);

  // Out-of-stock cards are dropped.
  const stocked = await createBkLiveSearch(fixtureClient({ bottomwear: fixture('clothing-bottomwear') }).client, () => {})({ category: 'bottomwear' });
  assert.equal(stocked.length, fixture('clothing-bottomwear').groups.filter((c: BkCard) => c.totalStock! > 0).length);
  assert.ok(stocked.length < 14);

  // Zero results stay zero (the API does not fall back), and a fallback-looking response becomes zero.
  const none = await createBkLiveSearch(fixtureClient({ topwear: { groups: [], pagination: { totalCount: 0, hasNextPage: false } } }).client, () => {})({ category: 'topwear', color: 'pink' });
  assert.deepEqual(none, []);
  const logs: string[] = [];
  const looseResponse = fixture('clothing-topwear');
  const loosened = await createBkLiveSearch(fixtureClient({ topwear: looseResponse }).client, message => logs.push(message))({ category: 'topwear', gender: 'girls' });
  assert.deepEqual(loosened, [], 'boys products in a girls search = fallback = zero');
  assert.ok(logs.some(line => line.includes('outside the filters (gender)')));
  assert.equal(violatesFilters(raw, { category: 'topwear', gender: 'boys' }, 'topwear'), null);
  assert.equal(violatesFilters(raw, { category: 'topwear', maxPrice: 1000 }, 'topwear'), 'price');
  assert.equal(violatesFilters(raw, { category: 'topwear', color: 'pink' }, 'topwear'), 'color');
  assert.equal(violatesFilters({ ...raw, ageMonthsMin: 48, ageMonthsMax: 84 }, { category: 'topwear', ageMin: 2, ageMax: 2 }, 'topwear'), null, 'card age fields can be wrong; the API matches sizes');

  // API failure → a typed error the engine turns into a friendly reply (never fake products).
  await assert.rejects(createBkLiveSearch(fixtureClient({ topwear: 'fail' }).client, () => {})({ category: 'topwear' }), CatalogUnavailableError);

  // ── Facets: same filters, no paging; attributes keep their exact labels; lists mean "any of" ──
  assert.deepEqual(Object.fromEntries(toFacetParams({ category: 'topwear', gender: 'girls' })), { verticalSlug: 'clothing', categorySlug: 'topwear', genders: 'GIRLS,UNISEX' });
  assert.equal(params({ category: 'topwear', sleeveLength: 'Full Sleeve,Full Sleeves' }).sleeveLength, 'Full Sleeve,Full Sleeves');
  assert.equal(params({ category: 'topwear', pattern: 'Solid' }).pattern, 'Solid');
  const counts = toFacetCounts(fixture('verify-facets-topwear'));
  assert.deepEqual(counts.type?.find(option => option.value === 'shirts'), { value: 'shirts', name: 'Shirts', count: 40 });
  assert.deepEqual(counts.sleeveLength?.find(option => option.value === 'Full Sleeve'), { value: 'Full Sleeve', name: 'Full Sleeve', count: 13 });
  assert.ok(counts.occasion?.some(option => option.value === 'Casual'));
  assert.deepEqual(Object.keys(counts).sort(), ['fit', 'occasion', 'pattern', 'sleeveLength', 'type'], 'colours etc. come from the product cards, not from counts');
  const facetClient = fixtureClient();
  const facets = await createBkFacetSearch(facetClient.client)({ category: 'topwear' });
  assert.deepEqual(facets, counts, 'facets search reads the recorded response');
  assert.equal(facetClient.requested.length, 1);
  assert.equal(await createBkFacetSearch(fixtureClient({ topwear: 'fail' }).client)({ category: 'topwear' }), null, 'a failed facets call means no extra chips, not an error');

  console.log('Bachpankart search checks passed (params, gender/age/attribute rules, mapping, paging, overlap merge, stock, fallback, errors, facets).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
