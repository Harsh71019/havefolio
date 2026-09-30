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
  constructor(private readonly config: ConfigService) {
    const secure = config.get<string>('NODE_ENV') === 'production';
    this.name = secure ? '__Host-havefolio_session' : 'havefolio_session';
    this.options = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  }
  read(request: Request): string | undefined {
    const header = request.headers.cookie;
    if (!header) return undefined;
    if (header.length > 8192) throw new UnauthorizedException('AUTH_REQUIRED');
    const values = header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.split('=')[0] === this.name);
    if (!values.length) return undefined;
    const token = values[0]?.slice(this.name.length + 1);
    if (
      values.length !== 1 ||
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      Buffer.from(token, 'base64url').toString('base64url') !== token
    )
      throw new UnauthorizedException('AUTH_REQUIRED');
    return token;
  }
  write(response: Response, token: string): void {
    response.cookie(this.name, token, {
      ...this.options,
      maxAge: this.config.getOrThrow<number>('AUTH_SESSION_ABSOLUTE_SECONDS') * 1000,
    });
  }
  clear(response: Response): void {
    response.clearCookie(this.name, this.options);
  }
}
