import assert from 'node:assert/strict';
import {
  BK_CATEGORIES, BK_DATA, BK_VERTICALS, BK_WORDS, attributeLabel, bkCategory, bkTier,
  verticalNeedsAge, verticalNeedsGender, verticalUsesAge,
} from '../lib/catalog/bkConfig';
import { resolveBkText } from '../lib/catalog/bkWords';

/** Catalog config and word mapping. Pure: no network, no fixtures beyond the generated data file. */
function main() {
  // Config shape: 12 verticals, 73 categories, every category in a known vertical.
  assert.equal(BK_VERTICALS.length, 12);
  assert.equal(BK_CATEGORIES.length, 73);
  assert.equal(new Set(BK_CATEGORIES.map(c => c.slug)).size, 73, 'category slugs are unique');
  for (const category of BK_CATEGORIES) assert.ok(BK_VERTICALS.some(v => v.slug === category.vertical), category.slug);
  assert.equal(bkTier('clothing'), 1);
  assert.equal(bkTier('toys'), 2);
  assert.equal(bkTier('something-new'), 2, 'an untuned vertical falls back to Tier 2');

  // Never invent slugs: every word-map target exists in the CSV or the API data.
  for (const entry of BK_WORDS) {
    const { vertical, categories = [], productType } = entry.target;
    if (vertical) assert.ok(BK_VERTICALS.some(v => v.slug === vertical), `${entry.phrases[0]}: vertical ${vertical}`);
    for (const slug of categories) assert.ok(bkCategory(slug), `${entry.phrases[0]}: category ${slug}`);
    if (productType) {
      const verticals = vertical ? [vertical] : categories.map(slug => bkCategory(slug)!.vertical);
      assert.ok(verticals.some(v => BK_DATA.verticals[v]?.productTypes.some(t => t.slug === productType)), `${entry.phrases[0]}: productType ${productType}`);
    }
  }

  // Required fields come from the data: gender only where it varies, age only where products carry it.
  assert.deepEqual(BK_VERTICALS.filter(v => verticalNeedsGender(v.slug)).map(v => v.slug), ['clothing', 'kids-fashion', 'footwear', 'school-supplies']);
  assert.equal(verticalUsesAge('travel-gear'), false, 'travel gear products carry no age');
  assert.equal(verticalNeedsAge('travel-gear'), false);
  assert.equal(verticalNeedsAge('clothing'), true);
  assert.equal(verticalNeedsAge('toys'), true);

  // Attribute labels are sent exactly as the API spells them (the filter is case-sensitive).
  assert.equal(attributeLabel('topwear', 'occasion', 'casual'), 'Casual');
  assert.equal(attributeLabel('topwear', 'occasion', 'wedding'), null);

  // Word mapping, including the apparel traps and overlaps.
  const r = (text: string) => resolveBkText(text);
  assert.deepEqual(r('shirt for my 5 year old son'), { vertical: 'clothing', categories: ['topwear'], productType: 'shirts', colors: [], materials: [], brands: [], leftover: '', matchedItem: true });
  assert.deepEqual([r('frock for 2 year old girl').categories, r('frock').productType], [['dresses'], 'frocks']);
  // "Dress" means clothes in general; occasion words narrow general clothes but not specific items.
  for (const text of ['dress for my son', 'dresses for my daughter', 'clothes', 'outfit']) assert.deepEqual([r(text).vertical, r(text).categories], ['clothing', []], text);
  for (const text of ['show dresses for diwali', 'dress for wedding', 'puja dress', 'something for diwali']) assert.deepEqual(r(text).categories, ['ethnic', 'ethnic-wear'], text);
  assert.deepEqual([r('dress for a party').categories, r('party dress for my son').categories], [['party-wear'], ['party-wear']]);
  assert.deepEqual([r('return gifts for party').productType, r('return gifts for party').leftover], ['return-gifts', ''], 'a specific item beats the occasion word');
  assert.deepEqual([r('gift hamper for wedding').productType, r('shirt for a party').productType, r('shirt for a party').leftover], ['gift-baskets', 'shirts', '']);
  assert.deepEqual([r('kurta for diwali').categories, r('kurta for diwali').leftover], [['ethnic', 'ethnic-wear'], '']);
  assert.deepEqual(r('ethnic wear for diwali, boy, 6').categories, ['ethnic', 'ethnic-wear']);
  assert.deepEqual(r('kurta for my son').categories, ['ethnic', 'ethnic-wear']);
  assert.deepEqual(r('festive outfit').categories, ['ethnic', 'ethnic-wear']);
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
