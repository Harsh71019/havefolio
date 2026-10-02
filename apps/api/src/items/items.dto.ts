import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
export const statuses = ['owned', 'sold', 'donated', 'disposed', 'lost', 'returned'] as const;
export const conditions = ['working', 'needs_repair', 'broken', 'unknown'] as const;
export const frequencies = ['often', 'sometimes', 'rarely', 'never', 'unknown'] as const;
export const acquisitions = ['bought', 'gift', 'secondhand', 'other', 'unknown'] as const;
export class PurchaseDateDto {
  @ApiProperty({ enum: ['exact', 'month', 'year', 'unknown'] })
  @IsIn(['exact', 'month', 'year', 'unknown'])
  precision!: string;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 9999 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(9999)
  year?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 12 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 31 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  day?: number | null;
}
export class CreateItemDto {
  @ApiProperty({ minLength: 1, maxLength: 300 })
  @IsString()
  @Length(1, 300)
  @Matches(/\S/u)
  name!: string;
  @ApiProperty({ enum: statuses }) @IsIn(statuses) ownershipStatus!: (typeof statuses)[number];
  @ApiProperty({
    description: 'Explicit ISO 4217 current or historical currency code; never inferred.',
    example: 'INR',
  })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description:
      'Integer minor units as decimal string, at most 9223372036854775807. null/omitted is unknown; "0" is explicit zero.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  pricePaidMinor?: string | null;
  @ApiPropertyOptional({
    type: PurchaseDateDto,
    description:
      'Omitted means unknown. Calendar components must match precision; no date is fabricated.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => PurchaseDateDto)
  purchaseDate?: PurchaseDateDto;
  @ApiPropertyOptional({ enum: acquisitions })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(acquisitions)
  acquisitionType?: (typeof acquisitions)[number];
  @ApiPropertyOptional({ enum: conditions })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(conditions)
  condition?: (typeof conditions)[number];
  @ApiPropertyOptional({ enum: frequencies })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(frequencies)
  useFrequency?: (typeof frequencies)[number];
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID()
  categoryId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID()
  subcategoryId?: string | null;
  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 300)
  brand?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 300)
  model?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 5000)
  description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 10000)
  notes?: string | null;
  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description: 'Private user-entered object, maximum 16 KiB serialized.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsObject()
  specifications?: Record<string, unknown> | null;
}
export class RevisionDto {
  @ApiProperty({
    minimum: 1,
    maximum: 2147483646,
    description: 'Last-seen item revision. Stale mutations return 409.',
  })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  revision!: number;
}
// Ownership is changed exclusively through a history-appending action.
export class UpdateItemDto extends PartialType(
  OmitType(CreateItemDto, ['ownershipStatus'] as const),
  { skipNullProperties: false },
) {
  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  revision!: number;
}
export class ItemActionDto extends RevisionDto {
  @ApiProperty({ enum: ['ownership_changed', 'used', 'repaired'] })
  @IsIn(['ownership_changed', 'used', 'repaired'])
  action!: 'ownership_changed' | 'used' | 'repaired';
  @ApiPropertyOptional({ enum: statuses, description: 'Required only for ownership_changed.' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(statuses)
  ownershipStatus?: (typeof statuses)[number];
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Occurrence time; omitted uses the time the explicit action is recorded.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Length(20, 35)
  occurredAt?: string;
  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(0, 2000)
  note?: string;
}
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({
    description:
      'Opaque versioned inventory cursor. History accepts the last event UUID of the previous chronological page.',
    maxLength: 2048,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 2048)
  after?: string;
}
export class ItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minLength: 1, maxLength: 300 }) name!: string;
  @ApiProperty({ enum: statuses }) ownershipStatus!: (typeof statuses)[number];
  @ApiProperty({ description: 'Explicit ISO 4217 purchase currency.' }) currency!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Integer minor units as decimal string; null is unknown, "0" is explicit zero.',
  })
  pricePaidMinor!: string | null;
  @ApiProperty({ type: PurchaseDateDto }) purchaseDate!: PurchaseDateDto;
  @ApiProperty({ enum: acquisitions }) acquisitionType!: (typeof acquisitions)[number];
  @ApiProperty({ enum: conditions }) condition!: (typeof conditions)[number];
  @ApiProperty({ enum: frequencies }) useFrequency!: (typeof frequencies)[number];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) categoryId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) subcategoryId!: string | null;
  @ApiProperty({ type: [String] }) tagIds!: string[];
  @ApiProperty({ type: String, nullable: true }) brand!: string | null;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: Object, nullable: true }) specifications!: Record<string, unknown> | null;
  @ApiProperty({ minimum: 1, maximum: 2147483647 }) revision!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({
    type: Object,
    description: 'Immutable original manual input, separate from corrected current fields.',
  })
  originalEntry!: Record<string, unknown>;
  @ApiProperty({ enum: ['manual', 'url', 'barcode', 'photo', 'receipt', 'import'] })
  originalSource!: string;
}
/** Current cover summary for browse cards; never contains provider identifiers or URLs. */
export class ItemCoverDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Ready photo original ID for authenticated content.',
  })
  photoId!: string;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty({ type: String, nullable: true }) altText!: string | null;
  @ApiProperty() decorative!: boolean;
}
export class ItemListEntryDto extends OmitType(ItemDto, [
  'description',
  'notes',
  'specifications',
  'originalEntry',
  'originalSource',
] as const) {
  @ApiProperty({
    type: ItemCoverDto,
    nullable: true,
    description:
      'Ready original cover metadata. Resolve thumbnail through authenticated item-photo API; never a provider URL.',
  })
  cover!: ItemCoverDto | null;
}
export class ItemsPageDto {
  @ApiProperty({ type: [ItemListEntryDto] }) items!: ItemListEntryDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 2048,
    description:
      'Version 1 encrypted sort tuple; expires after seven days. Encrypted and unique ID; bound to owner, filters, sort and limit. Live view; moved records can appear again or disappear between requests. Deleted anchors remain usable.',
  })
  nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class ItemEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: [
      'created',
      'details_updated',
      'ownership_changed',
      'condition_changed',
      'usage_changed',
      'used',
      'repaired',
      'refund_recorded',
      'refund_corrected',
      'refund_deleted',
      'correction',
    ],
  })
  eventType!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    type: Object,
    description: 'Immutable action metadata and user provenance; private to the owner.',
  })
  metadata!: Record<string, unknown>;
}
export class EventsPageDto {
  @ApiProperty({ type: [ItemEventDto] }) events!: ItemEventDto[];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class ItemErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() error!: string;
}
