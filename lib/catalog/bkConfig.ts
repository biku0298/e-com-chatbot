import data from './bkCatalogData.json';

/**
 * All bachpankart catalog configuration lives here (never in engine.ts).
 * Category slugs come from the site's category CSV (docs/bachpankart-api.md); colour, brand,
 * material and product-type slugs come from the API's facets via bkCatalogData.json.
 */

export type BkTier = 1 | 2;
/** Funnel dimensions, in the vocabulary of Ray's shopping state. `type` is the API's productType. */
export type BkDimension = 'vertical' | 'category' | 'type' | 'color' | 'occasion' | 'fit' | 'sleeveLength' | 'pattern' | 'material' | 'brand';

export type BkVertical = { slug: string; label: string; tier: BkTier };
export type BkCategory = { vertical: string; slug: string; label: string };

/** Products per API page (the API rejects limit=100; 24 is honored). */
export const BK_PAGE_LIMIT = 24;
/** Fixed sort so paging never skips or repeats products (the default order is shuffled). */
export const BK_SORT = 'newest';
export const BK_SITE = 'https://bachpankart.com';

export const BK_VERTICALS: BkVertical[] = [
  { slug: 'clothing', label: 'Apparel', tier: 1 },
  { slug: 'kids-fashion', label: 'Kids Fashion', tier: 2 },
  { slug: 'footwear', label: 'Footwear', tier: 2 },
  { slug: 'toys', label: 'Toys & Games', tier: 2 },
  { slug: 'books', label: 'Books & Learning', tier: 2 },
  { slug: 'baby-care', label: 'Baby Care & Essentials', tier: 2 },
  { slug: 'feeding-nursing', label: 'Feeding & Nursing', tier: 2 },
  { slug: 'nursery-furniture', label: 'Nursery & Kids Furniture', tier: 2 },
  { slug: 'travel-gear', label: 'Travel & Gear', tier: 2 },
  { slug: 'school-supplies', label: 'School Supplies', tier: 2 },
  { slug: 'party-gifting', label: 'Party & Gifting', tier: 2 },
  { slug: 'health-safety', label: 'Health & Safety', tier: 2 },
];

