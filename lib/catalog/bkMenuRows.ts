import { byDisplayOrder as byOrder, type BkTaxonomy } from './bkTaxonomy';

/**
 * Conversion between the in-memory hierarchy and the database rows (Vertical, Category,
 * ProductType). Pure, so the mapping is tested without a database.
 */
export type VerticalRow = { id: string; slug: string; name: string; displayOrder: number };
export type CategoryRow = {
  id: string; slug: string; name: string; displayOrder: number; imageUrl: string | null; verticalId: string;
  productCount: number; inStockCount: number; inStockBoys: number; inStockGirls: number;
};
export type ProductTypeRow = {
  id: string; slug: string; name: string; displayOrder: number; categoryId: string;
  productCount: number; inStockCount: number; inStockBoys: number; inStockGirls: number;
};
export type MenuRows = { verticals: VerticalRow[]; categories: CategoryRow[]; productTypes: ProductTypeRow[] };

/** The hierarchy as flat rows, ready to write. */
export function toRows(taxonomy: BkTaxonomy): MenuRows {
  const rows: MenuRows = { verticals: [], categories: [], productTypes: [] };
  for (const vertical of taxonomy.verticals) {
    rows.verticals.push({ id: vertical.id, slug: vertical.slug, name: vertical.name, displayOrder: vertical.displayOrder });
    for (const category of vertical.categories) {
      const { productTypes, ...fields } = category;
      rows.categories.push({ ...fields, verticalId: vertical.id });
      for (const type of productTypes) rows.productTypes.push({ ...type, categoryId: category.id });
    }
  }
  return rows;
}

/** Rows read back from the database (vertical → categories → product types), in display order. */
export type VerticalTree = VerticalRow & {
  categories: (CategoryRow & { productTypes: ProductTypeRow[] })[];
};

/** Database rows → the in-memory hierarchy. */
export function fromRows(tree: VerticalTree[], syncedAt: Date | string | null): BkTaxonomy {
  return {
    source: 'database',
    syncedAt: syncedAt ? new Date(syncedAt).toISOString() : null,
    verticals: [...tree].sort(byOrder).map(vertical => ({
      id: vertical.id,
      slug: vertical.slug,
      name: vertical.name,
      displayOrder: vertical.displayOrder,
      categories: [...vertical.categories].sort(byOrder).map(category => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        displayOrder: category.displayOrder,
        imageUrl: category.imageUrl,
        productCount: category.productCount,
        inStockCount: category.inStockCount,
        inStockBoys: category.inStockBoys,
        inStockGirls: category.inStockGirls,
        productTypes: [...category.productTypes].sort(byOrder).map(type => ({
          id: type.id,
          slug: type.slug,
          name: type.name,
          displayOrder: type.displayOrder,
          productCount: type.productCount,
          inStockCount: type.inStockCount,
          inStockBoys: type.inStockBoys,
          inStockGirls: type.inStockGirls,
        })),
      })),
    })),
  };
}
