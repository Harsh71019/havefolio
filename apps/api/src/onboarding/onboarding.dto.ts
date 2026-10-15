import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { OnboardingAction, OnboardingState, OnboardingStatus } from '@havefolio/contracts';
export class OnboardingActionDto {
  @ApiProperty({ enum: ['start', 'skip', 'complete', 'revisit', 'browse_store', 'review_item'] })
  @IsIn(['start', 'skip', 'complete', 'revisit', 'browse_store', 'review_item'])
  action!: OnboardingAction;
}
export class OnboardingStatusDto implements OnboardingStatus {
  @ApiProperty({ enum: ['not_started', 'active', 'skipped', 'completed'] }) state!: OnboardingState;
  @ApiProperty({ minimum: 0 }) genuineItemCount!: number;
  @ApiProperty({ minimum: 0, maximum: 6 }) demoItemCount!: number;
  @ApiProperty() browsedStore!: boolean;
  @ApiProperty() reviewedItem!: boolean;
  @ApiProperty() triedDemo!: boolean;
  @ApiProperty() removedDemo!: boolean;
}
