import type { HealthResponse } from '@havefolio/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ example: 'havefolio-api' })
  service = 'havefolio-api' as const;

  @ApiProperty({ example: 'ok' })
  status = 'ok' as const;

  @ApiProperty({ example: '1' })
  version = '1' as const;
}
