import { describe, beforeEach, expect, it, jest } from '@jest/globals';
import { BadRequestException, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EventLogger } from '@havefolio/logging';
import { AuthService } from '../auth/auth.service.js';
import { ReminderQueueService } from '../notifications/reminder-queue.service.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SettingsController } from './settings.controller.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';
import type { OwnerContext } from '../auth/auth.context.js';
import type { OwnerPreferencesDto } from './settings.dto.js';

describe('SettingsService (PER-34)', () => {
  let service: SettingsService;

  const mockOwner: OwnerContext = {
    id: 'owner-uuid-1',
    email: 'owner@example.test',
    displayName: null,
    sessionId: 'session-uuid-1',
  };

  const defaultPreferences: OwnerPreferencesDto = {
    defaultCurrency: 'INR',
    notifyInApp: true,
    notifyNtfy: true,
    revision: 1,
    updatedAt: '2026-10-18T10:00:00.000Z',
  };

  const repository = {
    readPreferences: jest.fn<SettingsRepository['readPreferences']>(),
    updatePreferences: jest.fn<SettingsRepository['updatePreferences']>(),
    getDemoStatus: jest.fn<SettingsRepository['getDemoStatus']>(),
    listActiveReminders: jest.fn<SettingsRepository['listActiveReminders']>(),
  };

  const authService = {
    listSessions: jest.fn<AuthService['listSessions']>(),
    getRegistrationLockStatus: jest.fn<AuthService['getRegistrationLockStatus']>(),
    revokeSession: jest.fn<AuthService['revokeSession']>(),
    revokeOtherSessions: jest.fn<AuthService['revokeOtherSessions']>(),
  };

  const reminderQueue = {
    cancelForOwner: jest.fn<ReminderQueueService['cancelForOwner']>(),
    reenqueueForOwner: jest.fn<ReminderQueueService['reenqueueForOwner']>(),
  };

  const logger = {
    emit: jest.fn<EventLogger['emit']>(),
  };

  let controller: SettingsController;
  let testingModule: TestingModule;

  beforeEach(async () => {
    jest.resetAllMocks();

    testingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        SettingsService,
        { provide: SettingsRepository, useValue: repository },
        { provide: AuthService, useValue: authService },
        { provide: ReminderQueueService, useValue: reminderQueue },
        { provide: EventLogger, useValue: logger },
      ],
    }).compile();

    service = testingModule.get(SettingsService);
    controller = testingModule.get(SettingsController);
  });

  describe('getOverview', () => {
    it('returns preferences, sessions, privacy explanation, and demo status', async () => {
      repository.readPreferences.mockResolvedValue(defaultPreferences);
      authService.listSessions.mockResolvedValue([
        {
          id: 'session-uuid-1',
          isCurrent: true,
          createdAt: '2026-10-18T09:00:00.000Z',
          lastUsedAt: '2026-10-18T10:00:00.000Z',
          idleExpiresAt: '2026-10-18T18:00:00.000Z',
        },
      ]);
      authService.getRegistrationLockStatus.mockResolvedValue({
        locked: true,
        reason: 'single_owner_registered',
      });
      repository.getDemoStatus.mockResolvedValue({
        demoItemCount: 3,
        genuineItemCount: 1,
        triedDemo: true,
        removedDemo: false,
      });

      const overview = await service.getOverview(mockOwner);

      expect(overview.preferences).toEqual(defaultPreferences);
      expect(overview.sessions).toHaveLength(1);
      expect(overview.sessions[0]?.isCurrent).toBe(true);
      expect(overview.demoStatus.demoItemCount).toBe(3);

      // Verify privacy explanation invariants
      expect(overview.privacy.storageType).toBe('authenticated_cloudinary');
      expect(overview.privacy.accessType).toBe('authenticated_proxy');
      expect(overview.privacy.publicSharing).toBe(false);
      expect(overview.privacy.registrationLock.locked).toBe(true);
      expect(overview.privacy.storageDescription).toContain('private authenticated storage');
      expect(overview.privacy.accessDescription).toContain(
        'authenticated Havefolio API proxy routes',
      );
      expect(overview.privacy.sharingDescription).toContain('no marketplace');
    });
  });

  describe('updatePreferences', () => {
    it('rejects invalid ISO currency codes', async () => {
      await expect(
        service.updatePreferences(mockOwner, {
          revision: 1,
          defaultCurrency: 'INVALID',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates currency without mutating historical financial records or queue jobs', async () => {
      const updated: OwnerPreferencesDto = {
        ...defaultPreferences,
        defaultCurrency: 'USD',
        revision: 2,
      };
      repository.updatePreferences.mockResolvedValue({
        preferences: updated,
        changedInApp: false,
      });

      const result = await service.updatePreferences(mockOwner, {
        revision: 1,
        defaultCurrency: 'USD',
      });

      expect(result.defaultCurrency).toBe('USD');
      expect(result.revision).toBe(2);
      expect(repository.updatePreferences).toHaveBeenCalledWith('owner-uuid-1', 1, {
        defaultCurrency: 'USD',
        notifyInApp: undefined,
        notifyNtfy: undefined,
      });
      expect(reminderQueue.cancelForOwner).not.toHaveBeenCalled();
      expect(reminderQueue.reenqueueForOwner).not.toHaveBeenCalled();
      expect(logger.emit).toHaveBeenCalledWith(
        'info',
        expect.objectContaining({
          event: 'settings_updated',
          currencyChanged: true,
        }),
      );
    });

    it('cancels queued reminders when owner opts out of in-app notifications', async () => {
      const activeReminders = [
        {
          desireId: 'desire-1',
          scheduleVersion: 1,
          scheduledFor: new Date(Date.now() + 3600000),
        },
      ];
      repository.updatePreferences.mockResolvedValue({
        preferences: {
          ...defaultPreferences,
          notifyInApp: false,
          revision: 2,
        },
        changedInApp: true,
      });
      repository.listActiveReminders.mockResolvedValue(activeReminders);

      const result = await service.updatePreferences(mockOwner, {
        revision: 1,
        notifyInApp: false,
      });

      expect(result.notifyInApp).toBe(false);
      expect(repository.listActiveReminders).toHaveBeenCalledWith('owner-uuid-1');
      expect(reminderQueue.cancelForOwner).toHaveBeenCalledWith(activeReminders);
      expect(reminderQueue.reenqueueForOwner).not.toHaveBeenCalled();
    });

    it('reenqueues future active reminders when owner re-enables in-app notifications', async () => {
      const futureDate = new Date(Date.now() + 3600000);
      const activeReminders = [
        {
          desireId: 'desire-1',
          scheduleVersion: 1,
          scheduledFor: futureDate,
        },
      ];
      repository.updatePreferences.mockResolvedValue({
        preferences: {
          ...defaultPreferences,
          notifyInApp: true,
          revision: 3,
        },
        changedInApp: true,
      });
      repository.listActiveReminders.mockResolvedValue(activeReminders);

      const result = await service.updatePreferences(mockOwner, {
        revision: 2,
        notifyInApp: true,
      });

      expect(result.notifyInApp).toBe(true);
      expect(reminderQueue.reenqueueForOwner).toHaveBeenCalledWith(activeReminders);
      expect(reminderQueue.cancelForOwner).not.toHaveBeenCalled();
    });
  });

  describe('SettingsController (PER-34)', () => {
    it('delegates getOverview and updatePreferences to service', async () => {
      repository.readPreferences.mockResolvedValue(defaultPreferences);
      authService.listSessions.mockResolvedValue([]);
      authService.getRegistrationLockStatus.mockResolvedValue({
        locked: true,
        reason: 'Single owner configured.',
      });
      repository.getDemoStatus.mockResolvedValue({
        demoItemCount: 0,
        genuineItemCount: 1,
        triedDemo: false,
        removedDemo: false,
      });

      const overview = await controller.getOverview(mockOwner);
      expect(overview.preferences).toEqual(defaultPreferences);

      repository.updatePreferences.mockResolvedValue({
        preferences: { ...defaultPreferences, defaultCurrency: 'USD', revision: 2 },
        changedInApp: false,
      });

      const updated = await controller.updatePreferences(mockOwner, {
        revision: 1,
        defaultCurrency: 'USD',
      });
      expect(updated.defaultCurrency).toBe('USD');
    });

    it('delegates session listing and revocation to auth service', async () => {
      authService.listSessions.mockResolvedValue([
        {
          id: 'session-1',
          createdAt: '2026-10-18T09:00:00.000Z',
          lastUsedAt: '2026-10-18T10:00:00.000Z',
          idleExpiresAt: '2026-10-18T18:00:00.000Z',
          isCurrent: true,
        },
      ]);
      authService.revokeSession.mockResolvedValue(undefined);
      authService.revokeOtherSessions.mockResolvedValue({ revokedCount: 2 });

      const sessions = await controller.listSessions(mockOwner);
      expect(sessions).toHaveLength(1);

      await controller.revokeSession(mockOwner, 'session-2');
      expect(authService.revokeSession).toHaveBeenCalledWith(mockOwner, 'session-2');

      const revokedMultiple = await controller.revokeOtherSessions(mockOwner);
      expect(revokedMultiple).toEqual({ revokedCount: 2 });
      expect(authService.revokeOtherSessions).toHaveBeenCalledWith(mockOwner);
    });

    it('publishes settings endpoints and schemas in OpenAPI', () => {
      const app = testingModule.createNestApplication();
      app.setGlobalPrefix('api');
      app.enableVersioning({
        defaultVersion: '1',
        type: VersioningType.URI,
      });
      const config = new DocumentBuilder()
        .setTitle('Havefolio API')
        .setVersion('1')
        .addCookieAuth('havefolio_session')
        .build();
      const doc = SwaggerModule.createDocument(app, config);

      expect(doc.paths['/api/v1/settings']?.get).toBeDefined();
      expect(doc.paths['/api/v1/settings']?.patch).toBeDefined();
      expect(doc.paths['/api/v1/settings/preferences']?.get).toBeDefined();
      expect(doc.paths['/api/v1/settings/sessions']?.get).toBeDefined();
      expect(doc.paths['/api/v1/settings/sessions']?.delete).toBeDefined();
      expect(doc.paths['/api/v1/settings/sessions/{id}']?.delete).toBeDefined();

      // Schemas
      expect(doc.components?.schemas?.['OwnerPreferencesDto']).toBeDefined();
      expect(doc.components?.schemas?.['UpdateOwnerPreferencesDto']).toBeDefined();
      expect(doc.components?.schemas?.['SettingsOverviewDto']).toBeDefined();
      expect(doc.components?.schemas?.['AuthSessionSummaryDto']).toBeDefined();
      expect(doc.components?.schemas?.['PrivacyExplanationDto']).toBeDefined();
    });
  });
});
