import Link from 'next/link';
import type { ItemResponse } from '@havefolio/contracts';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import {
  pricePaid,
  purchaseDateText,
  conditionLabels,
  frequencyLabels,
} from './item-detail-presentation';
import { statusLabel } from './item-presentation';
export function DemoItemDetails({
  item,
  returnTo,
}: {
  item: ItemResponse;
  returnTo: string;
}): React.JSX.Element {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-8">
      <Button asChild variant="outline" className="min-h-11">
        <Link href={returnTo}>Back to My Store</Link>
      </Button>
      <header className="space-y-3">
        <Badge>Demo · read-only example</Badge>
        <h1 className="text-3xl font-semibold break-words">{item.name}</h1>
        <p className="text-muted-foreground">
          A fictional household example. Amounts and dates are illustrative, excluded from your real
          spending. These details cannot be edited. Add your own item through manual entry.
        </p>
        <Button asChild className="min-h-11">
          <Link href="/items/new">Add my own item</Link>
        </Button>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Example details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ['Example amount', pricePaid(item).value],
                ['Example purchase date', purchaseDateText(item.purchaseDate).value],
                ['Example ownership', statusLabel(item.ownershipStatus)],
                ['Condition', conditionLabels[item.condition]],
                ['Use frequency', frequencyLabels[item.useFrequency]],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4">
            <ItemCover cover={null} emptyLabel="No demo photo" />
            <p className="text-sm text-muted-foreground">
              No photos, receipts or warranties are included in demo inventory.
            </p>
            <Link className="inline-flex min-h-11 items-center underline" href="/store">
              Manage or remove all demos in My Store
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
