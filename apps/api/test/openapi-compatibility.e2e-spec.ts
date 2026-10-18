import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { checkOpenApiCompatibility } from '@havefolio/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';

interface MutatedDoc {
  paths: Record<
    string,
    Record<
      string,
      {
        parameters?: Array<{
          name: string;
          in: string;
          required?: boolean;
          schema?: { type: string };
        }>;
      }
    >
  >;
  components: {
    schemas: Record<string, { properties: Record<string, { type?: string }> }>;
  };
  [key: string]: unknown;
}

describe('PER-39 OpenAPI contract compatibility and breaking change gate', () => {
  let app: INestApplication;
  let liveDoc: Record<string, unknown>;
  let baselineDoc: Record<string, unknown>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Havefolio API')
      .setDescription('Private household inventory and intentional-purchase API.')
      .setVersion('1.0.0')
      .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
      .build();

    liveDoc = SwaggerModule.createDocument(app, swaggerConfig) as unknown as Record<
      string,
      unknown
    >;

    const baselinePath = resolve(process.cwd(), '../../packages/contracts/openapi.json');
    baselineDoc = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies live API implementation is fully backwards-compatible with authoritative baseline', () => {
    const result = checkOpenApiCompatibility(baselineDoc, liveDoc);
    if (!result.compatible) {
      // Print detailed failures if any breaking changes detected
      const messages = result.breakingChanges
        .map((c) => `[${c.rule}] ${c.location}: ${c.message}`)
        .join('\n');
      throw new Error(`Breaking API changes detected against baseline:\n${messages}`);
    }
    expect(result.compatible).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });

  it('fails with PATH_REMOVED when a published endpoint is removed', () => {
    const mutated = JSON.parse(JSON.stringify(liveDoc)) as MutatedDoc;
    delete mutated.paths['/api/v1/items/{id}'];

    const result = checkOpenApiCompatibility(baselineDoc, mutated);
    expect(result.compatible).toBe(false);
    expect(result.breakingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'PATH_REMOVED',
          location: '/api/v1/items/{id}',
        }),
      ]),
    );
  });

  it('fails with METHOD_REMOVED when an HTTP method is removed from an endpoint', () => {
    const mutated = JSON.parse(JSON.stringify(liveDoc)) as MutatedDoc;
    delete mutated.paths['/api/v1/items']!.post;

    const result = checkOpenApiCompatibility(baselineDoc, mutated);
    expect(result.compatible).toBe(false);
    expect(result.breakingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'METHOD_REMOVED',
          location: 'POST /api/v1/items',
        }),
      ]),
    );
  });

  it('fails with REQUIRED_PARAMETER_ADDED when a new required query parameter is introduced', () => {
    const mutated = JSON.parse(JSON.stringify(liveDoc)) as MutatedDoc;
    mutated.paths['/api/v1/items']!.get!.parameters!.push({
      name: 'mandatory_filter',
      in: 'query',
      required: true,
      schema: { type: 'string' },
    });

    const result = checkOpenApiCompatibility(baselineDoc, mutated);
    expect(result.compatible).toBe(false);
    expect(result.breakingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'REQUIRED_PARAMETER_ADDED',
        }),
      ]),
    );
  });

  it('fails with RESPONSE_FIELD_REMOVED when a required response property is dropped', () => {
    const mutated = JSON.parse(JSON.stringify(liveDoc)) as MutatedDoc;
    // ItemDto is referenced in responses
    const itemSchema = mutated.components.schemas['ItemDto']!;
    delete itemSchema.properties['name'];

    const result = checkOpenApiCompatibility(baselineDoc, mutated);
    expect(result.compatible).toBe(false);
    expect(result.breakingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'RESPONSE_FIELD_REMOVED',
        }),
      ]),
    );
  });

  it('fails with RESPONSE_SCHEMA_TYPE_CHANGED when a response property changes type', () => {
    const mutated = JSON.parse(JSON.stringify(liveDoc)) as MutatedDoc;
    const itemSchema = mutated.components.schemas['ItemDto']!;
    itemSchema.properties['name']!.type = 'integer';

    const result = checkOpenApiCompatibility(baselineDoc, mutated);
    expect(result.compatible).toBe(false);
    expect(result.breakingChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'RESPONSE_SCHEMA_TYPE_CHANGED',
        }),
      ]),
    );
  });
});
