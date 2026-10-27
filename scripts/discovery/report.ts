import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CLOTHING_CATEGORIES, VERTICALS, loadFixture, loadIndex } from './requests';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw, unvalidated API JSON */

const REPORT_PATH = 'docs/discovery-report.md';
const START = '<!-- generated:start -->';
const END = '<!-- generated:end -->';
/** Months above this are treated as data errors (18 years). */
const MAX_PLAUSIBLE_AGE_MONTHS = 216;

type Group = any;
const groupsOf = (name: string): Group[] => (loadFixture(name) as any)?.groups ?? [];
const facetsOf = (name: string): any => (loadFixture(name) as any)?.availableFilters;
const totalOf = (name: string): number | undefined => (loadFixture(name) as any)?.pagination?.totalCount;
const list = (items: any[] | undefined, key = 'slug') => (items ?? []).map(item => `\`${item[key]}\``).join(', ') || '—';
const counted = (items: any[] | undefined, key = 'slug') => (items ?? []).map(item => `${item[key]} (${item.count})`).join(', ') || '—';

function allGroups(): Group[] {
  return loadIndex().filter(entry => entry.ok).flatMap(entry => groupsOf(entry.name));
}

function qualityRow(label: string, groups: Group[]): string {
  const ids = new Set(groups.map(g => g.id));
  const count = (test: (g: Group) => boolean) => groups.filter(test).length;
  return `| ${label} | ${groups.length} (${ids.size} ids) | ${count(g => !g.color)} | ${count(g => g.ageMonthsMin == null || g.ageMonthsMax == null)} | ${count(g => g.ageMonthsMax > MAX_PLAUSIBLE_AGE_MONTHS || (g.ageMonthsMin != null && g.ageMonthsMin < 12 && /^([2-9]|1\d)-\d+y$/.test(g.sizes?.[0]?.label ?? '')))} | ${count(g => !g.material)} | ${count(g => !g.totalStock)} | ${count(g => g.minPrice !== g.maxPrice)} | ${count(g => g.discountPercent > 0)} |`;
}

function ageClass(g: Group, min: number, max: number): string {
  if (g.ageMonthsMin == null || g.ageMonthsMax == null) return 'no age';
  if (g.ageMonthsMin >= min && g.ageMonthsMax <= max) return 'fully inside';
  if (g.ageMonthsMin <= min && g.ageMonthsMax >= max) return 'covers';
  if (g.ageMonthsMax >= min && g.ageMonthsMin <= max) return 'overlaps';
  return 'outside';
}

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, n]) => `${value}: ${n}`).join(', ') || '—';
}

