import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import type { Merchant } from '@havefolio/contracts';
export class CreateMerchantDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  displayName!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 253,
    description: 'Optional host only, no path, credentials or query.',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Length(1, 253)
  websiteHost?: string | null;
}
export class UpdateMerchantDto extends PartialType(CreateMerchantDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ enum: ['active', 'retired'] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['active', 'retired'])
  state?: 'active' | 'retired';
}
export class MerchantsQueryDto {
  @ApiPropertyOptional({
    maxLength: 120,
    description: 'Normalized name prefix; private, never logged.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(0, 120)
  q?: string;
  @ApiPropertyOptional({ enum: ['active', 'retired', 'all'], default: 'active' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['active', 'retired', 'all'])
  state?: 'active' | 'retired' | 'all';
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 25 })
  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      'Encrypted keyset cursor bound to owner, prefix, state and limit; expires in seven days.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 2048)
  after?: string;
}
export class MerchantDto implements Merchant {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 120 }) displayName!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 253 }) websiteHost!: string | null;
  @ApiProperty({ enum: ['active', 'retired'] }) state!: 'active' | 'retired';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class MerchantsPageDto {
  @ApiProperty({ type: [MerchantDto] }) merchants!: MerchantDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
