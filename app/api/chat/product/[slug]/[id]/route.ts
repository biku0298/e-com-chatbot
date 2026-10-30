import { createBkProductDetail } from '@/lib/search/bkProductDetail';
import { CatalogUnavailableError } from '@/lib/catalog/errors';

const productDetail = createBkProductDetail();

/** One product's details for the in-chat popup (never sends the shopper to the store). */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  try {
    const product = await productDetail(slug, id);
    if (!product) return Response.json({ error: 'This product is no longer available.' }, { status: 404 });
    return Response.json(product);
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) console.error('Product detail error:', error);
    return Response.json({ error: "Couldn't load this product right now — please try again in a moment." }, { status: 503 });
  }
}
