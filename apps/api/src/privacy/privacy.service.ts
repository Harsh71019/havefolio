import { ReminderQueueService } from '../notifications/reminder-queue.service.js';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivacyRepository } from './privacy.repository.js';
import { PasswordService } from '../auth/password.service.js';
import { AuthRateService } from '../auth/auth-rate.service.js';
import { hashToken } from '../auth/session-cookie.service.js';
import type { OwnerContext } from '../auth/auth.context.js';
import { PrivateMediaStorage } from '../media/storage.js';
import type { DeleteAccountDto, DeletionStatusDto } from './privacy.dto.js';

@Injectable()
export class PrivacyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private exporting = false;
  constructor(
    private readonly repository: PrivacyRepository,
    private readonly passwords: PasswordService,
    private readonly rate: AuthRateService,
    private readonly storage: PrivateMediaStorage,
    private readonly config: ConfigService,
    private readonly queue: ReminderQueueService,
  ) {}
  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async export(owner: OwnerContext): Promise<string> {
    if (this.exporting) throw new ServiceUnavailableException('EXPORT_BUSY');
    this.exporting = true;
    try {
      return await this.repository.export(owner);
    } finally {
      this.exporting = false;
    }
  }
  async delete(
    owner: OwnerContext,
    input: DeleteAccountDto,
    source: string,
  ): Promise<DeletionStatusDto> {
    await this.rate.check('delete', source, owner.email);
    const reminders = await this.repository.admit(owner, hashToken(input.receipt), (hash) =>
      this.passwords.verify(input.password, hash),
    );
    await this.queue.cancelForOwner(reminders);
    this.logger.log({ event: 'account_deletion_requested', component: 'privacy' });
    return this.repository.status(hashToken(input.receipt));
  }
  async status(receipt: string): Promise<DeletionStatusDto> {
    return this.repository.status(hashToken(receipt));
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.repository.reconcile(this.storage);
    } catch {
      this.logger.warn({
        event: 'account_deletion_retry',
        component: 'privacy',
        code: 'PRIVACY_UNAVAILABLE',
      });
    } finally {
      this.running = false;
    }
  }
}
