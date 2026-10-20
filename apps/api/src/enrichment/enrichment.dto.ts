import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { EnrichmentField, EnrichmentRequest, EnrichmentReview } from '@havefolio/contracts';
export class EnrichmentRequestDto implements EnrichmentRequest {
  @ApiProperty({ format: 'uuid' }) @IsUUID() commandId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revision!: number;
  @ApiProperty({ enum: ['name', 'url', 'barcode', 'photo', 'receipt'] })
  @IsIn(['name', 'url', 'barcode', 'photo', 'receipt'])
  kind!: EnrichmentRequest['kind'];
  @ApiPropertyOptional({
    maxLength: 64,
    description: 'Only for barcode input; never looked up by this boundary.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^[0-9A-Za-z -]{1,64}$/)
  barcode?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Ready original attachment belonging to this item; no content is transmitted.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  attachmentId?: string;
}
export class EnrichmentReviewDto implements EnrichmentReview {
  @ApiProperty({ format: 'uuid' }) @IsUUID() commandId!: string;
  @ApiProperty({
    minimum: 1,
    description: 'Current item revision; includes prior review decisions.',
  })
  @IsInt()
  @Min(1)
  revision!: number;
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,80}$/)
  candidateId!: string;
  @ApiProperty({ enum: ['name', 'brand', 'model', 'description'] })
  @IsIn(['name', 'brand', 'model', 'description'])
  field!: EnrichmentField;
  @ApiProperty({ enum: ['accept', 'reject', 'correct'] })
  @IsIn(['accept', 'reject', 'correct'])
  decision!: EnrichmentReview['decision'];
  @ApiPropertyOptional({
    maxLength: 5000,
    description: 'Required only for correct; name/brand/model limited to 300.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 5000)
  value?: string;
}
export class EnrichmentPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Exclusive descending UUID cursor within this item.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  before?: string;
}
