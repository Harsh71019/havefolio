import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import type {
  AuthSessionSummary,
  OwnerPreferences,
  PrivacyExplanation,
  SettingsDemoStatus,
  SettingsOverview,
  UpdateOwnerPreferencesInput,
} from '@havefolio/contracts';

export class OwnerPreferencesDto implements OwnerPreferences {
  @ApiProperty({
    example: 'INR',
    description: 'Owner-scoped default display and entry currency (ISO 4217 code).',
  })
  defaultCurrency!: string;

  @ApiProperty({
    example: true,
    description: 'Whether in-app waiting-period review reminders are enabled.',
  })
  notifyInApp!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether push notifications (ntfy) for waiting periods are enabled.',
  })
  notifyNtfy!: boolean;

  @ApiProperty({
    example: 1,
    description: 'Optimistic concurrency revision number.',
  })
  revision!: number;

  @ApiProperty({
    example: '2026-10-18T10:00:00.000Z',
    description: 'Timestamp of the latest preference update.',
  })
  updatedAt!: string;
}

export class UpdateOwnerPreferencesDto implements UpdateOwnerPreferencesInput {
  @ApiProperty({
    example: 1,
    description: 'Current revision for optimistic concurrency control.',
  })
  @IsInt()
  @Min(1)
  revision!: number;

  @ApiPropertyOptional({
    example: 'USD',
    description: 'New default display/entry ISO 4217 currency code.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Enable or disable in-app waiting-period reminders.',
  })
  @IsOptional()
  @IsBoolean()
  notifyInApp?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Enable or disable external push notifications (ntfy).',
  })
  @IsOptional()
  @IsBoolean()
  notifyNtfy?: boolean;
}

export class AuthSessionSummaryDto implements AuthSessionSummary {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '2026-10-18T08:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-18T10:00:00.000Z' })
  lastUsedAt!: string;

  @ApiProperty({ example: '2026-10-18T18:00:00.000Z' })
  idleExpiresAt!: string;

  @ApiProperty({ example: true, description: 'Whether this is the current active session.' })
  isCurrent!: boolean;
}

export class RegistrationLockDto {
  @ApiProperty({ example: true, description: 'Whether registration is locked.' })
  locked!: boolean;

  @ApiProperty({
    example: 'Single owner configured. Additional registrations are blocked.',
  })
  reason!: string;
}

export class PrivacyExplanationDto implements PrivacyExplanation {
  @ApiProperty({ example: 'authenticated_cloudinary' })
  storageType!: 'authenticated_cloudinary';

  @ApiProperty({
    example:
      'Item photos, receipts, and warranties are securely stored in private authenticated storage folders. Files are not accessible through public Cloudinary URLs or public CDN links.',
  })
  storageDescription!: string;

  @ApiProperty({ example: 'authenticated_proxy' })
  accessType!: 'authenticated_proxy';

  @ApiProperty({
    example:
      'Media is served only through authenticated Havefolio API proxy routes with short-lived session access. Uploads are stripped of unneeded metadata and restricted to your authenticated owner session.',
  })
  accessDescription!: string;

  @ApiProperty({ example: false })
  publicSharing!: false;

  @ApiProperty({
    example:
      'Havefolio is a personal inventory and decision aid. It has no marketplace, public storefront, public links, discovery feeds, or third-party tracking.',
  })
  sharingDescription!: string;

  @ApiProperty({ type: RegistrationLockDto })
  registrationLock!: RegistrationLockDto;
}

export class SettingsDemoStatusDto implements SettingsDemoStatus {
  @ApiProperty({ example: 0, description: 'Number of sample items currently in inventory.' })
  demoItemCount!: number;

  @ApiProperty({ example: 12, description: 'Number of genuine items in inventory.' })
  genuineItemCount!: number;

  @ApiProperty({ example: false, description: 'Whether demo items have ever been explored.' })
  triedDemo!: boolean;

  @ApiProperty({ example: false, description: 'Whether demo items have ever been removed.' })
  removedDemo!: boolean;
}

export class SettingsOverviewDto implements SettingsOverview {
  @ApiProperty({ type: OwnerPreferencesDto })
  preferences!: OwnerPreferencesDto;

  @ApiProperty({ type: [AuthSessionSummaryDto] })
  sessions!: AuthSessionSummaryDto[];

  @ApiProperty({ type: PrivacyExplanationDto })
  privacy!: PrivacyExplanationDto;

  @ApiProperty({ type: SettingsDemoStatusDto })
  demoStatus!: SettingsDemoStatusDto;
}

export class RevokeSessionsResponseDto {
  @ApiProperty({ example: 1, description: 'Number of revoked sessions.' })
  revokedCount!: number;
}
