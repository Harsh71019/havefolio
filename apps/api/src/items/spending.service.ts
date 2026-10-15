import { BadRequestException, Injectable } from '@nestjs/common';
import { isCurrencyCode, parseCalendarDay, spendingScopeStatuses } from '@havefolio/domain';
import type { SpendingBucket, SpendingReport } from '@havefolio/contracts';
import { ItemsRepository } from './items.repository.js';
import type { SpendingQueryDto } from './spending.dto.js';

const invalid = (): never => {
  throw new BadRequestException('INVALID_SPENDING_QUERY');
};
export function normalizeSpendingQuery(q: SpendingQueryDto): SpendingQueryDto {
  if (!['current-owned', 'all-history'].includes(q.scope)) invalid();
  if (q.currency && !isCurrencyCode(q.currency)) invalid();
  if (q.subcategoryId && !q.categoryId) invalid();
  try {
    for (const day of [q.purchasedFrom, q.purchasedTo]) if (day) parseCalendarDay(day);
  } catch {
    invalid();
  }
  if (q.purchasedFrom && q.purchasedTo && q.purchasedFrom > q.purchasedTo) invalid();
  const grouping = q.grouping ?? 'overall';
  if (!['overall', 'category', 'subcategory', 'year', 'month'].includes(grouping)) invalid();
  return { ...q, grouping };
}

/** SQL implementation of domain/spending.ts; parameters only, no private fields selected.
 * All dimensions use the same source, refund join, date relation and metrics. */
export function spendingSql(
  owner: string,
  input: SpendingQueryDto,
): { text: string; values: unknown[] } {
  const q = normalizeSpendingQuery(input);
  const values: unknown[] = [owner];
  const bind = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  const scope = q.scope === 'current-owned' ? 'current_owned' : 'all_history';
  const clauses = [
    `i.owner_id=$1`,
    `i.demo_dataset_id IS NULL`,
    `i.ownership_status=ANY(${bind(spendingScopeStatuses[scope])}::text[])`,
  ];
  // PER-19: exclude durable demo identity before every dimension, precision check and refund join.
  for (const [key, column] of [
    ['currency', 'currency'],
    ['categoryId', 'category_id'],
    ['subcategoryId', 'subcategory_id'],
  ] as const)
    if (q[key]) clauses.push(`i.${column}=${bind(q[key])}`);
  // Sargable coarse bounds narrow the owner/date index; exact containment remains below.
  if (q.purchasedFrom)
    clauses.push(
      `(i.purchase_year>=${bind(Number(q.purchasedFrom.slice(0, 4)))}::int OR i.purchase_year IS NULL)`,
    );
  if (q.purchasedTo)
    clauses.push(
      `(i.purchase_year<=${bind(Number(q.purchasedTo.slice(0, 4)))}::int OR i.purchase_year IS NULL)`,
    );
  const from = bind(q.purchasedFrom ?? null),
    to = bind(q.purchasedTo ?? null);
  const key = {
    overall: 'NULL::text',
    category: 'category_id::text',
    subcategory: 'subcategory_id::text',
    year: "lpad(purchase_year::text,4,'0')",
    month: "lpad(purchase_year::text,4,'0')||'-'||lpad(purchase_month::text,2,'0')",
  }[q.grouping ?? 'overall'];
  return {
    values,
    text: `WITH source AS MATERIALIZED (
    SELECT i.id,i.owner_id,i.currency,i.price_paid_minor,i.acquisition_type,i.category_id,i.subcategory_id,
      i.purchase_date_precision,i.purchase_year,i.purchase_month,
      make_date(i.purchase_year,coalesce(i.purchase_month,1),coalesce(i.purchase_day,1)) AS first_day,
      CASE i.purchase_date_precision WHEN 'year' THEN make_date(i.purchase_year,12,31)
        WHEN 'month' THEN (make_date(i.purchase_year,i.purchase_month,1)+interval '1 month - 1 day')::date
        ELSE make_date(i.purchase_year,i.purchase_month,i.purchase_day) END AS last_day
    FROM items i WHERE ${clauses.join(' AND ')}
  ), refunds AS (
    SELECT r.item_id,sum(r.amount_minor) AS refunded FROM item_refunds r
      JOIN source s ON s.id=r.item_id AND s.owner_id=r.owner_id AND s.currency=r.currency
      WHERE r.owner_id=$1 GROUP BY r.item_id
  ), related AS (
    SELECT s.*,coalesce(r.refunded,0::numeric) AS refunded,
      CASE WHEN purchase_date_precision='unknown' THEN 'unknownDate'
        WHEN (${from}::date IS NULL OR first_day>=${from}::date) AND (${to}::date IS NULL OR last_day<=${to}::date) THEN 'dated'
        WHEN (${from}::date IS NULL OR last_day>=${from}::date) AND (${to}::date IS NULL OR first_day<=${to}::date) THEN 'spanningRange'
        ELSE 'outside' END AS relation
      FROM source s LEFT JOIN refunds r ON r.item_id=s.id
  ) SELECT currency,${key} AS key,relation AS "dateBucket",
    coalesce(sum(price_paid_minor),0)::text AS "grossMinor",sum(refunded)::text AS "refundedMinor",
    (coalesce(sum(price_paid_minor),0)-sum(refunded))::text AS "netMinor",
    count(*) FILTER (WHERE price_paid_minor IS NOT NULL)::text AS "pricedItemCount",
    count(*) FILTER (WHERE price_paid_minor IS NULL AND acquisition_type<>'gift')::text AS "unknownPriceCount",
    count(*) FILTER (WHERE price_paid_minor IS NULL AND acquisition_type='gift')::text AS "notSpendingCount",
    count(*) FILTER (WHERE price_paid_minor=0)::text AS "explicitZeroCount",
    count(*) FILTER (WHERE purchase_date_precision<>'unknown')::text AS "knownDateCount",
    count(*) FILTER (WHERE purchase_date_precision='unknown')::text AS "unknownDateCount",
    count(*)::text AS "totalItemCount",
    bool_or(purchase_date_precision='year') AS "hasYearPrecision"
    FROM related WHERE relation<>'outside' GROUP BY currency,${key},relation
    ORDER BY currency,key NULLS FIRST,relation LIMIT 1001`,
  };
}

