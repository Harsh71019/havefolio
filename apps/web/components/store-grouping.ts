import type { ItemListEntry, TaxonomySnapshot } from '@havefolio/contracts';

export interface StoreSubgroup {
  key: string;
  title: string | null;
  items: ItemListEntry[];
}
export interface StoreGroup {
  key: string;
  title: string;
  retired: boolean;
  /** Owner-wide count from taxonomy, when known; may exceed loaded items while paging. */
  total: number | null;
  loaded: number;
  subgroups: StoreSubgroup[];
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byName = (a: ItemListEntry, b: ItemListEntry): number =>
  collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byPosition = (
  a: { position: number; name: string; id: string },
  b: { position: number; name: string; id: string },
): number => a.position - b.position || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);

export const uncategorisedKey = 'uncategorised';

/**
 * Deterministic grouping: categories and subcategories in taxonomy order, items by name then id.
 * Items without a category, or whose category is not in the snapshot, stay visible in a
 * neutral final group instead of being hidden.
 */
export function groupInventory(
  items: ItemListEntry[],
  taxonomy: TaxonomySnapshot | undefined,
): { groups: StoreGroup[]; emptyCategories: string[] } {
  const categories = [...(taxonomy?.categories ?? [])].sort(byPosition);
  const subcategories = [...(taxonomy?.subcategories ?? [])].sort(byPosition);
  const known = new Set(categories.map((c) => c.id));
  const groups: StoreGroup[] = [];
  for (const category of categories) {
    const members = items.filter((i) => i.categoryId === category.id);
    if (!members.length) continue;
    const children = subcategories.filter((s) => s.categoryId === category.id);
    const childIds = new Set(children.map((s) => s.id));
    const subgroups: StoreSubgroup[] = [];
    const general = members.filter((i) => !i.subcategoryId || !childIds.has(i.subcategoryId));
    if (general.length)
      subgroups.push({
        key: `${category.id}:none`,
        title: general.length === members.length ? null : 'No subcategory',
        items: general.sort(byName),
      });
    for (const child of children) {
      const inChild = members.filter((i) => i.subcategoryId === child.id);
      if (inChild.length)
        subgroups.push({
          key: child.id,
          title: child.retiredAt ? `${child.name} (retired)` : child.name,
          items: inChild.sort(byName),
        });
    }
    groups.push({
      key: category.id,
      title: category.name,
      retired: Boolean(category.retiredAt),
      total: category.itemCount,
      loaded: members.length,
      subgroups,
    });
  }
  const rest = items.filter((i) => !i.categoryId || !known.has(i.categoryId)).sort(byName);
  if (rest.length)
    groups.push({
      key: uncategorisedKey,
      title: taxonomy ? 'Not yet categorised' : 'All items',
      retired: false,
      total: null,
      loaded: rest.length,
      subgroups: [{ key: `${uncategorisedKey}:none`, title: null, items: rest }],
    });
  const emptyCategories = categories
    .filter((c) => !c.retiredAt && c.itemCount === 0)
    .map((c) => c.name);
  return { groups, emptyCategories };
}
