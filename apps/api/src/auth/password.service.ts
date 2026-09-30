import { Injectable, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string;
  readonly options: {
    type: typeof argon2id;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
    hashLength: number;
  };
  constructor(config: ConfigService) {
    this.options = {
      type: argon2id,
      memoryCost: config.getOrThrow<number>('AUTH_ARGON_MEMORY_KIB'),
      timeCost: config.getOrThrow<number>('AUTH_ARGON_TIME_COST'),
      parallelism: config.getOrThrow<number>('AUTH_ARGON_PARALLELISM'),
      hashLength: 32,
    };
  }
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }
  async hash(password: string): Promise<string> {
    try {
      return await hash(password, this.options);
    } catch {
      throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    }
  }
  async verify(password: string, digest: string | null): Promise<boolean> {
    try {
      const valid = await verify(digest ?? this.dummyHash, password);
      return digest !== null && valid;
    } catch {
      return false;
    }
  }
  private parameters(digest: string): { memory: number; time: number } | undefined {
    const match = /^\$argon2id\$v=19\$([^$]+)\$/.exec(digest);
    if (!match) return undefined;
    const params = new Map(
      match[1]!.split(',').map((part) => {
        const [key, value] = part.split('=');
        return [key!, Number(value)] as const;
      }),
    );
    const memory = params.get('m');
    const time = params.get('t');
    return memory && time ? { memory, time } : undefined;
  }
  needsUpgrade(digest: string): boolean {
    const params = this.parameters(digest);
    return (
      !params || params.memory < this.options.memoryCost || params.time < this.options.timeCost
    );
  }
  // Never reduce an existing stronger memory/time parameter during an upgrade.
  async upgrade(password: string, digest: string): Promise<string> {
    const params = this.parameters(digest);
    try {
      return await hash(password, {
        ...this.options,
        memoryCost: Math.max(this.options.memoryCost, params?.memory ?? 0),
        timeCost: Math.max(this.options.timeCost, params?.time ?? 0),
      });
    } catch {
      throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    }
  }
}
