import { ApiProperty } from '@nestjs/swagger';
export class DocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['receipt', 'warranty'] }) kind!: 'receipt' | 'warranty';
  @ApiProperty({ enum: ['application/pdf', 'image/webp'] }) mimeType!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty({ nullable: true, type: Number }) width!: number | null;
  @ApiProperty({ nullable: true, type: Number }) height!: number | null;
}
export class DocumentSnapshotDto {
  @ApiProperty() revision!: number;
  @ApiProperty({ type: [DocumentDto], maxItems: 16 }) documents!: DocumentDto[];
}