/** The site's 73 categories (docs/bachpankart-api.md CSV). */
export const BK_CATEGORIES: BkCategory[] = ([
  ['clothing', 'topwear', 'Topwear'], ['clothing', 'dresses', 'Dresses'], ['clothing', 'bottomwear', 'Bottomwear'],
  ['clothing', 'party-wear', 'Party Wear'], ['clothing', 'ethnic', 'Ethnic & Festive'], ['clothing', 'innerwear', 'Innerwear'],
  ['clothing', 'sleepwear', 'Sleepwear'], ['clothing', 'sets', 'Sets'], ['clothing', 'ethnic-wear', 'Ethnic Wear'],
  ['kids-fashion', 'fashion-accessories', 'Accessories'], ['kids-fashion', 'jewellery', 'Jewellery'], ['kids-fashion', 'fashion-bags', 'Bags'],
  ['footwear', 'casual-shoes', 'Casual Shoes'], ['footwear', 'sports-shoes', 'Sports Shoes'], ['footwear', 'sandals', 'Sandals & Flip-flops'],
  ['footwear', 'booties', 'Booties'],
  ['toys', 'toys', 'Toys'], ['toys', 'educational', 'Educational Toys'], ['toys', 'plush', 'Plush & Soft Toys'],
  ['toys', 'electronic', 'Electronic Toys'], ['toys', 'board-games', 'Board Games & Puzzles'], ['toys', 'building', 'Building & Construction'],
  ['toys', 'action-figures', 'Action Figures & Dolls'], ['toys', 'outdoor-toys', 'Outdoor & Active Play'], ['toys', 'musical-toys', 'Musical Toys'],
  ['toys', 'ride-ons', 'Ride-Ons & Scooters'], ['toys', 'role-play', 'Role Play'],
  ['books', 'puzzle-books', 'Puzzle Books'], ['books', 'picture-books', 'Picture Books'], ['books', 'drawing-supplies', 'Drawing & Sketching'],
  ['books', 'story-books', 'Story Books'], ['books', 'paints', 'Paints & Brushes'], ['books', 'activity-books', 'Activity Books'],
  ['books', 'craft-kits', 'Craft Kits'], ['books', 'learning', 'Learning & Educational'], ['books', 'clay-dough', 'Clay & Dough'],
  ['books', 'colouring', 'Colouring Books'], ['books', 'stickers-stamps', 'Stickers & Stamps'], ['books', 'beads', 'Beads & Threading'],
  ['books', 'reference', 'Reference & Atlas'],
  ['baby-care', 'potty-seats-chairs', 'Potty Seats & Chairs'], ['baby-care', 'baby-proofing', 'Baby Proofing'], ['baby-care', 'diapering', 'Diapering'],
  ['baby-care', 'bathing-skincare', 'Bathing & Skincare'], ['baby-care', 'healthcare', 'Healthcare'], ['baby-care', 'wipes', 'Wipes'],
  ['baby-care', 'towels-bibs', 'Towels & Bibs'], ['baby-care', 'baby-grooming', 'Grooming'],
  ['feeding-nursing', 'bottles', 'Bottles & Nipples'], ['feeding-nursing', 'sippy-cups', 'Sippy Cups & Mugs'], ['feeding-nursing', 'feeding-bibs', 'Feeding Bibs'],
  ['feeding-nursing', 'feeding-sets', 'Feeding Sets'], ['feeding-nursing', 'nursing-accessories', 'Breastfeeding Accessories'],
  ['feeding-nursing', 'sterilizers-warmers', 'Sterilizers & Warmers'],
  ['nursery-furniture', 'cribs-cradles', 'Cribs & Cradles'], ['nursery-furniture', 'beds-bedding', 'Beds & Bedding'],
  ['nursery-furniture', 'study-tables', 'Study Tables & Chairs'], ['nursery-furniture', 'toy-storage', 'Toy Storage'],
  ['travel-gear', 'strollers', 'Strollers & Prams'], ['travel-gear', 'carriers-slings', 'Carriers & Slings'],
  ['school-supplies', 'school-bags', 'School Bags & Backpacks'], ['school-supplies', 'lunch-water', 'Lunch Boxes & Water Bottles'],
  ['school-supplies', 'stationery', 'Stationery'], ['school-supplies', 'notebooks', 'Notebooks & Diaries'],
  ['school-supplies', 'pencil-cases', 'Pencil Cases & Boxes'], ['school-supplies', 'geometry-sets', 'Geometry & Math Sets'],
  ['school-supplies', 'art-supplies-school', 'School Art Supplies'],
  ['party-gifting', 'party-themes', 'Themed Party Sets'], ['party-gifting', 'gift-hampers', 'Gift Hampers'], ['party-gifting', 'party-favors', 'Party Favors'],
  // The site's label is cut off ("Outlet Covers &").
  ['health-safety', 'childproofing', 'Childproofing'], ['health-safety', 'safety-gates', 'Safety Gates'], ['health-safety', 'outlet-covers', 'Outlet Covers'],
] as const).map(([vertical, slug, label]) => ({ vertical, slug, label }));

/** Tier rules: which fields must be known before searching, and the funnel order for chips. */
export const BK_TIERS: Record<BkTier, { requiresGender: boolean; funnel: BkDimension[] }> = {
  1: { requiresGender: true, funnel: ['category', 'type', 'color', 'occasion', 'fit', 'sleeveLength', 'pattern', 'material', 'brand'] },
  // Tier 2 asks gender/age only where the vertical's data supports it (see verticalNeedsGender / verticalNeedsAge).
  2: { requiresGender: false, funnel: ['category', 'type', 'brand', 'color'] },
};
/** Ask for gender only where at least this share of products is not UNISEX. */
const GENDER_VARIES_SHARE = 0.1;
/** Ask for / filter by age only where at least this share of products carries an age (the API drops the rest). */
const AGE_COVERAGE_SHARE = 0.8;

/** Chips: at most this many vertical chips, and no narrowing chips for this many matches or fewer. */
export const BK_MAX_VERTICAL_CHIPS = 6;
export const BK_SMALL_SET = 8;

type VerticalData = {
  label: string; totalCount: number; genders: Record<string, number>; ageCoverage: number;
  productTypes: { slug: string; name: string }[]; colors: { slug: string; name: string; family: string | null }[];
  materials: { slug: string; name: string }[]; brands: { slug: string; name: string }[];
};
export const BK_DATA = data as unknown as {
  verticals: Record<string, VerticalData>;
  categories: Record<string, { productTypes: { slug: string; name: string }[]; attributes: Record<string, string[]> }>;
};

