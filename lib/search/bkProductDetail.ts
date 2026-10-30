import type { ProductDetail } from '../chat/types';
import { getBkClient, isBkFailure, type BkClient } from '../bk/client';
import { CatalogUnavailableError } from '../catalog/errors';

/** Shapes accepted for the URL parts (the slug may end in dashes, e.g. "...-yelllow----"). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;
const ID = /^[a-z0-9]{8,40}$/;
export const isProductRef = (slug: string, id: string) => SLUG.test(slug) && ID.test(id);

const COUNTRIES: Record<string, string> = { IN: 'India', CN: 'China', US: 'USA', GB: 'UK' };
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const byOrder = (a: any, b: any) => (a?.displayOrder ?? 0) - (b?.displayOrder ?? 0);

/** "A **bold** start.\\\n\\\nNext paragraph" → ["A **bold** start.", "Next paragraph"]; each "- " line stays its own entry. */
export function descriptionParagraphs(raw: unknown): string[] {
  return text(raw)
    .replace(/\\\r?\n/g, '\n')
    .replace(/\\n/g, '\n')
    .split(/\n\s*\n/)
    .flatMap(paragraph => paragraph.split(/\n(?=\s*[-•]\s)/))
    .map(paragraph => paragraph.replace(/\s*\n\s*/g, ' ').replace(/\\+$/, '').trim())
    .filter(Boolean);
}

/** The /products/by-group response → what the popup shows. */
export function toProductDetail(data: any): ProductDetail {
  const product = data?.product ?? {};
  const group = data?.currentGroup ?? {};
  const variants: any[] = (Array.isArray(group.variants) ? group.variants : []).filter((variant: any) => variant?.status !== 'INACTIVE');
  const available = (variant: any) => (variant?.stock ?? 0) > 0;
  const priced = variants.filter(variant => typeof variant?.price === 'number');
  const pool = priced.some(available) ? priced.filter(available) : priced;
  const cheapest = pool.reduce<any>((best, variant) => (!best || variant.price < best.price ? variant : best), null);
  const price = cheapest?.price ?? group.minPrice ?? 0;
  const mrp = typeof cheapest?.mrp === 'number' && cheapest.mrp > price ? cheapest.mrp : null;

  // A single "Free Size" (or size-less) variant is not a real choice of sizes.
  const sized = [...variants].sort((a, b) => byOrder(a?.size, b?.size)).filter(variant => text(variant?.size?.value));
  const sizes = sized.length > 1 || (sized.length === 1 && !/^free\s*size$/i.test(text(sized[0].size.value)))
    ? sized.map(variant => ({
      label: text(variant.size.value),
      price: variant.price ?? price,
      mrp: typeof variant.mrp === 'number' && variant.mrp > (variant.price ?? price) ? variant.mrp : null,
      inStock: available(variant),
    }))
    : [];

  const siblings: any[] = Array.isArray(data?.siblingGroups) ? data.siblingGroups : [];
  const colour = (entry: any, current: boolean) => ({
    id: text(entry?.id),
    slug: text(entry?.slug),
    name: text(entry?.color?.name) || 'This colour',
    hex: text(entry?.color?.hex) || null,
    current,
  });
  // Alphabetical, so the swatches keep their places when the shopper switches colour.
  const colours = siblings.length
    ? [colour(group, true), ...siblings.filter(sibling => (sibling?.totalStock ?? 1) > 0 && sibling?.id && sibling?.slug).map(sibling => colour(sibling, false))]
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Facts: material, then the product type's attributes in their display order, then origin.
  const attributeNames = new Map<string, { name: string; order: number }>(
    (Array.isArray(data?.productType?.attributes) ? data.productType.attributes : []).map((attribute: any) => [attribute.slug, { name: text(attribute.name), order: attribute.displayOrder ?? 0 }]),
  );
  const attributes = Object.entries(product.attributes ?? {})
    .map(([slug, value]) => ({
      label: attributeNames.get(slug)?.name || slug.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()),
      value: Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : text(value),
      order: attributeNames.get(slug)?.order ?? 99,
    }))
    .filter(attribute => attribute.value)
    .sort((a, b) => a.order - b.order)
    .map(({ label, value }) => ({ label, value }));
  const details = [
    ...(text(data?.material?.name) ? [{ label: 'Material', value: text(data.material.name) }] : []),
    ...attributes,
    ...(text(product.countryOfOrigin) ? [{ label: 'Made in', value: COUNTRIES[text(product.countryOfOrigin)] ?? text(product.countryOfOrigin) }] : []),
  ];

  const images = (Array.isArray(group.images) ? [...group.images] : [])
    .sort((a, b) => Number(Boolean(b?.isMain)) - Number(Boolean(a?.isMain)) || byOrder(a, b))
    .filter(image => text(image?.url))
    .map(image => ({ url: text(image.url), thumbnailUrl: text(image.thumbnailUrl) || text(image.url), alt: text(image.alt) || text(product.name) }));

  return {
    id: text(group.id),
    slug: text(group.slug),
    name: text(product.name),
    brand: text(data?.brand?.name) || null,
    price,
    mrp,
    discountPercent: mrp ? Math.round(((mrp - price) / mrp) * 100) : 0,
    inStock: variants.some(available),
    images,
    sizes,
    colours,
    details,
    description: descriptionParagraphs(product.description),
    keyFeatures: (Array.isArray(product.keyFeatures) ? product.keyFeatures : []).map(text).filter(Boolean),
    careInstructions: text(product.careInstructions) || null,
    returns: product.isReturnable ? `Returnable within ${product.returnWindowDays ?? 7} days` : 'Not returnable',
  };
}

/**
 * One product's details for the popup, through the shared client (cached 10 minutes).
 * Returns null when the store has no such product; throws CatalogUnavailableError on API failure.
 */
export function createBkProductDetail(client: BkClient = getBkClient()) {
  return async function productDetail(slug: string, id: string): Promise<ProductDetail | null> {
    if (!isProductRef(slug, id)) return null;
    const result = await client.get(`products/by-group/${slug}/${id}`);
    if (isBkFailure(result)) {
      // The store rejects unknown or removed products with a 4xx; anything else is an outage.
      if (result.reason === 'http_4xx' && result.status !== 429) return null;
      throw new CatalogUnavailableError(result.reason);
    }
    const detail = toProductDetail(result.data);
    return detail.id && detail.name ? detail : null;
  };
}
