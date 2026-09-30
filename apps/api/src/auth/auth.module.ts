import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SafeExceptionFilter } from './safe-exception.filter.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthRateService } from './auth-rate.service.js';
import { PasswordService } from './password.service.js';
import { SessionCookieService } from './session-cookie.service.js';
@Module({
  controllers: [AuthController],
  providers: [
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
    AuthRepository,
    AuthService,
    AuthRateService,
    PasswordService,
    SessionCookieService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