type AggregateRow = Omit<
  SpendingBucket,
  | 'pricedItemCount'
  | 'unknownPriceCount'
  | 'notSpendingCount'
  | 'explicitZeroCount'
  | 'knownDateCount'
  | 'unknownDateCount'
  | 'totalItemCount'
> & {
  pricedItemCount: string;
  unknownPriceCount: string;
  notSpendingCount: string;
  explicitZeroCount: string;
  knownDateCount: string;
  unknownDateCount: string;
  totalItemCount: string;
  hasYearPrecision: boolean;
};
const countKeys = [
  'pricedItemCount',
  'unknownPriceCount',
  'notSpendingCount',
  'explicitZeroCount',
  'knownDateCount',
  'unknownDateCount',
  'totalItemCount',
] as const;
@Injectable()
export class SpendingService {
  constructor(private readonly repo: ItemsRepository) {}
  async report(owner: string, input: SpendingQueryDto): Promise<SpendingReport> {
    const q = normalizeSpendingQuery(input);
    return this.repo.transaction(owner, async (c) => {
      if (q.categoryId) {
        const result = await c.query<{ valid: boolean }>(
          `SELECT
          EXISTS(SELECT 1 FROM categories WHERE owner_id=$1 AND id=$2) AND
          ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM subcategories WHERE owner_id=$1 AND category_id=$2 AND id=$3)) AS valid`,
          [owner, q.categoryId, q.subcategoryId ?? null],
        );
        if (!result.rows[0]?.valid) invalid();
      }
      const query = spendingSql(owner, q);
      const { rows } = await c.query<AggregateRow>(query.text, query.values);
      if (rows.length > 1000) throw new BadRequestException('SPENDING_BUCKET_LIMIT');
      if (q.grouping === 'month' && rows.some((r) => r.hasYearPrecision))
        throw new BadRequestException('SPENDING_PRECISION_UNREPRESENTABLE');
      const buckets = rows.map((row) => {
        if (BigInt(row.netMinor) < 0n) throw new Error('Spending invariant violated');
        const bucket = { ...row };
        Reflect.deleteProperty(bucket, 'hasYearPrecision');
        const counts = Object.fromEntries(
          countKeys.map((k) => {
            const n = Number(row[k]);
            if (!Number.isSafeInteger(n) || n < 0) throw new Error('Spending count out of range');
            return [k, n];
          }),
        ) as Pick<SpendingBucket, (typeof countKeys)[number]>;
        return { ...bucket, ...counts };
      });
      return {
        scope: q.scope,
        grouping: q.grouping ?? 'overall',
        basis: 'purchase-date',
        purchasedFrom: q.purchasedFrom ?? null,
        purchasedTo: q.purchasedTo ?? null,
        buckets,
      };
    });
  }
}
