import type { AccountDeletionStatus } from '@havefolio/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class DeletionReceiptDto {
  @ApiProperty({
    description:
      'Random 256-bit status-only receipt generated and saved by the client; never include in a URL.',
    pattern: '^[a-f0-9]{64}$',
  })
  @Matches(/^[a-f0-9]{64}$/)
  receipt!: string;
}
export class DeleteAccountDto extends DeletionReceiptDto {
  @ApiProperty({ minLength: 1, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
  @ApiProperty({ enum: ['DELETE MY ACCOUNT'] })
  @Equals('DELETE MY ACCOUNT')
  confirmation!: string;
}
export class DeletionStatusDto implements AccountDeletionStatus {
  @ApiProperty({ enum: ['pending', 'retrying', 'awaiting_finality', 'completed'] })
  state!: AccountDeletionStatus['state'];
  @ApiProperty() remainingFiles!: number;
  @ApiProperty() awaitingFinality!: number;
  @ApiProperty({ nullable: true, type: String }) completedAt!: string | null;
}
