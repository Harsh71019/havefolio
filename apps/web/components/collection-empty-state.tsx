import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Card, CardContent } from '@havefolio/ui/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';

export function CollectionEmptyState({
  description,
  icon: Icon,
  title,
}: Readonly<{
  description: string;
  icon: LucideIcon;
  title: string;
}>): ReactElement {
  return (
    <Card className="border-dashed py-0">
      <CardContent className="p-0">
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardContent>
    </Card>
  );
}
