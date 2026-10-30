import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BK_DATA, BK_WORDS, attributeLabel, bkCategory, bkTier, bkVertical,
  verticalAsksGender, verticalFiltersGender, verticalNeedsAge, verticalUsesAge,
} from '../lib/catalog/bkConfig';
import { getTaxonomy, parseMenu, setTaxonomy, taxonomyProductType, taxonomyProductTypes, type BkTaxonomy } from '../lib/catalog/bkTaxonomy';
import { resolveBkText } from '../lib/catalog/bkWords';

/** Catalog hierarchy, config and word mapping. Pure: uses the recorded /menu fixture, no network. */
function main() {
  // The hierarchy comes from the store's /menu (recorded fixture = the bundled snapshot).
  const menu = JSON.parse(readFileSync('fixtures/bk/menu.json', 'utf8'));
  const taxonomy = parseMenu(menu);
  setTaxonomy(taxonomy);
  const verticals = taxonomy.verticals;
  const categories = verticals.flatMap(v => v.categories.map(c => ({ ...c, vertical: v.slug })));
  assert.equal(verticals.length, 14);
  assert.equal(categories.length, 105);
  assert.equal(new Set(categories.map(c => c.slug)).size, 105, 'category slugs are unique');
  assert.deepEqual(getTaxonomy().verticals.map(v => v.slug), verticals.map(v => v.slug));
  assert.deepEqual(bkCategory('topwear'), { vertical: 'clothing', slug: 'topwear', label: 'Topwear', inStockCount: categories.find(c => c.slug === 'topwear')!.inStockCount });
  assert.deepEqual(bkVertical('clothing'), { slug: 'clothing', label: 'Apparel', noun: 'clothes', tier: 1, askGender: false });
  assert.deepEqual(bkVertical('special-needs'), { slug: 'special-needs', label: verticals.find(v => v.slug === 'special-needs')!.name, noun: verticals.find(v => v.slug === 'special-needs')!.name.toLowerCase(), tier: 2, askGender: false }, 'a department the store adds works on defaults');
  assert.equal(bkVertical('not-a-department'), undefined);
  assert.equal(bkTier('clothing'), 1);
  assert.equal(bkTier('toys'), 2);
  assert.equal(bkTier('something-new'), 2, 'an untuned vertical falls back to Tier 2');
  assert.ok(taxonomyProductTypes('clothing').some(t => t.slug === 'frocks'));
  assert.equal(new Set(taxonomyProductTypes('clothing').map(t => t.slug)).size, taxonomyProductTypes('clothing').length, 'one entry per product type slug');

  // A malformed menu is rejected as a whole (a sync never stores half a tree).
  assert.throws(() => parseMenu({}), /no verticals/);
  assert.throws(() => parseMenu({ verticals: [{ id: 'v', slug: '', name: 'X', categories: [] }] }), /vertical slug/);
  const twice = { verticals: [{ id: 'v', slug: 'v', name: 'V', categories: [{ id: 'a', slug: 'same', name: 'A', productTypes: [] }, { id: 'b', slug: 'same', name: 'B', productTypes: [] }] }] };
  assert.throws(() => parseMenu(twice), /duplicate category slug/);
  assert.deepEqual(parseMenu({ verticals: [{ id: 'v', slug: 'v', name: 'V', categories: [{ id: 'c', slug: 'c', name: 'C', inStockCount: -3, inStockCounts: { boys: 'x' }, productTypes: [] }] }] }).verticals[0].categories[0].inStockCount, 0, 'counts are sanitized');

  // Never invent slugs: every word-map target exists in the store hierarchy.
  for (const entry of BK_WORDS) {
    const { vertical, categories: targets = [], productType } = entry.target;
    if (vertical) assert.ok(bkVertical(vertical), `${entry.phrases[0]}: vertical ${vertical}`);
    for (const slug of targets) assert.ok(bkCategory(slug), `${entry.phrases[0]}: category ${slug}`);
    if (productType) {
      const owners = vertical ? [vertical] : targets.map(slug => bkCategory(slug)!.vertical);
      assert.ok(owners.some(v => taxonomyProductType(v, productType)), `${entry.phrases[0]}: productType ${productType}`);
    }
  }

  // Gender: filtering follows boys'/girls' stock; asking is Ray's choice (Apparel and Kids Fashion).
  const filtering = verticals.filter(v => verticalFiltersGender(v.slug)).map(v => v.slug);
  assert.ok(['clothing', 'kids-fashion', 'footwear'].every(v => filtering.includes(v)), filtering.join(','));
  assert.ok(!filtering.includes('toys') && !filtering.includes('baby-care'), 'no gender where nothing is for boys or girls');
  assert.deepEqual(verticals.filter(v => verticalAsksGender(v.slug)).map(v => v.slug), ['clothing', 'kids-fashion'], 'only apparel and kids fashion ask boy/girl');
  assert.equal(verticalUsesAge('travel-gear'), false, 'travel gear products carry no age');
  assert.equal(verticalNeedsAge('travel-gear'), false);
  assert.equal(verticalNeedsAge('clothing'), true);
  assert.equal(verticalNeedsAge('toys'), true);

  // Overlapping words skip categories with nothing in stock (the store's "ethnic" category is empty
  // in this snapshot), and use both when both have stock.
  assert.equal(bkCategory('ethnic')!.inStockCount, 0);
  assert.deepEqual(resolveBkText('ethnic wear').categories, ['ethnic-wear']);
  const restocked: BkTaxonomy = structuredClone(taxonomy);
  restocked.verticals.find(v => v.slug === 'clothing')!.categories.find(c => c.slug === 'ethnic')!.inStockCount = 5;
  setTaxonomy(restocked);
  assert.deepEqual(resolveBkText('ethnic wear').categories, ['ethnic', 'ethnic-wear'], 'restocked categories come back after a sync');
  setTaxonomy(taxonomy);

  // Attribute labels are sent exactly as the API spells them (the filter is case-sensitive).
  assert.equal(attributeLabel('topwear', 'occasion', 'casual'), 'Casual');
  assert.equal(attributeLabel('topwear', 'occasion', 'wedding'), null);

  // Word mapping, including the apparel traps and overlaps.
  const r = (text: string) => resolveBkText(text);
  assert.deepEqual(r('shirt for my 5 year old son'), { vertical: 'clothing', categories: ['topwear'], productType: 'shirts', colors: [], materials: [], brands: [], leftover: '', matchedItem: true });
  assert.deepEqual([r('frock for 2 year old girl').categories, r('frock').productType], [['dresses'], 'frocks']);
  // "Dress" means clothes in general; occasion words narrow general clothes but not specific items.
  for (const text of ['dress for my son', 'dresses for my daughter', 'clothes', 'outfit']) assert.deepEqual([r(text).vertical, r(text).categories], ['clothing', []], text);
  for (const text of ['show dresses for diwali', 'dress for wedding', 'puja dress', 'something for diwali']) assert.deepEqual(r(text).categories, ['ethnic-wear'], text);
  assert.deepEqual([r('dress for a party').categories, r('party dress for my son').categories], [['party-wear'], ['party-wear']]);
  assert.deepEqual([r('return gifts for party').productType, r('return gifts for party').leftover], ['return-gifts', ''], 'a specific item beats the occasion word');
  assert.deepEqual([r('gift hamper for wedding').productType, r('shirt for a party').productType, r('shirt for a party').leftover], ['gift-baskets', 'shirts', '']);
  assert.deepEqual([r('kurta for diwali').categories, r('kurta for diwali').leftover], [['ethnic-wear'], '']);
  assert.deepEqual(r('ethnic wear for diwali, boy, 6').categories, ['ethnic-wear']);
  assert.deepEqual(r('kurta for my son').categories, ['ethnic-wear']);
  assert.deepEqual(r('festive outfit').categories, ['ethnic-wear']);
  assert.deepEqual(r('party dress for my daughter').categories, ['party-wear']);
  assert.deepEqual([r('co-ord set').categories, r('top and pant set').categories, r('top and pant set').productType], [['sets'], ['sets'], 'co-ord-sets']);
  assert.deepEqual(r('tshirt').productType, 't-shirts');
  const bib = r('bib for my baby');
  assert.deepEqual([bib.vertical, bib.categories], [null, ['towels-bibs', 'feeding-bibs']], 'overlap across verticals keeps both');
  assert.deepEqual(r('childproofing').categories, ['baby-proofing', 'childproofing']);
  assert.deepEqual(r('educational toys').categories, ['educational', 'learning']);
  // Outside apparel, specific words use department + product type (store categories are broad or mislabelled).
  const typed = (text: string) => [r(text).vertical, r(text).categories, r(text).productType];
  assert.deepEqual(typed('water bottle'), ['school-supplies', [], 'water-bottles'], 'longer phrase beats "bottle"');
  assert.deepEqual(typed('feeding bottle'), ['feeding-nursing', [], 'feeding-bottles']);
  for (const word of ['stroller', 'pram', 'buggy']) assert.deepEqual(typed(word), ['travel-gear', [], 'strollers'], word);
  for (const word of ['lunch box', 'tiffin']) assert.deepEqual(typed(word), ['school-supplies', [], 'lunch-boxes'], word);
  for (const word of ['sipper', 'sippy cup']) assert.deepEqual(typed(word), ['feeding-nursing', [], 'sippy-cups'], word);
  for (const word of ['school bag', 'backpack']) assert.deepEqual(typed(word), ['school-supplies', [], 'school-backpacks'], word);
  for (const word of ['crib', 'cradle']) assert.deepEqual(typed(word), ['nursery-furniture', [], 'cradles'], word);
  assert.deepEqual(typed('hair band for my daughter'), ['kids-fashion', [], 'hairbands'], 'not the whole Accessories category');
  assert.deepEqual(r('potty').categories, ['potty-seats-chairs']);
  assert.deepEqual([r('toys').vertical, r('toys').categories], ['toys', []]);

  // Colour words → colour slugs from the API data (first or last word only).
  assert.deepEqual(r('orange t-shirt').colors, ['mango-orange']);
  assert.ok(r('blue jeans').colors.includes('sky-blue') && r('blue jeans').colors.includes('navy-blue'));
  assert.ok(!r('blue jeans').colors.includes('white-with-blue-green'), 'mostly-white prints are not "blue"');
  assert.ok(r('pink dress').colors.includes('pink-dusty'));
  assert.ok(r('golden lehenga').colors.includes('golden'));
  const allColours = new Set(Object.values(BK_DATA.verticals).flatMap(v => v.colors.map(c => c.slug)));
  for (const slug of r('red green yellow white black dress').colors) assert.ok(allColours.has(slug), slug);

  // Materials, brands and leftover search words.
  assert.ok(r('wooden toy for 1 year old').materials.includes('wood'));
  assert.deepEqual([r('wooden toy').vertical, r('wooden toy').leftover], ['toys', '']);
  assert.deepEqual(r('doodledry t-shirt').brands, ['doodledry']);
  assert.deepEqual(r('adore you dress').brands, [], 'ordinary-word brand names never match');
  assert.deepEqual([r('dinosaur toy').vertical, r('dinosaur toy').leftover], ['toys', 'dinosaur']);
  assert.deepEqual([r('laptop').matchedItem, r('laptop').leftover], [false, 'laptop']);
  assert.deepEqual([r('two shirts').productType, r('two shirts').leftover], ['shirts', ''], 'quantities are not search words');
  assert.deepEqual([r('one thousand rupees').matchedItem, r('one thousand rupees').leftover], [false, '']);
  const nothing = r('gift for my 4 year old under ₹800');
  assert.deepEqual([nothing.matchedItem, nothing.leftover, nothing.categories], [false, '', []], 'no item yet');

  console.log('Bachpankart catalog checks passed (config, slugs, required fields, word/colour/material/brand mapping).');
}
main();
