'use client';
import { useId, type ReactElement } from 'react';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { Label } from '@havefolio/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { Checkbox } from '@havefolio/ui/components/checkbox';

const NONE = '__none';
/** Retired assignments remain visible but cannot be selected for a new assignment. */
export function CategorySelector({
  taxonomy,
  categoryId,
  subcategoryId,
  onChange,
  disabled = false,
}: {
  taxonomy: TaxonomySnapshot;
  categoryId?: string | undefined;
  subcategoryId?: string | undefined;
  disabled?: boolean;
  onChange: (categoryId?: string, subcategoryId?: string) => void;
}): ReactElement {
  const id = useId();
  const category = taxonomy.categories.find((row) => row.id === categoryId);
  const subcategory = taxonomy.subcategories.find((row) => row.id === subcategoryId);
  const retiredCategory = Boolean(category?.retiredAt);
  const activeCategories = taxonomy.categories.filter((row) => !row.retiredAt);
  const activeSubcategories = taxonomy.subcategories.filter(
    (row) => row.categoryId === categoryId && !row.retiredAt && !retiredCategory,
  );
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-category`}>Category</Label>
        <Select
          value={categoryId ?? NONE}
          onValueChange={(value) => onChange(value === NONE ? undefined : value, undefined)}
          disabled={disabled}
        >
          <SelectTrigger
            id={`${id}-category`}
            className="min-h-11 w-full min-w-0 [&>span]:truncate"
          >
            <SelectValue placeholder="Uncategorised" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Uncategorised</SelectItem>
            {retiredCategory && category ? (
              <SelectItem value={category.id} disabled>
                {category.name} (retired)
              </SelectItem>
            ) : null}
            {activeCategories.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-subcategory`}>Subcategory (optional)</Label>
        <Select
          value={subcategoryId ?? NONE}
          onValueChange={(value) => onChange(categoryId, value === NONE ? undefined : value)}
          disabled={disabled || !categoryId || retiredCategory}
        >
          <SelectTrigger
            id={`${id}-subcategory`}
            className="min-h-11 w-full min-w-0 [&>span]:truncate"
          >
            <SelectValue placeholder="No subcategory" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No subcategory</SelectItem>
            {subcategory && (subcategory.retiredAt || retiredCategory) ? (
              <SelectItem value={subcategory.id} disabled>
                {subcategory.name} (retired)
              </SelectItem>
            ) : null}
            {activeSubcategories.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {subcategory && retiredCategory ? (
          <p className="text-sm text-muted-foreground">{subcategory.name} — parent retired</p>
        ) : null}
      </div>
    </div>
  );
}
export function TagSelector({
  taxonomy,
  selectedIds,
  onChange,
  disabled = false,
}: {
  taxonomy: Pick<TaxonomySnapshot, 'tags'>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}): ReactElement {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">Tags (optional)</legend>
      {taxonomy.tags.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {taxonomy.tags.map((tag) => (
            <label
              key={tag.id}
              htmlFor={`${id}-${tag.id}`}
              className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border px-3 py-2"
            >
              <Checkbox
                id={`${id}-${tag.id}`}
                checked={selectedIds.includes(tag.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...new Set([...selectedIds, tag.id])]
                      : selectedIds.filter((value) => value !== tag.id),
                  )
                }
              />
              <span className="min-w-0 break-words">{tag.name}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No tags yet. Create reusable tags in Settings.
        </p>
      )}
    </fieldset>
  );
}
