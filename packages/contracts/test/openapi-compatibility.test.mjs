import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkOpenApiCompatibility } from '../dist/index.js';

const fixtureBaseline = () => ({
  openapi: '3.0.0',
  paths: {
    '/api/v1/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Item list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items', 'nextCursor'],
                  properties: {
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'name', 'status'],
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          status: { type: 'string', enum: ['owned', 'sold', 'returned'] },
                        },
                      },
                    },
                    nextCursor: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createItem',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'currency'],
                properties: {
                  name: { type: 'string' },
                  currency: { type: 'string', enum: ['INR', 'USD', 'EUR'] },
                  pricePaidMinor: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/items/{id}': {
      get: {
        operationId: 'getItem',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Single item',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

test('identical OpenAPI specs are compatible with zero breaking changes', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, true);
  assert.equal(result.breakingChanges.length, 0);
});

test('removing an endpoint is detected as a breaking change', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  delete cand.paths['/api/v1/items/{id}'];

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(
    result.breakingChanges.some(
      (c) => c.rule === 'PATH_REMOVED' && c.location === '/api/v1/items/{id}',
    ),
  );
});

test('removing an HTTP method from an existing endpoint is detected as breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  delete cand.paths['/api/v1/items'].post;

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(
    result.breakingChanges.some(
      (c) => c.rule === 'METHOD_REMOVED' && c.location === 'POST /api/v1/items',
    ),
  );
});

test('adding a new required query parameter is breaking; adding an optional one is compatible', () => {
  const base = fixtureBaseline();

  // Breaking: new required query param
  const candBreaking = JSON.parse(JSON.stringify(base));
  candBreaking.paths['/api/v1/items'].get.parameters.push({
    name: 'filter',
    in: 'query',
    required: true,
    schema: { type: 'string' },
  });
  const resBreaking = checkOpenApiCompatibility(base, candBreaking);
  assert.equal(resBreaking.compatible, false);
  assert.ok(resBreaking.breakingChanges.some((c) => c.rule === 'REQUIRED_PARAMETER_ADDED'));

  // Compatible: new optional query param
  const candCompatible = JSON.parse(JSON.stringify(base));
  candCompatible.paths['/api/v1/items'].get.parameters.push({
    name: 'filter',
    in: 'query',
    required: false,
    schema: { type: 'string' },
  });
  const resCompatible = checkOpenApiCompatibility(base, candCompatible);
  assert.equal(resCompatible.compatible, true);
});

test('changing an optional parameter to required is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  cand.paths['/api/v1/items'].get.parameters.find((p) => p.name === 'limit').required = true;

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(result.breakingChanges.some((c) => c.rule === 'PARAMETER_REQUIRED_CHANGED'));
});

test('changing parameter schema type is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  cand.paths['/api/v1/items'].get.parameters.find((p) => p.name === 'limit').schema.type = 'string';

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(result.breakingChanges.some((c) => c.rule === 'PARAMETER_TYPE_CHANGED'));
});

test('adding a new required field to request body schema is breaking; optional field is compatible', () => {
  const base = fixtureBaseline();

  // Breaking: new required field
  const candBreaking = JSON.parse(JSON.stringify(base));
  candBreaking.paths['/api/v1/items'].post.requestBody.content[
    'application/json'
  ].schema.required.push('tag');
  candBreaking.paths['/api/v1/items'].post.requestBody.content[
    'application/json'
  ].schema.properties.tag = { type: 'string' };

  const resBreaking = checkOpenApiCompatibility(base, candBreaking);
  assert.equal(resBreaking.compatible, false);
  assert.ok(
    resBreaking.breakingChanges.some((c) => c.rule === 'REQUEST_BODY_REQUIRED_FIELD_ADDED'),
  );

  // Compatible: new optional field
  const candCompatible = JSON.parse(JSON.stringify(base));
  candCompatible.paths['/api/v1/items'].post.requestBody.content[
    'application/json'
  ].schema.properties.tag = { type: 'string' };
  const resCompatible = checkOpenApiCompatibility(base, candCompatible);
  assert.equal(resCompatible.compatible, true);
});

test('changing request body property type is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  cand.paths['/api/v1/items'].post.requestBody.content[
    'application/json'
  ].schema.properties.name.type = 'integer';

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(result.breakingChanges.some((c) => c.rule === 'REQUEST_SCHEMA_TYPE_CHANGED'));
});

test('removing an allowed enum value from request body is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  cand.paths['/api/v1/items'].post.requestBody.content[
    'application/json'
  ].schema.properties.currency.enum = ['INR', 'USD']; // EUR removed

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(
    result.breakingChanges.some(
      (c) => c.rule === 'REQUEST_ENUM_VALUE_REMOVED' && c.message.includes('EUR'),
    ),
  );
});

test('removing a 2xx response status code is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  delete cand.paths['/api/v1/items'].post.responses['201'];

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(result.breakingChanges.some((c) => c.rule === 'RESPONSE_STATUS_REMOVED'));
});

test('removing a property from a 2xx response schema is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  delete cand.paths['/api/v1/items/{id}'].get.responses['200'].content['application/json'].schema
    .properties.name;

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(
    result.breakingChanges.some(
      (c) => c.rule === 'RESPONSE_FIELD_REMOVED' && c.location.endsWith('.name'),
    ),
  );
});

test('changing a response property type is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  cand.paths['/api/v1/items/{id}'].get.responses['200'].content[
    'application/json'
  ].schema.properties.name.type = 'number';

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(result.breakingChanges.some((c) => c.rule === 'RESPONSE_SCHEMA_TYPE_CHANGED'));
});

test('removing an enum value from response schema is breaking', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));
  cand.paths['/api/v1/items'].get.responses['200'].content[
    'application/json'
  ].schema.properties.items.items.properties.status.enum = ['owned']; // sold, returned removed

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, false);
  assert.ok(result.breakingChanges.some((c) => c.rule === 'RESPONSE_ENUM_VALUE_REMOVED'));
});

test('adding new endpoints, optional response properties, or new HTTP methods is compatible', () => {
  const base = fixtureBaseline();
  const cand = JSON.parse(JSON.stringify(base));

  // Add new endpoint
  cand.paths['/api/v1/categories'] = {
    get: {
      operationId: 'listCategories',
      responses: {
        200: { description: 'Categories' },
      },
    },
  };

  // Add optional response property
  cand.paths['/api/v1/items/{id}'].get.responses['200'].content[
    'application/json'
  ].schema.properties.description = { type: 'string' };

  const result = checkOpenApiCompatibility(base, cand);
  assert.equal(result.compatible, true);
  assert.equal(result.breakingChanges.length, 0);
});

test('authoritative baseline packages/contracts/openapi.json is self-compatible', () => {
  const openapiPath = resolve(import.meta.dirname, '../openapi.json');
  const spec = JSON.parse(readFileSync(openapiPath, 'utf8'));
  const result = checkOpenApiCompatibility(spec, spec);
  assert.equal(result.compatible, true);
  assert.equal(result.breakingChanges.length, 0);
});
