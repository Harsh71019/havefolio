import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { applyMigrations, createDatabase, items } from '@havefolio/db';
import { eq } from 'drizzle-orm';
import type { QueryResult } from 'pg';

const run = new IntegrationRun(integrationConfiguration());
const owner = randomUUID();
const other = randomUUID();
const item = randomUUID();
const category = randomUUID();
const subcategory = randomUUID();
const foreignCategory = randomUUID();
const query = (sql: string, args: unknown[] = []): Promise<QueryResult> =>
  run.runtime.query(sql, args);
const denied = async (sql: string, args: unknown[] = [], code = '23514'): Promise<void> => {
  await expect(query(sql, args)).rejects.toMatchObject({ code });
};
const addItem = async (fields: Record<string, unknown> = {}): Promise<string> => {
  const data = {
    id: randomUUID(),
    owner_id: owner,
    name: 'Fixture',
    currency: 'INR',
    original_entry: { name: 'Fixture' },
    original_source: 'manual',
    ...fields,
  };
  const keys = Object.keys(data);
  await query(
    `INSERT INTO items (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
    Object.values(data),
  );
  return data.id;
};

beforeAll(async () => {
  await run.start();
  await query('INSERT INTO users (id) VALUES ($1),($2)', [owner, other]);
  await query('INSERT INTO categories (id,owner_id,name) VALUES ($1,$2,$3),($4,$5,$6)', [
    category,
    owner,
    'Electronics',
    foreignCategory,
    other,
    'Other',
  ]);
  await query('INSERT INTO subcategories (id,owner_id,category_id,name) VALUES ($1,$2,$3,$4)', [
    subcategory,
    owner,
    category,
    'Audio',
  ]);
  await addItem({ id: item, category_id: category, subcategory_id: subcategory });
}, 60_000);
afterAll(async () => {
  await run.close();
});

describe('PER-7 real relational constraints', () => {
  it('migrates an empty namespace and repeat migration preserves data and journal', async () => {
    const before = await query(`SELECT count(*) FROM "${run.schema}".__drizzle_migrations`);
    const journal = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL('../../../packages/db/migrations/meta/_journal.json', import.meta.url),
        ),
        'utf8',
      ),
    ) as { entries: unknown[] };
    expect(before.rows[0].count).toBe(String(journal.entries.length));
    await applyMigrations(run.migration, run.schema);
    expect((await query(`SELECT count(*) FROM "${run.schema}".__drizzle_migrations`)).rows).toEqual(
      before.rows,
    );
    expect((await query('SELECT name FROM items WHERE id=$1', [item])).rows[0].name).toBe(
      'Fixture',
    );
  });

  it('enforces owner existence, category owner and exact subcategory parent', async () => {
    await expect(addItem({ owner_id: randomUUID() })).rejects.toMatchObject({ code: '23503' });
    await expect(addItem({ category_id: foreignCategory })).rejects.toMatchObject({
      code: '23503',
    });
    await expect(addItem({ subcategory_id: subcategory })).rejects.toMatchObject({ code: '23514' });
    const second = randomUUID();
    await query('INSERT INTO categories(id,owner_id,name) VALUES($1,$2,$3)', [
      second,
      owner,
      'Books',
    ]);
    await expect(
      addItem({ category_id: second, subcategory_id: subcategory }),
    ).rejects.toMatchObject({ code: '23503' });
    await denied(
      'INSERT INTO subcategories(owner_id,category_id,name) VALUES($1,$2,$3)',
      [other, category, 'Wrong'],
      '23503',
    );
    await denied(
      'INSERT INTO subcategories(id,owner_id,category_id,name) VALUES($1,$2,$1,$3)',
      [randomUUID(), owner, 'Self'],
      '23503',
    );
    await denied('DELETE FROM categories WHERE id=$1', [category], '23001');
    await denied('DELETE FROM subcategories WHERE id=$1', [subcategory], '23001');
    await denied(
      'INSERT INTO categories(owner_id,name) VALUES($1,$2)',
      [owner, ' electronics '],
      '23505',
    );
  });

  it('keeps null, explicit zero, gifts and large bigint prices distinct through Drizzle', async () => {
    const ids = [];
    for (const value of [null, 0n, 2147483648n, 9007199254740993n, 9223372036854775807n]) {
      const id = await addItem({ price_paid_minor: value, acquisition_type: 'gift' });
      ids.push(id);
      const [row] = await createDatabase(run.runtime).select().from(items).where(eq(items.id, id));
      if (!row) throw new Error('Missing persisted item');
      expect(row.pricePaidMinor).toBe(value);
      if (value !== null) expect(BigInt(value.toString())).toBe(value);
    }
    expect(ids).toHaveLength(5);
    await expect(addItem({ price_paid_minor: -1 })).rejects.toMatchObject({ code: '23514' });
    await expect(addItem({ price_paid_minor: '1.5' })).rejects.toMatchObject({ code: '22P02' });
    await expect(addItem({ price_paid_minor: '9223372036854775808' })).rejects.toMatchObject({
      code: '22003',
    });
    for (const currency of ['ZZZ', 'inr', 'XXX', 'XTS', 'IN', null]) {
      await expect(addItem({ currency })).rejects.toMatchObject({
        code: currency === null ? '23502' : '23514',
      });
    }
    await addItem({ currency: 'JPY' });
    await addItem({ currency: 'DEM' }); // Withdrawn ISO code retains historical meaning.
  });

  it('round-trips known components without inventing purchase precision', async () => {
    for (const [precision, year, month, day] of [
      ['unknown', null, null, null],
      ['year', 2020, null, null],
      ['month', 2020, 2, null],
      ['exact', 2024, 2, 29],
      ['exact', 2000, 2, 29],
      ['exact', 1, 1, 1],
      ['exact', 9999, 12, 31],
    ]) {
      const id = await addItem({
        purchase_date_precision: precision,
        purchase_year: year,
        purchase_month: month,
        purchase_day: day,
      });
      const [row] = await createDatabase(run.runtime).select().from(items).where(eq(items.id, id));
      if (!row) throw new Error('Missing persisted item');
      expect([
        row.purchaseDatePrecision,
        row.purchaseYear,
        row.purchaseMonth,
        row.purchaseDay,
      ]).toEqual([precision, year, month, day]);
    }
    for (const [precision, year, month, day] of [
      ['exact', 1900, 2, 29],
      ['exact', 2023, 2, 29],
      ['exact', 2024, 4, 31],
      ['exact', 2024, 0, 1],
      ['exact', 2024, 13, 1],
      ['exact', 2024, 1, 0],
      ['exact', 2024, 1, null],
      ['exact', null, 1, 1],
      ['month', 2024, null, null],
      ['month', 2024, 1, 1],
      ['year', null, null, null],
      ['year', 0, null, null],
      ['year', 10000, null, null],
      ['year', 2024, 1, null],
      ['unknown', 2024, null, null],
      ['invalid', null, null, null],
    ]) {
      await expect(
        addItem({
          purchase_date_precision: precision,
          purchase_year: year,
          purchase_month: month,
          purchase_day: day,
        }),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('keeps physical condition, usage, acquisition and ownership independent', async () => {
    const id = await addItem({
      condition: 'working',
      use_frequency: 'rarely',
      acquisition_type: 'gift',
    });
    for (const status of ['owned', 'sold', 'donated', 'disposed', 'lost', 'returned']) {
      await query('UPDATE items SET ownership_status=$1 WHERE id=$2', [status, id]);
      expect(
        (
          await query('SELECT condition,use_frequency,acquisition_type FROM items WHERE id=$1', [
            id,
          ])
        ).rows[0],
      ).toEqual({ condition: 'working', use_frequency: 'rarely', acquisition_type: 'gift' });
    }
    for (const column of ['condition', 'use_frequency', 'acquisition_type', 'ownership_status'])
      await denied(`UPDATE items SET ${column}='invalid' WHERE id=$1`, [id]);
  });

  it('has owner-safe tags and prevents duplicate names and assignments', async () => {
    const tag = randomUUID(),
      wrong = randomUUID();
    await query('INSERT INTO tags(id,owner_id,name) VALUES($1,$2,$3),($4,$5,$3)', [
      tag,
      owner,
      'Favourite',
      wrong,
      other,
    ]);
    await query('INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES($1,$2,$3)', [
      owner,
      item,
      tag,
    ]);
    await denied(
      'INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES($1,$2,$3)',
      [owner, item, tag],
      '23505',
    );
    await denied(
      'INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES($1,$2,$3)',
      [owner, item, wrong],
      '23503',
    );
    await denied(
      'INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES($1,$2,$3)',
      [other, item, wrong],
      '23503',
    );
    await denied('INSERT INTO tags(owner_id,name) VALUES($1,$2)', [owner, ' favourite '], '23505');
    await query('DELETE FROM tags WHERE id=$1', [tag]);
    expect((await query('SELECT * FROM item_tags WHERE tag_id=$1', [tag])).rowCount).toBe(0);
  });

  it('preserves append-only lifecycle and original input while suggestions remain separate', async () => {
    const id = await addItem(),
      event = randomUUID(),
      suggestion = randomUUID();
    await query(
      "INSERT INTO lifecycle_events(id,owner_id,item_id,event_type,occurred_at,metadata) VALUES($1,$2,$3,'created',$4,$5)",
      [event, owner, id, '2024-01-01T00:00:00Z', { source: 'user' }],
    );
    await query(
      "INSERT INTO item_suggestions(id,owner_id,item_id,provider,suggested_values) VALUES($1,$2,$3,'fixture',$4)",
      [suggestion, owner, id, { name: 'Suggestion' }],
    );
    await query("UPDATE items SET name='User correction',condition='broken' WHERE id=$1", [id]);
    expect(
      (await query('SELECT original_entry FROM items WHERE id=$1', [id])).rows[0].original_entry,
    ).toEqual({ name: 'Fixture' });
    expect(
      (await query('SELECT metadata FROM lifecycle_events WHERE id=$1', [event])).rows[0].metadata,
    ).toEqual({ source: 'user' });
    await denied("UPDATE items SET original_entry='{}' WHERE id=$1", [id]);
    await denied("UPDATE items SET original_source='import' WHERE id=$1", [id]);
    await denied('UPDATE items SET owner_id=$1 WHERE id=$2', [other, id]);
    await denied("UPDATE lifecycle_events SET event_type='used' WHERE id=$1", [event]);
    await denied('DELETE FROM lifecycle_events WHERE id=$1', [event]);
    await denied("UPDATE item_suggestions SET status='accepted' WHERE id=$1", [suggestion]);
    await query("UPDATE item_suggestions SET status='accepted',decided_at=now() WHERE id=$1", [
      suggestion,
    ]);
    expect((await query('SELECT name FROM items WHERE id=$1', [id])).rows[0].name).toBe(
      'User correction',
    );
    await denied("UPDATE item_suggestions SET suggested_values='{}' WHERE id=$1", [suggestion]);
    await denied(
      "INSERT INTO item_suggestions(owner_id,item_id,provider,suggested_values) VALUES($1,$2,'fixture','{}')",
      [other, id],
      '23503',
    );
    await denied(
      "INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at) VALUES($1,$2,'used',now())",
      [other, id],
      '23503',
    );
    await query(
      "INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at,metadata) VALUES($1,$2,'correction',now(),$3)",
      [owner, id, { correctsEventId: event, reason: 'User correction' }],
    );
    await query('DELETE FROM items WHERE id=$1', [id]);
    expect((await query('SELECT * FROM lifecycle_events WHERE item_id=$1', [id])).rowCount).toBe(0);
    expect((await query('SELECT * FROM item_suggestions WHERE item_id=$1', [id])).rowCount).toBe(0);
  });

  it('enforces attachment identity, variant purpose and item ownership, and cleanup before erasure', async () => {
    const id = await addItem(),
      media = randomUUID(),
      variant = randomUUID();
    const insert = (
      attachment: string,
      own: string,
      itemId: string | null,
      kind = 'photo',
      parent: string | null = null,
    ): Promise<QueryResult> =>
      query(
        "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,parent_id,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$4,$5,$6,$7,'image','jpg','fixture.jpg','image/jpeg',4,$8)",
        [
          attachment,
          own,
          itemId,
          kind,
          parent ? 'thumbnail' : 'original',
          parent,
          `havefolio/test/${attachment}`,
          'a'.repeat(64),
        ],
      );
    await expect(insert(randomUUID(), other, id)).rejects.toMatchObject({ code: '23503' });
    await expect(insert(randomUUID(), randomUUID(), null)).rejects.toMatchObject({ code: '23503' });
    await insert(media, owner, id);
    for (const state of ['pending', 'ready', 'deleting']) {
      await query(
        'UPDATE media_attachments SET state=$1,provider_asset_id=$2,provider_version=1 WHERE id=$3',
        [state, media, media],
      );
      await denied('DELETE FROM media_attachments WHERE id=$1', [media]);
    }
    await expect(insert(randomUUID(), owner, item, 'photo', media)).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insert(randomUUID(), owner, id, 'receipt', media)).rejects.toMatchObject({
      code: '23514',
    });
    await insert(variant, owner, id, 'photo', media);
    await expect(insert(randomUUID(), owner, id, 'photo', variant)).rejects.toMatchObject({
      code: '23514',
    });
    const selfVariant = randomUUID();
    await expect(insert(selfVariant, owner, id, 'photo', selfVariant)).rejects.toMatchObject({
      code: '23514',
    });
    await denied('DELETE FROM items WHERE id=$1', [id], '23001');
    await denied('DELETE FROM users WHERE id=$1', [owner], '23001');
    await denied('DELETE FROM media_attachments WHERE id=$1', [media]);
    await denied('UPDATE media_attachments SET item_id=NULL WHERE id=$1', [media]);
    await denied("UPDATE media_attachments SET kind='receipt' WHERE id=$1", [media]);
    for (const kind of ['receipt', 'warranty']) {
      const doc = randomUUID();
      await insert(doc, owner, id, kind);
      await query("UPDATE media_attachments SET state='deleted' WHERE id=$1", [doc]);
      await query('DELETE FROM media_attachments WHERE id=$1', [doc]);
    }
    await query("UPDATE media_attachments SET state='deleted' WHERE id IN ($1,$2)", [
      media,
      variant,
    ]);
    await query('DELETE FROM media_attachments WHERE id=$1', [variant]);
    await query('DELETE FROM media_attachments WHERE id=$1', [media]);
    await query(
      'INSERT INTO item_warranties(owner_id,item_id,starts_on,expires_on) VALUES($1,$2,$3,$4)',
      [owner, id, '2024-01-01', '2025-01-01'],
    );
    await denied(
      'INSERT INTO item_warranties(owner_id,item_id,starts_on,expires_on) VALUES($1,$2,$3,$4)',
      [owner, id, '2025-01-01', '2024-01-01'],
    );
    await denied(
      'INSERT INTO item_warranties(owner_id,item_id) VALUES($1,$2)',
      [other, id],
      '23503',
    );
    await query('DELETE FROM items WHERE id=$1', [id]);
    expect((await query('SELECT * FROM item_warranties WHERE item_id=$1', [id])).rowCount).toBe(0);
  });

  it('provides bounded browse/ownership indexes and timestamp updates', async () => {
    const names = (
      await query('SELECT indexname FROM pg_indexes WHERE schemaname=$1', [run.schema])
    ).rows.map((r: { indexname: string }) => r.indexname);
    for (const name of [
      'item_owner_created_idx',
      'item_owner_status_created_idx',
      'item_owner_category_idx',
      'item_subcategory_owner_idx',
      'event_owner_item_time_idx',
      'media_item_owner_idx',
      'category_owner_name_unique',
      'tag_owner_name_unique',
      'item_tags_item_id_tag_id_pk',
    ])
      expect(names).toContain(name);
    const before = (await query('SELECT updated_at FROM items WHERE id=$1', [item])).rows[0]
      .updated_at;
    await query("UPDATE items SET name='Changed' WHERE id=$1", [item]);
    expect(
      (
        await query('SELECT updated_at FROM items WHERE id=$1', [item])
      ).rows[0].updated_at.getTime(),
    ).toBeGreaterThanOrEqual(before.getTime());
    const disposableOwner = randomUUID();
    await query('INSERT INTO users(id) VALUES($1)', [disposableOwner]);
    await query("INSERT INTO categories(owner_id,name) VALUES($1,'Disposable')", [disposableOwner]);
    await query('DELETE FROM users WHERE id=$1', [disposableOwner]);
    expect(
      (await query('SELECT * FROM categories WHERE owner_id=$1', [disposableOwner])).rowCount,
    ).toBe(0);
  });
});

it('upgrades populated PER-12 metadata without losing owner IDs or recovery states', async () => {
  const upgrade = new IntegrationRun(integrationConfiguration());
  try {
    await upgrade.start();
    // Reconstruct the old schema ONLY inside this run's disposable namespace, in a rollback-safe transaction.
    await upgrade.migration.query('BEGIN');
    await upgrade.migration.query(`DROP SCHEMA "${upgrade.schema}" CASCADE`);
    await upgrade.migration.query(`CREATE SCHEMA "${upgrade.schema}"`);
    const folder = fileURLToPath(new URL('../../../packages/db/migrations/', import.meta.url));
    for (const name of ['0000_foundation.sql', '0001_private_cloudinary_media.sql'])
      await upgrade.migration.query(
        (await readFile(folder + name, 'utf8')).replaceAll('--> statement-breakpoint', ''),
      );
    const preservedOwner = randomUUID();
    for (const state of ['pending', 'ready', 'deleting', 'deleted']) {
      await upgrade.migration.query(
        "INSERT INTO media_attachments(id,owner_id,kind,variant,state,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,provider_asset_id,provider_version) VALUES($1,$2,'photo','original',$3,$4,'image','jpg','fixture.jpg','image/jpeg',4,$5,$6,1)",
        [
          randomUUID(),
          preservedOwner,
          state,
          `havefolio/test/${randomUUID()}`,
          'a'.repeat(64),
          state === 'ready' ? 'ready-fixture' : null,
        ],
      );
    }
    await upgrade.migration.query(
      (await readFile(folder + '0002_inventory_domain.sql', 'utf8')).replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
    expect((await upgrade.migration.query('SELECT id FROM users')).rows).toEqual([
      { id: preservedOwner },
    ]);
    expect(
      (await upgrade.migration.query('SELECT state,item_id FROM media_attachments ORDER BY state'))
        .rows,
    ).toEqual(
      ['deleted', 'deleting', 'pending', 'ready'].map((state) => ({ state, item_id: null })),
    );
    await upgrade.migration.query('ROLLBACK'); // Restore fixture's original schema/journal for ordinary owned cleanup.
  } finally {
    await upgrade.migration.query('ROLLBACK');
    await upgrade.close();
  }
}, 60_000);
