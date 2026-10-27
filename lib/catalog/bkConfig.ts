import data from './bkCatalogData.json';

/**
 * All bachpankart catalog configuration lives here (never in engine.ts).
 * Category slugs come from the site's category CSV (docs/bachpankart-api.md); colour, brand,
 * material and product-type slugs come from the API's facets via bkCatalogData.json.
 */

export type BkTier = 1 | 2;
/** Funnel dimensions, in the vocabulary of Ray's shopping state. `type` is the API's productType. */
export type BkDimension = 'vertical' | 'category' | 'type' | 'color' | 'occasion' | 'fit' | 'sleeveLength' | 'pattern' | 'material' | 'brand';

/**
 * `noun` is how Ray names the department in a sentence ("I couldn't find clothes for boys…").
 * `askGender: false` never asks boy/girl there (most products are unisex), but a gender the
 * customer gives is still used to filter.
 */
export type BkVertical = { slug: string; label: string; noun: string; tier: BkTier; askGender?: boolean };
export type BkCategory = { vertical: string; slug: string; label: string };

/** Products per API page (the API rejects limit=100; 24 is honored). */
export const BK_PAGE_LIMIT = 24;
/** Fixed sort so paging never skips or repeats products (the default order is shuffled). */
export const BK_SORT = 'newest';
export const BK_SITE = 'https://bachpankart.com';

export const BK_VERTICALS: BkVertical[] = [
  { slug: 'clothing', label: 'Apparel', noun: 'clothes', tier: 1 },
  { slug: 'kids-fashion', label: 'Kids Fashion', noun: 'fashion accessories', tier: 2 },
  { slug: 'footwear', label: 'Footwear', noun: 'footwear', tier: 2, askGender: false },
  { slug: 'toys', label: 'Toys & Games', noun: 'toys', tier: 2 },
  { slug: 'books', label: 'Books & Learning', noun: 'books', tier: 2 },
  { slug: 'baby-care', label: 'Baby Care & Essentials', noun: 'baby care products', tier: 2 },
  { slug: 'feeding-nursing', label: 'Feeding & Nursing', noun: 'feeding products', tier: 2 },
  { slug: 'nursery-furniture', label: 'Nursery & Kids Furniture', noun: 'nursery furniture', tier: 2 },
  { slug: 'travel-gear', label: 'Travel & Gear', noun: 'travel gear', tier: 2 },
  { slug: 'school-supplies', label: 'School Supplies', noun: 'school supplies', tier: 2, askGender: false },
  { slug: 'party-gifting', label: 'Party & Gifting', noun: 'party and gifting items', tier: 2 },
  { slug: 'health-safety', label: 'Health & Safety', noun: 'safety products', tier: 2 },
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
  // Tier 2 asks gender/age only where the vertical's data supports it (see verticalAsksGender / verticalNeedsAge).
  2: { requiresGender: false, funnel: ['category', 'type', 'brand', 'color'] },
};
/** Gender matters only where at least this share of products is not UNISEX. */
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

/** Whether a known gender filters results here (BOYS/GIRLS + UNISEX). */
export function verticalFiltersGender(vertical: string): boolean {
  if (BK_TIERS[bkTier(vertical)].requiresGender) return true;
  const genders = BK_DATA.verticals[vertical]?.genders ?? {};
  const total = Object.values(genders).reduce((sum, n) => sum + n, 0);
  return total > 0 && (total - (genders.UNISEX ?? 0)) / total >= GENDER_VARIES_SHARE;
}

