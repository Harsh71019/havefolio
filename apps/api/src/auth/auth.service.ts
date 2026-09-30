import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { AuthRateService } from './auth-rate.service.js';
import { hashToken, newToken } from './session-cookie.service.js';
import { normalizeEmail, type CredentialsDto, type OwnerResponseDto } from './auth.dto.js';
import type { OwnerContext } from './auth.context.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly repository: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly rate: AuthRateService,
  ) {}
  private event(event: string): void {
    this.logger.log(JSON.stringify({ event, domain: 'auth' }));
  }
  publicOwner(owner: OwnerContext): OwnerResponseDto {
    return { id: owner.id, email: owner.email, displayName: owner.displayName };
  }
  async register(
    input: CredentialsDto,
    source: string,
  ): Promise<{ owner: OwnerContext; token: string }> {
    const email = normalizeEmail(input.email);
    await this.rate.check('register', source, email);
    if (!this.config.get<boolean>('AUTH_REGISTRATION_ENABLED', false))
      throw new ForbiddenException('REGISTRATION_UNAVAILABLE');
    const passwordHash = await this.passwords.hash(input.password);
    const token = newToken();
    const owner = await this.repository.register(email, passwordHash, hashToken(token));
    this.event('owner_registered');
    return { owner, token };
  }
  async login(
    input: CredentialsDto,
    source: string,
    previousToken?: string,
  ): Promise<{ owner: OwnerContext; token: string }> {
    const email = normalizeEmail(input.email);
    await this.rate.check('login', source, email);
    const owner = await this.repository.findByEmail(email);
    const valid = await this.passwords.verify(input.password, owner?.passwordHash ?? null);
    if (!owner || !valid) {
      this.event('login_rejected');
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    const upgrade = this.passwords.needsUpgrade(owner.passwordHash)
      ? await this.passwords.upgrade(input.password, owner.passwordHash)
      : undefined;
    const token = newToken();
    const context = await this.repository.login(
      owner,
      hashToken(token),
      previousToken ? hashToken(previousToken) : undefined,
      upgrade,
    );
    this.event(upgrade ? 'login_hash_upgraded' : 'login_succeeded');
    return { owner: context, token };
  }
  async authenticate(token: string): Promise<OwnerContext> {
    const owner = await this.repository.authenticate(hashToken(token));
    if (!owner) throw new UnauthorizedException('AUTH_REQUIRED');
    return owner;
  }
  async logout(owner: OwnerContext, all: boolean): Promise<void> {
    await this.repository.logout(owner, all);
    this.event(all ? 'all_sessions_revoked' : 'session_revoked');
  }
}
