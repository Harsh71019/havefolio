import type { Notification, NotificationsPage, NotificationType } from '@havefolio/contracts';
import { notificationTypes } from '@havefolio/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

export class NotificationDto implements Notification {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: notificationTypes })
  type!: NotificationType;

  @ApiProperty({ format: 'uuid' })
  desireId!: string;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationsPageDto implements NotificationsPage {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ minimum: 0 })
  unreadCount!: number;
}

export class NotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 2048, description: 'Opaque notification cursor.' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 2048)
  after?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['true', 'false'])
  unreadOnly?: 'true' | 'false';
}

export class NotificationErrorDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'NOTIFICATION_NOT_FOUND' })
  message!: string;

  @ApiProperty({ example: 'Not Found' })
  error!: string;
}
