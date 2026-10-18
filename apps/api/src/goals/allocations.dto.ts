import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsUUID, Max, Min } from 'class-validator';
import type {
  DesireAllocationState,
  ConfirmDesireAllocationRequest,
  AllocationGoal,
} from '@havefolio/contracts';
import { ContributionDto } from './goals.dto.js';

export class ConfirmAllocationDto implements ConfirmDesireAllocationRequest {
  @ApiProperty({ format: 'uuid' }) @IsUUID() commandId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() reviewEventId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() goalId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483646) goalRevision!: number;
  @ApiProperty({
    enum: [true],
    description: 'Explicit owner confirmation; does not assert money moved.',
  })
  @Equals(true)
  confirmed!: true;
}
export class AllocationGoalDto implements AllocationGoal {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String }) targetMinor!: string;
  @ApiProperty({ type: String }) progressMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty() revision!: number;
}
export class AllocationDto {
  @ApiProperty({ format: 'uuid' }) sourceReviewEventId!: string;
  @ApiProperty() sourceChanged!: boolean;
  @ApiProperty({ type: AllocationGoalDto, nullable: true }) goal!: AllocationGoalDto | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) rootContributionId!: string | null;
  @ApiProperty({ type: ContributionDto, nullable: true })
  currentContribution!: ContributionDto | null;
}
export class AllocationStateDto implements DesireAllocationState {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) currentReviewEventId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) estimatedNotSpentMinor!: string | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
  @ApiProperty({ type: AllocationDto, nullable: true }) allocation!: AllocationDto | null;
}