const verticalBySlug = new Map(BK_VERTICALS.map(vertical => [vertical.slug, vertical]));
const categoryBySlug = new Map(BK_CATEGORIES.map(category => [category.slug, category]));

export const bkVertical = (slug: string | null | undefined) => (slug ? verticalBySlug.get(slug) : undefined);
export const bkCategory = (slug: string | null | undefined) => (slug ? categoryBySlug.get(slug) : undefined);
/** A vertical with no tuning still works on Tier 2 defaults. */
export const bkTier = (vertical: string | null | undefined): BkTier => bkVertical(vertical)?.tier ?? 2;

export function verticalNeedsGender(vertical: string): boolean {
  if (BK_TIERS[bkTier(vertical)].requiresGender) return true;
  const genders = BK_DATA.verticals[vertical]?.genders ?? {};
  const total = Object.values(genders).reduce((sum, n) => sum + n, 0);
  return total > 0 && (total - (genders.UNISEX ?? 0)) / total >= GENDER_VARIES_SHARE;
}

/**
 * Tier 1 needs age, and Tier 2 needs it wherever the vertical has age data, so in practice age is
 * required exactly where products carry it. Travel gear (no ages) never asks: filtering would hide it.
 */
export function verticalNeedsAge(vertical: string): boolean {
  return verticalUsesAge(vertical);
}

/** Whether age filtering is safe here: cards without an age are excluded by the API. */
export function verticalUsesAge(vertical: string): boolean {
  return (BK_DATA.verticals[vertical]?.ageCoverage ?? 0) >= AGE_COVERAGE_SHARE;
}

/** Attribute labels exactly as the API spells them (the filter is case-sensitive). */
export function attributeLabel(category: string | null | undefined, attribute: string, word: string): string | null {
  const values = category ? BK_DATA.categories[category]?.attributes[attribute] ?? [] : [];
  return values.find(value => value.toLowerCase() === word.toLowerCase()) ?? null;
}

// ── Word map ───────────────────────────────────────────────────────────────────

/** What a customer phrase points to. Overlapping words list several categories (searched as separate calls). */
export type BkTarget = { vertical?: string; categories?: string[]; productType?: string };
export type BkWordEntry = { phrases: string[]; target: BkTarget };

/**
 * Customer words → catalog targets. Longer phrases win over the words inside them
 * ("water bottle" beats "bottle"). Tier 1 (apparel) is mapped richly; other verticals use
 * their category labels plus common synonyms.
 */
