import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
export class PhotoOrderDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revision!: number;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 8 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  photoIds!: string[];
}
export class PhotoDescriptionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) revision!: number;
  @ApiProperty({
    description:
      'True only when the photo adds nothing beyond nearby text; alt text must be empty.',
  })
  @IsBoolean()
  decorative!: boolean;
  @ApiProperty({ type: String, nullable: true, maxLength: 250 })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(250)
  altText!: string | null;
}
export class PhotoDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() cover!: boolean;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty() byteSize!: number;
  @ApiProperty({ enum: ['image/webp'] }) mimeType!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Owner-supplied description.' })
  altText!: string | null;
  @ApiProperty({ description: 'Owner marked the photo as decorative (empty alternative).' })
  decorative!: boolean;
}
export class PhotoSnapshotDto {
  @ApiProperty() revision!: number;
  @ApiProperty({ type: [PhotoDto] }) photos!: PhotoDto[];
}
export class PhotoResultDto {
  @ApiProperty() index!: number;
  @ApiProperty({ required: false, type: PhotoDto }) photo?: PhotoDto;
  @ApiProperty({ required: false }) error?: string;
}
export class PhotoUploadDto {
  @ApiProperty({ type: [PhotoResultDto] }) results!: PhotoResultDto[];
}
