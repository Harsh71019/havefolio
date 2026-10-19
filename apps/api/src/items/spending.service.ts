import { spendingMembershipSql } from './spending-membership.js';
import { BadRequestException, Injectable } from '@nestjs/common';
import { isCurrencyCode, parseCalendarDay } from '@havefolio/domain';
import type {
  MerchantSpendingReport,
  MerchantSpendingRow,
  SpendingBucket,
  SpendingReport,
} from '@havefolio/contracts';
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
  if (!['overall', 'category', 'subcategory', 'year', 'month', 'merchant'].includes(grouping))
    invalid();
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
  const membership = spendingMembershipSql(q, bind);
  const isMerchant = q.grouping === 'merchant';
  const key = {
    overall: 'NULL::text',
    category: 'category_id::text',
    subcategory: 'subcategory_id::text',
    year: "lpad(purchase_year::text,4,'0')",
    month: "lpad(purchase_year::text,4,'0')||'-'||lpad(purchase_month::text,2,'0')",
    merchant: 's.merchant_id::text',
  }[q.grouping ?? 'overall'];
  const merchantJoin = isMerchant
    ? 'LEFT JOIN merchants m ON m.id=s.merchant_id AND m.owner_id=$1'
    : '';
  const merchantSelect = isMerchant
    ? "CASE WHEN s.merchant_id IS NOT NULL THEN jsonb_build_object('id',m.id::text,'displayName',m.display_name,'websiteHost',m.website_host,'state',m.state) ELSE NULL END AS merchant,"
    : 'NULL::jsonb AS merchant,';
  const groupBy = isMerchant
    ? 'GROUP BY currency,s.merchant_id,m.id,m.display_name,m.website_host,m.state,m.normalized_name,relation'
    : `GROUP BY currency,${key},relation`;
  const orderBy = isMerchant
    ? 'ORDER BY currency,(s.merchant_id IS NULL) ASC,m.normalized_name ASC NULLS LAST,relation'
    : `ORDER BY currency,${key} NULLS FIRST,relation`;

  return {
    values,
    text: `WITH ${membership}, refunds AS (
    SELECT r.item_id,sum(r.amount_minor) AS refunded FROM item_refunds r
      JOIN source s ON s.id=r.item_id AND s.owner_id=r.owner_id AND s.currency=r.currency
      WHERE r.owner_id=$1 GROUP BY r.item_id
  ) SELECT currency,${key} AS key,${merchantSelect}relation AS "dateBucket",
    coalesce(sum(price_paid_minor),0)::text AS "grossMinor",sum(coalesce(r.refunded,0::numeric))::text AS "refundedMinor",
    (coalesce(sum(price_paid_minor),0)-sum(coalesce(r.refunded,0::numeric)))::text AS "netMinor",
    count(*) FILTER (WHERE price_paid_minor IS NOT NULL)::text AS "pricedItemCount",
    count(*) FILTER (WHERE price_paid_minor IS NULL AND acquisition_type<>'gift')::text AS "unknownPriceCount",
    count(*) FILTER (WHERE price_paid_minor IS NULL AND acquisition_type='gift')::text AS "notSpendingCount",
    count(*) FILTER (WHERE price_paid_minor=0)::text AS "explicitZeroCount",
    count(*) FILTER (WHERE purchase_date_precision<>'unknown')::text AS "knownDateCount",
    count(*) FILTER (WHERE purchase_date_precision='unknown')::text AS "unknownDateCount",
    count(*) FILTER (WHERE s.merchant_id IS NULL)::text AS "missingMerchantCount",
    count(*)::text AS "totalItemCount",
    bool_or(purchase_date_precision='year') AS "hasYearPrecision"
    FROM related s ${merchantJoin} LEFT JOIN refunds r ON r.item_id=s.id WHERE relation<>'outside' ${groupBy}
    ${orderBy} LIMIT 1001`,
  };
}

/** PER-69: lifetime totals per merchant. Same membership and refund rules as spendingSql, but
 * all history with no date range, so every dated and unknown-date purchase belongs to one total. */
