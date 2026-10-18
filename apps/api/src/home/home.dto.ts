import { ApiProperty } from '@nestjs/swagger';
import type { HomeDesireEntry, HomeGoalEntry, HomeRediscoveryItem } from '@havefolio/contracts';
import { itemConditions } from '@havefolio/contracts';
import { ItemCoverDto, ItemListEntryDto } from '../items/items.dto.js';
import { SpendingReportDto } from '../items/spending.dto.js';

export class HomeInventoryDto {
  @ApiProperty({ minimum: 0, description: 'Currently owned genuine items; samples excluded.' })
  ownedCount!: number;
  @ApiProperty({ minimum: 0, description: 'Owned sample items, disclosed separately.' })
  sampleOwnedCount!: number;
}
export class HomeDesireEntryDto implements HomeDesireEntry {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['considering', 'waiting', 'ready_for_review'] })
  effectiveState!: HomeDesireEntry['effectiveState'];
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) reviewAt!: string | null;
}
export class HomeDesiresDto {
  @ApiProperty({ minimum: 0 }) activeCount!: number;
  @ApiProperty({ minimum: 0 }) readyForReviewCount!: number;
  @ApiProperty({ type: [HomeDesireEntryDto], maxItems: 3, description: 'Newest first.' })
  items!: HomeDesireEntryDto[];
}
export class HomeGoalEntryDto implements HomeGoalEntry {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String }) targetMinor!: string;
  @ApiProperty({
    type: String,
    description: 'Sum of effective confirmed contributions only; may exceed target.',
  })
  progressMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) targetDate!: string | null;
}
export class HomeGoalsDto {
  @ApiProperty({ minimum: 0 }) activeCount!: number;
  @ApiProperty({
    type: [HomeGoalEntryDto],
    maxItems: 3,
    description: 'Active goals, nearest target date first, then undated.',
  })
  items!: HomeGoalEntryDto[];
}
export class HomeRediscoveryItemDto implements HomeRediscoveryItem {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: itemConditions }) condition!: HomeRediscoveryItem['condition'];
  @ApiProperty({ enum: ['rarely', 'never'] }) useFrequency!: HomeRediscoveryItem['useFrequency'];
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastUsedAt!: string | null;
  @ApiProperty({ type: ItemCoverDto, nullable: true }) cover!: ItemCoverDto | null;
}
export class HomeRediscoveryDto {
  @ApiProperty({ minimum: 0 }) eligibleCount!: number;
  @ApiProperty({
    type: HomeRediscoveryItemDto,
    nullable: true,
    description:
      'Owned genuine item, not broken or worn out, that the owner marked rarely or never used. Least recently recorded use first, then oldest record. Null when none is eligible.',
  })
  item!: HomeRediscoveryItemDto | null;
}
/** Wire shape of `HomeSummary` in @havefolio/contracts. */
export class HomeSummaryDto {
  @ApiProperty({ type: HomeInventoryDto }) inventory!: HomeInventoryDto;
  @ApiProperty({
    type: SpendingReportDto,
    description: 'The authoritative current-owned overall report, identical to GET /spending.',
  })
  spending!: SpendingReportDto;
  @ApiProperty({ type: [ItemListEntryDto], maxItems: 4, description: 'Newest owned items.' })
  recentItems!: ItemListEntryDto[];
  @ApiProperty({ type: HomeDesiresDto }) desires!: HomeDesiresDto;
  @ApiProperty({ type: HomeGoalsDto }) goals!: HomeGoalsDto;
  @ApiProperty({ type: HomeRediscoveryDto }) rediscovery!: HomeRediscoveryDto;
}
