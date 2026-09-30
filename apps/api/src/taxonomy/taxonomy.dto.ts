import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class TaxonomyNameDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  @Matches(/\S/u)
  name!: string;
}
export class TagNameDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @Length(1, 80)
  @Matches(/\S/u)
  name!: string;
}
export class CreateSubcategoryDto extends TaxonomyNameDto {
  @ApiProperty({ format: 'uuid', description: 'Active root category owned by this session.' })
  @IsUUID()
  categoryId!: string;
}
export class UpdateTaxonomyDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Matches(/\S/u)
  name?: string;
  @ApiPropertyOptional({ description: 'Retirement preserves existing item classifications.' })
  @IsOptional()
  @IsBoolean()
  retired?: boolean;
}
export class ReorderTaxonomyDto {
  @ApiProperty({
    type: [String],
    maxItems: 500,
    description: 'Complete sibling list, including retired entries, in desired order.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids!: string[];
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required for subcategory ordering; not accepted for root ordering.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
export class DeleteCategoryDto {
  @ApiPropertyOptional({
    description: 'Explicit consent to delete child subcategories after any item reassignment.',
  })
  @IsOptional()
  @IsBoolean()
  removeSubcategories?: boolean;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required when in use. Active same-owner root (or sibling subcategory) replacement.',
  })
  @IsOptional()
  @IsUUID()
  replacementId?: string;
}
export class DeleteTagDto {
  @ApiProperty({
    description: 'Explicit consent to remove item/tag relationships; items are preserved.',
  })
  @IsBoolean()
  removeRelationships!: boolean;
}
export class TaxonomyEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() position!: number;
  @ApiProperty() isDemo!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) retiredAt!: string | null;
  @ApiProperty() itemCount!: number;
}
export class SubcategoryEntryDto extends TaxonomyEntryDto {
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
}
export class TagEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() itemCount!: number;
}
export class TaxonomySnapshotDto {
  @ApiProperty({ type: [TaxonomyEntryDto] }) categories!: TaxonomyEntryDto[];
  @ApiProperty({ type: [SubcategoryEntryDto] }) subcategories!: SubcategoryEntryDto[];
  @ApiProperty({ type: [TagEntryDto] }) tags!: TagEntryDto[];
  @ApiProperty() defaultsSeeded!: boolean;
}
