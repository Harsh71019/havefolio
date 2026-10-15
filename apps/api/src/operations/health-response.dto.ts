import type {
  DependencyHealth,
  DependencyStatus,
  HealthErrorCode,
  HealthResponse,
  LivenessResponse,
  ReadinessDependencies,
  ReadinessResponse,
  ReadinessStatus,
} from '@havefolio/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ example: 'havefolio-api' })
  service = 'havefolio-api' as const;

  @ApiProperty({ example: 'ok' })
  status = 'ok' as const;

  @ApiProperty({ example: '1' })
  version = '1' as const;
}

export class LivenessResponseDto implements LivenessResponse {
  @ApiProperty({ example: 'havefolio-api' })
  service = 'havefolio-api' as const;

  @ApiProperty({ example: 'ok' })
  status = 'ok' as const;
}

export class DependencyHealthDto implements DependencyHealth {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded', 'unavailable', 'disabled'] })
  status!: DependencyStatus;

  @ApiProperty({
    example: 'DATABASE_UNAVAILABLE',
    enum: ['DATABASE_UNAVAILABLE', 'VALKEY_UNAVAILABLE', 'STORAGE_UNAVAILABLE', 'TIMEOUT'],
    required: false,
  })
  error?: HealthErrorCode;
}

export class ReadinessDependenciesDto implements ReadinessDependencies {
  @ApiProperty({ type: DependencyHealthDto })
  postgres!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  valkey!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  storage!: DependencyHealthDto;
}

export class ReadinessResponseDto implements ReadinessResponse {
  @ApiProperty({ example: 'havefolio-api' })
  service = 'havefolio-api' as const;

  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded', 'unavailable'] })
  status!: ReadinessStatus;

  @ApiProperty({ type: ReadinessDependenciesDto })
  dependencies!: ReadinessDependenciesDto;

  @ApiProperty({ example: 4, required: false })
  durationMs?: number;
}
