import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';

export interface LogContext {
  requestId?: string;
  correlationId: string;
  causationId?: string;
  jobId?: string;
  attempt?: number;
}
export const logContext = new AsyncLocalStorage<Readonly<LogContext>>();
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
export function effectiveId(value: unknown): string {
  return validId(value) ? value : randomUUID();
}
export function jobMetadata(): LogContext {
  const context = logContext.getStore();
  return {
    correlationId: context?.correlationId ?? randomUUID(),
    ...(context?.requestId ? { requestId: context.requestId, causationId: context.requestId } : {}),
    ...(context?.jobId ? { causationId: context.jobId } : {}),
  };
}
export function jobContext(metadata: unknown, id: unknown, attemptsMade: number): LogContext {
  const data =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  return {
    correlationId: validId(data.correlationId)
      ? data.correlationId
      : typeof id === 'string'
        ? createHash('sha256')
            .update('havefolio:job:' + id)
            .digest('hex')
            .slice(0, 32)
        : randomUUID(),
    ...(validId(data.requestId) ? { requestId: data.requestId } : {}),
    ...(typeof data.causationId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(data.causationId)
      ? { causationId: data.causationId }
      : {}),
    // BullMQ permits arbitrary job IDs; retain only safe bounded identifiers.
    ...(typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? { jobId: id } : {}),
    attempt: Math.max(1, Math.min(10000, attemptsMade + 1)),
  };
}

/** Queue producers attach only this metadata; private payloads are never logged. */
export function correlatedJobData<T extends object>(data: T): T & { metadata: LogContext } {
  return { ...data, metadata: jobMetadata() };
}