export const BK_WORDS: BkWordEntry[] = [
  // ── Apparel (Tier 1) ──
  { phrases: ['clothes', 'clothing', 'apparel', 'outfit', 'outfits', 'kids wear'], target: { vertical: 'clothing' } },
  { phrases: ['shirt'], target: { categories: ['topwear'], productType: 'shirts' } },
  { phrases: ['t-shirt', 't shirt', 'tshirt', 'tee'], target: { categories: ['topwear'], productType: 't-shirts' } },
  { phrases: ['polo', 'polo shirt'], target: { categories: ['topwear'], productType: 'polos' } },
  { phrases: ['jacket'], target: { categories: ['topwear'], productType: 'jackets' } },
  { phrases: ['top', 'topwear'], target: { categories: ['topwear'] } },
  { phrases: ['frock'], target: { categories: ['dresses'], productType: 'frocks' } },
  { phrases: ['dress', 'dresses'], target: { categories: ['dresses'] } },
  { phrases: ['gown'], target: { categories: ['dresses'], productType: 'gowns' } },
  { phrases: ['jumpsuit'], target: { categories: ['dresses'], productType: 'jumpsuit' } },
  { phrases: ['party dress', 'party frock', 'party gown', 'party wear', 'partywear', 'party outfit', 'birthday dress', 'birthday outfit'], target: { categories: ['party-wear'] } },
  { phrases: ['party suit', 'blazer'], target: { categories: ['party-wear'], productType: 'party-suits' } },
  { phrases: ['ethnic', 'ethnic wear', 'festive', 'festive wear', 'traditional', 'traditional wear', 'diwali', 'kurta', 'kurta pajama', 'kurta pyjama', 'wedding outfit'], target: { categories: ['ethnic', 'ethnic-wear'] } },
  { phrases: ['lehenga', 'lehenga choli', 'ghagra'], target: { categories: ['ethnic-wear'] } },
  { phrases: ['sherwani'], target: { categories: ['ethnic-wear'], productType: 'sherwani-sets' } },
  { phrases: ['dhoti'], target: { categories: ['ethnic-wear'], productType: 'dhoti-set' } },
  { phrases: ['sharara'], target: { categories: ['ethnic-wear'], productType: 'sharara-set' } },
  { phrases: ['salwar', 'salwar suit'], target: { categories: ['ethnic-wear'], productType: 'salwar-suits' } },
  { phrases: ['bottomwear', 'pants', 'pant'], target: { categories: ['bottomwear'] } },
  { phrases: ['shorts'], target: { categories: ['bottomwear'], productType: 'shorts' } },
  { phrases: ['jeans', 'denims'], target: { categories: ['bottomwear'], productType: 'jeans' } },
  { phrases: ['trousers', 'trouser'], target: { categories: ['bottomwear'], productType: 'trousers' } },
  { phrases: ['leggings', 'legging'], target: { categories: ['bottomwear'], productType: 'leggings' } },
  { phrases: ['skirt'], target: { categories: ['bottomwear'], productType: 'skirts' } },
  // "co-ord" and "top and pant set" go to sets first.
  { phrases: ['co-ord', 'co ord', 'coord', 'co-ord set', 'top and pant set', 'top and pants set', 'top and bottom set', 'matching set'], target: { categories: ['sets'], productType: 'co-ord-sets' } },
  { phrases: ['set', 'clothing set'], target: { categories: ['sets'] } },
  { phrases: ['night suit', 'nightsuit'], target: { categories: ['sets'], productType: 'night-suits' } },
  { phrases: ['romper', 'onesie'], target: { categories: ['sets'], productType: 'romper-sets' } },
  { phrases: ['night dress', 'nightdress', 'nighty', 'nightie'], target: { categories: ['sleepwear'], productType: 'night-dresses' } },
  { phrases: ['sleepwear', 'nightwear', 'night wear', 'pyjama', 'pajama', 'pyjamas', 'pajamas'], target: { categories: ['sleepwear', 'sets'] } },
  { phrases: ['innerwear', 'vest', 'underwear', 'banyan'], target: { categories: ['innerwear'] } },
  // ── Kids fashion ──
  { phrases: ['accessories', 'hair band', 'hairband', 'hair clip', 'hair clips', 'cap', 'hat', 'sunglasses'], target: { categories: ['fashion-accessories'] } },
  { phrases: ['jewellery', 'jewelry', 'bracelet', 'necklace', 'earrings'], target: { categories: ['jewellery'] } },
  { phrases: ['bag', 'handbag', 'purse', 'sling bag'], target: { categories: ['fashion-bags'] } },
  // ── Footwear ──
  { phrases: ['footwear'], target: { vertical: 'footwear' } },
  { phrases: ['shoes', 'shoe', 'sneakers', 'casual shoes'], target: { categories: ['casual-shoes'] } },
  { phrases: ['sports shoes', 'running shoes'], target: { categories: ['sports-shoes'] } },
  { phrases: ['sandals', 'sandal', 'flip flops', 'flip-flops', 'slippers', 'chappal'], target: { categories: ['sandals'] } },
  { phrases: ['booties', 'baby shoes'], target: { categories: ['booties'] } },
  // ── Toys ──
  { phrases: ['toy', 'toys', 'games'], target: { vertical: 'toys' } },
  { phrases: ['educational toy', 'educational'], target: { categories: ['educational', 'learning'] } },
  { phrases: ['soft toy', 'plush', 'teddy', 'teddy bear', 'stuffed toy', 'stuffed animal'], target: { categories: ['plush'] } },
  { phrases: ['electronic toy', 'remote control car', 'rc car'], target: { categories: ['electronic'] } },
  { phrases: ['board game', 'puzzle', 'jigsaw'], target: { categories: ['board-games'] } },
  { phrases: ['building blocks', 'blocks', 'lego', 'construction toy'], target: { categories: ['building'] } },
  { phrases: ['doll', 'action figure'], target: { categories: ['action-figures'] } },
  { phrases: ['outdoor toy', 'outdoor play', 'ball'], target: { categories: ['outdoor-toys'] } },
  { phrases: ['musical toy', 'xylophone', 'toy drum'], target: { categories: ['musical-toys'] } },
  { phrases: ['ride on', 'ride-on', 'scooter', 'tricycle', 'cycle'], target: { categories: ['ride-ons'] } },
  { phrases: ['role play', 'pretend play', 'kitchen set', 'doctor set'], target: { categories: ['role-play'] } },
  { phrases: ['rattle'], target: { vertical: 'toys', productType: 'rattles-shakers' } },
  // ── Books & learning ──
  { phrases: ['book', 'books'], target: { vertical: 'books' } },
  { phrases: ['story book', 'storybook', 'stories'], target: { categories: ['story-books'] } },
  { phrases: ['picture book'], target: { categories: ['picture-books'] } },
  { phrases: ['colouring book', 'coloring book', 'colouring', 'coloring'], target: { categories: ['colouring'] } },
  { phrases: ['activity book'], target: { categories: ['activity-books'] } },
  { phrases: ['puzzle book'], target: { categories: ['puzzle-books'] } },
  { phrases: ['drawing', 'sketching', 'sketch book'], target: { categories: ['drawing-supplies'] } },
  { phrases: ['paints', 'paint', 'brushes'], target: { categories: ['paints'] } },
  { phrases: ['art supplies', 'art kit'], target: { categories: ['paints', 'art-supplies-school'] } },
  { phrases: ['craft kit', 'craft', 'diy kit'], target: { categories: ['craft-kits'] } },
  { phrases: ['clay', 'play dough', 'playdough', 'dough'], target: { categories: ['clay-dough'] } },
  { phrases: ['stickers', 'stamps'], target: { categories: ['stickers-stamps'] } },
  { phrases: ['beads', 'threading'], target: { categories: ['beads'] } },
  { phrases: ['atlas', 'dictionary', 'encyclopedia'], target: { categories: ['reference'] } },
  { phrases: ['flash cards', 'flashcards', 'learning'], target: { categories: ['learning'] } },
  // ── Baby care ──
  { phrases: ['baby care'], target: { vertical: 'baby-care' } },
  { phrases: ['potty', 'potty seat', 'potty chair', 'potty training'], target: { categories: ['potty-seats-chairs'] } },
  { phrases: ['baby proofing', 'babyproofing', 'childproofing', 'child proofing', 'corner guard'], target: { categories: ['baby-proofing', 'childproofing'] } },
  { phrases: ['diaper', 'diapers', 'nappy', 'nappies'], target: { categories: ['diapering'] } },
  { phrases: ['bath', 'bathing', 'shampoo', 'soap', 'lotion', 'skincare', 'baby wash'], target: { categories: ['bathing-skincare'] } },
  { phrases: ['thermometer', 'nasal aspirator', 'healthcare'], target: { categories: ['healthcare'] } },
  { phrases: ['wipes'], target: { categories: ['wipes'] } },
  { phrases: ['towel', 'bath towel'], target: { categories: ['towels-bibs'] } },
  { phrases: ['bib', 'bibs'], target: { categories: ['towels-bibs', 'feeding-bibs'] } },
  { phrases: ['grooming', 'nail clipper', 'comb'], target: { categories: ['baby-grooming'] } },
  // ── Feeding & nursing ──
  { phrases: ['feeding bottle', 'bottle', 'nipple', 'teat'], target: { categories: ['bottles'] } },
  { phrases: ['sipper', 'sippy', 'sippy cup', 'kids mug'], target: { categories: ['sippy-cups'] } },
  { phrases: ['feeding set', 'plate', 'bowl', 'spoon'], target: { categories: ['feeding-sets'] } },
  { phrases: ['breastfeeding', 'breast pump', 'nursing pillow', 'nursing pad'], target: { categories: ['nursing-accessories'] } },
  { phrases: ['sterilizer', 'steriliser', 'bottle warmer'], target: { categories: ['sterilizers-warmers'] } },
  // ── Nursery furniture ──
  { phrases: ['crib', 'cradle', 'cot', 'bassinet'], target: { categories: ['cribs-cradles'] } },
  { phrases: ['bed', 'bedding', 'mattress', 'blanket', 'pillow'], target: { categories: ['beds-bedding'] } },
  { phrases: ['study table', 'kids table', 'kids chair', 'table and chair', 'desk'], target: { categories: ['study-tables'] } },
  { phrases: ['toy storage', 'toy box', 'storage box'], target: { categories: ['toy-storage'] } },
  // ── Travel gear ──
  { phrases: ['stroller', 'pram', 'buggy', 'pushchair'], target: { categories: ['strollers'] } },
  { phrases: ['baby carrier', 'carrier', 'sling', 'baby sling'], target: { categories: ['carriers-slings'] } },
  // ── School supplies ──
  { phrases: ['school supplies'], target: { vertical: 'school-supplies' } },
  { phrases: ['school bag', 'schoolbag', 'backpack'], target: { categories: ['school-bags'] } },
  { phrases: ['lunch box', 'lunchbox', 'tiffin', 'water bottle'], target: { categories: ['lunch-water'] } },
  { phrases: ['stationery', 'pencil', 'pen', 'eraser', 'sharpener', 'crayons'], target: { categories: ['stationery'] } },
  { phrases: ['notebook', 'diary'], target: { categories: ['notebooks'] } },
  { phrases: ['pencil case', 'pencil box', 'pencil pouch'], target: { categories: ['pencil-cases'] } },
  { phrases: ['geometry box', 'geometry set', 'compass box'], target: { categories: ['geometry-sets'] } },
  // ── Party & gifting ──
  { phrases: ['party decoration', 'party decorations', 'birthday decoration', 'party theme', 'balloons'], target: { categories: ['party-themes'] } },
  { phrases: ['gift hamper', 'hamper', 'gift box'], target: { categories: ['gift-hampers'] } },
  { phrases: ['return gift', 'return gifts', 'party favor', 'party favors', 'party favour', 'party favours'], target: { categories: ['party-favors'] } },
  // ── Health & safety ──
  { phrases: ['safety gate', 'baby gate'], target: { categories: ['safety-gates'] } },
  { phrases: ['outlet cover', 'socket cover', 'plug cover'], target: { categories: ['outlet-covers'] } },
];

