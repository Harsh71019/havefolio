import { BadRequestException, Injectable } from '@nestjs/common';
import { isCurrencyCode } from '@havefolio/domain';
import { EventLogger } from '@havefolio/logging';
import { AuthService } from '../auth/auth.service.js';
import { ReminderQueueService } from '../notifications/reminder-queue.service.js';
import type { OwnerContext } from '../auth/auth.context.js';
import {
  OwnerPreferencesDto,
  PrivacyExplanationDto,
  SettingsOverviewDto,
  UpdateOwnerPreferencesDto,
} from './settings.dto.js';
import { SettingsRepository } from './settings.repository.js';

@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly auth: AuthService,
    private readonly reminderQueue: ReminderQueueService,
    private readonly logger: EventLogger,
  ) {}

  async getPreferences(ownerId: string): Promise<OwnerPreferencesDto> {
    return this.repository.readPreferences(ownerId);
  }

  async updatePreferences(
    owner: OwnerContext,
    input: UpdateOwnerPreferencesDto,
  ): Promise<OwnerPreferencesDto> {
    if (input.defaultCurrency !== undefined && !isCurrencyCode(input.defaultCurrency)) {
      throw new BadRequestException('INVALID_SETTINGS_CURRENCY');
    }

    const { preferences, changedInApp } = await this.repository.updatePreferences(
      owner.id,
      input.revision,
      {
        defaultCurrency: input.defaultCurrency,
        notifyInApp: input.notifyInApp,
        notifyNtfy: input.notifyNtfy,
      },
    );

    // If in-app notifications preference changed, reconcile queued BullMQ jobs
    if (changedInApp) {
      const active = await this.repository.listActiveReminders(owner.id);
      if (preferences.notifyInApp) {
        const future = active.filter((r) => r.scheduledFor.getTime() > Date.now());
        await this.reminderQueue.reenqueueForOwner(future);
      } else {
        await this.reminderQueue.cancelForOwner(active);
      }
    }

    this.logger.emit('info', {
      event: 'settings_updated',
      component: 'settings',
      operation: 'update_preferences',
      currencyChanged: input.defaultCurrency !== undefined,
      notifyInAppChanged: input.notifyInApp !== undefined,
      notifyNtfyChanged: input.notifyNtfy !== undefined,
    });

    return preferences;
  }

  async getOverview(owner: OwnerContext): Promise<SettingsOverviewDto> {
    const [preferences, sessions, lockStatus, demoStatus] = await Promise.all([
      this.repository.readPreferences(owner.id),
      this.auth.listSessions(owner),
      this.auth.getRegistrationLockStatus(),
      this.repository.getDemoStatus(owner.id),
    ]);

    const privacy: PrivacyExplanationDto = {
      storageType: 'authenticated_cloudinary',
      storageDescription:
        'Item photos, receipts, and warranties are securely stored in private authenticated storage folders. Files are not accessible through public Cloudinary URLs or public CDN links.',
      accessType: 'authenticated_proxy',
      accessDescription:
        'Media is served only through authenticated Havefolio API proxy routes with short-lived session access. Uploads are stripped of unneeded metadata and restricted to your authenticated owner session.',
      publicSharing: false,
      sharingDescription:
        'Havefolio is a personal inventory and decision aid. It has no marketplace, public storefront, public links, discovery feeds, or third-party tracking.',
      registrationLock: lockStatus,
    };

    return {
      preferences,
      sessions,
      privacy,
      demoStatus,
    };
  }
}
