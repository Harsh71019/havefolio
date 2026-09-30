import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import type { OwnerContext } from './auth.context.js';

export interface CredentialOwner {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
}
const OWNER_COLUMNS = 'id, email, display_name AS "displayName", password_hash AS "passwordHash"';
const ACTIVE =
  'revoked_at IS NULL AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()';

@Injectable()
export class AuthRepository implements OnModuleDestroy {
  private readonly pool?: Pool;
  private closed = false;
  constructor(private readonly config: ConfigService) {
    if (config.get<string>('DATABASE_URL')) {
      this.pool = new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: 3,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
      });
      this.pool.on('error', () => undefined);
    }
  }
  private async run<T>(
    operation: (client: PoolClient) => Promise<T>,
    transaction = false,
  ): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      if (transaction) await client.query('BEGIN');
      const result = await operation(client);
      if (transaction) await client.query('COMMIT');
      return result;
    } catch (error) {
      if (transaction && client) await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }
  async findByEmail(email: string): Promise<CredentialOwner | undefined> {
    return this.run(
      async (client) =>
        (
          await client.query<CredentialOwner>(
            `SELECT ${OWNER_COLUMNS} FROM users WHERE email = $1`,
            [email],
          )
        ).rows[0],
    );
  }
  async register(email: string, passwordHash: string, tokenHash: string): Promise<OwnerContext> {
    return this.run(async (client) => {
      // Fixed transaction lock plus the unique partial index protect every API process.
      await client.query('SELECT pg_advisory_xact_lock(72808)');
      const existing = await client.query('SELECT id FROM users WHERE email IS NOT NULL LIMIT 1');
      if (existing.rowCount) throw new ForbiddenException('REGISTRATION_UNAVAILABLE');
      const owner = (
        await client.query<CredentialOwner>(
          `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING ${OWNER_COLUMNS}`,
          [email, passwordHash],
        )
      ).rows[0]!;
      return this.createSession(client, owner, tokenHash);
    }, true);
  }
  private async createSession(
    client: PoolClient,
    owner: CredentialOwner,
    tokenHash: string,
  ): Promise<OwnerContext> {
    // A login owns the user's row lock. Keep retained rows bounded, including revocations.
    await client.query(
      `DELETE FROM auth_sessions WHERE owner_id = $1 AND (revoked_at IS NOT NULL OR idle_expires_at <= clock_timestamp() OR absolute_expires_at <= clock_timestamp())`,
      [owner.id],
    );
    await client.query(
      `DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE owner_id = $1 ORDER BY created_at DESC, id DESC OFFSET $2)`,
      [owner.id, this.config.getOrThrow<number>('AUTH_SESSION_MAX_RETAINED') - 1],
    );
    const row = (
      await client.query<{ id: string }>(
        `INSERT INTO auth_sessions (owner_id, token_hash, idle_expires_at, absolute_expires_at) VALUES ($1, $2, now() + $3 * interval '1 second', now() + $4 * interval '1 second') RETURNING id`,
        [
          owner.id,
          tokenHash,
          this.config.getOrThrow<number>('AUTH_SESSION_IDLE_SECONDS'),
          this.config.getOrThrow<number>('AUTH_SESSION_ABSOLUTE_SECONDS'),
        ],
      )
    ).rows[0]!;
    return { id: owner.id, email: owner.email, displayName: owner.displayName, sessionId: row.id };
  }
  async login(
    expected: CredentialOwner,
    tokenHash: string,
    previousHash: string | undefined,
    upgradedHash: string | undefined,
  ): Promise<OwnerContext> {
    return this.run(async (client) => {
      const owner = (
        await client.query<CredentialOwner>(
          `SELECT ${OWNER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
          [expected.id],
        )
      ).rows[0];
      if (
        !owner ||
        Buffer.byteLength(owner.passwordHash) !== Buffer.byteLength(expected.passwordHash) ||
        !timingSafeEqual(Buffer.from(owner.passwordHash), Buffer.from(expected.passwordHash))
      )
        throw new UnauthorizedException('INVALID_CREDENTIALS');
      if (upgradedHash)
        await client.query(
          'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
          [upgradedHash, owner.id],
        );
      if (previousHash)
        await client.query(
          'UPDATE auth_sessions SET revoked_at = clock_timestamp() WHERE owner_id = $1 AND token_hash = $2 AND revoked_at IS NULL',
          [owner.id, previousHash],
        );
      return this.createSession(client, owner, tokenHash);
    }, true);
  }
  async authenticate(tokenHash: string): Promise<OwnerContext | undefined> {
    return this.run(async (client) => {
      // Conditional update serializes with revoke and cannot resurrect an expired/revoked row.
      const session = (
        await client.query<{ owner_id: string; id: string }>(
          `UPDATE auth_sessions SET last_used_at = clock_timestamp(), idle_expires_at = least(absolute_expires_at, clock_timestamp() + $2 * interval '1 second') WHERE token_hash = $1 AND ${ACTIVE} RETURNING owner_id, id`,
          [tokenHash, this.config.getOrThrow<number>('AUTH_SESSION_IDLE_SECONDS')],
        )
      ).rows[0];
      if (!session) return undefined;
      const owner = (
        await client.query<CredentialOwner>(
          `SELECT ${OWNER_COLUMNS} FROM users WHERE id = $1 AND email IS NOT NULL`,
          [session.owner_id],
        )
      ).rows[0];
      return (
        owner && {
          id: owner.id,
          email: owner.email,
          displayName: owner.displayName,
          sessionId: session.id,
        }
      );
    });
  }
  async logout(owner: OwnerContext, all: boolean): Promise<void> {
    await this.run(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner.id]);
      const session = await client.query(
        `SELECT id FROM auth_sessions WHERE id = $1 AND owner_id = $2 AND ${ACTIVE} FOR UPDATE`,
        [owner.sessionId, owner.id],
      );
      if (!session.rowCount) throw new UnauthorizedException('AUTH_REQUIRED');
      await client.query(
        `UPDATE auth_sessions SET revoked_at = clock_timestamp() WHERE owner_id = $1 AND revoked_at IS NULL${all ? '' : ' AND id = $2'}`,
        all ? [owner.id] : [owner.id, owner.sessionId],
      );
    }, true);
  }
  async onModuleDestroy(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.pool?.end();
    }
  }
}
