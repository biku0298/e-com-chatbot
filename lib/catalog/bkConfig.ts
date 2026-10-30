import data from './bkCatalogData.json';
import { taxonomyCategory, taxonomyVertical } from './bkTaxonomy';

/**
 * All bachpankart catalog configuration lives here (never in engine.ts).
 * The hierarchy (verticals, categories, product types and their names) comes from the store's
 * /menu, kept in our database (see bkTaxonomy / bkMenuSync). What lives here is Ray's own
 * tuning: tiers, which departments ask boy/girl, the word map and colour/material words.
 * Colour, brand, material and age data come from the API's facets via bkCatalogData.json.
 */

export type BkTier = 1 | 2;
/** Funnel dimensions, in the vocabulary of Ray's shopping state. `type` is the API's productType. */
export type BkDimension = 'vertical' | 'category' | 'type' | 'color' | 'occasion' | 'fit' | 'sleeveLength' | 'pattern' | 'material' | 'brand';

/**
 * A department as Ray uses it: the store's name (`label`) plus Ray's tuning.
 * `noun` is how Ray names it in a sentence ("I couldn't find clothes for boys…").
 */
export type BkVertical = { slug: string; label: string; noun: string; tier: BkTier; askGender: boolean; emoji: string };
export type BkCategory = { vertical: string; slug: string; label: string; inStockCount: number };

/** Products per API page (the API rejects limit=100; 24 is honored). */
export const BK_PAGE_LIMIT = 24;
/** Fixed sort so paging never skips or repeats products (the default order is shuffled). */
export const BK_SORT = 'newest';
/** Store website, for product links. */
export const BK_SITE = (process.env.BK_SITE_URL || 'https://bachpankart.com').replace(/\/$/, '');

/**
 * Ray's tuning per department. `askGender: true` asks "boy or girl?" before searching (Tier 1
 * always asks). Departments the store adds later work on Tier 2 defaults without an entry here.
 */
const VERTICAL_TUNING: Record<string, { noun: string; tier: BkTier; askGender?: boolean; emoji?: string }> = {
  clothing: { noun: 'clothes', tier: 1, emoji: '👕' },
  'kids-fashion': { noun: 'fashion accessories', tier: 2, askGender: true, emoji: '🎀' },
  footwear: { noun: 'footwear', tier: 2, emoji: '👟' },
  toys: { noun: 'toys', tier: 2, emoji: '🧸' },
  books: { noun: 'books', tier: 2, emoji: '📚' },
  'baby-care': { noun: 'baby care products', tier: 2, emoji: '🍼' },
  'feeding-nursing': { noun: 'feeding products', tier: 2, emoji: '🥣' },
  'nursery-furniture': { noun: 'nursery furniture', tier: 2, emoji: '🛏️' },
  'travel-gear': { noun: 'travel gear', tier: 2, emoji: '🚼' },
  'school-supplies': { noun: 'school supplies', tier: 2, emoji: '🎒' },
  'party-gifting': { noun: 'party and gifting items', tier: 2, emoji: '🎁' },
  'health-safety': { noun: 'safety products', tier: 2, emoji: '🛡️' },
};

/** Tier rules: which fields must be known before searching, and the funnel order for chips. */
export const BK_TIERS: Record<BkTier, { requiresGender: boolean; funnel: BkDimension[] }> = {
  1: { requiresGender: true, funnel: ['category', 'type', 'color', 'occasion', 'fit', 'sleeveLength', 'pattern', 'material', 'brand'] },
  // Tier 2 asks gender only where configured and age only where products carry it.
  2: { requiresGender: false, funnel: ['category', 'type', 'brand', 'color'] },
};
/** Ask for / filter by age only where at least this share of products carries an age (the API drops the rest). */
const AGE_COVERAGE_SHARE = 0.8;

/** Chips: at most this many vertical chips, and no narrowing chips for this many matches or fewer. */
export const BK_MAX_VERTICAL_CHIPS = 6;
/** Question chips: at most this many departments or categories to choose from. */
export const BK_MAX_QUESTION_CHIPS = 8;
export const BK_SMALL_SET = 8;

type VerticalData = {
  label: string; totalCount: number; genders: Record<string, number>; ageCoverage: number;
  colors: { slug: string; name: string; family: string | null }[];
  materials: { slug: string; name: string }[]; brands: { slug: string; name: string }[];
};
export const BK_DATA = data as unknown as {
  verticals: Record<string, VerticalData>;
  categories: Record<string, { attributes: Record<string, string[]> }>;
};

/** A department by slug: the store's name from the hierarchy, merged with Ray's tuning. */
export function bkVertical(slug: string | null | undefined): BkVertical | undefined {
  const vertical = taxonomyVertical(slug);
  if (!vertical) return undefined;
  const tuning = VERTICAL_TUNING[vertical.slug];
  return {
    slug: vertical.slug,
    label: vertical.name,
    noun: tuning?.noun ?? vertical.name.toLowerCase(),
    tier: tuning?.tier ?? 2,
    askGender: tuning?.askGender ?? false,
    emoji: tuning?.emoji ?? '',
  };
}

/** A category by slug (slugs are unique across the store). */
export function bkCategory(slug: string | null | undefined): BkCategory | undefined {
  const category = taxonomyCategory(slug);
  return category ? { vertical: category.vertical, slug: category.slug, label: category.name, inStockCount: category.inStockCount } : undefined;
}

/** A vertical with no tuning still works on Tier 2 defaults. */
export const bkTier = (vertical: string | null | undefined): BkTier => bkVertical(vertical)?.tier ?? 2;

/** Whether a known gender filters results here (BOYS/GIRLS + UNISEX): the department has boys' or girls' stock. */
export function verticalFiltersGender(vertical: string): boolean {
  if (BK_TIERS[bkTier(vertical)].requiresGender) return true;
  return (taxonomyVertical(vertical)?.categories ?? []).some(category => category.inStockBoys > 0 || category.inStockGirls > 0);
}

/** Whether Ray asks "boy or girl?" before searching here. */
export function verticalAsksGender(vertical: string): boolean {
  return BK_TIERS[bkTier(vertical)].requiresGender || (bkVertical(vertical)?.askGender ?? false);
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