function generated(requestsMade: number): string {
  const index = loadIndex();
  const out: string[] = [];
  out.push(`_Generated from the ${index.length} saved responses in \`fixtures/bk/\` (rebuild with \`npm run discover:bk -- --offline\`, zero requests). Requests made by this run: ${requestsMade}._`, '');

  // ── Counts ──
  out.push('## Catalog size', '', '### Verticals', '');
  out.push('| Vertical | Site label | `totalCount` | Genders (facets) | Has `ageRange` |', '|---|---|---|---|---|');
  let sum = 0;
  for (const slug of VERTICALS) {
    const total = totalOf(`vertical-${slug}`) ?? 0;
    sum += total;
    const facets = facetsOf(`facets-vertical-${slug}`);
    const label = groupsOf(`vertical-${slug}`)[0]?.vertical?.name ?? '?';
    out.push(`| \`${slug}\` | ${label} | ${total} | ${counted(facets?.genders, 'value')} | ${facets?.ageRange ? `yes (${facets.ageRange.min}–${facets.ageRange.max} mo)` : 'no'} |`);
  }
  out.push(`| **All** | | **${sum}** | | |`, '');
  out.push('### Clothing categories', '');
  out.push('| Category | `totalCount` | Genders (facets) | Product types | Attributes (values) |', '|---|---|---|---|---|');
  for (const slug of CLOTHING_CATEGORIES) {
    const facets = facetsOf(slug === 'topwear' ? 'verify-facets-topwear' : `facets-clothing-${slug}`);
    const attributes = (facets?.attributes ?? []).map((a: any) => `**${a.slug}**: ${a.values.map((v: any) => `${v.value} (${v.count})`).join(', ')}`).join('<br>') || '—';
    out.push(`| \`${slug}\` | ${totalOf(`clothing-${slug}`) ?? '?'} | ${counted(facets?.genders, 'value')} | ${counted(facets?.productTypes)} | ${attributes} |`);
  }
  out.push('');

  // ── Slugs per vertical ──
  out.push('## Filter slugs per vertical (from the facets endpoint)', '');
  out.push('The products endpoint returns empty `availableFilters`, so these come from `products/facets?verticalSlug=…`.', '');
  for (const slug of VERTICALS) {
    const f = facetsOf(`facets-vertical-${slug}`);
    if (!f) continue;
    out.push(`<details><summary><code>${slug}</code>: ${f.productTypes.length} product types, ${f.colors.length} colours, ${f.brands.length} brands, ${f.materials.length} materials</summary>`, '');
    out.push(`- **genders**: ${counted(f.genders, 'value')}`);
    out.push(`- **ageRange**: ${f.ageRange ? `${f.ageRange.min}–${f.ageRange.max} months` : 'none'}; buckets: ${(f.ageBuckets ?? []).map((b: any) => `${b.slug} (${b.count})`).join(', ') || '—'}`);
    out.push(`- **productTypes**: ${list(f.productTypes)}`);
    out.push(`- **colorFamilies**: ${list(f.colorFamilies)}`);
    out.push(`- **colors**: ${(f.colors ?? []).map((c: any) => `\`${c.slug}\` (${c.familySlug ?? '?'})`).join(', ') || '—'}`);
    out.push(`- **materials**: ${list(f.materials)}`);
    out.push(`- **brands**: ${list(f.brands)}`);
    out.push(`- **attributes**: ${(f.attributes ?? []).map((a: any) => `${a.slug} → ${a.values.map((v: any) => v.value).join(' / ')}`).join('; ') || '—'}`);
    out.push('', '</details>', '');
  }

  // ── Product objects ──
  const groups = allGroups();
  const keys = new Map<string, number>();
  for (const g of groups) for (const key of Object.keys(g)) keys.set(key, (keys.get(key) ?? 0) + 1);
  const themeAxes = new Map<string, Set<string>>();
  for (const g of groups) for (const [key, value] of Object.entries(g.themeAxes ?? {})) {
    if (!themeAxes.has(key)) themeAxes.set(key, new Set());
    if (value) themeAxes.get(key)!.add(String(value));
  }
  const variantsPerProduct = new Map<string, Set<string>>();
  for (const g of groups) variantsPerProduct.set(g.productId, (variantsPerProduct.get(g.productId) ?? new Set()).add(g.id));
  const sharedSlugs = new Map<string, Set<string>>();
  for (const g of groups) sharedSlugs.set(g.slug, (sharedSlugs.get(g.slug) ?? new Set()).add(g.id));
  const duplicates = [...sharedSlugs].filter(([, ids]) => ids.size > 1).map(([slug]) => `\`${slug}\``);

  out.push('## Product objects', '');
  out.push(`- **Keys** (all ${groups.length} sampled cards): ${[...keys].map(([key, n]) => `\`${key}\`${n === groups.length ? '' : ` (${n})`}`).join(', ')}`);
  out.push(`- **\`themeAxes\`** keys seen: ${[...themeAxes].map(([key, values]) => `\`${key}\` (${[...values].slice(0, 5).join(', ') || 'empty'})`).join(', ') || '—'}`);
  out.push(`- **Variants**: ${[...variantsPerProduct.values()].filter(ids => ids.size > 1).length} of ${variantsPerProduct.size} \`productId\`s appear as more than one card (one card per colour variant).`);
  out.push(`- **Slugs shared by different ids**: ${duplicates.join(', ') || 'none'}`, '');
  out.push('### Data quality in the samples', '');
  out.push('| Sample | Cards | No colour | No age | Implausible age | No material | Out of stock | Price range | Discounted |', '|---|---|---|---|---|---|---|---|---|');
  for (const slug of VERTICALS) out.push(qualityRow(`\`${slug}\``, groupsOf(`vertical-${slug}`)));
  for (const slug of CLOTHING_CATEGORIES) out.push(qualityRow(`clothing / \`${slug}\``, groupsOf(`clothing-${slug}`)));
  out.push(qualityRow('**All fixtures**', groups), '');
  out.push('<details><summary>One raw product (clothing / topwear)</summary>', '', '```json', JSON.stringify(groupsOf('clothing-topwear')[0], null, 2), '```', '', '</details>', '');

  // ── Verification evidence ──
  out.push('## Verification evidence', '');
  const fallback = loadFixture('verify-fallback-toys') as any;
  out.push(`- **Fallback (full toys filter URL)**: \`totalCount\` ${fallback?.pagination?.totalCount}, ${fallback?.groups?.length ?? '?'} groups, top-level keys: ${Object.keys(fallback ?? {}).map(k => `\`${k}\``).join(', ')}.`);
  const age = groupsOf('verify-age-topwear-24-48');
  out.push(`- **Age 24–48 months (topwear)**: \`totalCount\` ${totalOf('verify-age-topwear-24-48')} of ${totalOf('clothing-topwear')}; page 1: ${tally(age.map(g => ageClass(g, 24, 48)))}. Ranges: ${age.map(g => `${g.ageMonthsMin}–${g.ageMonthsMax}`).join(', ')}.`);
  const travel = groupsOf('verify-age-travel-12');
  out.push(`- **Age filter on cards without age** (travel-gear, 12 months): \`totalCount\` ${totalOf('verify-age-travel-12')} of ${totalOf('vertical-travel-gear')}; returned ranges: ${tally(travel.map(g => `${g.ageMonthsMin}–${g.ageMonthsMax}`))}. Cards with no age in the vertical sample: ${groupsOf('vertical-travel-gear').filter(g => g.ageMonthsMin == null).length} of ${groupsOf('vertical-travel-gear').length}.`);
  const limitEntries =index.filter(entry => entry.name.startsWith('verify-limit'));
  out.push(`- **limit**: 24 → ${groupsOf('clothing-topwear').length} groups (\`pagination.limit\` ${(loadFixture('clothing-topwear') as any)?.pagination?.limit}); ${limitEntries.map(entry => `${entry.name.replace('verify-limit-', '')} → ${entry.ok ? `${groupsOf(entry.name).length} groups` : `HTTP ${entry.status}`}`).join('; ')}.`);
  const all = facetsOf('verify-facets-topwear');
  const girls = facetsOf('verify-facets-topwear-girls');
  const products = facetsOf('clothing-topwear');
  out.push(`- **\`availableFilters\` on the products endpoint**: ${Object.entries(products ?? {}).map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.length}]` : String(v)}`).join(', ')}.`);
  const facetRow = (f: any) => `colours ${f?.colors?.length}, brands ${f?.brands?.length}, product types ${counted(f?.productTypes)}, price ${f?.priceRange?.min}–${f?.priceRange?.max}, attributes ${(f?.attributes ?? []).map((a: any) => `${a.slug}(${a.values.length})`).join(' ')}, genders ${counted(f?.genders, 'value')}`;
  out.push(`- **Facets narrow?** topwear: ${facetRow(all)}. Topwear + \`genders=GIRLS\`: ${facetRow(girls)}.`);
  const frock = loadFixture('verify-q-frock') as any;
  const frockGirls = loadFixture('verify-q-frock-girls') as any;
  out.push(`- **Search**: \`q=frock\` → ${frock?.pagination?.totalCount} (categories: ${tally(frock?.groups?.map((g: any) => g.category.slug) ?? [])}; genders: ${tally(frock?.groups?.map((g: any) => g.gender) ?? [])}), \`search\` = \`${JSON.stringify(frock?.search)}\`. With \`genders=GIRLS\` → ${frockGirls?.pagination?.totalCount}. With \`categorySlug=topwear\` → ${totalOf('verify-q-frock-topwear')}.`);
  const laptop = loadFixture('verify-q-laptop') as any;
  out.push(`- **Search for something not sold** (\`q=laptop\`) → ${laptop?.pagination?.totalCount}: ${(laptop?.groups ?? []).slice(0, 5).map((g: any) => `${g.name} [${g.category.slug}]`).join('; ')}.`);
  const facetsFixture = loadFixture('verify-facets-topwear') as any;
  out.push(`- **Facets endpoint**: top-level keys ${Object.keys(facetsFixture ?? {}).map(k => `\`${k}\``).join(', ')}; \`appliedFilters\` \`${JSON.stringify(facetsFixture?.appliedFilters)}\`.`, '');

  out.push('## Requests', '', '| Fixture | Status | URL |', '|---|---|---|');
  for (const entry of index) out.push(`| ${entry.name} | ${entry.ok ? entry.status : `${entry.status ?? ''} ${entry.reason}`} | \`${entry.url.replace('https://api.bachpankart.com/api/consumer/', '')}\` |`);
  return out.join('\n');
}

export function writeDiscoveryReport(requestsMade: number): void {
  const body = `${START}\n${generated(requestsMade)}\n${END}`;
  const existing = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, 'utf8') : '';
  const report = existing.includes(START) && existing.includes(END)
    ? existing.slice(0, existing.indexOf(START)) + body + existing.slice(existing.indexOf(END) + END.length)
    : `# Bachpankart API discovery report\n\n_This section is written by hand; everything between the generated markers is rebuilt from fixtures._\n\n${body}\n`;
  writeFileSync(REPORT_PATH, report);
  console.log(`Wrote ${REPORT_PATH}.`);
}
