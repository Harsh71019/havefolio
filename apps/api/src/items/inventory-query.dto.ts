import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from './items.dto.js';
import {
  inventorySorts,
  unknownModes,
  datePrecisions,
  itemFrequencies,
  itemStatuses,
  normalizeInventorySearch,
} from '@havefolio/contracts';
export class ItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'NFKC, collapsed whitespace, case-insensitive whole-word AND matching in name/brand/model, or one tag. No stemming or substring matching.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeInventorySearch(value) : value,
  )
  @IsString()
  @Length(0, 200)
  q?: string;
  @ApiPropertyOptional({ enum: inventorySorts, default: 'id' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(inventorySorts)
  sort?: (typeof inventorySorts)[number];
  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description:
      'Default asc for id/name/oldest/price; desc for newest/updated. id only supports asc; oldest only asc; newest/updated only desc.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Requires matching categoryId.' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  subcategoryId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  tagId?: string;
  @ApiPropertyOptional({ enum: itemStatuses })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(itemStatuses)
  ownershipStatus?: (typeof itemStatuses)[number];
  @ApiPropertyOptional({ enum: itemFrequencies })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(itemFrequencies)
  useFrequency?: (typeof itemFrequencies)[number];
  @ApiPropertyOptional({ enum: unknownModes, default: 'include' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(unknownModes)
  priceKnown?: (typeof unknownModes)[number];
  @ApiPropertyOptional({ enum: unknownModes, default: 'include' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(unknownModes)
  dateKnown?: (typeof unknownModes)[number];
  @ApiPropertyOptional({ enum: datePrecisions })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(datePrecisions)
  datePrecision?: (typeof datePrecisions)[number];
  @ApiPropertyOptional({
    pattern: '^[A-Z]{3}$',
    description: 'Required for price sort/range; scopes unknown prices to this currency too.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @ApiPropertyOptional({
    type: String,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description: 'Inclusive integer minor units; requires currency.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  priceMin?: string;
  @ApiPropertyOptional({
    type: String,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description: 'Inclusive integer minor units; requires currency.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  priceMax?: string;
  @ApiPropertyOptional({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description:
      'Inclusive earliest date. Approximate purchase intervals overlap the range; use exact precision for exact-age results. Unknown inclusion follows dateKnown.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  purchasedFrom?: string;
  @ApiPropertyOptional({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description:
      'Inclusive latest purchase date. Age is represented as a fixed purchase-date range, never invented dates.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  purchasedTo?: string;
}
