import { Injectable } from '@nestjs/common';
import { HealthResponseDto } from './health-response.dto.js';

@Injectable()
export class HealthService {
  getStatus(): HealthResponseDto {
    return new HealthResponseDto();
  }
}
