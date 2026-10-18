import { Module } from '@nestjs/common';
import { AttachmentRepository, DatabaseAttachmentRepository } from './attachment.repository.js';
import { PrivateMediaStorage } from './storage.js';
import { CloudinaryStorage } from './cloudinary-storage.service.js';
import { MediaService } from './media.service.js';
import { UploadRateService } from './upload-rate.service.js';

@Module({
  providers: [
    { provide: AttachmentRepository, useClass: DatabaseAttachmentRepository },
    { provide: PrivateMediaStorage, useClass: CloudinaryStorage },
    MediaService,
    UploadRateService,
  ],
  exports: [MediaService, PrivateMediaStorage, UploadRateService],
})
export class MediaModule {}
