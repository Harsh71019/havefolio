import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ServiceUnavailableException } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Test as HttpTest } from 'supertest';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { applyMigrations } from '@havefolio/db';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { TaxonomyModule } from '../src/taxonomy/taxonomy.module.js';
import { TaxonomyService } from '../src/taxonomy/taxonomy.service.js';
import { TaxonomyRepository } from '../src/taxonomy/taxonomy.repository.js';

jest.setTimeout(60000);
describe('taxonomy HTTP and relational integrity on isolated infrastructure', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID();
  const other = randomUUID();
  const token = newToken();
  let app: NestExpressApplication;
  let service: TaxonomyService;
  let repository: TaxonomyRepository;
  let foreignCategory: string;
  let foreignSubcategory: string;
  let foreignTag: string;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const get = (): HttpTest =>
    http().get('/api/v1/taxonomy').set('Cookie', `havefolio_session=${token}`);
  const post = (path: string, body: object): HttpTest =>
    http().post(`/api/v1/taxonomy/${path}`).set('Cookie', `havefolio_session=${token}`).send(body);
  const patch = (path: string, body: object): HttpTest =>
    http().patch(`/api/v1/taxonomy/${path}`).set('Cookie', `havefolio_session=${token}`).send(body);
  const remove = (path: string, body: object = {}): HttpTest =>
    http()
      .delete(`/api/v1/taxonomy/${path}`)
      .set('Cookie', `havefolio_session=${token}`)
      .send(body);
  const snapshot = async (): Promise<TaxonomySnapshot> =>
    (await get().expect(200)).body as TaxonomySnapshot;
  const category = async (name: string): Promise<string> => {
    const result = await post('categories', { name }).expect(201);
    return (result.body as TaxonomySnapshot).categories.find((row) => row.name === name)!.id;
  };
  const subcategory = async (name: string, categoryId: string): Promise<string> => {
    const result = await post('subcategories', { name, categoryId }).expect(201);
    return (result.body as TaxonomySnapshot).subcategories.find(
      (row) => row.name === name && row.categoryId === categoryId,
    )!.id;
  };
  const item = async (
    categoryId: string,
    subcategoryId?: string,
    ownerId = owner,
  ): Promise<string> => {
    const id = randomUUID();
    await run.runtime.query(
      `INSERT INTO items(id,owner_id,name,category_id,subcategory_id,currency,original_entry,original_source) VALUES ($1,$2,'Synthetic item',$3,$4,'INR','{"name":"Synthetic item"}','manual')`,
      [id, ownerId, categoryId, subcategoryId ?? null],
    );
    return id;
  };
  beforeAll(async () => {
    await run.start();
    await applyMigrations(run.migration, run.schema);
    await run.runtime.query(
      `INSERT INTO users(id,email,password_hash) VALUES ($1,'owner@example.test','$argon2id$fixture'),($2,NULL,NULL)`,
      [owner, other],
    );
    await run.runtime.query(
      `INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES ($1,$2,now()+interval '1 hour',now()+interval '1 day')`,
      [owner, hashToken(token)],
    );
    const config = integrationConfiguration();
    const url = new URL(config.runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        TaxonomyModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: url.toString(),
        }),
      )
      .compile();
    service = module.get(TaxonomyService);
    repository = module.get(TaxonomyRepository);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    // Keep one listening server so keep-alive clients cannot reuse closed ephemeral listeners.
    await app.listen(0, '127.0.0.1');
    await service.create(other, 'categories', 'Foreign root');
    foreignCategory = (await service.list(other)).categories[0]!.id;
    await service.create(other, 'subcategories', 'Foreign child', foreignCategory);
    foreignSubcategory = (await service.list(other)).subcategories[0]!.id;
    await service.create(other, 'tags', 'Foreign tag');
    foreignTag = (await service.list(other)).tags[0]!.id;
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });

  it('requires real owner authentication, rejects injected ownership and isolates reads/mutations', async () => {
    await http().get('/api/v1/taxonomy').expect(401);
    await http().post('/api/v1/taxonomy/categories').send({ name: 'No access' }).expect(401);
    await http()
      .patch(`/api/v1/taxonomy/categories/${foreignCategory}`)
      .send({ name: 'No access' })
      .expect(401);
    await http().delete(`/api/v1/taxonomy/categories/${foreignCategory}`).send({}).expect(401);
    await post('categories', { name: 'Sneaky', ownerId: other }).expect(400);
    expect((await snapshot()).categories).toEqual([]);
    for (const [kind, id] of [
      ['categories', foreignCategory],
      ['subcategories', foreignSubcategory],
      ['tags', foreignTag],
    ]) {
      await patch(`${kind}/${id}`, { name: 'Changed' }).expect(404);
      await remove(`${kind}/${id}`, kind === 'tags' ? { removeRelationships: true } : {}).expect(
        404,
      );
    }
    await post('subcategories', { name: 'Bad', categoryId: foreignCategory }).expect(404);
    expect((await service.list(other)).categories[0]!.name).toBe('Foreign root');
    expect((await get()).headers['cache-control']).toBe('no-store');
  });
  it('preserves capitalisation while normalizing duplicates, validates names and structurally excludes cycles', async () => {
    const root = await category('Kitchen');
    const normalized = await post('categories', { name: '  Dining   Room  ' }).expect(201);
    expect(
      (normalized.body as TaxonomySnapshot).categories.some((row) => row.name === 'Dining Room'),
    ).toBe(true);
    const duplicate = await post('categories', { name: 'dINING room' }).expect(409);
    expect(duplicate.body.message).toBe('NAME_ALREADY_EXISTS');
    expect(JSON.stringify(duplicate.body)).not.toContain('dINING room');
    await post('categories', { name: 'Ｄｉｎｉｎｇ　Ｒｏｏｍ' }).expect(409);
    const child = await subcategory('Cookware', root);
    await post('subcategories', { name: ' cookware ', categoryId: root }).expect(409);
    const another = await category('Another root');
    await subcategory('Cookware', another);
    await patch(`subcategories/${child}`, { categoryId: child }).expect(400);
    await patch(`categories/${root}`, { parentId: root }).expect(400);
    await post('categories', { name: 'Root parent', categoryId: root }).expect(400);
    await post('subcategories', { name: 'Deep', categoryId: child }).expect(404);
    for (const name of ['', '   ', '\u200b', 'x'.repeat(121)])
      await post('categories', { name }).expect(400);
    await patch(`categories/${root}`, {}).expect(400);
    await patch('categories/not-a-uuid', { name: 'Bad' }).expect(400);
    const duplicates = await Promise.all([
      post('categories', { name: 'Concurrent' }),
      post('categories', { name: 'concurrent' }),
    ]);
    expect(duplicates.map((row) => row.status).sort()).toEqual([201, 409]);
  });
  it('atomically reorders complete siblings, detects changed membership and scopes ordering', async () => {
    const before = await snapshot();
    const ids = before.categories.map((row) => row.id).reverse();
    const ordered = await patch('categories/order', { ids }).expect(200);
    expect((ordered.body as TaxonomySnapshot).categories.map((row) => row.id)).toEqual(ids);
    expect((ordered.body as TaxonomySnapshot).categories.map((row) => row.position)).toEqual(
      ids.map((_, index) => index),
    );
    await patch('categories/order', { ids: ids.slice(1) }).expect(409);
    await patch('categories/order', { ids: [...ids.slice(1), foreignCategory] }).expect(409);
    await patch('categories/order', { ids: [ids[0], ids[0]] }).expect(400);
    const root = await category('Ordered children');
    const first = await subcategory('First', root);
    const second = await subcategory('Second', root);
    const result = await patch('subcategories/order', {
      categoryId: root,
      ids: [second, first],
    }).expect(200);
    expect(
      (result.body as TaxonomySnapshot).subcategories
        .filter((row) => row.categoryId === root)
        .map((row) => row.id),
    ).toEqual([second, first]);
    await patch('subcategories/order', { categoryId: foreignCategory, ids: [] }).expect(404);
    await patch('categories/order', { categoryId: root, ids }).expect(400);
  });
  it('retires and restores without losing classifications, rejects admission under retired roots and reserves names', async () => {
    const root = await category('Retirable');
    const child = await subcategory('Retirable child', root);
    const id = await item(root, child);
    await patch(`categories/${root}`, { retired: true }).expect(200);
    const retired = await snapshot();
    expect(retired.categories.find((row) => row.id === root)?.retiredAt).toBeTruthy();
    expect(retired.categories.find((row) => row.id === root)?.itemCount).toBe(1);
    expect(
      (await run.runtime.query('SELECT category_id,subcategory_id FROM items WHERE id=$1', [id]))
        .rows[0],
    ).toEqual({ category_id: root, subcategory_id: child });
    await post('subcategories', { name: 'Unavailable', categoryId: root }).expect(409);
    await post('categories', { name: 'retirable' }).expect(409);
    await patch(`subcategories/${child}`, { retired: true }).expect(200);
    await patch(`subcategories/${child}`, { retired: false }).expect(409);
    await patch(`categories/${root}`, { retired: false }).expect(200);
    await patch(`subcategories/${child}`, { retired: false }).expect(200);
    await patch(`subcategories/${child}`, { name: 'Renamed child' }).expect(200);
  });
  it('blocks orphaning, validates explicit replacements and atomically reassigns items with revisions/history', async () => {
    const from = await category('Move from');
    const to = await category('Move to');
    const child = await subcategory('Move child', from);
    const sibling = await subcategory('Move sibling', from);
    const foreignSibling = await subcategory('Other sibling', to);
    const id = await item(from, child);
    const otherId = await item(foreignCategory, foreignSubcategory, other);
    await remove(`categories/${from}`, { replacementId: to }).expect(409);
    await remove(`subcategories/${child}`).expect(409);
    await remove(`subcategories/${child}`, { replacementId: foreignSibling }).expect(409);
    await remove(`subcategories/${child}`, { replacementId: foreignSubcategory }).expect(404);
    await remove(`subcategories/${child}`, { replacementId: child }).expect(400);
    await patch(`subcategories/${sibling}`, { retired: true }).expect(200);
    await remove(`subcategories/${child}`, { replacementId: sibling }).expect(409);
    await patch(`subcategories/${sibling}`, { retired: false }).expect(200);
    await remove(`subcategories/${child}`, { replacementId: sibling }).expect(200);
    await remove(`subcategories/${sibling}`, {
      replacementId: await subcategory('Final child', from),
    }).expect(200);
    const last = (await snapshot()).subcategories.find((row) => row.name === 'Final child')!;
    // Remove this last classification by explicit replacement to another sibling, then handle that
    // sibling after its item is explicitly moved by a category-only fixture (future PER-10 operation).
    await run.runtime.query('UPDATE items SET subcategory_id=NULL WHERE id=$1', [id]);
    await remove(`subcategories/${last.id}`).expect(200);
    await remove(`categories/${from}`).expect(409);
    await remove(`categories/${from}`, { replacementId: foreignCategory }).expect(404);
    await patch(`categories/${to}`, { retired: true }).expect(200);
    await remove(`categories/${from}`, { replacementId: to }).expect(409);
    await patch(`categories/${to}`, { retired: false }).expect(200);
    await remove(`categories/${from}`, { replacementId: to }).expect(200);
    const moved = (
      await run.runtime.query(
        'SELECT category_id,subcategory_id,revision,original_entry FROM items WHERE id=$1',
        [id],
      )
    ).rows[0];
    expect(moved).toMatchObject({
      category_id: to,
      subcategory_id: null,
      revision: 4,
      original_entry: { name: 'Synthetic item' },
    });
    const events = await run.runtime.query(
      'SELECT metadata FROM lifecycle_events WHERE owner_id=$1 AND item_id=$2',
      [owner, id],
    );
    expect(events.rowCount).toBe(3);
    expect(
      events.rows.some((row) => row.metadata.fromId === from && row.metadata.toId === to),
    ).toBe(true);
    expect(
      (
        await run.runtime.query(
          'SELECT category_id,subcategory_id,revision FROM items WHERE id=$1',
          [otherId],
        )
      ).rows[0],
    ).toEqual({ category_id: foreignCategory, subcategory_id: foreignSubcategory, revision: 1 });
    expect((await snapshot()).categories.some((row) => row.id === from)).toBe(false);
  });
  it('requires explicit child removal consent and moves every child assignment with a parent deletion', async () => {
    const from = await category('Parent merge from');
    const to = await category('Parent merge to');
    const child = await subcategory('Merge child', from);
    const id = await item(from, child);
    await remove(`categories/${from}`, { replacementId: to }).expect(409);
    await remove(`categories/${from}`, { removeSubcategories: true }).expect(409);
    await remove(`categories/${from}`, { replacementId: to, removeSubcategories: true }).expect(
      200,
    );
    expect(
      (
        await run.runtime.query(
          'SELECT category_id,subcategory_id,revision FROM items WHERE id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ category_id: to, subcategory_id: null, revision: 2 });
    expect((await snapshot()).subcategories.some((row) => row.id === child)).toBe(false);
    const empty = await category('Empty parent');
    await subcategory('Empty child', empty);
    await remove(`categories/${empty}`, { removeSubcategories: true }).expect(200);
  });
  it('rolls back item reassignment, history and deletion together when a later write fails', async () => {
    const from = await category('Rollback from');
    const to = await category('Rollback to');
    const id = await item(from);
    const spy = jest
      .spyOn(repository, 'remove')
      .mockRejectedValueOnce(new ServiceUnavailableException('TAXONOMY_UNAVAILABLE'));
    try {
      await remove(`categories/${from}`, { replacementId: to }).expect(503);
    } finally {
      spy.mockRestore();
    }
    expect(
      (await run.runtime.query('SELECT category_id,revision FROM items WHERE id=$1', [id])).rows[0],
    ).toEqual({ category_id: from, revision: 1 });
    expect(
      (await run.runtime.query('SELECT id FROM lifecycle_events WHERE item_id=$1', [id])).rowCount,
    ).toBe(0);
    expect((await snapshot()).categories.some((row) => row.id === from)).toBe(true);
  });
  it('supports reusable tags, prevents normalized duplicates and duplicate joins, and explicitly removes relationships', async () => {
    const root = await category('Tagged root');
    const one = await item(root);
    const two = await item(root);
    const result = await post('tags', { name: 'Repair kit' }).expect(201);
    const tag = (result.body as TaxonomySnapshot).tags.find((row) => row.name === 'Repair kit')!.id;
    await post('tags', { name: ' repair   KIT ' }).expect(409);
    await post('tags', { name: 'x'.repeat(81) }).expect(400);
    await patch(`tags/${tag}`, { name: 'Useful' }).expect(200);
    await run.runtime.query(
      'INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES ($1,$2,$4),($1,$3,$4)',
      [owner, one, two, tag],
    );
    await expect(
      run.runtime.query('INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES ($1,$2,$3)', [
        owner,
        one,
        tag,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      run.runtime.query('INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES ($1,$2,$3)', [
        owner,
        one,
        foreignTag,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    expect((await snapshot()).tags.find((row) => row.id === tag)?.itemCount).toBe(2);
    await remove(`tags/${tag}`, { removeRelationships: false }).expect(409);
    await remove(`tags/${tag}`, {}).expect(400);
    await remove(`tags/${tag}`, { removeRelationships: true }).expect(200);
    expect(
      (await run.runtime.query('SELECT id FROM items WHERE id=ANY($1::uuid[])', [[one, two]]))
        .rowCount,
    ).toBe(2);
    expect(
      (await run.runtime.query('SELECT tag_id FROM item_tags WHERE tag_id=$1', [tag])).rowCount,
    ).toBe(0);
    expect((await service.list(other)).tags[0]!.id).toBe(foreignTag);
  });
  it('seeds removable demo roots once, keeps custom records custom, and never recreates deleted defaults', async () => {
    await category('Electronics');
    const results = await Promise.all([post('defaults', {}), post('defaults', {})]);
    expect(results.every((row) => row.status === 200)).toBe(true);
    const before = await snapshot();
    expect(before.defaultsSeeded).toBe(true);
    expect(before.categories.find((row) => row.name === 'Electronics')?.isDemo).toBe(false);
    const demo = before.categories.find((row) => row.isDemo)!;
    await remove(`categories/${demo.id}`).expect(200);
    await post('defaults', {}).expect(200);
    const after = await snapshot();
    expect(after.categories.some((row) => row.name === demo.name)).toBe(false);
    expect(after.categories.length).toBe(before.categories.length - 1);
    expect((await service.list(other)).defaultsSeeded).toBe(false);
    await applyMigrations(run.migration, run.schema);
    expect((await snapshot()).defaultsSeeded).toBe(true);
  });
  it('publishes versioned cookie-authenticated DTO and response contracts', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
        .build(),
    );
    const paths = Object.entries(doc.paths).filter(([path]) => path.startsWith('/api/v1/taxonomy'));
    expect(paths).toHaveLength(10);
    for (const [, path] of paths)
      for (const operation of Object.values(path)) {
        expect(operation.security).toEqual([{ ownerSession: [] }]);
        expect(operation.responses['401']).toBeDefined();
        expect(operation.responses['409']).toBeDefined();
      }
    const schemas = doc.components!.schemas!;
    expect(schemas.TaxonomySnapshotDto).toMatchObject({
      required: ['categories', 'subcategories', 'tags', 'defaultsSeeded'],
    });
    expect(JSON.stringify(schemas.TaxonomyNameDto)).not.toContain('ownerId');
    expect(schemas.DeleteTagDto).toMatchObject({ required: ['removeRelationships'] });
  });
});
