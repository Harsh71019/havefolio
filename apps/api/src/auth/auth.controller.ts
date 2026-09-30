import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiCreatedResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentOwner, Public, type OwnerContext } from './auth.context.js';
import { CredentialsDto, OwnerResponseDto } from './auth.dto.js';
import { SessionCookieService } from './session-cookie.service.js';

@ApiTags('auth')
@ApiServiceUnavailableResponse({
  description: 'Authentication dependency unavailable; retry later.',
})
@ApiForbiddenResponse({ description: 'Registration unavailable or request origin rejected.' })
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookieService,
  ) {}
  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Create the initial owner when explicitly enabled; establishes a session.',
  })
  @ApiCreatedResponse({ type: OwnerResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid credentials format.' })
  @ApiTooManyRequestsResponse({ description: 'Authentication attempt limit exceeded.' })
  async register(
    @Body() input: CredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OwnerResponseDto> {
    const result = await this.auth.register(
      input,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    this.cookies.write(response, result.token);
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.publicOwner(result.owner);
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify credentials and rotate the presented owner session.' })
  @ApiOkResponse({ type: OwnerResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid credentials format.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or malformed session cookie.' })
  @ApiTooManyRequestsResponse({ description: 'Authentication attempt limit exceeded.' })
  async login(
    @Body() input: CredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OwnerResponseDto> {
    const result = await this.auth.login(
      input,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      this.cookies.read(request),
    );
    this.cookies.write(response, result.token);
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.publicOwner(result.owner);
  }
  @Get('me')
  @ApiCookieAuth('ownerSession')
  @ApiOperation({ summary: 'Get the current owner after checking and touching the session.' })
  @ApiOkResponse({ type: OwnerResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session.' })
  me(
    @CurrentOwner() owner: OwnerContext,
    @Res({ passthrough: true }) response: Response,
  ): OwnerResponseDto {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.publicOwner(owner);
  }
  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth('ownerSession')
  @ApiOperation({ summary: 'Revoke the current session and clear its cookie.' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session.' })
  async logout(
    @CurrentOwner() owner: OwnerContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(owner, false);
    this.cookies.clear(response);
  }
  @Post('logout-all')
  @HttpCode(204)
  @ApiCookieAuth('ownerSession')
  @ApiOperation({
    summary: 'Revoke every owner session, including this one, and clear the cookie.',
  })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session.' })
  async logoutAll(
    @CurrentOwner() owner: OwnerContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(owner, true);
    this.cookies.clear(response);
  }
}
