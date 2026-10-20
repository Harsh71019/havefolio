import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  conversionPhotoStates,
  type ConversionPhotoState,
  type DesireConversion,
  type DesireConversionEligibility,
  type DesireConversionState,
  type DesireConversionSuggestions,
} from '@havefolio/contracts';
import {
  CreateItemDto,
  PurchaseDateDto,
  acquisitions,
  conditions,
  frequencies,
} from '../items/items.dto.js';
import { DesirePhotoDto } from './desires.dto.js';

export class ConfirmedPricePaidDto {
  @ApiProperty({
    enum: ['known', 'unknown'],
    description:
      'Explicit confirmation of the actual price paid. "unknown" stores no amount; it is never inferred from the likely price.',
  })
  @IsIn(['known', 'unknown'])
  state!: 'known' | 'unknown';
  @ApiPropertyOptional({
    type: String,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description:
      'Required only when state is "known": integer minor units as a decimal string, at most 9223372036854775807. "0" is an explicit zero.',
  })
  @ValidateIf((o: ConfirmedPricePaidDto, v) => o.state === 'known' || v !== undefined)
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  minor?: string;
}

/** Confirmed item facts. Only bounded current item-contract fields; no merchant/source (PER-56). */
export class ConvertDesireItemDto extends OmitType(CreateItemDto, [
  'pricePaidMinor',
  'purchaseDate',
  'acquisitionType',
  'condition',
  'useFrequency',
  'description',
  'specifications',
  'commandId',
] as const) {
  @ApiProperty({ type: ConfirmedPricePaidDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ConfirmedPricePaidDto)
  pricePaid!: ConfirmedPricePaidDto;
  @ApiProperty({
    type: PurchaseDateDto,
    description:
      'Required explicit precision; "unknown" is allowed. Components must match precision; no day is invented.',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PurchaseDateDto)
  purchaseDate!: PurchaseDateDto;
  @ApiProperty({ enum: acquisitions, description: 'Required; "gift" keeps PER-20 gift semantics.' })
  @IsIn(acquisitions)
  acquisitionType!: (typeof acquisitions)[number];
  @ApiProperty({ enum: conditions })
  @IsIn(conditions)
  condition!: (typeof conditions)[number];
  @ApiProperty({ enum: frequencies })
  @IsIn(frequencies)
  useFrequency!: (typeof frequencies)[number];
}

export class ConvertDesireDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Stable client command UUID. Retry the identical body with the same UUID.',
  })
  @IsUUID()
  commandId!: string;
  @ApiProperty({
    format: 'uuid',
    description: 'The current effective bought review event being confirmed. Stale values 409.',
  })
  @IsUUID()
  boughtEventId!: string;
  @ApiProperty({
    description:
      'Copy the desire photo into new private item media. The desire photo is always preserved.',
  })
  @IsBoolean()
  copyPhoto!: boolean;
  @ApiProperty({ type: ConvertDesireItemDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ConvertDesireItemDto)
  item!: ConvertDesireItemDto;
}

export class DesireConversionDto implements DesireConversion {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) desireId!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ description: 'Current item name.' }) itemName!: string;
  @ApiProperty({ format: 'uuid' }) boughtEventId!: string;
  @ApiProperty({
    description:
      'False when a later review correction replaced the bought outcome. The item is retained.',
  })
  boughtOutcomeCurrent!: boolean;
  @ApiProperty({
    enum: conversionPhotoStates,
    description:
      'pending: copy not finished (resume with POST …/conversion/photo); unavailable: source photo was gone.',
  })
  photo!: ConversionPhotoState;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class DesireConversionSuggestionsDto implements DesireConversionSuggestions {
  @ApiProperty({ description: 'Copied suggestion; not a confirmed item fact.' }) name!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Copied from the desire reason.' })
  notes!: string | null;
  @ApiProperty({ type: String, nullable: true }) productUrl!: string | null;
  @ApiProperty({ type: DesirePhotoDto, nullable: true }) photo!: DesirePhotoDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Reference only. Never used as the actual price paid.',
  })
  likelyPriceMinor!: string | null;
  @ApiProperty({ type: String, nullable: true }) likelyCurrency!: string | null;
}

export class DesireConversionStateDto implements DesireConversionState {
  @ApiProperty({ format: 'uuid' }) desireId!: string;
  @ApiProperty({ enum: ['eligible', 'converted', 'not_bought'] })
  eligibility!: DesireConversionEligibility;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) boughtEventId!: string | null;
  @ApiProperty({ type: DesireConversionSuggestionsDto })
  suggestions!: DesireConversionSuggestionsDto;
  @ApiProperty({ type: DesireConversionDto, nullable: true })
  conversion!: DesireConversionDto | null;
}