export function merchantSpendingSql(owner: string): { text: string; values: unknown[] } {
  const values: unknown[] = [owner];
  const bind = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  const membership = spendingMembershipSql({ scope: 'all-history' }, bind);
  return {
    values,
    text: `WITH ${membership}, refunds AS (
    SELECT r.item_id,sum(r.amount_minor) AS refunded FROM item_refunds r
      JOIN source s ON s.id=r.item_id AND s.owner_id=r.owner_id AND s.currency=r.currency
      WHERE r.owner_id=$1 GROUP BY r.item_id
  ), totals AS (
    SELECT currency,s.merchant_id,
      coalesce(sum(price_paid_minor),0) AS gross,sum(coalesce(r.refunded,0::numeric)) AS refunded,
      count(*) FILTER (WHERE price_paid_minor IS NOT NULL) AS priced,
      count(*) FILTER (WHERE price_paid_minor IS NULL AND acquisition_type<>'gift') AS unknown,
      count(*) AS total
    FROM related s LEFT JOIN refunds r ON r.item_id=s.id WHERE relation<>'outside'
    GROUP BY currency,s.merchant_id
  ) SELECT t.currency,
    CASE WHEN t.merchant_id IS NOT NULL THEN jsonb_build_object('id',m.id::text,'displayName',m.display_name,'websiteHost',m.website_host,'state',m.state) ELSE NULL END AS merchant,
    t.gross::text AS "grossMinor",t.refunded::text AS "refundedMinor",(t.gross-t.refunded)::text AS "netMinor",
    t.priced::text AS "pricedItemCount",t.unknown::text AS "unknownPriceCount",t.total::text AS "totalItemCount"
    FROM totals t LEFT JOIN merchants m ON m.id=t.merchant_id AND m.owner_id=$1
    ORDER BY t.currency,(t.gross-t.refunded) DESC,(t.merchant_id IS NULL) ASC,m.normalized_name ASC NULLS LAST
    LIMIT 1001`,
  };
}
type MerchantRow = Omit<
  MerchantSpendingRow,
  'pricedItemCount' | 'unknownPriceCount' | 'totalItemCount'
> & { pricedItemCount: string; unknownPriceCount: string; totalItemCount: string };

type AggregateRow = Omit<
  SpendingBucket,
  | 'pricedItemCount'
  | 'unknownPriceCount'
  | 'notSpendingCount'
  | 'explicitZeroCount'
  | 'knownDateCount'
  | 'unknownDateCount'
  | 'totalItemCount'
  | 'missingMerchantCount'
> & {
  pricedItemCount: string;
  unknownPriceCount: string;
  notSpendingCount: string;
  explicitZeroCount: string;
  knownDateCount: string;
  unknownDateCount: string;
  totalItemCount: string;
  missingMerchantCount: string;
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
  'missingMerchantCount',
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
      if (q.merchantId) {
        const result = await c.query<{ valid: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM merchants WHERE owner_id=$1 AND id=$2) AS valid`,
          [owner, q.merchantId],
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
        const counts = Object.fromEntries(
          countKeys.map((k) => {
            const n = Number(row[k]);
            if (!Number.isSafeInteger(n) || n < 0) throw new Error('Spending count out of range');
            return [k, n];
          }),
        ) as Pick<SpendingBucket, (typeof countKeys)[number]>;
        const result: SpendingBucket = {
          currency: row.currency,
          key: row.key,
          dateBucket: row.dateBucket,
          grossMinor: row.grossMinor,
          refundedMinor: row.refundedMinor,
          netMinor: row.netMinor,
          ...counts,
        };
        if (q.grouping === 'merchant') {
          result.merchant = row.merchant ?? null;
        }
        return result;
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
  async merchants(owner: string): Promise<MerchantSpendingReport> {
    return this.repo.transaction(owner, async (c) => {
      const query = merchantSpendingSql(owner);
      const { rows } = await c.query<MerchantRow>(query.text, query.values);
      if (rows.length > 1000) throw new BadRequestException('SPENDING_BUCKET_LIMIT');
      return {
        scope: 'all-history',
        rows: rows.map((row) => {
          if (BigInt(row.netMinor) < 0n) throw new Error('Spending invariant violated');
          const count = (value: string): number => {
            const n = Number(value);
            if (!Number.isSafeInteger(n) || n < 0) throw new Error('Spending count out of range');
            return n;
          };
          return {
            currency: row.currency,
            merchant: row.merchant ?? null,
            grossMinor: row.grossMinor,
            refundedMinor: row.refundedMinor,
            netMinor: row.netMinor,
            pricedItemCount: count(row.pricedItemCount),
            unknownPriceCount: count(row.unknownPriceCount),
            totalItemCount: count(row.totalItemCount),
          };
        }),
      };
    });
  }
}
