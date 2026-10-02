import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Min,
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
export class PhotoDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() cover!: boolean;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
  @ApiProperty() byteSize!: number;
  @ApiProperty({ enum: ['image/webp'] }) mimeType!: string;
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
