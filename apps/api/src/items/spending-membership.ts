import { spendingScopeStatuses } from '@havefolio/domain';
import type { SpendingQuery } from '@havefolio/contracts';

/** Shared owner/demo/scope/date membership for reports and bounded inventory drill-down.
 * bind is supplied by the calling query so every external value remains a SQL parameter. */
export function spendingMembershipSql(q: SpendingQuery, bind: (v: unknown) => string): string {
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
  return `source AS MATERIALIZED (
    SELECT i.id,i.owner_id,i.currency,i.price_paid_minor,i.acquisition_type,i.category_id,i.subcategory_id,
      i.purchase_date_precision,i.purchase_year,i.purchase_month,
      make_date(i.purchase_year,coalesce(i.purchase_month,1),coalesce(i.purchase_day,1)) AS first_day,
      CASE i.purchase_date_precision WHEN 'year' THEN make_date(i.purchase_year,12,31)
        WHEN 'month' THEN (make_date(i.purchase_year,i.purchase_month,1)+interval '1 month - 1 day')::date
        ELSE make_date(i.purchase_year,i.purchase_month,i.purchase_day) END AS last_day
    FROM items i WHERE ${clauses.join(' AND ')}
  ), related AS (
    SELECT s.*, CASE WHEN purchase_date_precision='unknown' THEN 'unknownDate'
        WHEN (${from}::date IS NULL OR first_day>=${from}::date) AND (${to}::date IS NULL OR last_day<=${to}::date) THEN 'dated'
        WHEN (${from}::date IS NULL OR last_day>=${from}::date) AND (${to}::date IS NULL OR first_day<=${to}::date) THEN 'spanningRange'
        ELSE 'outside' END AS relation FROM source s
  )`;
}
