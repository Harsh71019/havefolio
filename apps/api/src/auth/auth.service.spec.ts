import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthRateService } from './auth-rate.service.js';
import { PasswordService } from './password.service.js';
import { hashToken } from './session-cookie.service.js';

const context = {
  id: 'owner',
  email: 'owner@example.test',
  displayName: null,
  sessionId: 'session',
};
const credentials = { email: ' OWNER@example.test ', password: 'synthetic password fixture' };
describe('AuthService', () => {
  const repository = {
    register: jest.fn<AuthRepository['register']>(),
    findByEmail: jest.fn<AuthRepository['findByEmail']>(),
    login: jest.fn<AuthRepository['login']>(),
    authenticate: jest.fn<AuthRepository['authenticate']>(),
    logout: jest.fn<AuthRepository['logout']>(),
  };
  const passwords = {
    hash: jest.fn<PasswordService['hash']>(),
    verify: jest.fn<PasswordService['verify']>(),
    needsUpgrade: jest.fn<PasswordService['needsUpgrade']>(),
    upgrade: jest.fn<PasswordService['upgrade']>(),
  };
  const rate = { check: jest.fn<AuthRateService['check']>() };
  let service: AuthService;
  let enabled: boolean;
  beforeEach(async () => {
    jest.resetAllMocks();
    enabled = true;
    repository.register.mockResolvedValue(context);
    repository.login.mockResolvedValue(context);
    passwords.hash.mockResolvedValue('hashed');
    rate.check.mockResolvedValue();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repository },
        { provide: PasswordService, useValue: passwords },
        { provide: AuthRateService, useValue: rate },
        { provide: ConfigService, useValue: { get: () => enabled } },
      ],
    }).compile();
    service = module.get(AuthService);
  });
  it('normalizes registration and persists only the token hash', async () => {
    const result = await service.register(credentials, 'source');
    expect(repository.register).toHaveBeenCalledWith(
      'owner@example.test',
      'hashed',
      hashToken(result.token),
    );
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.publicOwner(result.owner)).toEqual({
      id: 'owner',
      email: 'owner@example.test',
      displayName: null,
    });
  });
  it('disables registration before hashing or creating a record', async () => {
    enabled = false;
    await expect(service.register(credentials, 'source')).rejects.toMatchObject({
      message: 'REGISTRATION_UNAVAILABLE',
    });
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(repository.register).not.toHaveBeenCalled();
  });
  it('returns the same failure for unknown accounts and wrong passwords and verifies a dummy hash', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(service.login(credentials, 'source')).rejects.toMatchObject({
      message: 'INVALID_CREDENTIALS',
    });
    expect(passwords.verify).toHaveBeenCalledWith(credentials.password, null);
    repository.findByEmail.mockResolvedValue({ ...context, passwordHash: 'hash' });
    await expect(service.login(credentials, 'source')).rejects.toMatchObject({
      message: 'INVALID_CREDENTIALS',
    });
    expect(repository.login).not.toHaveBeenCalled();
  });
  it('upgrades only after successful verification and rotates the presented token', async () => {
    const owner = { ...context, passwordHash: 'old-hash' };
    repository.findByEmail.mockResolvedValue(owner);
    passwords.verify.mockResolvedValue(true);
    passwords.needsUpgrade.mockReturnValue(true);
    passwords.upgrade.mockResolvedValue('new-hash');
    const result = await service.login(credentials, 'source', 'previous-token');
    expect(repository.login).toHaveBeenCalledWith(
      owner,
      hashToken(result.token),
      hashToken('previous-token'),
      'new-hash',
    );
    passwords.needsUpgrade.mockReturnValue(false);
    await service.login(credentials, 'source');
    expect(passwords.upgrade).toHaveBeenCalledTimes(1);
  });
  it('rejects missing repository sessions, authenticates valid ones, and delegates both revocations', async () => {
    await expect(service.authenticate('token')).rejects.toMatchObject({ message: 'AUTH_REQUIRED' });
    repository.authenticate.mockResolvedValue(context);
    expect(await service.authenticate('token')).toEqual(context);
    expect(repository.authenticate).toHaveBeenLastCalledWith(hashToken('token'));
    await service.logout(context, false);
    await service.logout(context, true);
    expect(repository.logout.mock.calls).toEqual([
      [context, false],
      [context, true],
    ]);
  });
  it('fails closed before password/DB work when the limiter is unavailable', async () => {
    rate.check.mockRejectedValue(new Error('unavailable'));
    await expect(service.login(credentials, 'source')).rejects.toThrow('unavailable');
    expect(repository.findByEmail).not.toHaveBeenCalled();
  });
});
