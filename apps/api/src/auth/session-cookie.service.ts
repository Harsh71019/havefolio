import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class SessionCookieService {
  readonly name: string;
  private readonly options: CookieOptions;
  private readonly lanOrigin: string | undefined;
  private readonly lanName = 'havefolio_lan_session';
  constructor(private readonly config: ConfigService) {
    const secure = config.get<string>('NODE_ENV') === 'production';
    this.name = secure ? '__Host-havefolio_session' : 'havefolio_session';
    this.lanOrigin = config.get<string>('AUTH_LAN_HTTP_ORIGIN');
    this.options = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  }
  read(request: Request): string | undefined {
    const header = request.headers.cookie;
    if (!header) return undefined;
    if (header.length > 8192) throw new UnauthorizedException('AUTH_REQUIRED');
    const values = header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => {
        const name = part.split('=')[0];
        return name === this.name || (Boolean(this.lanOrigin) && name === this.lanName);
      });
    if (!values.length) return undefined;
    const token = values[0]?.slice(values[0].indexOf('=') + 1);
    if (
      values.length !== 1 ||
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      Buffer.from(token, 'base64url').toString('base64url') !== token
    )
      throw new UnauthorizedException('AUTH_REQUIRED');
    return token;
  }
  private cookieOptions(request?: Request): { name: string; options: CookieOptions } {
    // The guard admits this exact Origin before any credential or session write.
    // Never infer HTTP opt-in from forwarded headers or a caller-provided cookie.
    if (this.lanOrigin && request?.headers.origin === this.lanOrigin)
      return { name: this.lanName, options: { ...this.options, secure: false } };
    return { name: this.name, options: this.options };
  }
  write(response: Response, token: string, request?: Request): void {
    const { name, options } = this.cookieOptions(request);
    response.cookie(name, token, {
      ...options,
      maxAge: this.config.getOrThrow<number>('AUTH_SESSION_ABSOLUTE_SECONDS') * 1000,
    });
  }
  clear(response: Response, request?: Request): void {
    const { name, options } = this.cookieOptions(request);
    response.clearCookie(name, options);
  }
}
