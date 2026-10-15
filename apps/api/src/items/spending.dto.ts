import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { SpendingQuery, SpendingReport, SpendingBucket } from '@havefolio/contracts';

export class SpendingQueryDto implements SpendingQuery {
  @ApiProperty({ enum: ['current-owned', 'all-history'] })
  @IsIn(['current-owned', 'all-history'])
  scope!: SpendingQuery['scope'];
  @ApiPropertyOptional({
    enum: ['overall', 'category', 'subcategory', 'year', 'month'],
    default: 'overall',
  })
  @IsOptional()
  @IsIn(['overall', 'category', 'subcategory', 'year', 'month'])
  grouping?: NonNullable<SpendingQuery['grouping']>;
  @ApiPropertyOptional({ description: 'Original ISO 4217 currency; never converted.' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Requires categoryId; retired assignments are included.',
  })
  @IsOptional()
  @IsUUID()
  subcategoryId?: string;
  @ApiPropertyOptional({
    format: 'date',
    description: 'Inclusive purchase-date bound. Partial overlaps are disclosed separately.',
  })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  purchasedFrom?: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  purchasedTo?: string;
}
export class SpendingBucketDto implements SpendingBucket {
  @ApiProperty() currency!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Taxonomy UUID (null = unassigned), YYYY, YYYY-MM, or null for overall/unknown date. Month reports reject year-only purchases.',
  })
  key!: string | null;
  @ApiProperty({ enum: ['dated', 'spanningRange', 'unknownDate'] })
  dateBucket!: SpendingBucket['dateBucket'];
  @ApiProperty({
    pattern: '^[0-9]+$',
    description: 'Exact unbounded sum of recorded integer minor units as decimal string.',
  })
  grossMinor!: string;
  @ApiProperty({ pattern: '^[0-9]+$' }) refundedMinor!: string;
  @ApiProperty({ pattern: '^[0-9]+$' }) netMinor!: string;
  @ApiProperty({ minimum: 0 }) pricedItemCount!: number;
  @ApiProperty({ minimum: 0 }) unknownPriceCount!: number;
  @ApiProperty({ minimum: 0 }) notSpendingCount!: number;
  @ApiProperty({ minimum: 0 }) explicitZeroCount!: number;
  @ApiProperty({ minimum: 0 }) knownDateCount!: number;
  @ApiProperty({ minimum: 0 }) unknownDateCount!: number;
  @ApiProperty({ minimum: 0 }) totalItemCount!: number;
}
export class SpendingReportDto implements SpendingReport {
  @ApiProperty({ enum: ['current-owned', 'all-history'] }) scope!: SpendingReport['scope'];
  @ApiProperty({ enum: ['overall', 'category', 'subcategory', 'year', 'month'] })
  grouping!: SpendingReport['grouping'];
  @ApiProperty({ enum: ['purchase-date'] }) basis!: 'purchase-date';
  @ApiProperty({ type: String, nullable: true, format: 'date' }) purchasedFrom!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) purchasedTo!: string | null;
  @ApiProperty({
    type: [SpendingBucketDto],
    maxItems: 1000,
    description:
      'Separate currencies and date relations. Never sum spanningRange or unknownDate into a dated total. Empty inventory returns [].',
  })
  buckets!: SpendingBucketDto[];
}
