import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentOwner, Public, type OwnerContext } from '../auth/auth.context.js';
import { PrivacyService } from './privacy.service.js';
import { DeleteAccountDto, DeletionReceiptDto, DeletionStatusDto } from './privacy.dto.js';

@ApiTags('privacy')
@ApiBadRequestResponse({
  description: 'INVALID_REQUEST: invalid confirmation, password or status receipt.',
})
@ApiServiceUnavailableResponse({ description: 'PRIVACY_UNAVAILABLE or EXPORT_BUSY; retry later.' })
@Controller({ path: 'privacy', version: '1' })
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get('export')
  @ApiCookieAuth('ownerSession')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="havefolio-private-export.json"')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary:
      'Download complete owner-scoped JSON, attachment metadata only. No stored artifact or delivery URL.',
  })
  @ApiProduces('application/json')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        format: { type: 'string' },
        version: { type: 'integer' },
        exportedAt: { type: 'string', format: 'date-time' },
        attachments: { type: 'string', enum: ['metadata_only'] },
        money: { type: 'string' },
        data: { type: 'object', additionalProperties: true },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'AUTH_REQUIRED' })
  @ApiResponse({
    status: 413,
    description: 'EXPORT_TOO_LARGE: export exceeds 16 MiB; no truncated export is returned.',
  })
  export(@CurrentOwner() owner: OwnerContext): Promise<string> {
    return this.privacy.export(owner);
  }
  @Post('deletion')
  @HttpCode(202)
  @ApiCookieAuth('ownerSession')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Verify password now and confirm irreversible deletion. Revokes all normal sessions; client must save its receipt before submission.',
  })
  @ApiResponse({ status: 202, type: DeletionStatusDto })
  @ApiUnauthorizedResponse({ description: 'AUTH_REQUIRED or INVALID_CREDENTIALS' })
  @ApiTooManyRequestsResponse({ description: 'AUTH_RATE_LIMITED' })
  delete(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: DeleteAccountDto,
    @Req() request: Request,
  ): Promise<DeletionStatusDto> {
    return this.privacy.delete(
      owner,
      input,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
  }
  @Public()
  @Post('deletion-status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Inspect deletion using a 256-bit status-only receipt in the body. Cannot authenticate, export, cancel or mutate an account. Completed receipts expire after 30 days.',
  })
  @ApiOkResponse({ type: DeletionStatusDto })
  @ApiNotFoundResponse({ description: 'DELETION_NOT_FOUND' })
  status(@Body() input: DeletionReceiptDto): Promise<DeletionStatusDto> {
    return this.privacy.status(input.receipt);
  }
}
