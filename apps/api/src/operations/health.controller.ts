import { Public } from '../auth/auth.context.js';
import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  HealthResponseDto,
  LivenessResponseDto,
  ReadinessResponseDto,
} from './health-response.dto.js';
import { HealthService } from './health.service.js';

@Public()
@ApiTags('operations')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check whether the API process is responding' })
  @ApiOkResponse({ type: HealthResponseDto })
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  getHealth(): HealthResponseDto {
    return this.healthService.getStatus();
  }

  @Get('live')
  @ApiOperation({ summary: 'Check whether the API process is alive' })
  @ApiOkResponse({ type: LivenessResponseDto })
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  getLive(): LivenessResponseDto {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether API dependencies are ready' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiResponse({
    status: 503,
    description: 'One or more critical dependencies are unavailable',
    type: ReadinessResponseDto,
  })
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getReady(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponseDto> {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status === 'unavailable') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
