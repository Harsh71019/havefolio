import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  matchRelevanceValues,
  matchSources,
  itemStatuses,
  itemConditions,
  itemFrequencies,
  type MatchRelevance,
  type MatchSource,
  type DesireMatchItemSummary,
  type DesireMatchHints,
  type DesireMatch,
  type ItemStatus,
  type ItemCondition,
  type ItemFrequency,
  type ItemCoverSummary,
} from '@havefolio/contracts';

export class CreateDesireMatchDto {
  @ApiProperty({
    description: 'UUID of the owned inventory item to match with the desire.',
    example: 'd9b3297a-9a91-4cf1-8c43-bf5db5a1e8e2',
  })
  @IsUUID('4')
  itemId!: string;

  @ApiPropertyOptional({
    description:
      'Plain-language explanation for why this item was matched as a potential alternative. Max 1000 characters.',
    example: 'Serves the same daily purpose for brewing coffee at home.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @IsString()
  @Length(1, 1000)
  reason?: string;

  @ApiPropertyOptional({
    enum: matchRelevanceValues,
    description: 'Initial relevance feedback. Defaults to relevant.',
    example: 'relevant',
  })
  @IsOptional()
  @IsIn(matchRelevanceValues)
  relevance?: MatchRelevance;
}

export class PatchDesireMatchDto {
  @ApiPropertyOptional({
    description:
      'Updated plain-language explanation for why this item was matched. Max 1000 characters.',
    example: 'Good backup option for work travel.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @IsString()
  @Length(1, 1000)
  reason?: string;

  @ApiPropertyOptional({
    enum: matchRelevanceValues,
    description: 'Relevance feedback indicating whether this possession is relevant or irrelevant.',
    example: 'irrelevant',
  })
  @IsOptional()
  @IsIn(matchRelevanceValues)
  relevance?: MatchRelevance;
}

export class MatchCandidatesQueryDto {
  @ApiPropertyOptional({
    description: 'Search text to match item name, brand, model, or tags.',
    example: 'headphones',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter candidates by category UUID.',
    example: 'd9b3297a-9a91-4cf1-8c43-bf5db5a1e8e2',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Whether to include sold, disposed, lost, donated, returned or worn-out items. Defaults to false (only owned items that are not worn out).',
    example: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeUnavailable?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 50,
    default: 20,
    description: 'Number of candidates to return per page.',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque pagination cursor from nextCursor.',
  })
  @IsOptional()
  @IsString()
  after?: string;
}

export class MatchesQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 50,
    default: 20,
    description: 'Number of matches to return per page.',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque pagination cursor from nextCursor.',
  })
  @IsOptional()
  @IsString()
  after?: string;
}

export class DesireMatchHintsDto implements DesireMatchHints {
  @ApiProperty({ type: String, nullable: true })
  categoryHint!: string | null;

  @ApiProperty({ type: String, nullable: true })
  usageHint!: string | null;

  @ApiProperty({ type: String, nullable: true })
  conditionHint!: string | null;

  @ApiProperty({ type: [String] })
  traitHints!: string[];
}

export class DesireMatchItemSummaryDto implements DesireMatchItemSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  brand!: string | null;

  @ApiProperty({ type: String, nullable: true })
  model!: string | null;

  @ApiProperty({ enum: itemStatuses })
  ownershipStatus!: ItemStatus;

  @ApiProperty({ enum: itemConditions })
  condition!: ItemCondition;

  @ApiProperty({ enum: itemFrequencies })
  useFrequency!: ItemFrequency;

  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  categoryName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  subcategoryId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  subcategoryName!: string | null;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty({ nullable: true })
  cover!: ItemCoverSummary | null;

  @ApiProperty({
    description: 'True if ownershipStatus is owned. False for sold, disposed, lost, etc.',
  })
  isUsableAlternative!: boolean;
}

export class DesireMatchDto implements DesireMatch {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  desireId!: string;

  @ApiProperty()
  itemId!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ enum: matchRelevanceValues })
  relevance!: MatchRelevance;

  @ApiProperty({ enum: matchSources })
  source!: MatchSource;

  @ApiProperty({ type: DesireMatchItemSummaryDto })
  item!: DesireMatchItemSummaryDto;

  @ApiProperty({ type: DesireMatchHintsDto })
  hints!: DesireMatchHintsDto;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DesireMatchesPageDto {
  @ApiProperty({ type: [DesireMatchDto] })
  items!: DesireMatchDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty()
  totalCount!: number;
}

export class MatchCandidateItemDto extends DesireMatchItemSummaryDto {
  @ApiProperty({
    description: 'True if already matched to this desire.',
  })
  isAlreadyMatched!: boolean;

  @ApiProperty({
    description: 'Plain-language suggested reason explaining potential relevance.',
  })
  suggestedReason!: string;

  @ApiProperty({ type: DesireMatchHintsDto })
  hints!: DesireMatchHintsDto;
}

export class MatchCandidatesPageDto {
  @ApiProperty({ type: [MatchCandidateItemDto] })
  items!: MatchCandidateItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
