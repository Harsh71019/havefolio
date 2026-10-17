import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { currencyCodes } from '@havefolio/domain';
export const goalErrorCodes = [
  'GOAL_NOT_FOUND',
  'CONTRIBUTION_NOT_FOUND',
  'STALE_GOAL_REVISION',
  'GOAL_CURRENCY_LOCKED',
  'GOAL_CURRENCY_MISMATCH',
  'GOAL_ARCHIVED',
  'CONTRIBUTION_COMMAND_REUSED',
  'CONTRIBUTION_ALREADY_CORRECTED',
  'INVALID_GOAL',
  'INVALID_CONTRIBUTION',
  'GOALS_UNAVAILABLE',
] as const;
export class GoalRevisionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483646) revision!: number;
}
export class CreateGoalDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @Length(1, 200) name!: string;
  @ApiProperty({
    type: String,
    pattern: '^(0|[1-9][0-9]{0,18})$',
    description: 'Exact integer minor units, at most PostgreSQL bigint maximum. Zero allowed.',
  })
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  targetMinor!: string;
  @ApiProperty({ enum: currencyCodes }) @IsIn(currencyCodes) currency!: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_, v: unknown) => v !== undefined && v !== null)
  @IsISO8601({ strict: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  targetDate?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf((_, v: unknown) => v !== undefined && v !== null)
  @IsString()
  @Length(1, 2000)
  notes?: string | null;
}
export class PatchGoalDto extends PartialType(CreateGoalDto, { skipNullProperties: false }) {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483646) revision!: number;
  @ApiPropertyOptional({ enum: ['active', 'completed', 'archived'] })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsIn(['active', 'completed', 'archived'])
  status?: 'active' | 'completed' | 'archived';
}
export class GoalsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Exclusive ID cursor. Stable ascending ID order.',
  })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsUUID()
  after?: string;
  @ApiPropertyOptional({ enum: ['active', 'completed', 'archived'] })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsIn(['active', 'completed', 'archived'])
  status?: string;
}
export class ContributionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 2 })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(2147483647)
  before?: number;
}
export class CreateContributionDto extends GoalRevisionDto {
  @ApiProperty({ format: 'uuid', description: 'Stable command UUID for identical retries.' })
  @IsUUID()
  commandId!: string;
  @ApiProperty({ enum: ['contribution', 'correction', 'reversal'] })
  @IsIn(['contribution', 'correction', 'reversal'])
  kind!: 'contribution' | 'correction' | 'reversal';
  @ApiProperty({
    type: String,
    description: 'Positive confirmed amount; correction is replacement amount, reversal is zero.',
  })
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  amountMinor!: string;
  @ApiProperty({ enum: currencyCodes }) @IsIn(currencyCodes) currency!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsUUID()
  supersedesId?: string;
  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsString()
  @Length(1, 2000)
  note?: string;
}
export class GoalDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String }) targetMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) targetDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ enum: ['active', 'completed', 'archived'] }) status!: string;
  @ApiProperty() revision!: number;
  @ApiProperty({
    type: String,
    description: 'Sum of effective confirmed contributions only; may exceed target.',
  })
  progressMinor!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class ContributionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sequence!: number;
  @ApiProperty({ enum: ['contribution', 'correction', 'reversal'] }) kind!: string;
  @ApiProperty({ type: String }) amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) supersedesId!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class GoalsPageDto {
  @ApiProperty({ type: [GoalDto] }) items!: GoalDto[];
  @ApiProperty({ type: String, nullable: true }) nextAfter!: string | null;
}
export class ContributionsPageDto {
  @ApiProperty({ type: [ContributionDto] }) items!: ContributionDto[];
  @ApiProperty({ type: Number, nullable: true }) nextBefore!: number | null;
}

export class GoalErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() error!: string;
}
