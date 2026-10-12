import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsString, Length, ValidateIf, ValidateNested } from 'class-validator';
import { acquisitions, RevisionDto, statuses } from './items.dto.js';

const amountDescription =
  'Integer minor units as a decimal string ("50000" is ₹500.00 in INR), 1 to 9223372036854775807. Numbers, fractions and grouping are rejected; beyond the bound returns UNSAFE_MONEY_VALUE.';
const noteDescription =
  'Optional private, neutral note (1–1000 characters after trimming; empty clears). Never logged or sent to telemetry.';

/**
 * Exact, month-only, year-only or unknown calendar date. Shape checks only here; the shared
 * domain value object returns INVALID_DATE_PRECISION or INVALID_CALENDAR_DATE.
 */
export class RefundDateDto {
  @ApiProperty({ enum: ['exact', 'month', 'year', 'unknown'] })
  @IsString()
  @Length(1, 16)
  precision!: string;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 9999 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  year?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 12 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  month?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 31 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  day?: number | null;
}

export class RecordRefundDto extends RevisionDto {
  @ApiProperty({ type: String, pattern: '^[1-9][0-9]{0,18}$', description: amountDescription })
  @IsString()
  @Length(1, 40)
  amountMinor!: string;
  @ApiProperty({
    pattern: '^[A-Z]{3}$',
    example: 'INR',
    description:
      'Must equal the item purchase currency (CURRENCY_MISMATCH otherwise). Never converted.',
  })
  @IsString()
  @Length(3, 3)
  currency!: string;
  @ApiPropertyOptional({
    type: RefundDateDto,
    description: 'When the refund was received. Omitted means unknown; never defaults to today.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => RefundDateDto)
  refundDate?: RefundDateDto;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 1000,
    description: noteDescription,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 2000)
  note?: string | null;
}

/** Corrects one refund. Omitted fields are unchanged; at least one field is required. */
export class CorrectRefundDto extends RevisionDto {
  @ApiPropertyOptional({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description: amountDescription,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 40)
  amountMinor?: string;
  @ApiPropertyOptional({
    pattern: '^[A-Z]{3}$',
    description: 'Optional confirmation; must equal the purchase currency.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(3, 3)
  currency?: string;
  @ApiPropertyOptional({ type: RefundDateDto })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => RefundDateDto)
  refundDate?: RefundDateDto;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 1000,
    description: noteDescription,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 2000)
  note?: string | null;
}

export class RefundDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, description: 'Positive integer minor units as a decimal string.' })
  amountMinor!: string;
  @ApiProperty({ description: 'ISO 4217; always the purchase currency.' }) currency!: string;
  @ApiProperty({ type: RefundDateDto }) refundDate!: RefundDateDto;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class RefundTotalsDto {
  @ApiProperty({ description: 'Purchase currency shared by every amount below.' })
  currency!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Historical amount paid, unchanged by refunds. null is not recorded; "0" is an explicit zero.',
  })
  amountPaidMinor!: string | null;
  @ApiProperty({ type: String, description: 'Sum of confirmed refunds; "0" when none.' })
  refundedMinor!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Net recorded spend: amount paid minus refunds; never negative. null when the amount paid is not recorded. Not a current or resale value.',
  })
  netMinor!: string | null;
}

export class ItemRefundsDto {
  @ApiProperty({
    minimum: 1,
    maximum: 2147483647,
    description: 'Item revision; send it with the next refund change.',
  })
  revision!: number;
  @ApiProperty({
    enum: statuses,
    description: 'Shown for context only; refunds never change ownership or vice versa.',
  })
  ownershipStatus!: (typeof statuses)[number];
  @ApiProperty({ enum: acquisitions }) acquisitionType!: (typeof acquisitions)[number];
  @ApiProperty({ type: RefundTotalsDto }) totals!: RefundTotalsDto;
  @ApiProperty({ type: [RefundDto], maxItems: 50, description: 'Oldest first; at most 50.' })
  refunds!: RefundDto[];
}
