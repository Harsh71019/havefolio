import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { OnboardingAction, OnboardingStatus } from '@havefolio/contracts';
import { ItemsRepository } from '../items/items.repository.js';
import { MediaService } from '../media/media.service.js';
import { demoItems, demoVersion } from './demo-data.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly media: MediaService,
  ) {}

  private async ensure(c: PoolClient, owner: string): Promise<void> {
    await c.query('INSERT INTO owner_onboarding(owner_id) VALUES($1) ON CONFLICT DO NOTHING', [
      owner,
    ]);
  }
  private async snapshot(c: PoolClient, owner: string): Promise<OnboardingStatus> {
    const { rows } = await c.query<OnboardingStatus>(
      `SELECT
      o.state,o.browsed_store AS "browsedStore",o.reviewed_item AS "reviewedItem",
      o.tried_demo AS "triedDemo",o.removed_demo AS "removedDemo",
      (SELECT count(*)::int FROM items WHERE owner_id=$1 AND demo_dataset_id IS NULL) AS "genuineItemCount",
      (SELECT count(*)::int FROM items WHERE owner_id=$1 AND demo_dataset_id IS NOT NULL) AS "demoItemCount"
      FROM owner_onboarding o WHERE owner_id=$1`,
      [owner],
    );
    return rows[0]!;
  }
  read(owner: string): Promise<OnboardingStatus> {
    return this.repository.transaction(owner, async (c) => {
      await this.ensure(c, owner);
      return this.snapshot(c, owner);
    });
  }
  act(owner: string, action: OnboardingAction): Promise<OnboardingStatus> {
    return this.repository.transaction(owner, async (c) => {
      await this.ensure(c, owner);
      const old = await this.snapshot(c, owner);
      let state = old.state;
      switch (action) {
        case 'start':
          if (state === 'skipped' || state === 'completed')
            throw new ConflictException('INVALID_ONBOARDING_TRANSITION');
          state = 'active';
          break;
        case 'skip':
          state = 'skipped';
          break;
        case 'complete':
          state = 'completed';
          break;
        case 'revisit':
          state = 'active';
          break;
      }
      // Milestones record visited surfaces only; adding a genuine item is computed independently.
      // Check that a genuine record actually exists before accepting the genuine-details milestone.
      const reviewed = action === 'review_item' && old.genuineItemCount > 0;
      await c.query(
        `UPDATE owner_onboarding SET state=$2,
        browsed_store=browsed_store OR $3,reviewed_item=reviewed_item OR $4 WHERE owner_id=$1`,
        [owner, state, action === 'browse_store', reviewed],
      );
      return this.snapshot(c, owner);
    });
  }
  seed(owner: string): Promise<OnboardingStatus> {
    return this.repository.transaction(owner, async (c) => {
      await this.ensure(c, owner);
      const existing = await c.query('SELECT id FROM demo_datasets WHERE owner_id=$1', [owner]);
      if (existing.rowCount) return this.snapshot(c, owner);
      const dataset = (
        await c.query<{ id: string }>(
          'INSERT INTO demo_datasets(owner_id,version) VALUES($1,$2) RETURNING id',
          [owner, demoVersion],
        )
      ).rows[0]!.id;
      for (const example of demoItems) {
        // Reuse same-owner taxonomy; retired entries remain retired.
        // New classification is ordinary reusable taxonomy and survives demo removal.
        await c.query(
          'INSERT INTO categories(owner_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [owner, example.category],
        );
        const category =
          (
            await c.query<{ id: string }>(
              'SELECT id FROM categories WHERE owner_id=$1 AND lower(btrim(name))=lower($2) AND retired_at IS NULL',
              [owner, example.category],
            )
          ).rows[0]?.id ?? null;
        let child: string | null = null;
        if (category) {
          await c.query(
            'INSERT INTO subcategories(owner_id,category_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [owner, category, example.subcategory],
          );
          child =
            (
              await c.query<{ id: string }>(
                'SELECT id FROM subcategories WHERE owner_id=$1 AND category_id=$2 AND lower(btrim(name))=lower($3) AND retired_at IS NULL',
                [owner, category, example.subcategory],
              )
            ).rows[0]?.id ?? null;
        }
        const d = example as typeof example & { year?: number; month?: number; day?: number };
        const item = (
          await c.query<{ id: string }>(
            `INSERT INTO items(owner_id,demo_dataset_id,name,category_id,subcategory_id,currency,price_paid_minor,purchase_date_precision,purchase_year,purchase_month,purchase_day,acquisition_type,condition,use_frequency,ownership_status,notes,original_entry,original_source)
          VALUES($1,$2,$3,$4,$5,'INR',$6,$7,$8,$9,$10,'bought',$11,$12,$13,'Fictional sample. Amounts are examples, not current market prices.','{}','import') RETURNING id`,
            [
              owner,
              dataset,
              example.name,
              category,
              child,
              example.price,
              example.precision,
              d.year ?? null,
              d.month ?? null,
              d.day ?? null,
              example.condition,
              example.frequency,
              example.status,
            ],
          )
        ).rows[0]!.id;
        await c.query(
          'INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at,metadata) VALUES($1,$2,\'created\',now(),\'{"source":"demo"}\')',
          [owner, item],
        );
      }
      const counts = (
        await c.query<{ valid: boolean }>(
          `SELECT
        (SELECT count(*) FROM categories WHERE owner_id=$1)<=500 AND
        (SELECT count(*) FROM subcategories WHERE owner_id=$1)<=500 AS valid`,
          [owner],
        )
      ).rows[0];
      if (!counts?.valid) throw new ConflictException('TAXONOMY_LIMIT_EXCEEDED');
      // Explicit exploration may start new onboarding, but never reopens a dismissed checklist.
      await c.query(
        "UPDATE owner_onboarding SET tried_demo=true,removed_demo=false,state=CASE WHEN state='not_started' THEN 'active' ELSE state END WHERE owner_id=$1",
        [owner],
      );
      return this.snapshot(c, owner);
    });
  }
  remove(owner: string): Promise<OnboardingStatus> {
    return this.repository.transaction(owner, async (c) => {
      await this.ensure(c, owner);
      // Defensive recovery for assets attached by older/internal tools. Keep provider tombstones.
      const assets = (
        await c.query<{ id: string; state: string }>(
          `SELECT m.id,m.state FROM media_attachments m JOIN items i ON i.id=m.item_id AND i.owner_id=m.owner_id
        WHERE i.owner_id=$1 AND i.demo_dataset_id IS NOT NULL AND m.state<>'deleted'
        ORDER BY (m.parent_id IS NULL),m.id LIMIT 501`,
          [owner],
        )
      ).rows;
      if (assets.length > 500 || assets.some((a) => a.state === 'pending'))
        throw new ConflictException('ITEM_MEDIA_PENDING');
      for (const asset of assets) await this.media.delete(owner, asset.id);
      const incomplete = await c.query(
        `SELECT 1 FROM media_attachments m JOIN items i ON i.id=m.item_id AND i.owner_id=m.owner_id
        WHERE i.owner_id=$1 AND i.demo_dataset_id IS NOT NULL AND m.state<>'deleted' LIMIT 1`,
        [owner],
      );
      if (incomplete.rowCount) throw new ConflictException('ITEM_MEDIA_PENDING');

      await c.query(
        `UPDATE media_attachments m SET item_id=NULL FROM items i WHERE i.owner_id=$1 AND i.demo_dataset_id IS NOT NULL AND m.owner_id=$1 AND m.item_id=i.id AND m.state='deleted'`,
        [owner],
      );
      await c.query('DELETE FROM items WHERE owner_id=$1 AND demo_dataset_id IS NOT NULL', [owner]);
      const removed = await c.query('DELETE FROM demo_datasets WHERE owner_id=$1', [owner]);
      if (removed.rowCount)
        await c.query('UPDATE owner_onboarding SET removed_demo=true WHERE owner_id=$1', [owner]);
      return this.snapshot(c, owner);
    });
  }
}
