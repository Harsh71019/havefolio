import { ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '#components/card';
import { Pill, PillIndicator } from '#components/kibo-ui/pill';
import { cn } from '#lib/utils';

export type OwnedItemCardProps = {
  ageLabel: string;
  category: string;
  className?: string;
  footer?: ReactNode;
  media?: ReactNode;
  name: string;
  priceLabel: string;
  status: string;
  statusTone?: 'success' | 'error' | 'warning' | 'info';
  useLabel: string;
};

export function OwnedItemCard({
  ageLabel,
  category,
  className,
  footer,
  media,
  name,
  priceLabel,
  status,
  statusTone = 'success',
  useLabel,
}: OwnedItemCardProps): ReactNode {
  return (
    <Card className={cn('overflow-hidden py-0', className)}>
      <div className="grid aspect-[4/3] place-items-center bg-muted text-muted-foreground">
        {media ?? (
          <div className="flex flex-col items-center gap-2 text-sm">
            <ImageIcon aria-hidden="true" className="size-7" />
            <span>No photo yet</span>
          </div>
        )}
      </div>
      <CardHeader className="gap-3 px-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">{category}</span>
          <Pill className="shrink-0" variant="outline">
            <PillIndicator variant={statusTone} />
            {status}
          </Pill>
        </div>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <ItemFact label="Paid" value={priceLabel} />
          <ItemFact label="Age" value={ageLabel} />
          <ItemFact label="Use" value={useLabel} />
        </dl>
      </CardContent>
      {footer ? <div className="border-t px-5 py-4">{footer}</div> : null}
    </Card>
  );
}

function ItemFact({ label, value }: Readonly<{ label: string; value: string }>): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-semibold">{value}</dd>
    </div>
  );
}
