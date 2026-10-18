import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';

jest.setTimeout(60000);

interface DbError {
  code?: string;
  message?: string;
}

describe('PER-39 database constraints supporting ownership, lifecycle, financial semantics and concurrency', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const ownerA = randomUUID();
  const ownerB = randomUUID();

  const insertItem = (
    id: string,
    owner: string,
    overrides: Record<string, unknown> = {},
  ): Promise<unknown> => {
    const fields = {
      id,
      owner_id: owner,
      name: 'Item for testing constraints',
      ownership_status: 'owned',
      currency: 'INR',
      original_entry: JSON.stringify({ name: 'Item for testing constraints' }),
      original_source: 'manual',
      ...overrides,
    };
    const cols = Object.keys(fields);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = Object.values(fields);
    return run.runtime.query(
      `INSERT INTO items(${cols.join(', ')}) VALUES (${placeholders})`,
      values,
    );
  };

  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id, email, password_hash) VALUES ($1, 'owner-a@example.test', '$argon2id$fixture'), ($2, NULL, NULL)",
      [ownerA, ownerB],
    );
    await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [ownerA]);
  });

  afterAll(async () => {
    await run.close();
  });

  describe('Ownership and cross-resource isolation constraints', () => {
    it('enforces subcategory must belong to same owner as category', async () => {
      const catA = randomUUID();
      await run.runtime.query(
        'INSERT INTO categories(id, owner_id, name, position) VALUES ($1, $2, $3, 0)',
        [catA, ownerA, 'Owner A Category'],
      );

      // Subcategory created by ownerB referencing ownerA category must be rejected by foreign key
      const subB = randomUUID();
      let failed = false;
      try {
        await run.runtime.query(
          'INSERT INTO subcategories(id, owner_id, category_id, name, position) VALUES ($1, $2, $3, $4, 0)',
          [subB, ownerB, catA, 'Cross Owner Subcategory'],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failed = true;
        expect(err.code).toBe('23503'); // foreign_key_violation
      }
      expect(failed).toBe(true);
    });

    it('enforces media attached to a desire must be of kind photo only', async () => {
      const desireA = randomUUID();
      await run.runtime.query(
        "INSERT INTO desires(id, owner_id, name, status) VALUES ($1, $2, 'Desire for media test', 'considering')",
        [desireA, ownerA],
      );

      const mediaReceipt = randomUUID();
      let failed = false;
      try {
        await run.runtime.query(
          `INSERT INTO media_attachments(
            id, owner_id, desire_id, kind, variant, object_key, resource_type,
            format, original_filename, mime_type, byte_size, checksum, state
          ) VALUES ($1, $2, $3, 'receipt', 'original', $4, 'raw', 'pdf', 'receipt.pdf', 'application/pdf', 1024, $5, 'pending')`,
          [
            mediaReceipt,
            ownerA,
            desireA,
            `key-${mediaReceipt}.pdf`,
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          ],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failed = true;
        expect(err.code).toBe('23514'); // check_violation (media_desire_kind_check)
      }
      expect(failed).toBe(true);
    });

    it('enforces at most one ready photo per desire', async () => {
      const desireId = randomUUID();
      await run.runtime.query(
        "INSERT INTO desires(id, owner_id, name, status) VALUES ($1, $2, 'Desire single photo test', 'considering')",
        [desireId, ownerA],
      );

      const photo1 = randomUUID();
      const photo2 = randomUUID();
      const checksum = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      await run.runtime.query(
        `INSERT INTO media_attachments(
          id, owner_id, desire_id, kind, variant, object_key, resource_type,
          format, original_filename, mime_type, byte_size, checksum, state, width, height,
          provider_asset_id, provider_version, position
        ) VALUES ($1, $2, $3, 'photo', 'original', $4, 'image', 'webp', 'photo.webp', 'image/webp', 2048, $5, 'ready', 800, 600, 'asset_1', 1, 0)`,
        [photo1, ownerA, desireId, `key-${photo1}.webp`, checksum],
      );

      // Attempting to insert a second ready original photo for the same desire violates media_desire_single_photo_unique
      let failed = false;
      try {
        await run.runtime.query(
          `INSERT INTO media_attachments(
            id, owner_id, desire_id, kind, variant, object_key, resource_type,
            format, original_filename, mime_type, byte_size, checksum, state, width, height,
            provider_asset_id, provider_version, position
          ) VALUES ($1, $2, $3, 'photo', 'original', $4, 'image', 'webp', 'photo2.webp', 'image/webp', 2048, $5, 'ready', 800, 600, 'asset_2', 1, 0)`,
          [photo2, ownerA, desireId, `key-${photo2}.webp`, checksum],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failed = true;
        expect(err.code).toBe('23505'); // unique_violation (media_desire_single_photo_unique)
      }
      expect(failed).toBe(true);
    });

    it('enforces unique constraints on desire conversions', async () => {
      await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [ownerA]);
      const desireA = randomUUID();
      const itemA = randomUUID();
      const eventA = randomUUID();
      const cmdA = randomUUID();
      const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      await run.runtime.query(
        "INSERT INTO desires(id, owner_id, name) VALUES ($1, $2, 'Convert Desire')",
        [desireA, ownerA],
      );
      // Desire review event with outcome 'bought' is required before conversion
      await run.runtime.query(
        `INSERT INTO desire_review_events(id, desire_id, owner_id, command_id, request_hash, sequence, outcome)
         VALUES ($1, $2, $3, $4, $5, 2, 'bought')`,
        [eventA, desireA, ownerA, randomUUID(), hashA],
      );

      await insertItem(itemA, ownerA, { name: 'Converted Item' });

      const convId = randomUUID();
      await run.runtime.query(
        `INSERT INTO desire_conversions(id, owner_id, desire_id, item_id, bought_event_id, command_id, request_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [convId, ownerA, desireA, itemA, eventA, cmdA, hashA],
      );

      // Duplicate desire conversion for the same desire must be rejected
      let failedDesireUnique = false;
      const itemA2 = randomUUID();
      await insertItem(itemA2, ownerA, { name: 'Second Item' });
      try {
        await run.runtime.query(
          `INSERT INTO desire_conversions(id, owner_id, desire_id, item_id, bought_event_id, command_id, request_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), ownerA, desireA, itemA2, eventA, randomUUID(), hashA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedDesireUnique = true;
        expect(err.code).toBe('23505'); // unique_violation (conversion_owner_desire_unique)
      }
      expect(failedDesireUnique).toBe(true);

      // Duplicate item link for conversion must be rejected
      let failedItemUnique = false;
      try {
        const desireB = randomUUID();
        const eventB = randomUUID();
        await run.runtime.query(
          "INSERT INTO desires(id, owner_id, name) VALUES ($1, $2, 'Desire B')",
          [desireB, ownerA],
        );
        await run.runtime.query(
          `INSERT INTO desire_review_events(id, desire_id, owner_id, command_id, request_hash, sequence, outcome)
           VALUES ($1, $2, $3, $4, $5, 2, 'bought')`,
          [eventB, desireB, ownerA, randomUUID(), hashA],
        );
        await run.runtime.query(
          `INSERT INTO desire_conversions(id, owner_id, desire_id, item_id, bought_event_id, command_id, request_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), ownerA, desireB, itemA, eventB, randomUUID(), hashA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedItemUnique = true;
        expect(err.code).toBe('23505'); // conversion_item_unique
      }
      expect(failedItemUnique).toBe(true);
    });

    it('enforces ledger append-only integrity on goal contributions and allocations', async () => {
      await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [ownerA]);
      const goalId = randomUUID();
      await run.runtime.query(
        "INSERT INTO goals(id, owner_id, name, currency, target_minor) VALUES ($1, $2, 'Emergency Fund', 'INR', 5000000)",
        [goalId, ownerA],
      );

      const cmd1 = randomUUID();
      const hash1 = '1111111111111111111111111111111111111111111111111111111111111111';
      const contrib1 = randomUUID();

      // Goal starts with revision 1, so the first contribution sequence is 2
      await run.runtime.query(
        `INSERT INTO goal_contributions(id, goal_id, owner_id, command_id, request_hash, sequence, kind, amount_minor, currency)
         VALUES ($1, $2, $3, $4, $5, 2, 'contribution', 100000, 'INR')`,
        [contrib1, goalId, ownerA, cmd1, hash1],
      );

      // Cannot reuse commandId on the same goal
      let failedCommandUnique = false;
      try {
        await run.runtime.query(
          `INSERT INTO goal_contributions(id, goal_id, owner_id, command_id, request_hash, sequence, kind, amount_minor, currency)
           VALUES ($1, $2, $3, $4, $5, 3, 'contribution', 200000, 'INR')`,
          [randomUUID(), goalId, ownerA, cmd1, hash1],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedCommandUnique = true;
        expect(err.code).toBe('23505'); // contribution_command_unique
      }
      expect(failedCommandUnique).toBe(true);

      // Superseding the same contribution twice violates contribution_successor_unique
      const contrib2 = randomUUID();
      await run.runtime.query(
        `INSERT INTO goal_contributions(id, goal_id, owner_id, command_id, request_hash, sequence, kind, amount_minor, currency, supersedes_id)
         VALUES ($1, $2, $3, $4, $5, 3, 'correction', 150000, 'INR', $6)`,
        [contrib2, goalId, ownerA, randomUUID(), hash1, contrib1],
      );

      let failedSuccessorUnique = false;
      try {
        await run.runtime.query(
          `INSERT INTO goal_contributions(id, goal_id, owner_id, command_id, request_hash, sequence, kind, amount_minor, currency, supersedes_id)
           VALUES ($1, $2, $3, $4, $5, 4, 'correction', 180000, 'INR', $6)`,
          [randomUUID(), goalId, ownerA, randomUUID(), hash1, contrib1],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedSuccessorUnique = true;
        // Either trigger guard (23514 CONTRIBUTION_ALREADY_CORRECTED) or constraint (23505 contribution_successor_unique)
        expect(['23505', '23514']).toContain(err.code);
      }
      expect(failedSuccessorUnique).toBe(true);
    });
  });

  describe('Financial semantics constraints in PostgreSQL', () => {
    it('rejects negative item price at the database constraint level', async () => {
      let failed = false;
      try {
        await insertItem(randomUUID(), ownerA, { price_paid_minor: -100 });
      } catch (error: unknown) {
        const err = error as DbError;
        failed = true;
        expect(err.code).toBe('23514'); // check_violation (item_price_check)
      }
      expect(failed).toBe(true);
    });

    it('rejects non-positive refund amount at the database constraint level', async () => {
      const itemId = randomUUID();
      await insertItem(itemId, ownerA, { price_paid_minor: 50000 });

      // Refund of 0
      let failedZero = false;
      try {
        await run.runtime.query(
          'INSERT INTO item_refunds(id, item_id, owner_id, amount_minor, currency) VALUES ($1, $2, $3, 0, $4)',
          [randomUUID(), itemId, ownerA, 'INR'],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedZero = true;
        expect(err.code).toBe('23514'); // refund_amount_check
      }
      expect(failedZero).toBe(true);

      // Negative refund
      let failedNeg = false;
      try {
        await run.runtime.query(
          'INSERT INTO item_refunds(id, item_id, owner_id, amount_minor, currency) VALUES ($1, $2, $3, -500, $4)',
          [randomUUID(), itemId, ownerA, 'INR'],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedNeg = true;
        expect(err.code).toBe('23514'); // refund_amount_check
      }
      expect(failedNeg).toBe(true);
    });

    it('enforces currency and owner matching on refunds via composite foreign key', async () => {
      const itemId = randomUUID();
      await insertItem(itemId, ownerA, { price_paid_minor: 100000, currency: 'INR' });

      // Inserting refund with mismatched currency (USD instead of INR)
      let failedCurrency = false;
      try {
        await run.runtime.query(
          'INSERT INTO item_refunds(id, item_id, owner_id, amount_minor, currency) VALUES ($1, $2, $3, 20000, $4)',
          [randomUUID(), itemId, ownerA, 'USD'],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedCurrency = true;
        expect(err.code).toBe('23503'); // foreign_key_violation (composite item_id, owner_id, currency)
      }
      expect(failedCurrency).toBe(true);

      // Inserting refund with mismatched owner
      let failedOwner = false;
      try {
        await run.runtime.query(
          'INSERT INTO item_refunds(id, item_id, owner_id, amount_minor, currency) VALUES ($1, $2, $3, 20000, $4)',
          [randomUUID(), itemId, ownerB, 'INR'],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedOwner = true;
        expect(err.code).toBe('23503'); // foreign_key_violation
      }
      expect(failedOwner).toBe(true);
    });

    it('enforces currency and owner matching on goal contributions in database', async () => {
      await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [ownerA]);
      const goalId = randomUUID();
      await run.runtime.query(
        "INSERT INTO goals(id, owner_id, name, currency, target_minor) VALUES ($1, $2, 'INR Goal', 'INR', 2000000)",
        [goalId, ownerA],
      );

      // Inserting contribution with USD currency into INR goal must be rejected
      let failed = false;
      try {
        await run.runtime.query(
          `INSERT INTO goal_contributions(id, goal_id, owner_id, command_id, request_hash, sequence, kind, amount_minor, currency)
           VALUES ($1, $2, $3, $4, $5, 2, 'contribution', 50000, 'USD')`,
          [
            randomUUID(),
            goalId,
            ownerA,
            randomUUID(),
            '2222222222222222222222222222222222222222222222222222222222222222',
          ],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failed = true;
        // Rejected by contribution_guard trigger (23514) or foreign key (23503)
        expect(['23514', '23503']).toContain(err.code);
      }
      expect(failed).toBe(true);
    });

    it('rejects negative target on goals at database constraint level', async () => {
      await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [ownerA]);
      let failed = false;
      try {
        await run.runtime.query(
          "INSERT INTO goals(id, owner_id, name, currency, target_minor) VALUES ($1, $2, 'Negative Goal', 'INR', -1)",
          [randomUUID(), ownerA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failed = true;
        expect(err.code).toBe('23514'); // goal_target_check
      }
      expect(failed).toBe(true);
    });
  });

  describe('Lifecycle state and revision check constraints', () => {
    it('rejects invalid enum values for item ownership status and condition', async () => {
      // Invalid status
      let failedStatus = false;
      try {
        await insertItem(randomUUID(), ownerA, { ownership_status: 'borrowed' });
      } catch (error: unknown) {
        const err = error as DbError;
        failedStatus = true;
        expect(err.code).toBe('23514'); // item_ownership_status_check
      }
      expect(failedStatus).toBe(true);

      // Invalid condition
      let failedCondition = false;
      try {
        await insertItem(randomUUID(), ownerA, { condition: 'vintage' });
      } catch (error: unknown) {
        const err = error as DbError;
        failedCondition = true;
        expect(err.code).toBe('23514'); // item_condition_check
      }
      expect(failedCondition).toBe(true);
    });

    it('rejects invalid enum values for desire status and classification', async () => {
      // Invalid desire status
      let failedStatus = false;
      try {
        await run.runtime.query(
          "INSERT INTO desires(id, owner_id, name, status) VALUES ($1, $2, 'Bad Status', 'purchased')",
          [randomUUID(), ownerA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedStatus = true;
        expect(err.code).toBe('23514'); // desire_status_check
      }
      expect(failedStatus).toBe(true);

      // Invalid classification
      let failedClassification = false;
      try {
        await run.runtime.query(
          "INSERT INTO desires(id, owner_id, name, status, classification) VALUES ($1, $2, 'Bad Class', 'considering', 'essential')",
          [randomUUID(), ownerA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedClassification = true;
        expect(err.code).toBe('23514'); // desire_classification_check
      }
      expect(failedClassification).toBe(true);
    });

    it('enforces revision numbers must be strictly positive', async () => {
      // Item revision > 0
      let failedItem = false;
      try {
        await insertItem(randomUUID(), ownerA, { revision: 0 });
      } catch (error: unknown) {
        const err = error as DbError;
        failedItem = true;
        expect(err.code).toBe('23514'); // item_revision_check
      }
      expect(failedItem).toBe(true);

      // Desire revision >= 1
      let failedDesire = false;
      try {
        await run.runtime.query(
          "INSERT INTO desires(id, owner_id, name, status, revision) VALUES ($1, $2, 'Rev 0 Desire', 'considering', 0)",
          [randomUUID(), ownerA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedDesire = true;
        expect(err.code).toBe('23514'); // desire_revision_check
      }
      expect(failedDesire).toBe(true);

      // Goal revision > 0
      await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [ownerA]);
      let failedGoal = false;
      try {
        await run.runtime.query(
          "INSERT INTO goals(id, owner_id, name, currency, target_minor, revision) VALUES ($1, $2, 'Rev 0 Goal', 'INR', 1000, 0)",
          [randomUUID(), ownerA],
        );
      } catch (error: unknown) {
        const err = error as DbError;
        failedGoal = true;
        expect(err.code).toBe('23514'); // goal_revision_check
      }
      expect(failedGoal).toBe(true);
    });
  });

  describe('Transaction rollback and optimistic concurrency', () => {
    it('rolls back all mutations atomically when a mid-transaction constraint fails', async () => {
      const itemId = randomUUID();
      let failed = false;

      // Begin transaction
      await run.runtime.query('BEGIN');
      try {
        // Step 1: Insert valid item
        await insertItem(itemId, ownerA, { price_paid_minor: 50000 });

        // Step 2: Attempt invalid refund in same transaction
        await run.runtime.query(
          'INSERT INTO item_refunds(id, item_id, owner_id, amount_minor, currency) VALUES ($1, $2, $3, -999, $4)',
          [randomUUID(), itemId, ownerA, 'INR'],
        );

        await run.runtime.query('COMMIT');
      } catch {
        await run.runtime.query('ROLLBACK');
        failed = true;
      }

      expect(failed).toBe(true);

      // Verify the item was rolled back and does not exist in items table
      const res = await run.runtime.query('SELECT 1 FROM items WHERE id = $1', [itemId]);
      expect(res.rowCount).toBe(0);
    });

    it('serializes concurrent mutations on the same resource using revision checks', async () => {
      const itemId = randomUUID();
      await insertItem(itemId, ownerA, { revision: 1 });

      // First transaction updates from revision 1 to 2
      const update1 = await run.runtime.query(
        "UPDATE items SET name = 'Updated by Tx1', revision = revision + 1 WHERE id = $1 AND owner_id = $2 AND revision = 1",
        [itemId, ownerA],
      );
      expect(update1.rowCount).toBe(1);

      // Second transaction still thinking revision is 1 gets rowCount 0 (stale revision)
      const update2 = await run.runtime.query(
        "UPDATE items SET name = 'Updated by Tx2', revision = revision + 1 WHERE id = $1 AND owner_id = $2 AND revision = 1",
        [itemId, ownerA],
      );
      expect(update2.rowCount).toBe(0);

      // Item name reflects Tx1, revision is 2
      const finalRes = await run.runtime.query<{ name: string; revision: number }>(
        'SELECT name, revision FROM items WHERE id = $1',
        [itemId],
      );
      expect(finalRes.rows[0]?.name).toBe('Updated by Tx1');
      expect(finalRes.rows[0]?.revision).toBe(2);
    });
  });
});
