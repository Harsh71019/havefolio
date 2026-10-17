import { Controller, Get, Header, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import {
  NotificationDto,
  NotificationErrorDto,
  NotificationsPageDto,
  NotificationsQueryDto,
} from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({ type: NotificationErrorDto, description: 'INVALID_NOTIFICATION_CURSOR.' })
@ApiUnauthorizedResponse({ type: NotificationErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({ type: NotificationErrorDto, description: 'NOTIFICATION_NOT_FOUND.' })
@ApiServiceUnavailableResponse({
  type: NotificationErrorDto,
  description: 'NOTIFICATIONS_UNAVAILABLE.',
})
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List private in-app notifications for the signed-in owner.' })
  @ApiOkResponse({ type: NotificationsPageDto })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Query() query: NotificationsQueryDto,
  ): Promise<NotificationsPageDto> {
    return this.service.list(owner.id, query);
  }

  @Patch(':id/read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Mark one owner-scoped in-app notification as read.' })
  @ApiOkResponse({ type: NotificationDto })
  markRead(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDto> {
    return this.service.markRead(owner.id, id);
  }
}
