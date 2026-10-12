import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  approximateDate,
  parseMinorUnits,
  refundLimits,
  refundTotals,
  toDateComponents,
  toMinorUnitsString,
  unknownDate,
  type ApproximateDate,
  type Money,
  type RefundTotals,
} from '@havefolio/domain';
import { domain, refundConstraintException } from './financial-errors.js';
import type {
  CorrectRefundDto,
  ItemRefundsDto,
  RecordRefundDto,
  RefundDto,
} from './item-refunds.dto.js';
import type { ItemDto } from './items.dto.js';
import { ItemsRepository } from './items.repository.js';

interface PurchaseRow {
  revision: number;
  currency: string;
  price_paid_minor: string | null;
  acquisition_type: ItemDto['acquisitionType'];
  ownership_status: ItemDto['ownershipStatus'];
}
interface RefundRow {
  id: string;
  currency: string;
  amount_minor: string;
  refund_date_precision: string;
  refund_year: number | null;
  refund_month: number | null;
  refund_day: number | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Neutral private note: trimmed, empty clears, bounded. */
function note(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  const trimmed = value.trim();
  if (trimmed.length > refundLimits.maxNoteLength) throw new BadRequestException('INVALID_REFUND');
  return trimmed || null;
}

/**
 * Explicit refunds against an owned item's historical purchase. The purchase amount is never
 * changed here, and refunds are never inferred from (nor cause) ownership changes. Every write
 * holds the owner lock and the item row lock, requires the last-seen item revision, advances it,
 * and appends owner-private history without the note.
 */
@Injectable()
export class ItemRefundsService {
  constructor(private readonly repository: ItemsRepository) {}

