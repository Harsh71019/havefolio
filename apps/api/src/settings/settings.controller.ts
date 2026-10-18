import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { AuthService } from '../auth/auth.service.js';
import {
  AuthSessionSummaryDto,
  OwnerPreferencesDto,
  RevokeSessionsResponseDto,
  SettingsOverviewDto,
  UpdateOwnerPreferencesDto,
} from './settings.dto.js';
import { SettingsService } from './settings.service.js';

@ApiTags('settings')
@ApiCookieAuth('ownerSession')
@ApiUnauthorizedResponse({ description: 'AUTH_REQUIRED: valid owner session required.' })
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Get settings overview including preferences, active sessions, privacy info and demo status.',
  })
  @ApiOkResponse({ type: SettingsOverviewDto })
  async getOverview(@CurrentOwner() owner: OwnerContext): Promise<SettingsOverviewDto> {
    return this.settingsService.getOverview(owner);
  }

  @Get('preferences')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get owner preferences (currency, notification channels, revision).',
  })
  @ApiOkResponse({ type: OwnerPreferencesDto })
  async getPreferences(@CurrentOwner() owner: OwnerContext): Promise<OwnerPreferencesDto> {
    return this.settingsService.getPreferences(owner.id);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update owner preferences with optimistic concurrency control.',
  })
  @ApiOkResponse({ type: OwnerPreferencesDto })
  @ApiConflictResponse({ description: 'STALE_SETTINGS_REVISION: reload preferences first.' })
  @ApiBadRequestResponse({ description: 'INVALID_SETTINGS_CURRENCY or INVALID_REQUEST.' })
  async updatePreferences(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: UpdateOwnerPreferencesDto,
  ): Promise<OwnerPreferencesDto> {
    return this.settingsService.updatePreferences(owner, input);
  }

  @Patch('preferences')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update owner preferences with optimistic concurrency control (alias route).',
  })
  @ApiOkResponse({ type: OwnerPreferencesDto })
  @ApiConflictResponse({ description: 'STALE_SETTINGS_REVISION: reload preferences first.' })
  @ApiBadRequestResponse({ description: 'INVALID_SETTINGS_CURRENCY or INVALID_REQUEST.' })
  async updatePreferencesAlias(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: UpdateOwnerPreferencesDto,
  ): Promise<OwnerPreferencesDto> {
    return this.settingsService.updatePreferences(owner, input);
  }

  @Get('sessions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List active sessions for the current owner.' })
  @ApiOkResponse({ type: [AuthSessionSummaryDto] })
  async listSessions(@CurrentOwner() owner: OwnerContext): Promise<AuthSessionSummaryDto[]> {
    return this.authService.listSessions(owner);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Revoke a specific active session.' })
  @ApiNoContentResponse({ description: 'Session revoked successfully.' })
  @ApiBadRequestResponse({ description: 'CANNOT_REVOKE_CURRENT_SESSION: use logout instead.' })
  @ApiNotFoundResponse({ description: 'SESSION_NOT_FOUND' })
  async revokeSession(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.authService.revokeSession(owner, sessionId);
  }

  @Delete('sessions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Revoke all other active sessions except the current session.' })
  @ApiOkResponse({ type: RevokeSessionsResponseDto })
  async revokeOtherSessions(
    @CurrentOwner() owner: OwnerContext,
  ): Promise<RevokeSessionsResponseDto> {
    return this.authService.revokeOtherSessions(owner);
  }
}
