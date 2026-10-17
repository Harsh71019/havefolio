import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Max,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  reviewOutcomes,
  type ReviewOutcome,
  type ReviewEvent,
  type ReviewHistoryPage,
} from '@havefolio/contracts';

export class CreateReviewDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Stable client command UUID. Retry the identical body with the same UUID.',
  })
  @IsUUID()
  commandId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revision!: number;
  @ApiProperty({ enum: reviewOutcomes }) @IsIn(reviewOutcomes) outcome!: ReviewOutcome;
  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsString()
  @Length(1, 2000)
  note?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required for used_owned; optional for bought. Must currently belong to this owner.',
  })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsUUID()
  linkedItemId?: string;
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Required future review date for delayed; forbidden for other outcomes.',
  })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  reviewAt?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Correct the current event explicitly. Stale corrections return 409.',
  })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsUUID()
  supersedesEventId?: string;
}
export class ReviewsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 2, description: 'Exclusive sequence cursor from nextBefore.' })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(2147483647)
  before?: number;
}
export class ReviewEventDto implements ReviewEvent {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty({ enum: reviewOutcomes }) outcome!: ReviewOutcome;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) linkedItemId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when the linked item is unavailable. No historical item name snapshot.',
  })
  linkedItemName!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) reviewAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) supersedesEventId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Historical estimate snapshot in integer minor units. Never sum event snapshots.',
  })
  estimatedNotSpentMinor!: string | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
}
export class ReviewHistoryPageDto implements ReviewHistoryPage {
  @ApiProperty({ type: [ReviewEventDto] }) items!: ReviewEventDto[];
  @ApiProperty({ type: Number, nullable: true }) nextBefore!: number | null;
  @ApiProperty({ type: String, nullable: true }) currentEventId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Single effective estimate for this desire; null if current decision is not declined or amount is unknown. Not savings.',
  })
  estimatedNotSpentMinor!: string | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
}