  private async purchase(
    c: PoolClient,
    owner: string,
    item: string,
    revision?: number,
  ): Promise<PurchaseRow> {
    const row = (
      await c.query<PurchaseRow>(
        'SELECT revision,currency,price_paid_minor,acquisition_type,ownership_status FROM items WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [owner, item],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('ITEM_NOT_FOUND');
    if (revision !== undefined && row.revision !== revision)
      throw new ConflictException('STALE_ITEM_REVISION');
    return row;
  }

  private async refunds(c: PoolClient, owner: string, item: string): Promise<RefundRow[]> {
    return (
      await c.query<RefundRow>(
        'SELECT id,currency,amount_minor,refund_date_precision,refund_year,refund_month,refund_day,note,created_at,updated_at FROM item_refunds WHERE owner_id=$1 AND item_id=$2 ORDER BY created_at,id LIMIT $3',
        [owner, item, refundLimits.maxRefundsPerItem + 1],
      )
    ).rows;
  }

  private totals(
    purchase: PurchaseRow,
    refunds: { currency: string; amount_minor: string }[],
  ): RefundTotals {
    return domain(() =>
      refundTotals(
        {
          currency: purchase.currency,
          pricePaidMinor: purchase.price_paid_minor,
          acquisitionType: purchase.acquisition_type,
        },
        refunds.map((r) => ({ currency: r.currency, amountMinor: r.amount_minor })),
      ),
    );
  }

  private async snapshot(c: PoolClient, owner: string, item: string): Promise<ItemRefundsDto> {
    const purchase = await this.purchase(c, owner, item);
    const rows = await this.refunds(c, owner, item);
    const totals = this.totals(purchase, rows);
    const minor = (value: Money | null): string | null => value && toMinorUnitsString(value);
    return {
      revision: purchase.revision,
      ownershipStatus: purchase.ownership_status,
      acquisitionType: purchase.acquisition_type,
      totals: {
        currency: purchase.currency,
        amountPaidMinor: minor(totals.paid),
        refundedMinor: toMinorUnitsString(totals.refunded),
        netMinor: minor(totals.net),
      },
      refunds: rows.map((r): RefundDto => ({
        id: r.id,
        amountMinor: r.amount_minor,
        currency: r.currency,
        refundDate: {
          precision: r.refund_date_precision,
          year: r.refund_year,
          month: r.refund_month,
          day: r.refund_day,
        },
        note: r.note,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    };
  }

  private async advance(
    c: PoolClient,
    owner: string,
    item: string,
    revision: number,
    event: 'refund_recorded' | 'refund_corrected' | 'refund_deleted',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const updated = await c.query(
      'UPDATE items SET revision=revision+1 WHERE owner_id=$1 AND id=$2 AND revision=$3',
      [owner, item, revision],
    );
    if (updated.rowCount !== 1) throw new ConflictException('STALE_ITEM_REVISION');
    // Amounts are owner-private history; the free-text note is deliberately excluded.
    await c.query(
      'INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at,metadata) VALUES($1,$2,$3,clock_timestamp(),$4)',
      [owner, item, event, { source: 'user', revision: revision + 1, ...metadata }],
    );
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw refundConstraintException(error) ?? error;
    }
  }

  list(owner: string, item: string): Promise<ItemRefundsDto> {
    return this.repository.transaction(owner, (c) => this.snapshot(c, owner, item));
  }

  async record(owner: string, item: string, input: RecordRefundDto): Promise<ItemRefundsDto> {
    const amount = domain(() => parseMinorUnits(input.amountMinor, input.currency));
    const date = domain(() =>
      input.refundDate === undefined ? unknownDate : approximateDate(input.refundDate),
    );
    const text = note(input.note) ?? null;
    return this.repository.transaction(owner, async (c) => {
      const purchase = await this.purchase(c, owner, item, input.revision);
      if (amount.currency !== purchase.currency) throw new ConflictException('CURRENCY_MISMATCH');
      const existing = await this.refunds(c, owner, item);
      this.totals(purchase, [
        ...existing,
        { currency: amount.currency, amount_minor: toMinorUnitsString(amount) },
      ]);
      const parts = toDateComponents(date);
      const id = await this.write(
        async () =>
          (
            await c.query<{ id: string }>(
              'INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor,refund_date_precision,refund_year,refund_month,refund_day,note) VALUES($1,$2,$3,$4::bigint,$5,$6,$7,$8,$9) RETURNING id',
              [
                owner,
                item,
                amount.currency,
                toMinorUnitsString(amount),
                parts.precision,
                parts.year,
                parts.month,
                parts.day,
                text,
              ],
            )
          ).rows[0]!.id,
      );
      await this.advance(c, owner, item, input.revision, 'refund_recorded', {
        refundId: id,
        amountMinor: toMinorUnitsString(amount),
        currency: amount.currency,
      });
      return this.snapshot(c, owner, item);
    });
  }

  async correct(
    owner: string,
    item: string,
    refund: string,
    input: CorrectRefundDto,
  ): Promise<ItemRefundsDto> {
    const fields = (['amountMinor', 'currency', 'refundDate', 'note'] as const).filter(
      (key) => input[key] !== undefined,
    );
    if (!fields.length) throw new BadRequestException('INVALID_REFUND');
    if (!uuid.test(refund)) throw new NotFoundException('REFUND_NOT_FOUND');
    const date: ApproximateDate | undefined =
      input.refundDate === undefined ? undefined : domain(() => approximateDate(input.refundDate!));
    const text = note(input.note);
    return this.repository.transaction(owner, async (c) => {
      const purchase = await this.purchase(c, owner, item, input.revision);
      if (input.currency !== undefined && input.currency !== purchase.currency)
        throw new ConflictException('CURRENCY_MISMATCH');
      const existing = await this.refunds(c, owner, item);
      const current = existing.find((r) => r.id === refund);
      if (!current) throw new NotFoundException('REFUND_NOT_FOUND');
      const amount =
        input.amountMinor === undefined
          ? current.amount_minor
          : toMinorUnitsString(domain(() => parseMinorUnits(input.amountMinor, purchase.currency)));
      this.totals(
        purchase,
        existing.map((r) => (r.id === refund ? { ...r, amount_minor: amount } : r)),
      );
      const parts = date ? toDateComponents(date) : undefined;
      await this.write(() =>
        c.query(
          `UPDATE item_refunds SET amount_minor=$4::bigint${parts ? ',refund_date_precision=$5,refund_year=$6,refund_month=$7,refund_day=$8' : ''}${text !== undefined ? `,note=$${parts ? 9 : 5}` : ''} WHERE owner_id=$1 AND item_id=$2 AND id=$3`,
          [
            owner,
            item,
            refund,
            amount,
            ...(parts ? [parts.precision, parts.year, parts.month, parts.day] : []),
            ...(text !== undefined ? [text] : []),
          ],
        ),
      );
      await this.advance(c, owner, item, input.revision, 'refund_corrected', {
        refundId: refund,
        fields,
        currency: purchase.currency,
        amountMinor: amount,
        ...(amount !== current.amount_minor ? { previousAmountMinor: current.amount_minor } : {}),
      });
      return this.snapshot(c, owner, item);
    });
  }

  async delete(
    owner: string,
    item: string,
    refund: string,
    revision: number,
  ): Promise<ItemRefundsDto> {
    if (!uuid.test(refund)) throw new NotFoundException('REFUND_NOT_FOUND');
    return this.repository.transaction(owner, async (c) => {
      const purchase = await this.purchase(c, owner, item, revision);
      const removed = (
        await c.query<{ amount_minor: string }>(
          'DELETE FROM item_refunds WHERE owner_id=$1 AND item_id=$2 AND id=$3 RETURNING amount_minor',
          [owner, item, refund],
        )
      ).rows[0];
      if (!removed) throw new NotFoundException('REFUND_NOT_FOUND');
      await this.advance(c, owner, item, revision, 'refund_deleted', {
        refundId: refund,
        currency: purchase.currency,
        amountMinor: removed.amount_minor,
      });
      return this.snapshot(c, owner, item);
    });
  }
}
