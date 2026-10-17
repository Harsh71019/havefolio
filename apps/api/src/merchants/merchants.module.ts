import { Module } from '@nestjs/common';
import { MerchantsController } from './merchants.controller.js';
import { MerchantsRepository } from './merchants.repository.js';
import { MerchantsService } from './merchants.service.js';
@Module({ controllers: [MerchantsController], providers: [MerchantsRepository, MerchantsService] })
export class MerchantsModule {}
