import { applicationMetadata, createDatabase, applyMigrations } from '@havefolio/db';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';

// Real service tests: two independent runs plus a third namespace representing unrelated work.
describe('migration and shared-service isolation', () => {
  it('builds empty schemas, denies runtime DDL, preserves other runs, and cleans failed work', async () => {
    const config = integrationConfiguration();
    const runs = [
      new IntegrationRun(config),
      new IntegrationRun(config),
      new IntegrationRun(config),
    ];
    const [a, b, unrelated] = runs;
    if (!a || !b || !unrelated) throw new Error('Missing test runs');
    const closed = new Set<IntegrationRun>();
    try {
      await Promise.all(runs.map((run) => run.start()));
      for (const run of runs) {
        await run.runtime.query('INSERT INTO application_metadata (key, value) VALUES ($1, $2)', [
          'probe',
          run.schema,
        ]);
        await expect(
          run.runtime.query('CREATE TABLE forbidden (id integer)'),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          run.runtime.query(`ALTER TABLE application_metadata ADD COLUMN forbidden text`),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          run.runtime.query('INSERT INTO application_metadata (key, value) VALUES ($1, $2)', [
            'probe',
            'duplicate',
          ]),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          run.runtime.query('INSERT INTO application_metadata (key, value) VALUES ($1, NULL)', [
            'null',
          ]),
        ).rejects.toMatchObject({ code: '23502' });
      }
      const keys = await Promise.all(runs.map((run) => run.setKey('probe', run.schema)));
      // Exact journal is in each run schema; repeat application must be a no-op.
      await expect(applyMigrations(a.runtime, `${a.schema}_forbidden`)).rejects.toThrow();
      await applyMigrations(a.migration, a.schema);
      const journal = await a.migration.query(
        `SELECT count(*)::int AS count FROM "${a.schema}".__drizzle_migrations`,
      );
      expect(journal.rows[0].count).toBeGreaterThan(0);
      try {
        throw new Error('Simulated failed test');
      } catch {
        await a.close();
        closed.add(a);
      }
      expect(await b.valkey.get(keys[0]!)).toBeNull();
      for (const [index, run] of [b, unrelated].entries()) {
        const rows = await run.runtime.query(
          'SELECT value FROM application_metadata WHERE key = $1',
          ['probe'],
        );
        expect(rows.rows).toEqual([{ value: run.schema }]);
        expect(await run.valkey.get(keys[index + 1]!)).toBe(run.schema);
      }
      const removed = await b.migration.query(
        'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS present',
        [a.schema],
      );
      expect(removed.rows[0].present).toBe(false);
      // Shared authenticated ACL rejects an out-of-namespace write.
      if (process.env.TEST_VALKEY_ACL_ENFORCED === 'true') {
        await expect(b.valkey.set('outside:per4:forbidden', 'probe')).rejects.toThrow(/NOPERM/);
      }
    } finally {
      const results = await Promise.allSettled(
        runs.filter((run) => !closed.has(run)).map((run) => run.close()),
      );
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    }
  }, 60000);
});
