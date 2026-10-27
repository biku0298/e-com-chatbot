import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every discovery request, the fixture location, and fixture loaders (shared by fetch and report). */
export const FIXTURE_DIR = join('fixtures', 'bk');

export const VERTICALS = [
  'clothing', 'kids-fashion', 'footwear', 'toys', 'books', 'baby-care',
  'feeding-nursing', 'nursery-furniture', 'travel-gear', 'school-supplies', 'party-gifting', 'health-safety',
];
export const CLOTHING_CATEGORIES = [
  'topwear', 'dresses', 'bottomwear', 'party-wear', 'ethnic', 'innerwear', 'sleepwear', 'sets', 'ethnic-wear',
];

type Params = Record<string, string | number>;
export type DiscoveryRequest = { name: string; path: string; params: Params; purpose: string };

const page1 = { limit: 24, sort: 'newest' };
const topwear = { verticalSlug: 'clothing', categorySlug: 'topwear' };

export const REQUESTS: DiscoveryRequest[] = [
  ...VERTICALS.map(slug => ({
    name: `vertical-${slug}`, path: 'products', params: { verticalSlug: slug, ...page1 }, purpose: 'Vertical page 1',
  })),
  ...CLOTHING_CATEGORIES.map(slug => ({
    name: `clothing-${slug}`, path: 'products', params: { verticalSlug: 'clothing', categorySlug: slug, ...page1 }, purpose: 'Clothing category page 1',
  })),
  {
    name: 'verify-fallback-toys', path: 'products', purpose: 'Fully filtered toys URL from the doc (matches nothing on the website)',
    params: {
      verticalSlug: 'toys', genders: 'UNISEX', productTypes: 'push-pull-toys', colors: 'pink,mango-orange', brands: 'todfod',
      materials: 'wood', ageMonthsMin: 12, ageMonthsMax: 24, discountMin: 30, priceMin: 2711, priceMax: 5355,
    },
  },
  { name: 'verify-age-topwear-24-48', path: 'products', params: { ...topwear, ageMonthsMin: 24, ageMonthsMax: 48, ...page1 }, purpose: 'Age matching rule' },
  { name: 'verify-limit-50', path: 'products', params: { ...topwear, limit: 50, sort: 'newest' }, purpose: 'Is limit=50 honored?' },
  { name: 'verify-limit-100', path: 'products', params: { ...topwear, limit: 100, sort: 'newest' }, purpose: 'Is limit=100 honored?' },
  { name: 'verify-topwear-girls', path: 'products', params: { ...topwear, genders: 'GIRLS', ...page1 }, purpose: 'Does availableFilters narrow to the current filters?' },
  { name: 'verify-q-frock', path: 'products', params: { q: 'frock', limit: 24 }, purpose: 'Search alone' },
  { name: 'verify-q-frock-girls', path: 'products', params: { q: 'frock', genders: 'GIRLS', limit: 24 }, purpose: 'Does q combine with filters?' },
  { name: 'verify-facets-topwear', path: 'products/facets', params: { ...topwear }, purpose: 'What does the facets endpoint add?' },
  // Round 2: the products endpoint returns empty availableFilters, so slugs and attributes come from facets.
  ...VERTICALS.map(slug => ({
    name: `facets-vertical-${slug}`, path: 'products/facets', params: { verticalSlug: slug }, purpose: 'Vertical filter slugs',
  })),
  ...CLOTHING_CATEGORIES.filter(slug => slug !== 'topwear').map(slug => ({
    name: `facets-clothing-${slug}`, path: 'products/facets', params: { verticalSlug: 'clothing', categorySlug: slug }, purpose: 'Clothing category attributes',
  })),
  { name: 'verify-facets-topwear-girls', path: 'products/facets', params: { ...topwear, genders: 'GIRLS' }, purpose: 'Do facets narrow to the current filters?' },
  { name: 'verify-q-laptop', path: 'products', params: { q: 'laptop', limit: 24 }, purpose: 'Search for something the site does not sell: fallback?' },
  { name: 'verify-q-frock-topwear', path: 'products', params: { q: 'frock', ...topwear, limit: 24 }, purpose: 'Search + contradicting category: strict?' },
  { name: 'verify-age-travel-12', path: 'products', params: { verticalSlug: 'travel-gear', ageMonthsMin: 12, ageMonthsMax: 12, ...page1 }, purpose: 'Age filter on a vertical whose cards have no age' },
];

export type FixtureIndexEntry = {
  name: string; url: string; purpose: string; ok: boolean; status?: number; reason?: string; fetchedAt: string;
};

export function loadFixture(name: string): unknown {
  const path = join(FIXTURE_DIR, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

export function loadIndex(): FixtureIndexEntry[] {
  const path = join(FIXTURE_DIR, 'index.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}
