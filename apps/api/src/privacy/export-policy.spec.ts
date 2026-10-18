import { describe, expect, it } from '@jest/globals';
import { getTableName, getTableColumns, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@havefolio/db';
import {
  exportRow,
  exportColumns,
  exportTables,
  excludedColumns,
  excludedTables,
  exportJsonColumns,
  serializeExportRow,
} from './export-policy.js';
describe('private export schema coverage', () => {
  it('requires an explicit decision for every current table', () => {
    const tables = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((v) => getTableName(v))
      .sort();
    expect(['users', ...exportTables, ...excludedTables].sort()).toEqual(tables);
    for (const table of Object.values(schema).filter((v) => is(v, PgTable))) {
      const name = getTableName(table) as keyof typeof exportColumns;
      if (excludedTables.includes(name)) continue;
      expect(
        Object.values(getTableColumns(table))
          .filter((c) => c.getSQLType() === 'jsonb')
          .map((c) => c.name as string)
          .sort(),
      ).toEqual([...(exportJsonColumns[name] ?? [])].sort());
      expect([...exportColumns[name], ...(excludedColumns[name] ?? [])].sort()).toEqual(
        Object.values(getTableColumns(table))
          .map((c) => c.name as string)
          .sort(),
      );
    }
  });
  it('preserves arbitrary-precision nested JSON without a JavaScript numeric round trip', () => {
    expect(
      serializeExportRow('items', {
        id: 'synthetic',
        original_entry: '{"numericOriginal":9007199254740993}',
        specifications: null,
      }),
    ).toContain('9007199254740993');
    expect(() => serializeExportRow('items', { original_entry: { unparsed: false } })).toThrow(
      'EXPORT_JSON_UNAVAILABLE',
    );
  });
  it('excludes internal secrets and delivery identities while preserving private original values', () => {
    expect(
      exportRow('media_attachments', {
        id: 'synthetic',
        original_filename: 'sample.pdf',
        object_key: 'protected',
        provider_asset_id: 'private',
        provider_version: 123,
        checksum: 'internal',
        byte_size: '9007199254740993',
      }),
    ).toEqual({ id: 'synthetic', original_filename: 'sample.pdf', byte_size: '9007199254740993' });
    expect(
      exportRow('items', {
        price_paid_minor: '9007199254740993',
        currency: 'INR',
        purchase_date_precision: 'year',
        purchase_year: 2020,
        purchase_month: null,
        original_entry: { notes: 'original' },
      }),
    ).toMatchObject({
      price_paid_minor: '9007199254740993',
      purchase_month: null,
      original_entry: { notes: 'original' },
    });
    expect(
      exportRow('goal_contributions', {
        request_hash: 'internal',
        amount_minor: '100',
        supersedes_id: 'previous',
      }),
    ).toEqual({ amount_minor: '100', supersedes_id: 'previous' });
  });
});