/** Whether Ray asks "boy or girl?" before searching here. */
export function verticalAsksGender(vertical: string): boolean {
  if (BK_TIERS[bkTier(vertical)].requiresGender) return true;
  return bkVertical(vertical)?.askGender !== false && verticalFiltersGender(vertical);
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
/**
 * `modifier`: an occasion word ("party", "Diwali", "wedding"). It picks the occasion's clothes when
 * used alone or with a general clothes word ("dress for Diwali"), and is ignored next to a specific
 * item ("return gifts for party", "hamper for wedding").
 */
export type BkWordEntry = { phrases: string[]; target: BkTarget; modifier?: boolean };

/**
 * Customer words → catalog targets. Longer phrases win over the words inside them
 * ("water bottle" beats "bottle"). Tier 1 (apparel) is mapped richly; other verticals use
 * their category labels plus common synonyms.
 */
export const BK_WORDS: BkWordEntry[] = [
  // ── Apparel (Tier 1) ──
  // "Dress" means clothes in general (Indian English: "dresses for Diwali" = festive outfits).
  // Only frock/gown/one-piece point at the Dresses category; occasion words narrow the clothes.
  { phrases: ['clothes', 'clothing', 'apparel', 'outfit', 'outfits', 'kids wear', 'dress', 'dresses', 'garments'], target: { vertical: 'clothing' } },
  { phrases: ['shirt'], target: { categories: ['topwear'], productType: 'shirts' } },
  { phrases: ['t-shirt', 't shirt', 'tshirt', 'tee'], target: { categories: ['topwear'], productType: 't-shirts' } },
  { phrases: ['polo', 'polo shirt'], target: { categories: ['topwear'], productType: 'polos' } },
  // The store has no sweater type; jackets are its warm topwear ("jumper" means sweater in India/UK, not jumpsuit).
  { phrases: ['jacket', 'sweater', 'jumper', 'hoodie', 'sweatshirt', 'cardigan'], target: { categories: ['topwear'], productType: 'jackets' } },
  { phrases: ['top', 'topwear'], target: { categories: ['topwear'] } },
  { phrases: ['frock'], target: { categories: ['dresses'], productType: 'frocks' } },
  { phrases: ['one piece', 'one-piece', 'girls dress', 'girls dresses', 'casual dress'], target: { categories: ['dresses'] } },
  { phrases: ['gown'], target: { categories: ['dresses'], productType: 'gowns' } },
  { phrases: ['jumpsuit'], target: { categories: ['dresses'], productType: 'jumpsuit' } },
  { phrases: ['party dress', 'party frock', 'party gown', 'party wear', 'partywear', 'party outfit', 'birthday dress', 'birthday outfit'], target: { categories: ['party-wear'] } },
  { phrases: ['party'], target: { categories: ['party-wear'] }, modifier: true },
  { phrases: ['party suit', 'blazer'], target: { categories: ['party-wear'], productType: 'party-suits' } },
  { phrases: ['ethnic', 'ethnic wear', 'festive wear', 'traditional wear', 'kurta', 'kurta pajama', 'kurta pyjama', 'wedding outfit', 'festive outfit'], target: { categories: ['ethnic', 'ethnic-wear'] } },
  { phrases: ['festive', 'festival', 'traditional', 'diwali', 'puja', 'pooja', 'navratri', 'durga puja', 'eid', 'rakhi', 'raksha bandhan', 'holi', 'onam', 'pongal', 'wedding', 'shaadi'], target: { categories: ['ethnic', 'ethnic-wear'] }, modifier: true },
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
  // Outside apparel, store categories are broad or mislabelled (Accessories holds keychains and crib
  // mobiles; in-stock prams sit in Carriers & Slings), so specific words use department + product type.
  // ── Kids fashion ──
  { phrases: ['accessories', 'fashion accessories'], target: { categories: ['fashion-accessories'] } },
  { phrases: ['hair band', 'hairband', 'hair bands', 'headband', 'hair accessories', 'hair clip', 'hair clips'], target: { vertical: 'kids-fashion', productType: 'hairbands' } },
  { phrases: ['jewellery', 'jewelry'], target: { categories: ['jewellery'] } },
  { phrases: ['bracelet'], target: { vertical: 'kids-fashion', productType: 'bracelets' } },
  { phrases: ['necklace'], target: { vertical: 'kids-fashion', productType: 'necklaces-kids' } },
  { phrases: ['earrings', 'earring'], target: { vertical: 'kids-fashion', productType: 'earrings-kids' } },
  { phrases: ['bag', 'handbag'], target: { categories: ['fashion-bags'] } },
  { phrases: ['purse', 'clutch'], target: { vertical: 'kids-fashion', productType: 'clutches-kids' } },
  { phrases: ['sling bag'], target: { vertical: 'kids-fashion', productType: 'sling-bags' } },
  // ── Footwear ──
  { phrases: ['footwear', 'shoes', 'shoe'], target: { vertical: 'footwear' } },
  { phrases: ['sneakers', 'casual shoes'], target: { vertical: 'footwear', productType: 'sneakers' } },
  { phrases: ['sports shoes', 'running shoes'], target: { vertical: 'footwear', productType: 'running-shoes' } },
  { phrases: ['sandals', 'sandal', 'chappal'], target: { vertical: 'footwear', productType: 'sandals' } },
  { phrases: ['flip flops', 'flip-flops', 'slippers'], target: { vertical: 'footwear', productType: 'flip-flops' } },
  { phrases: ['booties', 'baby shoes'], target: { vertical: 'footwear', productType: 'baby-booties' } },
  { phrases: ['soft shoes'], target: { vertical: 'footwear', productType: 'soft-shoes' } },
  // ── Toys ──
  { phrases: ['toy', 'toys', 'games'], target: { vertical: 'toys' } },
  { phrases: ['educational toy', 'educational'], target: { categories: ['educational', 'learning'] } },
  { phrases: ['soft toy', 'plush', 'teddy', 'teddy bear', 'stuffed toy'], target: { vertical: 'toys', productType: 'plush-toys' } },
  { phrases: ['stuffed animal'], target: { vertical: 'toys', productType: 'stuffed-animals' } },
  { phrases: ['remote control car', 'rc car', 'remote control toy'], target: { vertical: 'toys', productType: 'rc-toys' } },
  { phrases: ['electronic toy'], target: { categories: ['electronic'] } },
  { phrases: ['board game'], target: { vertical: 'toys', productType: 'board-games' } },
  { phrases: ['card game'], target: { vertical: 'toys', productType: 'card-games' } },
  { phrases: ['puzzle', 'jigsaw'], target: { vertical: 'toys', productType: 'puzzles' } },
  { phrases: ['building blocks', 'blocks', 'lego'], target: { vertical: 'toys', productType: 'building-blocks' } },
  { phrases: ['magnetic tiles'], target: { vertical: 'toys', productType: 'magnetic-tiles' } },
  { phrases: ['construction toy'], target: { categories: ['building'] } },
  { phrases: ['doll'], target: { vertical: 'toys', productType: 'dolls' } },
  { phrases: ['action figure'], target: { vertical: 'toys', productType: 'action-figures' } },
  { phrases: ['ball'], target: { vertical: 'toys', productType: 'balls' } },
  { phrases: ['outdoor toy', 'outdoor play'], target: { categories: ['outdoor-toys'] } },
  { phrases: ['musical toy', 'xylophone', 'toy drum'], target: { vertical: 'toys', productType: 'toy-instruments' } },
  { phrases: ['tricycle', 'trike'], target: { vertical: 'toys', productType: 'tricycles' } },
  { phrases: ['ride on car', 'ride-on car'], target: { vertical: 'toys', productType: 'ride-on-cars' } },
  { phrases: ['ride on', 'ride-on', 'scooter'], target: { categories: ['ride-ons'] } },
  { phrases: ['kitchen set'], target: { vertical: 'toys', productType: 'kitchen-sets' } },
  { phrases: ['doctor set'], target: { vertical: 'toys', productType: 'doctor-sets' } },
  { phrases: ['role play', 'pretend play'], target: { categories: ['role-play'] } },
  { phrases: ['rattle'], target: { vertical: 'toys', productType: 'rattles-shakers' } },
  { phrases: ['flash cards', 'flashcards'], target: { vertical: 'toys', productType: 'flash-cards' } },
  // ── Books & learning ──
  { phrases: ['book', 'books'], target: { vertical: 'books' } },
  { phrases: ['story book', 'storybook', 'stories'], target: { categories: ['story-books'] } },
  { phrases: ['bedtime stories', 'bedtime story'], target: { vertical: 'books', productType: 'bedtime-stories' } },
  { phrases: ['picture book'], target: { categories: ['picture-books'] } },
  { phrases: ['board book'], target: { vertical: 'books', productType: 'board-books' } },
  { phrases: ['colouring book', 'coloring book'], target: { vertical: 'books', productType: 'colouring-books' } },
  { phrases: ['colouring', 'coloring'], target: { categories: ['colouring'] } },
  { phrases: ['activity book'], target: { vertical: 'books', productType: 'activity-books' } },
  { phrases: ['sticker book'], target: { vertical: 'books', productType: 'sticker-books' } },
  { phrases: ['puzzle book'], target: { categories: ['puzzle-books'] } },
  { phrases: ['drawing', 'sketching', 'sketch book'], target: { categories: ['drawing-supplies'] } },
  { phrases: ['crayons', 'crayon'], target: { vertical: 'books', productType: 'crayons' } },
  { phrases: ['markers', 'marker'], target: { vertical: 'books', productType: 'markers' } },
  { phrases: ['sketch pens', 'sketch pen'], target: { vertical: 'books', productType: 'sketch-pens' } },
  { phrases: ['colour pencils', 'color pencils'], target: { vertical: 'books', productType: 'color-pencils' } },
  { phrases: ['paints', 'paint', 'brushes'], target: { categories: ['paints'] } },
  { phrases: ['art supplies', 'art kit'], target: { categories: ['paints', 'art-supplies-school'] } },
  { phrases: ['craft kit', 'craft', 'diy kit'], target: { categories: ['craft-kits'] } },
  { phrases: ['slime'], target: { vertical: 'books', productType: 'slime-kits' } },
  { phrases: ['clay', 'play dough', 'playdough', 'dough'], target: { categories: ['clay-dough'] } },
  { phrases: ['stickers', 'stamps'], target: { categories: ['stickers-stamps'] } },
  { phrases: ['beads', 'threading'], target: { categories: ['beads'] } },
  { phrases: ['dictionary'], target: { vertical: 'books', productType: 'dictionaries' } },
  { phrases: ['encyclopedia'], target: { vertical: 'books', productType: 'encyclopedias' } },
  { phrases: ['atlas'], target: { categories: ['reference'] } },
  { phrases: ['learning'], target: { categories: ['learning'] } },
  // ── Baby care ──
  { phrases: ['baby care'], target: { vertical: 'baby-care' } },
  { phrases: ['potty', 'potty seat', 'potty chair', 'potty training'], target: { categories: ['potty-seats-chairs'] } },
  { phrases: ['baby proofing', 'babyproofing', 'childproofing', 'child proofing'], target: { categories: ['baby-proofing', 'childproofing'] } },
  { phrases: ['diaper', 'diapers', 'nappy', 'nappies'], target: { vertical: 'baby-care', productType: 'diapers' } },
  { phrases: ['changing mat', 'diapering'], target: { categories: ['diapering'] } },
  { phrases: ['bath', 'bathing', 'shampoo', 'skincare', 'baby wash'], target: { categories: ['bathing-skincare'] } },
  { phrases: ['soap'], target: { vertical: 'baby-care', productType: 'baby-soap' } },
  { phrases: ['lotion'], target: { vertical: 'baby-care', productType: 'baby-lotion' } },
  { phrases: ['bath tub', 'bathtub'], target: { vertical: 'baby-care', productType: 'baby-bath-tubs' } },
  { phrases: ['thermometer'], target: { vertical: 'baby-care', productType: 'thermometers' } },
  { phrases: ['nasal aspirator'], target: { vertical: 'baby-care', productType: 'nasal-aspirators' } },
  { phrases: ['healthcare'], target: { categories: ['healthcare'] } },
  { phrases: ['wipes'], target: { vertical: 'baby-care', productType: 'baby-wipes' } },
  { phrases: ['towel', 'bath towel'], target: { vertical: 'baby-care', productType: 'bath-towels' } },
  { phrases: ['bib', 'bibs'], target: { categories: ['towels-bibs', 'feeding-bibs'] } },
  { phrases: ['teether', 'teething toy'], target: { vertical: 'baby-care', productType: 'teething-toys' } },
  { phrases: ['mosquito repellent', 'mosquito'], target: { vertical: 'baby-care', productType: 'mosquito-repellents' } },
  { phrases: ['nail clipper'], target: { vertical: 'baby-care', productType: 'baby-nail-clippers' } },
  { phrases: ['grooming', 'comb'], target: { categories: ['baby-grooming'] } },
  // ── Feeding & nursing ──
  { phrases: ['feeding bottle', 'bottle', 'baby bottle'], target: { vertical: 'feeding-nursing', productType: 'feeding-bottles' } },
  { phrases: ['nipple', 'teat'], target: { vertical: 'feeding-nursing', productType: 'nipples' } },
  { phrases: ['pacifier', 'soother', 'dummy'], target: { vertical: 'feeding-nursing', productType: 'pacifiers' } },
  { phrases: ['sipper', 'sippy', 'sippy cup'], target: { vertical: 'feeding-nursing', productType: 'sippy-cups' } },
  { phrases: ['kids mug', 'mug'], target: { vertical: 'feeding-nursing', productType: 'kids-mugs' } },
  { phrases: ['feeding set'], target: { vertical: 'feeding-nursing', productType: 'feeding-sets' } },
  { phrases: ['plate', 'bowl'], target: { vertical: 'feeding-nursing', productType: 'plates-bowls' } },
  { phrases: ['spoon', 'fork'], target: { vertical: 'feeding-nursing', productType: 'spoons-forks' } },
  { phrases: ['silicone bib'], target: { vertical: 'feeding-nursing', productType: 'silicone-bibs' } },
  { phrases: ['breast pump'], target: { vertical: 'feeding-nursing', productType: 'breast-pumps' } },
  { phrases: ['nursing pillow', 'feeding pillow'], target: { vertical: 'feeding-nursing', productType: 'nursing-pillows' } },
  { phrases: ['nursing pad'], target: { vertical: 'feeding-nursing', productType: 'nursing-pads' } },
  { phrases: ['breastfeeding'], target: { categories: ['nursing-accessories'] } },
  { phrases: ['sterilizer', 'steriliser'], target: { vertical: 'feeding-nursing', productType: 'bottle-sterilizers' } },
  { phrases: ['bottle warmer'], target: { vertical: 'feeding-nursing', productType: 'bottle-warmers' } },
  // ── Nursery furniture ──
  { phrases: ['crib', 'cradle', 'cot', 'bassinet'], target: { vertical: 'nursery-furniture', productType: 'cradles' } },
  { phrases: ['bed', 'mattress', 'blanket', 'pillow'], target: { categories: ['beds-bedding'] } },
  { phrases: ['bedding', 'bedding set'], target: { vertical: 'nursery-furniture', productType: 'bedding-sets' } },
  { phrases: ['play mat', 'playmat'], target: { vertical: 'nursery-furniture', productType: 'play-mats' } },
  { phrases: ['step stool'], target: { vertical: 'nursery-furniture', productType: 'step-stools' } },
  { phrases: ['study table', 'kids table', 'kids chair', 'table and chair', 'desk'], target: { categories: ['study-tables'] } },
  { phrases: ['toy storage', 'toy box', 'storage box'], target: { categories: ['toy-storage'] } },
  // ── Travel gear ──
  { phrases: ['stroller', 'pram', 'buggy', 'pushchair'], target: { vertical: 'travel-gear', productType: 'strollers' } },
  { phrases: ['baby carrier', 'carrier', 'sling', 'baby sling'], target: { vertical: 'travel-gear', productType: 'baby-carriers' } },
  // ── School supplies ──
  { phrases: ['school supplies'], target: { vertical: 'school-supplies' } },
  { phrases: ['school bag', 'schoolbag', 'backpack'], target: { vertical: 'school-supplies', productType: 'school-backpacks' } },
  { phrases: ['trolley bag'], target: { vertical: 'school-supplies', productType: 'trolley-bags' } },
  { phrases: ['lunch box', 'lunchbox', 'tiffin'], target: { vertical: 'school-supplies', productType: 'lunch-boxes' } },
  { phrases: ['lunch bag'], target: { vertical: 'school-supplies', productType: 'lunch-bags' } },
  { phrases: ['water bottle'], target: { vertical: 'school-supplies', productType: 'water-bottles' } },
  { phrases: ['stationery'], target: { categories: ['stationery'] } },
  { phrases: ['pencil'], target: { vertical: 'school-supplies', productType: 'pencils' } },
  { phrases: ['pen'], target: { vertical: 'school-supplies', productType: 'pens' } },
  { phrases: ['eraser'], target: { vertical: 'school-supplies', productType: 'erasers' } },
  { phrases: ['sharpener'], target: { vertical: 'school-supplies', productType: 'sharpeners' } },
  { phrases: ['notebook'], target: { vertical: 'school-supplies', productType: 'notebooks' } },
  { phrases: ['diary'], target: { vertical: 'school-supplies', productType: 'kids-diaries' } },
  { phrases: ['pencil case', 'pencil pouch'], target: { vertical: 'school-supplies', productType: 'pencil-cases' } },
  { phrases: ['pencil box'], target: { vertical: 'school-supplies', productType: 'pencil-boxes' } },
  { phrases: ['geometry box', 'geometry set', 'compass box'], target: { vertical: 'school-supplies', productType: 'geometry-boxes' } },
  // ── Party & gifting ──
  { phrases: ['party decoration', 'party decorations', 'birthday decoration', 'party theme', 'balloons'], target: { categories: ['party-themes'] } },
  { phrases: ['gift hamper', 'hamper', 'gift box', 'gift basket'], target: { vertical: 'party-gifting', productType: 'gift-baskets' } },
  { phrases: ['return gift', 'return gifts', 'party favor', 'party favors', 'party favour', 'party favours'], target: { vertical: 'party-gifting', productType: 'return-gifts' } },
  // ── Health & safety ──
  { phrases: ['safety gate', 'baby gate'], target: { categories: ['safety-gates'] } },
  { phrases: ['playpen'], target: { vertical: 'health-safety', productType: 'playpens' } },
  { phrases: ['corner guard'], target: { vertical: 'health-safety', productType: 'corner-guards' } },
  { phrases: ['cabinet lock', 'drawer lock'], target: { vertical: 'health-safety', productType: 'cabinet-locks' } },
  { phrases: ['door stopper'], target: { vertical: 'health-safety', productType: 'door-stoppers' } },
  { phrases: ['outlet cover', 'socket cover', 'plug cover'], target: { vertical: 'health-safety', productType: 'outlet-covers' } },
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
