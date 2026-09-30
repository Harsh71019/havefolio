import { Test } from '@nestjs/testing';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('returns the stable API health contract', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();
    const service = moduleRef.get(HealthService);

    expect(service.getStatus()).toEqual({
      service: 'havefolio-api',
      status: 'ok',
      version: '1',
    });
  });
});
