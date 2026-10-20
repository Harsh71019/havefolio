import type { SchemaObject } from '@nestjs/swagger';
const text: SchemaObject = { type: 'string' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const nullable: SchemaObject = { type: 'string', nullable: true };
const field: SchemaObject = {
  type: 'string',
  pattern: '^(name|brand|model|description|image|specification:[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63})$',
};
const candidate: SchemaObject = {
  type: 'object',
  required: ['id', 'fields'],
  properties: {
    id: text,
    fields: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        required: ['field', 'value', 'confidence', 'source'],
        properties: {
          field,
          value: text,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          source: {
            type: 'object',
            required: ['provider', 'inputKind', 'reference'],
            properties: {
              provider: text,
              inputKind: { type: 'string', enum: ['name', 'url', 'barcode', 'photo', 'receipt'] },
              reference: text,
            },
          },
        },
      },
    },
  },
};
export const enrichmentWorkSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'itemId',
    'baseRevision',
    'state',
    'attempts',
    'failureCode',
    'candidates',
    'createdAt',
  ],
  properties: {
    id: uuid,
    itemId: uuid,
    baseRevision: { type: 'integer', minimum: 1 },
    state: {
      type: 'string',
      enum: ['pending', 'processing', 'retry', 'succeeded', 'failed', 'unconfigured', 'stale'],
    },
    attempts: { type: 'integer', minimum: 0, maximum: 3 },
    failureCode: {
      type: 'string',
      nullable: true,
      enum: ['PROVIDER_UNCONFIGURED', 'PROVIDER_FAILED'],
    },
    candidates: { type: 'array', maxItems: 5, items: candidate },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
export const enrichmentReviewSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'workId',
    'commandId',
    'revision',
    'candidateId',
    'field',
    'decision',
    'previousValue',
    'confirmedValue',
    'resultingRevision',
    'createdAt',
  ],
  properties: {
    id: uuid,
    workId: uuid,
    commandId: uuid,
    revision: { type: 'integer' },
    candidateId: text,
    field,
    decision: { type: 'string', enum: ['accept', 'reject', 'correct'] },
    value: text,
    previousValue: nullable,
    confirmedValue: nullable,
    resultingRevision: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
export const enrichmentPageSchema: SchemaObject = {
  type: 'object',
  required: ['providerStatus', 'items', 'nextBefore'],
  properties: {
    providerStatus: { type: 'string', enum: ['available', 'unconfigured'] },
    items: { type: 'array', maxItems: 20, items: enrichmentWorkSchema },
    nextBefore: { ...uuid, nullable: true },
  },
};
export const enrichmentHistorySchema: SchemaObject = {
  type: 'object',
  required: ['items', 'nextBefore'],
  properties: {
    items: { type: 'array', maxItems: 20, items: enrichmentReviewSchema },
    nextBefore: { ...uuid, nullable: true },
  },
};
