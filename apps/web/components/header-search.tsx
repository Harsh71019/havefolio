'use client';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SearchIcon, XIcon } from 'lucide-react';
import { normalizeInventorySearch } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { changeInventoryQuery, readInventoryQuery } from './inventory-query-state';
import { saveStoreLocation, storeHref, subscribeStoreLocation } from './store-location';

/**
 * One search for everything already owned. On My Store it narrows the current view in place,
 * keeping other filters; elsewhere it opens My Store with the search applied.
 */
export function HeaderSearch(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const onStore = pathname === '/store';
  const search = useSyncExternalStore(
    subscribeStoreLocation,
    () => window.location.search,
    () => '',
  );
  const current = onStore ? (readInventoryQuery(new URLSearchParams(search)).q ?? '') : '';
  const [shown, setShown] = useState(current);
  const [value, setValue] = useState(current);
  if (current !== shown) {
    setShown(current);
    setValue(current);
  }

  const apply = (q: string | undefined): void => {
    if (onStore) {
      const query = readInventoryQuery(new URLSearchParams(window.location.search));
      saveStoreLocation(changeInventoryQuery(query, { q }));
    } else {
      router.push(storeHref(q ? { q } : {}));
    }
  };

  return (
    <form
      role="search"
      aria-label="Your items"
      className="relative w-full max-w-xl min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        apply(normalizeInventorySearch(value).slice(0, 200) || undefined);
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        name="q"
        aria-label="Search what you own"
        placeholder="Search what you own"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={200}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-11 rounded-lg bg-muted/60 pr-11 pl-9 text-sm shadow-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear search"
          onClick={() => {
            setValue('');
            if (current) apply(undefined);
          }}
          className="absolute top-0 right-0 size-11 rounded-lg text-muted-foreground hover:text-foreground"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </form>
  );
}