/** Customer colour words. Each maps to every colour slug whose first or last word is that colour (see bkWords). */
export const BK_COLOUR_WORDS: Record<string, string> = {
  red: 'red', pink: 'pink', orange: 'orange', yellow: 'yellow', green: 'green', blue: 'blue', navy: 'navy',
  purple: 'purple', violet: 'violet', lavender: 'lavender', brown: 'brown', beige: 'beige', black: 'black',
  white: 'white', grey: 'grey', gray: 'grey', gold: 'gold', golden: 'gold', maroon: 'maroon', peach: 'peach',
  cream: 'cream', teal: 'teal', mint: 'mint', mustard: 'mustard', coral: 'coral', olive: 'olive', wine: 'wine',
  ivory: 'ivory', magenta: 'magenta', silver: 'silver',
};

/** Customer material words → the word to look for in material slugs. */
export const BK_MATERIAL_WORDS: Record<string, string> = {
  wooden: 'wood', wood: 'wood', cotton: 'cotton', silk: 'silk', denim: 'denim', linen: 'linen', wool: 'wool',
  woollen: 'wool', woolen: 'wool', velvet: 'velvet', satin: 'satin', plastic: 'plastic', silicone: 'silicone',
  metal: 'metal', fleece: 'fleece', muslin: 'muslin', rayon: 'rayon', georgette: 'georgette', organza: 'organza',
};

/** Words that are not an item ("gift for my son" has no item yet). */
export const BK_NON_ITEM_WORDS = [
  'gift', 'gifts', 'present', 'something', 'anything', 'stuff', 'things', 'item', 'items', 'product', 'products',
  'kid', 'kids', 'child', 'children', 'baby', 'toddler', 'boy', 'boys', 'girl', 'girls', 'son', 'daughter',
  'for', 'my', 'a', 'an', 'the', 'some', 'with', 'and', 'or', 'of', 'in', 'old', 'year', 'years', 'month', 'months',
  'show', 'me', 'want', 'need', 'looking', 'buy', 'get', 'please', 'new', 'nice', 'good', 'best', 'cute',
];
