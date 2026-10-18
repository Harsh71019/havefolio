import { Injectable } from '@nestjs/common';
import { homeLimits, type HomeRediscoveryItem, type HomeSummary } from '@havefolio/contracts';
import type { HomeSummaryDto } from './home.dto.js';
import { DesiresService } from '../desires/desires.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { InventoryQueryService } from '../items/inventory-query.service.js';
import { ItemsRepository } from '../items/items.repository.js';
import { SpendingService } from '../items/spending.service.js';

/** Conditions that make an owned item unsuitable to suggest; worn_out follows PER-55. */
export const rediscoveryExcludedConditions = ['broken', 'worn_out'] as const;
export const rediscoveryFrequencies = ['rarely', 'never'] as const;

interface RediscoveryRow {
  id: string;
  name: string;
  condition: HomeRediscoveryItem['condition'];
  use_frequency: HomeRediscoveryItem['useFrequency'];
  last_used_at: Date | null;
  eligible_count: number;
  photo_id: string | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
}

@Injectable()
export class HomeService {
  constructor(
    private readonly items: ItemsRepository,
    private readonly spending: SpendingService,
    private readonly inventory: InventoryQueryService,
    private readonly desires: DesiresService,
    private readonly goals: GoalsService,
  ) {}

  /** One bounded request: every section delegates to the owning domain's rules. */
  async summary(owner: string): Promise<HomeSummaryDto> {
    const [spending, recent, desires, goals, own] = await Promise.all([
      this.spending.report(owner, { scope: 'current-owned' }),
      this.inventory.list(owner, {
        sort: 'newest',
        ownershipStatus: 'owned',
        limit: homeLimits.recentItems,
      }),
      this.desires.activeSnapshot(owner, homeLimits.desires),
      this.goals.activeSnapshot(owner, homeLimits.goals),
      this.ownedAndRediscovery(owner),
    ]);
    return {
      inventory: own.inventory,
      spending,
      recentItems: recent.items,
      desires,
      goals: {
        activeCount: goals.activeCount,
        items: goals.items.map((g) => ({
          id: g.id,
          name: g.name,
          targetMinor: g.targetMinor,
          progressMinor: g.progressMinor,
          currency: g.currency,
          targetDate: g.targetDate,
        })),
      },
      rediscovery: own.rediscovery,
    };
  }

  private ownedAndRediscovery(
    owner: string,
  ): Promise<Pick<HomeSummary, 'inventory' | 'rediscovery'>> {
    return this.items.transaction(owner, async (c) => {
      const counts = await c.query<{ owned: number; sample: number }>(
        `SELECT count(*) FILTER (WHERE demo_dataset_id IS NULL)::int AS owned,
           count(*) FILTER (WHERE demo_dataset_id IS NOT NULL)::int AS sample
         FROM items WHERE owner_id=$1 AND ownership_status='owned'`,
        [owner],
      );
      // Owner-declared frequency plus explicit "used" events only; nothing is inferred.
      const pick = await c.query<RediscoveryRow>(
        `WITH eligible AS (
           SELECT i.id,i.name,i.condition,i.use_frequency,i.created_at,
             (SELECT max(e.occurred_at) FROM lifecycle_events e
               WHERE e.owner_id=i.owner_id AND e.item_id=i.id AND e.event_type='used') AS last_used_at
           FROM items i
           WHERE i.owner_id=$1 AND i.demo_dataset_id IS NULL AND i.ownership_status='owned'
             AND i.condition<>ALL($2::text[]) AND i.use_frequency=ANY($3::text[])
         ), chosen AS (
           SELECT e.*,count(*) OVER ()::int AS eligible_count FROM eligible e
           ORDER BY e.last_used_at ASC NULLS FIRST,e.created_at ASC,e.id ASC LIMIT 1
         )
         SELECT c.id,c.name,c.condition,c.use_frequency,c.last_used_at,c.eligible_count,
           p.id AS photo_id,p.width,p.height,p.alt_text
         FROM chosen c LEFT JOIN LATERAL (
           SELECT m.id,m.width,m.height,m.alt_text FROM media_attachments m
           WHERE m.owner_id=$1 AND m.item_id=c.id AND m.kind='photo' AND m.variant='original'
             AND m.state='ready' ORDER BY m.position,m.id LIMIT 1
         ) p ON true`,
        [owner, rediscoveryExcludedConditions, rediscoveryFrequencies],
      );
      const row = pick.rows[0];
      return {
        inventory: { ownedCount: counts.rows[0]!.owned, sampleOwnedCount: counts.rows[0]!.sample },
        rediscovery: {
          eligibleCount: row?.eligible_count ?? 0,
          item: row
            ? {
                id: row.id,
                name: row.name,
                condition: row.condition,
                useFrequency: row.use_frequency,
                lastUsedAt: row.last_used_at?.toISOString() ?? null,
                cover: row.photo_id
                  ? {
                      photoId: row.photo_id,
                      width: row.width!,
                      height: row.height!,
                      altText: row.alt_text || null,
                      decorative: row.alt_text === '',
                    }
                  : null,
              }
            : null,
        },
      };
    });
  }
}
