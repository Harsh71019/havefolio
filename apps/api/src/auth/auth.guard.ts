import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { SessionCookieService } from './session-cookie.service.js';
import { PUBLIC_ROUTE, type OwnerRequest } from './auth.context.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly cookies: SessionCookieService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    // SameSite Strict plus basic origin enforcement. PER-37 adds comprehensive CSRF controls.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin &&
          request.headers.origin !==
            new URL(this.config.getOrThrow<string>('API_CORS_ORIGIN')).origin)
      )
        throw new ForbiddenException('REQUEST_ORIGIN_REJECTED');
    }
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const token = this.cookies.read(request);
    if (!token) throw new UnauthorizedException('AUTH_REQUIRED');
    request.owner = await this.auth.authenticate(token);
    return true;
  }
}
