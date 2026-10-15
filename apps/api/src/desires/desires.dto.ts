import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  desireClassifications,
  desireStatuses,
  desireEffectiveStates,
  type DesireClassification,
  type DesireStatus,
  type DesireEffectiveState,
} from '@havefolio/contracts';

export {
  desireClassifications,
  desireStatuses,
  desireEffectiveStates,
  type DesireClassification,
  type DesireStatus,
  type DesireEffectiveState,
};

export class WaitingPeriodInputDto {
  @ApiProperty({
    description:
      'Target review date-time in ISO 8601 UTC format. Must be in the future and after startedAt.',
    example: '2026-11-16T12:00:00.000Z',
  })
  @IsString()
  @IsISO8601()
  reviewAt!: string;

  @ApiPropertyOptional({
    description:
      'Waiting started date-time in ISO 8601 UTC format. Defaults to current time when starting new wait; preserves existing start when revising.',
    example: '2026-10-16T12:00:00.000Z',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @IsISO8601()
  startedAt?: string;
}

export class CreateDesireDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 300,
    description: 'Visible trimmed name of the product or item being considered.',
    example: 'Espresso machine',
  })
  @IsString()
  @Length(1, 300)
  @Matches(/\S/u)
  name!: string;

  @ApiPropertyOptional({
    enum: desireClassifications,
    nullable: true,
    description: 'Optional self-reflection category: need, want, or greed. Never required.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsIn(desireClassifications)
  classification?: DesireClassification | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description:
      'Integer minor units as decimal string, at most 9223372036854775807. null/omitted is unknown; "0" is explicit zero. Never an actual purchase price or saved money.',
    example: '1499900',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  likelyPriceMinor?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^[A-Z]{3}$',
    description:
      'Explicit ISO 4217 currency code. Required if likelyPriceMinor is provided; never inferred or defaulted to INR.',
    example: 'INR',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2048,
    description: 'Optional HTTP/HTTPS product link. Never fetched server-side.',
    example: 'https://example.com/products/espresso-machine',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(1, 2048)
  productUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2000,
    description: 'Private optional reason for considering.',
    example: 'Looking to brew at home instead of daily cafes.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 2000)
  reason?: string | null;

  @ApiPropertyOptional({
    type: WaitingPeriodInputDto,
    nullable: true,
    description:
      'Optional waiting period. If provided with a future review time, starts desire in waiting state.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => WaitingPeriodInputDto)
  waitingPeriod?: WaitingPeriodInputDto | null;
}

export class PatchDesireDto {
  @ApiProperty({
    minimum: 1,
    description: 'Optimistic concurrency revision. Required for all updates.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  revision!: number;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 300,
    description: 'Updated visible trimmed name.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 300)
  @Matches(/\S/u)
  name?: string;

  @ApiPropertyOptional({
    enum: desireClassifications,
    nullable: true,
    description: 'Select, change or clear (null) classification.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsIn(desireClassifications)
  classification?: DesireClassification | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description:
      'Updated likely price in integer minor units. Send null with currency: null to clear.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  likelyPriceMinor?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^[A-Z]{3}$',
    description: 'Explicit ISO 4217 currency code. Required if likelyPriceMinor is provided.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2048,
    description: 'Update or clear (null) product link.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(1, 2048)
  productUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2000,
    description: 'Update or clear (null) private reason.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(0, 2000)
  reason?: string | null;

  @ApiPropertyOptional({
    type: WaitingPeriodInputDto,
    nullable: true,
    description:
      'Start, revise or cancel waiting period. Object with reviewAt starts or extends; null cancels; omitted preserves.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => WaitingPeriodInputDto)
  waitingPeriod?: WaitingPeriodInputDto | null;
}

export class DesiresQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque versioned desire cursor for keyset pagination.',
    maxLength: 2048,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 2048)
  after?: string;

  @ApiPropertyOptional({
    enum: desireStatuses,
    description: 'Filter by stored status: considering or waiting.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(desireStatuses)
  status?: DesireStatus;

  @ApiPropertyOptional({
    enum: desireEffectiveStates,
    description: 'Filter by effective state: considering, waiting, or ready_for_review.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(desireEffectiveStates)
  effectiveState?: DesireEffectiveState;

  @ApiPropertyOptional({
    enum: desireClassifications,
    description: 'Filter by self-reflection category.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(desireClassifications)
  classification?: DesireClassification;
}

export class DesirePhotoDto {
  @ApiProperty({ format: 'uuid', description: 'Original ready photo attachment ID.' })
  id!: string;

  @ApiProperty({ example: 1200 })
  width!: number;

  @ApiProperty({ example: 800 })
  height!: number;

  @ApiProperty({ example: 45020 })
  byteSize!: number;

  @ApiProperty({ enum: ['image/webp'] })
  mimeType!: 'image/webp';

  @ApiProperty({ type: String, nullable: true })
  altText!: string | null;

  @ApiProperty()
  decorative!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class DesireDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minLength: 1, maxLength: 300, example: 'Espresso machine' })
  name!: string;

  @ApiProperty({ enum: desireClassifications, nullable: true })
  classification!: DesireClassification | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Likely price in integer minor units as decimal string. null is unknown; "0" is explicit zero.',
    example: '1499900',
  })
  likelyPriceMinor!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'INR' })
  currency!: string | null;

  @ApiProperty({ type: String, nullable: true })
  productUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({
    enum: desireStatuses,
    description: 'Stored database status: considering or waiting.',
  })
  status!: DesireStatus;

  @ApiProperty({
    enum: desireEffectiveStates,
    description: 'Current derived effective state: considering, waiting, or ready_for_review.',
  })
  effectiveState!: DesireEffectiveState;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  waitingStartedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  reviewAt!: string | null;

  @ApiProperty({
    type: DesirePhotoDto,
    nullable: true,
    description:
      'Current primary photo summary. Authenticated image bytes served via /api/v1/desires/:id/photo/content/:variant; never raw provider URLs.',
  })
  photo!: DesirePhotoDto | null;

  @ApiProperty({ minimum: 1, example: 1 })
  revision!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DesiresPageDto {
  @ApiProperty({ type: [DesireDto] })
  items!: DesireDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 2048,
    description: 'Opaque versioned keyset cursor. null when there are no more items.',
  })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class DesireErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() error!: string;
}

export class RevisionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  revision!: number;
}
