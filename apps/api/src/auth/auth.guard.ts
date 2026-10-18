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
  private isAllowedOrigin(origin: string): boolean {
    if (!origin || origin === 'null') return false;
    try {
      const canonical = new URL(this.config.getOrThrow<string>('API_CORS_ORIGIN')).origin;
      if (origin === canonical) return true;
      const lanOrigin = this.config.get<string>('AUTH_LAN_HTTP_ORIGIN');
      if (lanOrigin && origin === lanOrigin) return true;
    } catch {
      return false;
    }
    return false;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    // SameSite Strict plus comprehensive origin & CSRF enforcement.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        request.headers['sec-fetch-mode'] === 'navigate' ||
        request.headers['sec-fetch-mode'] === 'nested-navigate'
      ) {
        throw new ForbiddenException('REQUEST_ORIGIN_REJECTED');
      }
      if (request.headers.origin) {
        if (!this.isAllowedOrigin(request.headers.origin)) {
          throw new ForbiddenException('REQUEST_ORIGIN_REJECTED');
        }
      } else if (request.headers.referer) {
        try {
          const refererOrigin = new URL(request.headers.referer).origin;
          if (!this.isAllowedOrigin(refererOrigin)) {
            throw new ForbiddenException('REQUEST_ORIGIN_REJECTED');
          }
        } catch {
          throw new ForbiddenException('REQUEST_ORIGIN_REJECTED');
        }
      }
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
